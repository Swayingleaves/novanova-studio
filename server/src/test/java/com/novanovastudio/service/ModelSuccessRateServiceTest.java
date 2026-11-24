package com.novanovastudio.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.dto.ModelStatsDtos;
import com.novanovastudio.repository.ModelStatsSettingsRepository;
import com.novanovastudio.security.CurrentUser;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.TeamScope;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.ReactiveHashOperations;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

/**
 * ModelSuccessRateService 单元测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-24 09:30:00
 */
class ModelSuccessRateServiceTest {

    /** 配置仓储模拟。 */
    private ModelStatsSettingsRepository settingsRepository;

    /** Redis 模板模拟。 */
    private ReactiveStringRedisTemplate redisTemplate;

    /** Redis Hash 操作模拟。 */
    private ReactiveHashOperations<String, Object, Object> hashOperations;

    /** 当前用户提供器模拟。 */
    private CurrentUserProvider currentUserProvider;

    /** 被测服务。 */
    private ModelSuccessRateService service;

    @SuppressWarnings("unchecked")
    @BeforeEach
    void setUp() {
        settingsRepository = mock(ModelStatsSettingsRepository.class);
        redisTemplate = mock(ReactiveStringRedisTemplate.class);
        hashOperations = mock(ReactiveHashOperations.class);
        currentUserProvider = mock(CurrentUserProvider.class);
        when(redisTemplate.opsForHash()).thenReturn(hashOperations);
        service = new ModelSuccessRateService(settingsRepository, redisTemplate, currentUserProvider);
    }

    @Test
    void aggregateEntriesComputesRoundedRatesAndIgnoresEmptyModels() {
        List<Map.Entry<Object, Object>> entries = List.of(
                Map.entry("m1:s", "9"),
                Map.entry("m1:f", "1"),
                Map.entry("m2:s", "2"),
                Map.entry("m2:f", "1"),
                Map.entry("m2:s", "1"),
                Map.entry("m3:f", "5"),
                Map.entry("m4:s", "0"),
                Map.entry("invalid", "10")
        );

        Map<String, ModelStatsDtos.ModelSuccessRateStats> result = ModelSuccessRateService.aggregateEntries(entries, 3);

        assertThat(result).containsOnlyKeys("m1", "m2", "m3");
        assertThat(result.get("m1")).isEqualTo(new ModelStatsDtos.ModelSuccessRateStats(90, 9, 10, 3));
        assertThat(result.get("m2")).isEqualTo(new ModelStatsDtos.ModelSuccessRateStats(75, 3, 4, 3));
        assertThat(result.get("m3")).isEqualTo(new ModelStatsDtos.ModelSuccessRateStats(0, 0, 5, 3));
    }

    @Test
    void recordCallResultIncrementsDailyHashAndSetsTtl() {
        when(hashOperations.increment(anyString(), any(), anyLong())).thenReturn(Mono.just(1L));
        when(redisTemplate.expire(anyString(), any(Duration.class))).thenReturn(Mono.just(true));

        StepVerifier.create(service.recordCallResult("model-1", true)).verifyComplete();

        verify(hashOperations).increment(anyString(), org.mockito.ArgumentMatchers.eq("model-1:s"), org.mockito.ArgumentMatchers.eq(1L));
        verify(redisTemplate).expire(anyString(), org.mockito.ArgumentMatchers.eq(Duration.ofDays(366)));
    }

    @Test
    void getSuccessRateStatsMapAggregatesAcrossConfiguredWindowDays() {
        when(settingsRepository.findSingleton())
                .thenReturn(Mono.just(new ModelStatsSettingsRepository.ModelStatsSettingsRow(2, OffsetDateTime.now())));
        when(hashOperations.entries(anyString())).thenReturn(Flux.just(
                Map.entry("model-a:s", "4"),
                Map.entry("model-a:f", "1")
        ));

        StepVerifier.create(service.getSuccessRateStatsMap())
                .assertNext(map -> {
                    assertThat(map).containsKey("model-a");
                    // 2 天桶各返回 4 成功 1 失败，合计 8/10 = 80%
                    assertThat(map.get("model-a"))
                            .isEqualTo(new ModelStatsDtos.ModelSuccessRateStats(80, 8, 10, 2));
                })
                .verifyComplete();
    }

    @Test
    void saveSettingsRejectsOutOfRangeDays() {
        when(currentUserProvider.currentUser())
                .thenReturn(Mono.just(new CurrentUser(1L, "admin@admin.com", "admin", 1)));

        StepVerifier.create(service.saveSettings(new ModelStatsDtos.SaveModelStatsSettingsRequest(0))
                        .contextWrite(context -> context.put(TeamScope.CONTEXT_KEY, TeamScope.PLATFORM)))
                .expectError(BusinessException.class)
                .verify();

        StepVerifier.create(service.saveSettings(new ModelStatsDtos.SaveModelStatsSettingsRequest(366))
                        .contextWrite(context -> context.put(TeamScope.CONTEXT_KEY, TeamScope.PLATFORM)))
                .expectError(BusinessException.class)
                .verify();
    }
}
