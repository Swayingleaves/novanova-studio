package com.novanovastudio.ai;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.PersistenceDtos;
import java.util.List;
import java.util.Set;

/**
 * 视频音频输入能力和参考素材限制。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-09-10 15:00
 */
public final class AudioInputSupport {
    /** 独立于视频生成模式的音频输入能力标识。 */
    public static final String CAPABILITY = "audio-input";
    /** 已接通音频输入协议的渠道。 */
    private static final Set<String> FORMATS = Set.of("minimax", "evolink");
    /** 支持的音频媒体类型。 */
    private static final Set<String> MIME_TYPES = Set.of("audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave");

    /** 禁止实例化无状态能力工具。 */
    private AudioInputSupport() { }

    /**
     * 校验管理员配置的输入能力与渠道、模式是否一致。
     * @param modelType String 模型类型
     * @param format String 渠道调用格式
     * @param capabilities List 模型能力
     * @throws BusinessException 配置不满足音频输入条件
     */
    public static void validateCapability(String modelType, String format, List<String> capabilities) {
        if (!capabilities.contains(CAPABILITY)) return;
        if (!"video".equals(modelType) || !FORMATS.contains(format)
                || !capabilities.contains(VideoGenerationMode.REFERENCE_TO_VIDEO)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "音频输入仅支持已开启全能参考的 MiniMax、Evolink 视频模型");
        }
    }

    /**
     * 判断音频媒体类型。
     * @param mimeType String 媒体类型
     * @return boolean 是否支持
     */
    public static boolean isAudioMimeType(String mimeType) {
        return mimeType != null && MIME_TYPES.contains(mimeType.toLowerCase(java.util.Locale.ROOT).split(";", 2)[0].trim());
    }

    /**
     * 按媒体存储记录验证音频大小、时长和数量，避免使用请求伪造的元数据。
     * @param media List 当前用户有权访问的音频媒体记录
     * @throws BusinessException 超出限制或缺少可信元数据
     */
    public static void validateMedia(List<PersistenceDtos.UploadedMediaResponse> media) {
        if (media.size() > 3) throw new BusinessException(ErrorCode.PARAM_INVALID, "最多支持3段参考音频");
        long totalDuration = 0;
        for (PersistenceDtos.UploadedMediaResponse item : media) {
            if (!isAudioMimeType(item.mimeType())) throw new BusinessException(ErrorCode.PARAM_INVALID, "参考音频仅支持 MP3、WAV");
            if (item.bytes() == null || item.bytes() <= 0 || item.bytes() > 15L * 1024 * 1024) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "参考音频大小无效或超过15 MB");
            }
            if (item.durationMs() == null || item.durationMs() < 2000 || item.durationMs() > 15000) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "每段参考音频必须为2～15秒");
            }
            totalDuration += item.durationMs();
        }
        if (totalDuration > 15000) throw new BusinessException(ErrorCode.PARAM_INVALID, "参考音频总时长不能超过15秒");
    }
}
