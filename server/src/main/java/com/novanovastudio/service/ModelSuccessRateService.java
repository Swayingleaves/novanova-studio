package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.ModelStatsDtos;
import com.novanovastudio.repository.ModelStatsSettingsRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.TeamScope;
import java.time.Duration;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 平台模型调用成功率统计与配置服务。
 * <p>
 * 每次模型请求进入终态（成功或失败）时按自然日累加 Redis Hash 计数，
 * 查询模型列表时按后台配置的最近天数窗口聚合计算 0-100 区间成功率，并辅以短周期内存缓存降低 Redis 读取开销。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-24 09:25:00
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ModelSuccessRateService {

    /** 默认统计天数窗口。 */
    public static final int DEFAULT_WINDOW_DAYS = 3;

    /** 最小允许配置的统计天数。 */
    public static final int MIN_WINDOW_DAYS = 1;

    /** 最大允许配置的统计天数。 */
    public static final int MAX_WINDOW_DAYS = 365;

    /** Redis 按日统计 Hash 键前缀。 */
    static final String DAILY_KEY_PREFIX = "novanova:ai:model:stats:daily:";

    /** 成功计数字段后缀。 */
    static final String SUCCEEDED_FIELD_SUFFIX = ":s";

    /** 失败计数字段后缀。 */
    static final String FAILED_FIELD_SUFFIX = ":f";

    /** 每日统计桶在 Redis 中的保留时长（覆盖最大可配天数并留一天缓冲）。 */
    private static final Duration DAILY_BUCKET_TTL = Duration.ofDays(MAX_WINDOW_DAYS + 1L);

    /** 日期格式化器。 */
    private static final DateTimeFormatter DATE_FORMATTER = DateTimeFormatter.ISO_LOCAL_DATE;

    /** 聚合结果本地缓存有效期（毫秒）。 */
    private static final long CACHE_TTL_MILLIS = 30_000L;

    /** 配置仓储。 */
    private final ModelStatsSettingsRepository settingsRepository;

    /** 响应式 Redis 模板。 */
    private final ReactiveStringRedisTemplate redisTemplate;

    /** 当前登录用户提供器。 */
    private final CurrentUserProvider currentUserProvider;

    /** 聚合统计结果的轻量内存缓存。 */
    private final AtomicReference<CachedStats> statsCache = new AtomicReference<>();

    /**
     * 平台管理员读取模型成功率统计配置。
     *
     * @return Mono<ModelStatsSettings> 统计配置
     */
    public Mono<ModelStatsDtos.ModelStatsSettings> getAdminSettings() {
        return requirePlatformAdministrator().then(getSettings());
    }

    /**
     * 读取当前生效的模型成功率统计配置，无记录时返回默认 3 天。
     *
     * @return Mono<ModelStatsSettings> 统计配置
     */
    public Mono<ModelStatsDtos.ModelStatsSettings> getSettings() {
        return settingsRepository.findSingleton()
                .map(row -> new ModelStatsDtos.ModelStatsSettings(clampWindowDays(row.successRateWindowDays())))
                .defaultIfEmpty(new ModelStatsDtos.ModelStatsSettings(DEFAULT_WINDOW_DAYS))
                .onErrorResume(error -> {
                    log.warn("读取模型成功率统计配置失败，回退默认天数: error={}", error.getMessage());
                    return Mono.just(new ModelStatsDtos.ModelStatsSettings(DEFAULT_WINDOW_DAYS));
                });
    }

    /**
     * 平台管理员保存模型成功率统计天数配置并失效内存缓存。
     *
     * @param request SaveModelStatsSettingsRequest 保存请求
     * @return Mono<ModelStatsSettings> 保存后的配置
     */
    public Mono<ModelStatsDtos.ModelStatsSettings> saveSettings(ModelStatsDtos.SaveModelStatsSettingsRequest request) {
        return requirePlatformAdministrator().then(Mono.defer(() -> {
            if (request == null || request.successRateWindowDays() == null) {
                return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "模型成功率统计天数不能为空"));
            }
            int days = request.successRateWindowDays();
            if (days < MIN_WINDOW_DAYS || days > MAX_WINDOW_DAYS) {
                return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID,
                        "模型成功率统计天数必须在 " + MIN_WINDOW_DAYS + " 到 " + MAX_WINDOW_DAYS + " 天之间"));
            }
            return settingsRepository.upsert(days)
                    .doOnNext(row -> {
                        statsCache.set(null);
                        log.info("保存模型成功率统计配置成功: successRateWindowDays={}", row.successRateWindowDays());
                    })
                    .map(row -> new ModelStatsDtos.ModelStatsSettings(clampWindowDays(row.successRateWindowDays())));
        }));
    }

    /**
     * 记录一次模型调用终态结果（成功或失败）。
     * <p>
     * 统计属于可容错指标，写入失败仅记录告警日志，不影响主调用流程。
     *
     * @param modelConfigId String 模型配置唯一标识
     * @param succeeded boolean true 表示成功，false 表示失败
     * @return Mono<Void> 记录完成信号
     */
    public Mono<Void> recordCallResult(String modelConfigId, boolean succeeded) {
        if (!StringUtils.hasText(modelConfigId)) {
            return Mono.empty();
        }
        String normalizedId = modelConfigId.trim();
        String key = dailyKey(LocalDate.now());
        String field = normalizedId + (succeeded ? SUCCEEDED_FIELD_SUFFIX : FAILED_FIELD_SUFFIX);
        return redisTemplate.opsForHash().increment(key, field, 1L)
                .then(redisTemplate.expire(key, DAILY_BUCKET_TTL))
                .doOnSuccess(ignored -> statsCache.set(null))
                .onErrorResume(error -> {
                    log.warn("写入模型调用成功率统计失败: modelConfigId={}, succeeded={}, error={}",
                            normalizedId, succeeded, error.getMessage());
                    return Mono.empty();
                })
                .then();
    }

    /**
     * 以非阻塞方式触发一次模型调用结果记录，适用于流式回调等不等待落库的场景。
     *
     * @param modelConfigId String 模型配置唯一标识
     * @param succeeded boolean true 表示成功，false 表示失败
     */
    public void recordCallResultAsync(String modelConfigId, boolean succeeded) {
        recordCallResult(modelConfigId, succeeded).subscribe(
                ignored -> {
                },
                error -> log.warn("异步记录模型调用成功率失败: modelConfigId={}, succeeded={}, error={}",
                        modelConfigId, succeeded, error.getMessage()));
    }

    /**
     * 获取当前配置天数窗口内所有模型的成功率统计映射（key 为 modelConfigId）。
     *
     * @return Mono<Map<String, ModelSuccessRateStats>> 各模型成功率映射，无调用记录的模型不包含在内
     */
    public Mono<Map<String, ModelStatsDtos.ModelSuccessRateStats>> getSuccessRateStatsMap() {
        long now = System.currentTimeMillis();
        CachedStats cached = statsCache.get();
        if (cached != null && now < cached.expiresAtMillis()) {
            return Mono.just(cached.statsByModelConfigId());
        }
        return getSettings()
                .flatMap(settings -> loadStatsFromRedis(settings.successRateWindowDays()))
                .doOnNext(map -> statsCache.set(new CachedStats(map, System.currentTimeMillis() + CACHE_TTL_MILLIS)))
                .onErrorResume(error -> {
                    log.warn("读取模型调用成功率统计失败，降级为空映射: error={}", error.getMessage());
                    return Mono.just(Map.of());
                });
    }

    /**
     * 从 Redis 按最近 N 天汇总每个模型的成功与失败次数。
     *
     * @param windowDays int 统计天数窗口
     * @return Mono<Map<String, ModelSuccessRateStats>> 汇总结果
     */
    private Mono<Map<String, ModelStatsDtos.ModelSuccessRateStats>> loadStatsFromRedis(int windowDays) {
        int days = clampWindowDays(windowDays);
        LocalDate today = LocalDate.now();
        List<String> keys = new ArrayList<>(days);
        for (int offset = 0; offset < days; offset++) {
            keys.add(dailyKey(today.minusDays(offset)));
        }
        return Flux.fromIterable(keys)
                .flatMap(key -> redisTemplate.opsForHash().entries(key)
                        .onErrorResume(error -> {
                            log.warn("读取单日模型统计桶失败: key={}, error={}", key, error.getMessage());
                            return Flux.empty();
                        }))
                .collectList()
                .map(entries -> aggregateEntries(entries, days));
    }

    /**
     * 聚合多日 Redis Hash 条目为模型成功率映射。
     *
     * @param entries List<Map.Entry<Object, Object>> Redis Hash 条目集合
     * @param windowDays int 生效统计天数
     * @return Map<String, ModelSuccessRateStats> 模型成功率映射
     */
    static Map<String, ModelStatsDtos.ModelSuccessRateStats> aggregateEntries(
            List<Map.Entry<Object, Object>> entries, int windowDays) {
        Map<String, long[]> counters = new HashMap<>();
        for (Map.Entry<Object, Object> entry : entries) {
            if (entry.getKey() == null || entry.getValue() == null) {
                continue;
            }
            String field = String.valueOf(entry.getKey());
            long count = parsePositiveLong(String.valueOf(entry.getValue()));
            if (count <= 0) {
                continue;
            }
            if (field.endsWith(SUCCEEDED_FIELD_SUFFIX)) {
                String modelConfigId = field.substring(0, field.length() - SUCCEEDED_FIELD_SUFFIX.length());
                if (StringUtils.hasText(modelConfigId)) {
                    counters.computeIfAbsent(modelConfigId, ignored -> new long[2])[0] += count;
                }
            } else if (field.endsWith(FAILED_FIELD_SUFFIX)) {
                String modelConfigId = field.substring(0, field.length() - FAILED_FIELD_SUFFIX.length());
                if (StringUtils.hasText(modelConfigId)) {
                    counters.computeIfAbsent(modelConfigId, ignored -> new long[2])[1] += count;
                }
            }
        }
        Map<String, ModelStatsDtos.ModelSuccessRateStats> result = new HashMap<>(counters.size());
        for (Map.Entry<String, long[]> counter : counters.entrySet()) {
            long succeeded = counter.getValue()[0];
            long failed = counter.getValue()[1];
            long total = succeeded + failed;
            if (total <= 0) {
                continue;
            }
            int rate = calculateSuccessRate(succeeded, total);
            result.put(counter.getKey(), new ModelStatsDtos.ModelSuccessRateStats(rate, succeeded, total, windowDays));
        }
        return Map.copyOf(result);
    }

    /**
     * 计算 0 至 100 整数成功率（四舍五入并限制在合法区间）。
     *
     * @param succeeded long 成功次数
     * @param total long 总次数
     * @return int 0 至 100 的成功率百分比
     */
    static int calculateSuccessRate(long succeeded, long total) {
        if (total <= 0) {
            return 0;
        }
        int rounded = (int) Math.round((succeeded * 100.0) / total);
        return Math.max(0, Math.min(100, rounded));
    }

    /**
     * 构造指定日期的 Redis 统计键。
     *
     * @param date LocalDate 自然日
     * @return String Redis 键名
     */
    static String dailyKey(LocalDate date) {
        return DAILY_KEY_PREFIX + DATE_FORMATTER.format(date);
    }

    /**
     * 约束统计天数在合法范围内。
     *
     * @param days int 原始天数
     * @return int 约束后的天数
     */
    static int clampWindowDays(int days) {
        if (days < MIN_WINDOW_DAYS) {
            return DEFAULT_WINDOW_DAYS;
        }
        return Math.min(days, MAX_WINDOW_DAYS);
    }

    /**
     * 解析正整数计数值，非法值返回 0。
     *
     * @param raw String 原始字符串
     * @return long 计数值
     */
    private static long parsePositiveLong(String raw) {
        try {
            long value = Long.parseLong(raw.trim());
            return Math.max(0L, value);
        } catch (NumberFormatException ignored) {
            return 0L;
        }
    }

    /**
     * 限定平台空间的全局管理员才能修改模型成功率统计配置。
     *
     * @return Mono<Void> 权限校验通过信号
     */
    private Mono<Void> requirePlatformAdministrator() {
        return currentUserProvider.currentUser().flatMap(user -> TeamScope.current()
                .filter(scope -> scope.teamId() == 0 && "admin".equals(user.role()))
                .switchIfEmpty(Mono.error(new BusinessException(
                        ErrorCode.PERMISSION_DENIED, "仅平台管理员可管理模型成功率统计配置")))
                .then());
    }

    /**
     * 聚合结果本地缓存条目。
     *
     * @param statsByModelConfigId 模型配置标识到成功率统计的映射
     * @param expiresAtMillis 缓存过期时间戳（毫秒）
     */
    private record CachedStats(Map<String, ModelStatsDtos.ModelSuccessRateStats> statsByModelConfigId,
                               long expiresAtMillis) {
    }
}
