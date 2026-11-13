package com.novanovastudio.storage;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.entity.PersistenceRecords;
import com.novanovastudio.security.TeamScope;
import com.novanovastudio.service.PersistenceService;
import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * 私有存储桶读地址签发服务。
 * <p>
 * 媒体读地址不进入数据库和 JSONB，统一在接口响应前按对象存储配置现签；历史公开地址会解析出对象键后重新签名。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-09 17:40
 */
@Slf4j
@Service
public class MediaAccessService {

    /** 存储配置缓存时间，配置变更由管理入口清理。 */
    private static final Duration CONFIG_CACHE_TTL = Duration.ofSeconds(30);

    /** 已签名地址复用的最短剩余有效期，避免把即将过期的地址返回给浏览器。 */
    private static final Duration MIN_REMAINING_TTL = Duration.ofMinutes(5);

    /** 已签名地址缓存上限，超过后整表清理，避免长时间运行无限增长。 */
    private static final int SIGNED_URL_CACHE_LIMIT = 10_000;

    /** 延迟读取持久化服务，避免与媒体响应构造形成循环依赖。 */
    private final ObjectProvider<PersistenceService> persistenceServiceProvider;

    /** 对象存储适配器。 */
    private final ObjectStorageService objectStorageService;

    /** 对象存储配置。 */
    private final NovanovaProperties properties;

    /** 存储配置缓存。 */
    private volatile CachedConfigs cachedConfigs;

    /** 已签名地址缓存，键为存储配置、对象键和用途。 */
    private final Map<String, SignedUrl> signedUrls = new ConcurrentHashMap<>();

    /**
     * 创建读地址签发服务。
     *
     * @param persistenceServiceProvider ObjectProvider&lt;PersistenceService&gt; 持久化服务
     * @param objectStorageService ObjectStorageService 对象存储服务
     * @param properties NovanovaProperties 应用配置
     */
    public MediaAccessService(ObjectProvider<PersistenceService> persistenceServiceProvider,
                              ObjectStorageService objectStorageService,
                              NovanovaProperties properties) {
        this.persistenceServiceProvider = persistenceServiceProvider;
        this.objectStorageService = objectStorageService;
        this.properties = properties;
    }

    /**
     * 读地址用途，决定签名有效期和下载语义。
     */
    public enum Purpose {
        /** 页面预览、图片/视频/音频播放 */
        PREVIEW,
        /** 任务列表缩略图。支持的服务商在读取时把长边缩到 160 像素 */
        LIST_THUMBNAIL,
        /** 卡片封面。支持的服务商在读取时把长边缩到 960 像素，供技能市场等大卡片展示 */
        CARD_COVER,
        /** 首页作品墙缩略图。支持的服务商在读取时把长边缩到 720 像素，点击后再读取原图 */
        HOME_CARD,
        /** 附件下载 */
        DOWNLOAD,
        /** 第三方模型拉取参考素材 */
        THIRD_PARTY,
        /** 公开分享页展示 */
        PUBLIC_PAGE
    }

    /**
     * 签名后的读地址。
     *
     * @param url String 读地址，无法签名时为原始地址
     * @param expiresAt String 到期时间，无法签名时为空
     */
    public record Access(String url, String expiresAt) {
    }

    /**
     * 按媒体记录签发读地址。
     *
     * @param record MediaFileRecord 媒体记录
     * @param purpose Purpose 用途
     * @return Mono&lt;Access&gt; 读地址，没有对象键时返回原始地址
     */
    public Mono<Access> sign(PersistenceRecords.MediaFileRecord record, Purpose purpose) {
        if (record == null) {
            return Mono.just(new Access("", null));
        }
        if (!StringUtils.hasText(record.getObjectStorageKey())) {
            return Mono.just(new Access(firstNonEmpty(record.getObjectStorageUrl(), record.getSourceUrl()), null));
        }
        return signingConfig(record)
                .flatMap(config -> signedUrl(config, record.getObjectStorageKey(), record.getMimeType(),
                        lastSegment(record.getObjectStorageKey()), purpose, purpose == Purpose.DOWNLOAD))
                .map(url -> new Access(url, expiresAt(purpose).toString()))
                .switchIfEmpty(Mono.fromSupplier(() -> new Access(firstNonEmpty(record.getObjectStorageUrl(), record.getSourceUrl()), null)))
                .onErrorResume(error -> {
                    log.error("签发媒体读地址失败，回退原始地址: storageKey={}", record.getStorageKey(), error);
                    return Mono.just(new Access(firstNonEmpty(record.getObjectStorageUrl(), record.getSourceUrl()), null));
                });
    }

    /**
     * 按存储配置和对象键签发读地址，供分享副本、原文等只保存对象键的记录使用。
     *
     * @param storageId String 存储配置标识
     * @param objectKey String 对象键
     * @param fileName String 原始文件名
     * @param mimeType String 媒体类型
     * @param purpose Purpose 用途
     * @param download boolean 是否附件下载
     * @return Mono&lt;Access&gt; 读地址
     */
    public Mono<Access> signObject(String storageId, String objectKey, String fileName, String mimeType, Purpose purpose, boolean download) {
        if (!StringUtils.hasText(storageId) || !StringUtils.hasText(objectKey)) {
            return Mono.empty();
        }
        return persistenceServiceProvider.getObject().getObjectStorageForCleanup(storageId)
                .contextWrite(context -> context.put(TeamScope.SYSTEM_KEY, true))
                .flatMap(config -> signedUrl(config, objectKey, mimeType, fileName, purpose, download))
                .map(url -> new Access(url, expiresAt(purpose).toString()));
    }

    /**
     * 批量签发媒体读地址。
     *
     * @param records List&lt;MediaFileRecord&gt; 媒体记录
     * @param purpose Purpose 用途
     * @return Mono&lt;Map&lt;String, Access&gt;&gt; 媒体存储键到读地址的映射
     */
    public Mono<Map<String, Access>> signAll(List<PersistenceRecords.MediaFileRecord> records, Purpose purpose) {
        if (records == null || records.isEmpty()) {
            return Mono.just(Map.of());
        }
        return Flux.fromIterable(records)
                .concatMap(record -> sign(record, purpose).map(access -> Map.entry(record.getStorageKey(), access)))
                .collectMap(Map.Entry::getKey, Map.Entry::getValue, LinkedHashMap::new);
    }

    /**
     * 为单个地址重新签名，非本系统对象存储地址原样返回。
     *
     * @param url String 原始地址
     * @param purpose Purpose 用途
     * @return Mono&lt;String&gt; 签名地址
     */
    public Mono<String> signUrl(String url, Purpose purpose) {
        if (!isHttpUrl(url)) {
            return Mono.just(url);
        }
        String clean = stripQuery(url);
        return configs().flatMap(list -> {
            Optional<OwnedUrl> owned = match(clean, list);
            if (owned.isEmpty()) {
                return Mono.just(url);
            }
            OwnedUrl target = owned.get();
            return signedUrl(target.config(), target.key(), null, lastSegment(target.key()), purpose, false)
                    .map(signed -> signed);
        }).onErrorResume(error -> {
            log.error("重新签名历史媒体地址失败，保留原始地址", error);
            return Mono.just(url);
        });
    }

    /**
     * 为地址列表重新签名，非本系统对象存储地址原样返回。
     *
     * @param urls Collection&lt;String&gt; 原始地址
     * @param purpose Purpose 用途
     * @return Mono&lt;Map&lt;String, String&gt;&gt; 原始地址到签名地址的映射
     */
    public Mono<Map<String, String>> signUrls(Collection<String> urls, Purpose purpose) {
        if (urls == null || urls.isEmpty()) {
            return Mono.just(Map.of());
        }
        Set<String> unique = new LinkedHashSet<>(urls);
        return Flux.fromIterable(unique)
                .concatMap(url -> signUrl(url, purpose).map(signed -> Map.entry(url, signed)))
                .collectMap(Map.Entry::getKey, Map.Entry::getValue, LinkedHashMap::new);
    }

    /**
     * 递归替换 JSON 中本系统对象存储的历史公开地址，便于画布、素材、生成记录等快照直接返回可用地址。
     *
     * @param json JSONObject 快照
     * @param purpose Purpose 用途
     * @return Mono&lt;JSONObject&gt; 替换地址后的快照
     */
    public Mono<JSONObject> signJson(JSONObject json, Purpose purpose) {
        if (json == null || json.isEmpty()) {
            return Mono.justOrEmpty(json);
        }
        Set<String> urls = new LinkedHashSet<>();
        collectUrls(json, urls);
        return signUrls(urls, purpose).map(replacements -> replaceUrls(json, replacements));
    }

    /**
     * 递归替换 JSON 数组中本系统对象存储的历史公开地址。
     *
     * @param array JSONArray 数组
     * @param purpose Purpose 用途
     * @return Mono&lt;JSONArray&gt; 替换地址后的数组
     */
    public Mono<JSONArray> signJsonArray(JSONArray array, Purpose purpose) {
        if (array == null || array.isEmpty()) {
            return Mono.justOrEmpty(array);
        }
        Set<String> urls = new LinkedHashSet<>();
        collectUrls(array, urls);
        return signUrls(urls, purpose).map(replacements -> replaceUrls(array, replacements));
    }

    /**
     * 清理存储配置与签名地址缓存，配置变更后调用。
     */
    public void invalidate() {
        cachedConfigs = null;
        signedUrls.clear();
    }

    /**
     * 读取可签发地址的全部对象存储配置，短时缓存。
     *
     * @return Mono&lt;List&lt;PersistenceDtos.ObjectStorageConfig&gt;&gt; 对象存储配置
     */
    private Mono<List<PersistenceDtos.ObjectStorageConfig>> configs() {
        CachedConfigs snapshot = cachedConfigs;
        if (snapshot != null && snapshot.loadedAt().plus(CONFIG_CACHE_TTL).isAfter(Instant.now())) {
            return Mono.just(snapshot.configs());
        }
        return persistenceServiceProvider.getObject().listSigningObjectStorageConfigs()
                .map(configs -> {
                    cachedConfigs = new CachedConfigs(Instant.now(), configs);
                    return configs;
                });
    }

    /**
     * 读取媒体记录对应的存储配置。
     *
     * @param record MediaFileRecord 媒体记录
     * @return Mono&lt;PersistenceDtos.ObjectStorageConfig&gt; 存储配置
     */
    private Mono<PersistenceDtos.ObjectStorageConfig> signingConfig(PersistenceRecords.MediaFileRecord record) {
        PersistenceService persistenceService = persistenceServiceProvider.getObject();
        if (StringUtils.hasText(record.getObjectStorageConfigId())) {
            // 优先使用批量读取的配置缓存，停用或已删除的配置再回查清理入口。
            return configs().flatMapMany(Flux::fromIterable)
                    .filter(config -> record.getObjectStorageConfigId().trim().equals(config.id()))
                    .next()
                    .switchIfEmpty(persistenceService.getObjectStorageForCleanup(record.getObjectStorageConfigId())
                            .contextWrite(context -> context.put(TeamScope.SYSTEM_KEY, true)));
        }
        return configs().flatMapMany(Flux::fromIterable)
                .filter(config -> sameText(config.provider(), record.getObjectStorageProvider())
                        && sameText(config.bucket(), record.getBucket())
                        && sameText(config.region(), record.getRegion()))
                .next();
    }

    /**
     * 生成并缓存签名地址。
     *
     * @param config 存储配置
     * @param key 对象键
     * @param mimeType 媒体类型
     * @param fileName 原始文件名
     * @param purpose 用途
     * @param download 是否附件下载
     * @return Mono&lt;String&gt; 签名地址
     */
    private Mono<String> signedUrl(PersistenceDtos.ObjectStorageConfig config, String key, String mimeType,
                                   String fileName, Purpose purpose, boolean download) {
        Instant expiresAt = expiresAt(purpose);
        String cacheKey = config.id() + "|" + key + "|" + purpose + "|" + download;
        SignedUrl cached = signedUrls.get(cacheKey);
        if (cached != null && cached.expiresAt().minus(MIN_REMAINING_TTL).isAfter(Instant.now())) {
            return Mono.just(cached.url());
        }
        String resolvedName = StringUtils.hasText(fileName) ? fileName : lastSegment(key);
        String resolvedMimeType = StringUtils.hasText(mimeType) ? mimeType : null;
        int edge = thumbnailEdge(purpose);
        // PNG 截图缩到 720 之后仍然有 MB 级体积，首页卡片缩放时一并转成 JPEG；其他用途保持原格式。
        boolean jpeg = purpose == Purpose.HOME_CARD && edge > 0 && "image/png".equalsIgnoreCase(resolvedMimeType);
        String outputMimeType = jpeg ? "image/jpeg" : resolvedMimeType;
        return Mono.fromCallable(() -> edge > 0
                        ? objectStorageService.createThumbnailReadUrl(config, key, resolvedName, outputMimeType, download, expiresAt, edge, jpeg)
                        : objectStorageService.createReadUrl(config, key, resolvedName, outputMimeType, download, expiresAt))
                .subscribeOn(Schedulers.boundedElastic())
                .doOnNext(url -> {
                    if (signedUrls.size() > SIGNED_URL_CACHE_LIMIT) {
                        signedUrls.clear();
                    }
                    signedUrls.put(cacheKey, new SignedUrl(url, expiresAt));
                });
    }

    /**
     * 按用途读取图片缩放长边，非图片缩略用途返回 0 表示读取原图。
     *
     * @param purpose Purpose 读地址用途
     * @return int 缩放长边像素
     */
    private static int thumbnailEdge(Purpose purpose) {
        return switch (purpose) {
            case LIST_THUMBNAIL -> 160;
            case CARD_COVER -> 960;
            case HOME_CARD -> 720;
            default -> 0;
        };
    }

    /**
     * 按用途计算到期时间。
     *
     * @param purpose Purpose 用途
     * @return Instant 到期时间
     */
    private Instant expiresAt(Purpose purpose) {
        NovanovaProperties.ObjectStorage.SignTtl ttl = properties.getObjectStorage().getSignTtl();
        int seconds = switch (purpose) {
            case DOWNLOAD -> ttl.getDownloadSeconds();
            case THIRD_PARTY -> ttl.getThirdPartySeconds();
            case PUBLIC_PAGE -> ttl.getPublicPageSeconds();
            default -> ttl.getPreviewSeconds();
        };
        return Instant.now().plusSeconds(Math.max(1, seconds));
    }

    /**
     * 从地址列表解析出属于本系统对象存储的对象键。
     *
     * @param url 去除查询参数后的地址
     * @param configs 存储配置
     * @return Optional&lt;OwnedUrl&gt; 命中的配置与对象键
     */
    private Optional<OwnedUrl> match(String url, List<PersistenceDtos.ObjectStorageConfig> configs) {
        for (PersistenceDtos.ObjectStorageConfig config : configs) {
            for (String base : baseUrls(config)) {
                String normalizedBase = base.replaceAll("/+$", "");
                if (url.equals(normalizedBase)) {
                    return Optional.of(new OwnedUrl(config, ""));
                }
                if (url.regionMatches(true, 0, normalizedBase + "/", 0, normalizedBase.length() + 1)) {
                    String key = ObjectStorageUrlBuilder.decodeKeyPath(url.substring(normalizedBase.length() + 1));
                    if (StringUtils.hasText(key)) {
                        return Optional.of(new OwnedUrl(config, key));
                    }
                }
            }
        }
        return Optional.empty();
    }

    /**
     * 构造存储配置可能使用的访问前缀。
     *
     * @param config 存储配置
     * @return List&lt;String&gt; 访问前缀
     */
    private List<String> baseUrls(PersistenceDtos.ObjectStorageConfig config) {
        List<String> bases = new ArrayList<>();
        if (StringUtils.hasText(config.publicBaseUrl())) {
            bases.add(config.publicBaseUrl().trim());
        }
        switch (config.provider()) {
            case "tencentCos" -> bases.add("https://" + config.bucket().trim() + ".cos." + config.region().trim() + ".myqcloud.com");
            case "aliyunOss" -> {
                String host = endpointHost(config.endpoint());
                if (StringUtils.hasText(host)) {
                    bases.add("https://" + config.bucket().trim() + "." + host);
                }
            }
            default -> {
                // 七牛云与 R2 只有配置的公开访问域名可作为地址前缀。
            }
        }
        return bases;
    }

    /**
     * 读取阿里云 Endpoint 的域名部分。
     *
     * @param endpoint String Endpoint
     * @return String 域名
     */
    private String endpointHost(String endpoint) {
        if (!StringUtils.hasText(endpoint)) {
            return "";
        }
        try {
            String value = endpoint.trim();
            URI uri = URI.create(value.contains("://") ? value : "https://" + value);
            return uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
        } catch (IllegalArgumentException exception) {
            return "";
        }
    }

    /**
     * 收集 JSON 中所有 HTTP(S) 地址。
     *
     * @param value JSON 值
     * @param urls 地址集合
     */
    private void collectUrls(Object value, Set<String> urls) {
        if (value instanceof JSONObject object) {
            for (Object item : object.values()) {
                collectUrls(item, urls);
            }
            return;
        }
        if (value instanceof JSONArray array) {
            for (Object item : array) {
                collectUrls(item, urls);
            }
            return;
        }
        if (value instanceof String text && isHttpUrl(text)) {
            urls.add(text);
        }
    }

    /**
     * 用签名地址替换 JSON 中的历史公开地址。
     *
     * @param value JSON 值
     * @param replacements 地址映射
     * @return 替换后的 JSON 值
     */
    @SuppressWarnings("unchecked")
    private <T> T replaceUrls(T value, Map<String, String> replacements) {
        if (replacements.isEmpty()) {
            return value;
        }
        if (value instanceof JSONObject object) {
            for (Map.Entry<String, Object> entry : object.entrySet()) {
                Object item = entry.getValue();
                if (item instanceof String text && replacements.containsKey(text)) {
                    entry.setValue(replacements.get(text));
                } else {
                    replaceUrls(item, replacements);
                }
            }
            return value;
        }
        if (value instanceof JSONArray array) {
            for (int index = 0; index < array.size(); index++) {
                Object item = array.get(index);
                if (item instanceof String text && replacements.containsKey(text)) {
                    array.set(index, replacements.get(text));
                } else {
                    replaceUrls(item, replacements);
                }
            }
            return value;
        }
        return value;
    }

    /**
     * 去掉地址的查询参数和锚点。
     *
     * @param url 原始地址
     * @return String 去掉查询参数后的地址
     */
    private String stripQuery(String url) {
        String value = url.trim();
        int query = value.indexOf('?');
        if (query >= 0) {
            value = value.substring(0, query);
        }
        int fragment = value.indexOf('#');
        if (fragment >= 0) {
            value = value.substring(0, fragment);
        }
        return value;
    }

    /**
     * 判断是否为 HTTP(S) 地址。
     *
     * @param value 待判断文本
     * @return boolean 是否为 HTTP(S) 地址
     */
    private boolean isHttpUrl(String value) {
        return StringUtils.hasText(value) && (value.startsWith("http://") || value.startsWith("https://"));
    }

    /**
     * 读取对象键最后一段作为文件名。
     *
     * @param key 对象键
     * @return String 文件名
     */
    private String lastSegment(String key) {
        if (!StringUtils.hasText(key)) {
            return "media";
        }
        int index = key.lastIndexOf('/');
        return index >= 0 && index + 1 < key.length() ? key.substring(index + 1) : key;
    }

    /**
     * 比较两个文本是否相同，忽略空值。
     *
     * @param left 左值
     * @param right 右值
     * @return boolean 是否相同
     */
    private boolean sameText(String left, String right) {
        return StringUtils.hasText(left) && StringUtils.hasText(right) && left.trim().equals(right.trim());
    }

    /**
     * 返回第一个非空文本。
     *
     * @param values 候选文本
     * @return String 第一个非空文本
     */
    private String firstNonEmpty(String... values) {
        for (String value : values) {
            if (StringUtils.hasText(value)) {
                return value;
            }
        }
        return "";
    }

    /**
     * 命中的本系统对象存储地址。
     *
     * @param config 存储配置
     * @param key 对象键
     */
    private record OwnedUrl(PersistenceDtos.ObjectStorageConfig config, String key) {
    }

    /**
     * 已签名地址缓存项。
     *
     * @param url 签名地址
     * @param expiresAt 到期时间
     */
    private record SignedUrl(String url, Instant expiresAt) {
    }

    /**
     * 存储配置缓存项。
     *
     * @param loadedAt 加载时间
     * @param configs 存储配置
     */
    private record CachedConfigs(Instant loadedAt, List<PersistenceDtos.ObjectStorageConfig> configs) {
    }
}
