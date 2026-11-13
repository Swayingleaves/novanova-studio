package com.novanovastudio.ai;

import com.novanovastudio.common.SystemMessage;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.service.PersistenceService;
import com.novanovastudio.storage.MediaAccessService;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.URLConnection;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * @title        AiMediaSupport.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  AI媒体引用解析和结果存储支持
 * @createTime   2026-06-24 20:35:00
 */
@Component
@Slf4j
public class AiMediaSupport {

    /** AI HTTP客户端 */
    private final AiHttpClient aiHttpClient;

    /** 业务持久化服务 */
    private final PersistenceService persistenceService;

    /** 服务配置 */
    private final NovanovaProperties properties;

    /** 音频裁剪派生服务 */
    private final AudioClipService audioClipService;

    /** 私有存储桶读地址签发，测试环境下允许为空 */
    private final ObjectProvider<MediaAccessService> mediaAccessServiceProvider;

    /** 注入媒体解析和音频派生依赖。 */
    @Autowired
    public AiMediaSupport(AiHttpClient aiHttpClient, PersistenceService persistenceService, NovanovaProperties properties,
                          AudioClipService audioClipService, ObjectProvider<MediaAccessService> mediaAccessServiceProvider) {
        this.aiHttpClient = aiHttpClient;
        this.persistenceService = persistenceService;
        this.properties = properties;
        this.audioClipService = audioClipService;
        this.mediaAccessServiceProvider = mediaAccessServiceProvider;
    }

    /** 保留不依赖私有存储的构造方式，供单元测试直接使用。 */
    public AiMediaSupport(AiHttpClient aiHttpClient, PersistenceService persistenceService, NovanovaProperties properties,
                          AudioClipService audioClipService) {
        this(aiHttpClient, persistenceService, properties, audioClipService, null);
    }

    /** 保留原有测试和内部调用方的三参数构造方式。 */
    public AiMediaSupport(AiHttpClient aiHttpClient, PersistenceService persistenceService, NovanovaProperties properties) {
        this(aiHttpClient, persistenceService, properties, new AudioClipService(aiHttpClient, persistenceService, properties), null);
    }

    /**
     * 从图片接口结果中读取二进制内容
     *
     * @param item JSONObject 图片结果项
     * @return Mono<GeneratedBinary> 图片二进制
     */
    public Mono<GeneratedBinary> imageBinary(JSONObject item) {
        String base64 = AiTaskParameterReader.firstNonEmpty(item.getString("b64_json"));
        if (StringUtils.hasText(base64)) {
            return Mono.fromCallable(() -> {
                byte[] data = Base64.getDecoder().decode(base64);
                // 识别图片文件头，避免JPEG内容被登记为PNG。
                String mimeType = URLConnection.guessContentTypeFromStream(new ByteArrayInputStream(data));
                return new GeneratedBinary(data, AiTaskParameterReader.firstNonEmpty(mimeType, "image/png"));
            });
        }
        String url = AiTaskParameterReader.firstNonEmpty(item.getString("url"));
        if (StringUtils.hasText(url)) {
            if (isDataUrl(url)) {
                return Mono.fromSupplier(() -> dataUrlBinary(url, "image/png"));
            }
            return aiHttpClient.downloadRemoteBinary(url, "image/png");
        }
        return Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, SystemMessage.of("business.imageAPIReturnedNeitherB64JsonNorUrl")));
    }

    /**
     * 保存图片接口结果项
     *
     * @param userId Long 用户ID
     * @param item JSONObject 图片结果项
     * @param width Integer 宽度
     * @param height Integer 高度
     * @param durationMs Integer 时长毫秒
     * @return Mono<UploadedMediaResponse> 媒体响应
     */
    public Mono<PersistenceDtos.UploadedMediaResponse> storeGeneratedImageItem(Long userId, JSONObject item, Integer width, Integer height, Integer durationMs) {
        String url = AiTaskParameterReader.firstNonEmpty(item.getString("url"));
        if (isHttpUrl(url)) {
            // 上游返回的图片链接先下载转存默认对象存储，同时保留原始链接。
            return storeGeneratedMediaUrl(userId, AiTaskTypes.IMAGE, url,
                    AiTaskParameterReader.firstNonEmpty(item.getString("mime_type"), item.getString("mimeType"), "image/png"),
                    width, height, durationMs);
        }
        return imageBinary(item).flatMap(binary -> storeGeneratedMedia(userId, AiTaskTypes.IMAGE,
                "generated." + fileExtension(binary.mimeType(), "png"), binary, width, height, durationMs));
    }

    /**
     * 解析参考媒体可访问URL
     *
     * @param userId Long 用户ID
     * @param reference AiTaskMediaReference 参考媒体
     * @return Mono<String> 可访问URL
     */
    public Mono<String> resolveReferenceUrl(Long userId, AiTaskDtos.AiTaskMediaReference reference) {
        if (reference == null) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.referenceMediaIsRequired")));
        }
        if (StringUtils.hasText(reference.storageKey())) {
            return persistenceService.getMediaInfoForUser(userId, reference.storageKey().trim(), MediaAccessService.Purpose.THIRD_PARTY)
                    .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, SystemMessage.of("business.referenceMediaNotFoundOrOwnedByAnotherUser"))))
                    .flatMap(media -> audioClipService.resolveReferenceUrl(userId, reference, media))
                    .flatMap(this::signOwnedUrl)
                    .flatMap(this::validateReferenceUrl);
        }
        if (StringUtils.hasText(reference.url())) {
            if (reference.trimStartMs() != null || reference.trimEndMs() != null) {
                return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.trimmedAudioReferencesRequireStorageKey")));
            }
            return signOwnedUrl(reference.url().trim()).flatMap(this::validateReferenceUrl);
        }
        return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.referenceMediaNeedsStorageKeyOrUrl")));
    }

    /**
     * 把本系统对象存储的历史公开地址换成预签名地址，外部地址原样返回。
     *
     * @param url String 参考媒体地址
     * @return Mono<String> 可用地址
     */
    private Mono<String> signOwnedUrl(String url) {
        if (mediaAccessServiceProvider == null) {
            return Mono.just(url);
        }
        return mediaAccessServiceProvider.getObject().signUrl(url, MediaAccessService.Purpose.THIRD_PARTY);
    }

    /**
     * 解析参考媒体二进制
     *
     * @param userId Long 用户ID
     * @param reference AiTaskMediaReference 参考媒体
     * @param defaultMimeType String 默认MIME类型
     * @return Mono<GeneratedBinary> 参考媒体二进制
     */
    public Mono<GeneratedBinary> resolveReferenceBinary(Long userId, AiTaskDtos.AiTaskMediaReference reference, String defaultMimeType) {
        String mimeType = AiTaskParameterReader.firstNonEmpty(reference.mimeType(), defaultMimeType);
        return resolveReferenceUrl(userId, reference).flatMap(url -> {
            if (isDataUrl(url)) {
                return Mono.fromSupplier(() -> dataUrlBinary(url, mimeType));
            }
            if (isHttpUrl(url)) {
                return aiHttpClient.downloadRemoteBinary(url, mimeType);
            }
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.referenceURLMustUseHTTPHTTPSOrData")));
        });
    }

    /**
     * 校验参考媒体URL协议。
     *
     * @param url String 参考媒体地址
     * @return Mono<String> 规范化地址
     */
    private Mono<String> validateReferenceUrl(String url) {
        String normalized = StringUtils.hasText(url) ? url.trim() : "";
        if (isHttpUrl(normalized) || isDataUrl(normalized)) {
            return Mono.just(normalized);
        }
        return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.referenceURLMustUseHTTPHTTPSOrData")));
    }

    /**
     * 保存AI生成媒体
     *
     * @param userId Long 用户ID
     * @param kind String 媒体类型
     * @param fileName String 文件名
     * @param binary GeneratedBinary 媒体二进制
     * @param width Integer 宽度
     * @param height Integer 高度
     * @param durationMs Integer 时长毫秒
     * @return Mono<UploadedMediaResponse> 媒体响应
     */
    public Mono<PersistenceDtos.UploadedMediaResponse> storeGeneratedMedia(Long userId, String kind, String fileName, GeneratedBinary binary, Integer width, Integer height, Integer durationMs) {
        return storeGeneratedMedia(userId, kind, fileName, binary, width, height, durationMs, null);
    }

    /**
     * 保存AI生成媒体，并记录下载前的上游原始链接
     *
     * @param userId Long 用户ID
     * @param kind String 媒体类型
     * @param fileName String 文件名
     * @param binary GeneratedBinary 媒体二进制
     * @param width Integer 宽度
     * @param height Integer 高度
     * @param durationMs Integer 时长毫秒
     * @param sourceUrl String 上游返回的原始链接，base64或二进制结果为null
     * @return Mono<UploadedMediaResponse> 媒体响应
     */
    public Mono<PersistenceDtos.UploadedMediaResponse> storeGeneratedMedia(Long userId, String kind, String fileName, GeneratedBinary binary, Integer width, Integer height, Integer durationMs, String sourceUrl) {
        if (!StringUtils.hasText(sourceUrl)) {
            return persistenceService.storeGeneratedMediaForUser(userId, kind, fileName, binary.mimeType(), binary.data(), width, height, durationMs);
        }
        return persistenceService.storeGeneratedMediaForUser(userId, kind, fileName, binary.mimeType(), binary.data(), width, height, durationMs, sourceUrl);
    }

    /**
     * 将上游生成媒体下载并转存全站默认对象存储，同时保留原始链接。
     * <p>
     * 视频流式下载到临时文件后上传，避免整段视频进入堆内存；转存失败时回退为仅登记原始链接，
     * 不因下载、超限、容量不足或上传失败拖垮生成任务。
     *
     * @param userId Long 用户ID
     * @param kind String 媒体类型
     * @param sourceUrl String 第三方返回的媒体URL
     * @param mimeType String MIME类型
     * @param width Integer 宽度
     * @param height Integer 高度
     * @param durationMs Integer 时长毫秒
     * @return Mono<UploadedMediaResponse> 媒体响应
     */
    public Mono<PersistenceDtos.UploadedMediaResponse> storeGeneratedMediaUrl(Long userId, String kind, String sourceUrl, String mimeType, Integer width, Integer height, Integer durationMs) {
        if (!isHttpUrl(sourceUrl)) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.generatedMediaURLMustUseHTTPOrHTTPS")));
        }
        String trimmedUrl = sourceUrl.trim();
        return downloadAndStoreGeneratedMedia(userId, kind, trimmedUrl, mimeType, width, height, durationMs)
                .onErrorResume(error -> {
                    log.error("AI生成媒体转存对象存储失败，回退登记原始链接: userId={}, kind={}, sourceUrl={}",
                            userId, kind, sanitizeMediaUrlForLog(trimmedUrl), error);
                    return registerGeneratedMediaUrl(userId, kind, trimmedUrl, mimeType, width, height, durationMs);
                });
    }

    /**
     * 登记AI生成媒体URL
     * <p>
     * 只登记第三方媒体地址和元数据，不下载不上传对象存储；用于转存失败时回退保留原始链接。
     *
     * @param userId Long 用户ID
     * @param kind String 媒体类型
     * @param sourceUrl String 第三方返回的媒体URL
     * @param mimeType String MIME类型
     * @param width Integer 宽度
     * @param height Integer 高度
     * @param durationMs Integer 时长毫秒
     * @return Mono<UploadedMediaResponse> 媒体响应
     */
    public Mono<PersistenceDtos.UploadedMediaResponse> registerGeneratedMediaUrl(Long userId, String kind, String sourceUrl, String mimeType, Integer width, Integer height, Integer durationMs) {
        if (!isHttpUrl(sourceUrl)) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.generatedMediaURLMustUseHTTPOrHTTPS")));
        }
        String trimmedUrl = sourceUrl.trim();
        return aiHttpClient.readRemoteMediaHeaders(trimmedUrl)
                .flatMap(headers -> {
                    String resolvedMimeType = AiTaskParameterReader.firstNonEmpty(mimeType, headers.mimeType(), "application/octet-stream");
                    return persistenceService.registerRemoteMediaForUser(userId, new PersistenceDtos.RegisterRemoteMediaRequest(kind, trimmedUrl, null, resolvedMimeType, headers.bytes(), width, height, durationMs, null));
                });
    }

    /**
     * 下载上游生成媒体并转存对象存储。
     *
     * @param userId Long 用户ID
     * @param kind String 媒体类型
     * @param sourceUrl String 第三方媒体地址
     * @param mimeType String MIME类型
     * @param width Integer 宽度
     * @param height Integer 高度
     * @param durationMs Integer 时长毫秒
     * @return Mono<UploadedMediaResponse> 媒体响应
     */
    private Mono<PersistenceDtos.UploadedMediaResponse> downloadAndStoreGeneratedMedia(Long userId, String kind, String sourceUrl, String mimeType, Integer width, Integer height, Integer durationMs) {
        String resolvedMimeType = AiTaskParameterReader.firstNonEmpty(mimeType,
                AiTaskTypes.VIDEO.equals(kind) ? "video/mp4" : "image/png");
        if (AiTaskTypes.VIDEO.equals(kind)) {
            return storeRemoteVideoFile(userId, sourceUrl, resolvedMimeType, durationMs);
        }
        return aiHttpClient.downloadRemoteBinary(sourceUrl, resolvedMimeType)
                .flatMap(binary -> storeGeneratedMedia(userId, kind, "generated." + fileExtension(binary.mimeType(), "bin"),
                        binary, width, height, durationMs, sourceUrl));
    }

    /**
     * 流式下载视频到临时文件后上传对象存储，成功、失败和取消都会清理临时文件。
     *
     * @param userId Long 用户ID
     * @param sourceUrl String 第三方视频地址
     * @param mimeType String 默认MIME类型
     * @param durationMs Integer 时长毫秒
     * @return Mono<UploadedMediaResponse> 媒体响应
     */
    private Mono<PersistenceDtos.UploadedMediaResponse> storeRemoteVideoFile(Long userId, String sourceUrl, String mimeType, Integer durationMs) {
        return Mono.usingWhen(
                Mono.fromCallable(() -> Files.createTempFile("novanova-generated-video-", ".mp4"))
                        .subscribeOn(Schedulers.boundedElastic()),
                file -> aiHttpClient.downloadRemoteMediaToFile(sourceUrl, mimeType, file, maximumGeneratedVideoBytes())
                        .flatMap(downloaded -> persistenceService.storeGeneratedMediaFileForUser(userId, AiTaskTypes.VIDEO,
                                "generated." + fileExtension(downloaded.mimeType(), "mp4"), downloaded.mimeType(), file,
                                null, null, durationMs, sourceUrl)),
                this::deleteTemporaryFile,
                (file, error) -> deleteTemporaryFile(file),
                file -> deleteTemporaryFile(file));
    }

    /**
     * 清理生成媒体转存临时文件。
     *
     * @param file Path 临时文件
     * @return Mono<Void> 清理结果
     */
    private Mono<Void> deleteTemporaryFile(Path file) {
        return Mono.fromRunnable(() -> {
            try {
                Files.deleteIfExists(file);
            } catch (IOException exception) {
                log.info("清理生成媒体临时文件失败: file={}", file);
            }
        }).subscribeOn(Schedulers.boundedElastic()).then();
    }

    /**
     * 获取生成视频转存允许的最大字节数，沿用视频合成源文件限制。
     *
     * @return long 最大字节数
     */
    private long maximumGeneratedVideoBytes() {
        return Math.max(1L, properties.getAi().getVideoComposition().getMaximumInputBytes());
    }

    /**
     * 去除媒体地址中的查询参数，避免签名信息进入日志。
     *
     * @param url String 媒体地址
     * @return String 可安全记录的媒体地址
     */
    private String sanitizeMediaUrlForLog(String url) {
        if (!StringUtils.hasText(url)) {
            return "";
        }
        int queryIndex = url.indexOf('?');
        return queryIndex < 0 ? url : url.substring(0, queryIndex) + "?***";
    }

    /**
     * 解析base64格式data URL
     *
     * @param url String data URL
     * @param defaultMimeType String 默认MIME类型
     * @return GeneratedBinary 二进制内容
     */
    public GeneratedBinary dataUrlBinary(String url, String defaultMimeType) {
        int commaIndex = url.indexOf(',');
        if (commaIndex < 0 || !url.substring(0, commaIndex).contains(";base64")) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.dataURLMustBeBase64Encoded"));
        }
        String header = url.substring(5, commaIndex);
        String mimeType = AiTaskParameterReader.firstNonEmpty(header.split(";")[0], defaultMimeType);
        return new GeneratedBinary(Base64.getDecoder().decode(url.substring(commaIndex + 1)), mimeType);
    }

    /**
     * 根据MIME类型获取扩展名
     *
     * @param mimeType String MIME类型
     * @param defaultExtension String 默认扩展名
     * @return String 扩展名
     */
    public String fileExtension(String mimeType, String defaultExtension) {
        if (!StringUtils.hasText(mimeType) || !mimeType.contains("/")) {
            return defaultExtension;
        }
        return mimeType.substring(mimeType.indexOf('/') + 1).replace("jpeg", "jpg").replace("mpeg", "mp3");
    }

    /**
     * 判断是否为HTTP媒体地址
     *
     * @param url String 媒体地址
     * @return boolean 是否为HTTP地址
     */
    public boolean isHttpUrl(String url) {
        if (!StringUtils.hasText(url)) return false;
        String normalized = url.trim().toLowerCase(java.util.Locale.ROOT);
        return normalized.startsWith("http://") || normalized.startsWith("https://");
    }

    /**
     * 判断是否为data URL。
     *
     * @param url String 媒体地址
     * @return boolean 是否为data URL
     */
    private boolean isDataUrl(String url) {
        return StringUtils.hasText(url) && url.regionMatches(true, 0, "data:", 0, 5);
    }
}
