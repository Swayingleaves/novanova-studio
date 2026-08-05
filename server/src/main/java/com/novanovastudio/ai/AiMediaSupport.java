package com.novanovastudio.ai;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.service.PersistenceService;
import java.util.Base64;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Mono;

/**
 * @title        AiMediaSupport.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  AI媒体引用解析和结果存储支持
 * @createTime   2026-06-24 20:35:00
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class AiMediaSupport {

    /** AI HTTP客户端 */
    private final AiHttpClient aiHttpClient;

    /** 业务持久化服务 */
    private final PersistenceService persistenceService;

    /** 服务配置 */
    private final NovanovaProperties properties;

    /**
     * 从图片接口结果中读取二进制内容
     *
     * @param item JSONObject 图片结果项
     * @return Mono<GeneratedBinary> 图片二进制
     */
    public Mono<GeneratedBinary> imageBinary(JSONObject item) {
        String base64 = AiTaskParameterReader.firstNonEmpty(item.getString("b64_json"));
        if (StringUtils.hasText(base64)) {
            return Mono.fromSupplier(() -> new GeneratedBinary(Base64.getDecoder().decode(base64), "image/png"));
        }
        String url = AiTaskParameterReader.firstNonEmpty(item.getString("url"));
        if (StringUtils.hasText(url)) {
            if (isDataUrl(url)) {
                return Mono.fromSupplier(() -> dataUrlBinary(url, "image/png"));
            }
            return aiHttpClient.downloadRemoteBinary(url, "image/png");
        }
        return Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "图片接口未返回b64_json或url"));
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
            if (isInsecureHttpUrl(url) && properties.getAi().getImage().isUploadHttpResultToObjectStorage()) {
                // HTTPS页面不能直接加载HTTP图片，开启配置后必须转存成功才返回生成结果。
                log.info("检测到HTTP图片结果，开始转存默认对象存储: userId={}", userId);
                return imageBinary(item).flatMap(binary -> storeGeneratedMedia(userId, AiTaskTypes.IMAGE, "generated.png", binary, width, height, durationMs));
            }
            // 保持默认行为：仅登记第三方URL，不下载后上传对象存储。
            return registerGeneratedMediaUrl(userId, AiTaskTypes.IMAGE, url, AiTaskParameterReader.firstNonEmpty(item.getString("mime_type"), item.getString("mimeType"), "image/png"), width, height, durationMs);
        }
        return imageBinary(item).flatMap(binary -> storeGeneratedMedia(userId, AiTaskTypes.IMAGE, "generated.png", binary, width, height, durationMs));
    }

    /**
     * 解析参考媒体可访问URL
     *
     * @param userId Long 用户ID
     * @param reference AiTaskMediaReference 参考媒体
     * @return Mono<String> 可访问URL
     */
    public Mono<String> resolveReferenceUrl(Long userId, AiTaskDtos.AiTaskMediaReference reference) {
        if (StringUtils.hasText(reference.storageKey())) {
            return persistenceService.getMediaInfoForUser(userId, reference.storageKey()).map(PersistenceDtos.UploadedMediaResponse::url);
        }
        if (StringUtils.hasText(reference.url())) {
            return Mono.just(reference.url().trim());
        }
        return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "参考媒体必须提供storageKey或url"));
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
            if (url.startsWith("http://") || url.startsWith("https://")) {
                return aiHttpClient.downloadRemoteBinary(url, mimeType);
            }
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "参考媒体URL必须是http、https或data URL"));
        });
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
        return persistenceService.storeGeneratedMediaForUser(userId, kind, fileName, binary.mimeType(), binary.data(), width, height, durationMs);
    }

    /**
     * 登记AI生成媒体URL
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
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "生成媒体URL必须是http或https地址"));
        }
        String trimmedUrl = sourceUrl.trim();
        return aiHttpClient.readRemoteMediaHeaders(trimmedUrl)
                .flatMap(headers -> {
                    String resolvedMimeType = AiTaskParameterReader.firstNonEmpty(mimeType, headers.mimeType(), "application/octet-stream");
                    return persistenceService.registerRemoteMediaForUser(userId, new PersistenceDtos.RegisterRemoteMediaRequest(kind, trimmedUrl, null, resolvedMimeType, headers.bytes(), width, height, durationMs, null));
                });
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
            throw new BusinessException(ErrorCode.PARAM_INVALID, "data URL必须是base64格式");
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
        return StringUtils.hasText(url) && (url.startsWith("http://") || url.startsWith("https://"));
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

    /**
     * 判断是否为不安全的HTTP媒体地址。
     *
     * @param url String 媒体地址
     * @return boolean true表示HTTP地址，false表示其他协议或HTTPS地址
     */
    private boolean isInsecureHttpUrl(String url) {
        return StringUtils.hasText(url) && url.startsWith("http://");
    }
}
