package com.novanovastudio.service;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.ai.AiHttpClient;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.dto.SharedWorkDtos;
import com.novanovastudio.repository.PersistenceRepository;
import com.novanovastudio.repository.SharedWorkRepository;
import com.novanovastudio.storage.MediaAccessService;
import com.novanovastudio.storage.ObjectStorageService;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * 分享媒体私有副本、容量计量及短期访问授权，阻塞文件操作统一调度到弹性线程。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-06 10:00
 */
@Service
@RequiredArgsConstructor
public class SharedWorkMediaService {
    /** 原记录数据库访问。 */
    private final PersistenceRepository persistenceRepository;
    /** 已有媒体及配置能力。 */
    private final PersistenceService persistenceService;
    /** 分享媒体关联。 */
    private final SharedWorkRepository repository;
    /** 存储提供方适配器。 */
    private final ObjectStorageService objectStorageService;
    /** 容量预占与失败回收。 */
    private final StorageBillingService storageBillingService;
    /** 远程媒体安全校验及流式下载。 */
    private final AiHttpClient httpClient;
    /** 沿用现有媒体输入大小限制。 */
    private final NovanovaProperties properties;
    /** 私有存储桶读地址签发。 */
    private final MediaAccessService mediaAccessService;

    /**
     * 校验本次选定的存储能够保存私有媒体，不允许降级为公有对象。
     * @return 已通过校验的默认存储
     * @throws BusinessException 存储不支持或匿名读取未被拒绝时抛出
     */
    public Mono<PersistenceDtos.ObjectStorageConfig> privateStorage() {
        return persistenceService.getPlatformObjectStorageConfig().flatMap(config ->
                Mono.fromCallable(() -> objectStorageService.verifyPrivateBucket(config))
                        .subscribeOn(Schedulers.boundedElastic()).flatMap(verified -> verified ? Mono.just(config)
                                : Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "当前对象存储不能保证分享副本私有，请调整存储配置后重试"))));
    }

    /**
     * 为单个来源创建独立私有副本，上传前登记对象键供中断恢复。
     * @param code 分享标识
     * @param userId 来源所有者
     * @param source 服务端解析的来源
     * @param config 本次固定的目标存储
     * @return 完成信号
     */
    public Mono<Void> copy(String code, long userId, SharedWorkSnapshotFactory.MediaSource source, PersistenceDtos.ObjectStorageConfig config) {
        return temporaryFile(path -> download(userId, source, path).flatMap(file -> {
            String expectedCategory = category(source.mimeType());
            if (file.bytes() <= 0 || (!"other".equals(expectedCategory) && !expectedCategory.equals(category(file.mimeType())))) {
                return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "素材已失效或实际媒体类型与结果不一致，请重新保存素材后分享"));
            }
            String key = "shared-work/" + code + "/" + source.assetId();
            JSONObject asset = JSONObject.of("assetId", source.assetId(), "storageId", config.id(), "objectKey", key,
                    "fileName", source.fileName(), "mimeType", file.mimeType(), "fileBytes", file.bytes());
            return repository.addMedia(code, asset).then(storageBillingService.storeObject(config, key, file.bytes(),
                    StorageFileService.describe(source.fileName(), category(file.mimeType()), file.mimeType(), "generated"), () -> {
                        objectStorageService.putPrivateObject(config, key, path, file.mimeType());
                        return key;
                    })).then(repository.heartbeat(code));
        }));
    }

    /**
     * 解析作者有权访问的源媒体地址，仅用于私有预览或独立复制。
     * @param userId 来源用户
     * @param source 来源媒体
     * @return 安全读取地址
     */
    public Mono<String> sourceUrl(long userId, SharedWorkSnapshotFactory.MediaSource source) {
        if (source.storageKey().isBlank()) return Mono.just(source.sourceUrl());
        return persistenceRepository.getMedia(userId, source.storageKey())
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "原素材不属于当前用户或已删除，请重新保存素材后分享")))
                .flatMap(record -> {
                    if (record.getObjectStorageConfigId() != null && record.getObjectStorageKey() != null) {
                        // 模型厂商拉取参考素材使用两小时签名地址，复制与预览共用同一读取出口。
                        return storageBillingService.requireObjectAvailable(userId, record.getObjectStorageConfigId(), record.getObjectStorageKey())
                                .then(mediaAccessService.signObject(record.getObjectStorageConfigId(), record.getObjectStorageKey(),
                                        source.fileName(), source.mimeType(), MediaAccessService.Purpose.THIRD_PARTY, false))
                                .map(MediaAccessService.Access::url)
                                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "原素材没有可读取地址")));
                    }
                    String url = record.getObjectStorageUrl() == null || record.getObjectStorageUrl().isBlank() ? record.getSourceUrl() : record.getObjectStorageUrl();
                    if (url == null || url.isBlank()) return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "原素材没有可读取地址"));
                    return mediaAccessService.signUrl(url, MediaAccessService.Purpose.THIRD_PARTY);
                });
    }

    /**
     * 为已经校验作品状态的媒体签发公开页读取授权。
     * @param asset 内部媒体记录
     * @return 临时地址与到期时间
     */
    public Mono<SharedWorkDtos.MediaAccess> access(JSONObject asset) {
        return mediaAccessService.signObject(asset.getString("storageId"), asset.getString("objectKey"),
                        asset.getString("fileName"), asset.getString("mimeType"), MediaAccessService.Purpose.PUBLIC_PAGE, false)
                .map(access -> new SharedWorkDtos.MediaAccess(access.url(), access.expiresAt()));
    }

    /**
     * 下载已校验源媒体到临时文件，复用项目的安全远程访问策略。
     * @param userId 来源用户
     * @param source 来源信息
     * @param target 临时文件
     * @return 实际媒体大小及类型
     */
    private Mono<AiHttpClient.RemoteMediaFile> download(long userId, SharedWorkSnapshotFactory.MediaSource source, Path target) {
        return sourceUrl(userId, source).flatMap(url -> {
            long maximumBytes = Math.max(1, properties.getAi().getVideoComposition().getMaximumInputBytes());
            if (url.startsWith("data:")) return Mono.fromCallable(() -> {
                int delimiter = url.indexOf(",");
                if (delimiter < 0 || !url.substring(0, delimiter).endsWith(";base64") || url.length() > maximumBytes * 4 / 3 + 1024) {
                    throw new BusinessException(ErrorCode.PARAM_INVALID, "内嵌素材格式不正确或超过大小限制，请先上传素材");
                }
                byte[] bytes = Base64.getDecoder().decode(url.substring(delimiter + 1));
                if (bytes.length > maximumBytes) throw new BusinessException(ErrorCode.PARAM_INVALID, "素材超过当前媒体大小限制");
                Files.write(target, bytes);
                return new AiHttpClient.RemoteMediaFile((long) bytes.length, url.substring(5, delimiter - 7));
            }).subscribeOn(Schedulers.boundedElastic());
            return httpClient.downloadRemoteMediaToFile(url, source.mimeType(), target, maximumBytes);
        });
    }

    /**
     * 在所有完成、失败及取消分支中回收临时文件。
     * @param action 处理临时文件的操作
     * @param <T> 操作结果
     * @return 操作结果
     */
    public <T> Mono<T> temporaryFile(java.util.function.Function<Path, Mono<T>> action) {
        return Mono.usingWhen(Mono.fromCallable(() -> Files.createTempFile("novanova-share-", ".media")).subscribeOn(Schedulers.boundedElastic()),
                action, this::removeTemporaryFile, (path, error) -> removeTemporaryFile(path), this::removeTemporaryFile);
    }

    /** @param path 临时文件 @return 文件清理完成信号 */
    private Mono<Void> removeTemporaryFile(Path path) { return Mono.fromRunnable(() -> { try { Files.deleteIfExists(path); } catch (java.io.IOException exception) { throw new java.io.UncheckedIOException(exception); } }).subscribeOn(Schedulers.boundedElastic()).then(); }
    /** @param mimeType 实际媒体类型 @return 容量台账分类 */
    private static String category(String mimeType) { return mimeType.startsWith("image/") ? "image" : mimeType.startsWith("video/") ? "video" : mimeType.startsWith("audio/") ? "audio" : "other"; }
}
