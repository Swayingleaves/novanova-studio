package com.novanovastudio.ai;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.dto.PersistenceDtos;
import java.util.List;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * 音频能力和素材边界测试。
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-09-10 15:00
 */
class AudioInputSupportTest {
    /** 开启输入能力必须同时满足视频类型和全能参考模式，渠道由管理员自行配置。 */
    @Test
    void shouldValidateConfiguredCapability() {
        List<String> capabilities = List.of("reference-to-video", "audio-input");
        Assertions.assertDoesNotThrow(() -> AudioInputSupport.validateCapability("video", capabilities));
        Assertions.assertDoesNotThrow(() -> AudioInputSupport.validateCapability("video", List.of("reference-to-video", "audio-input", "custom-capability")));
        Assertions.assertThrows(BusinessException.class, () -> AudioInputSupport.validateCapability("text", capabilities));
        Assertions.assertThrows(BusinessException.class, () -> AudioInputSupport.validateCapability("video", List.of("audio-input")));
    }

    /** 数量、文件大小、每段和合计时长边界均使用媒体记录校验。 */
    @Test
    void shouldValidateAudioLimits() {
        Assertions.assertDoesNotThrow(() -> AudioInputSupport.validateMedia(List.of(media(15000, 15L * 1024 * 1024, "audio/wav"))));
        Assertions.assertDoesNotThrow(() -> AudioInputSupport.validateMedia(List.of(media(2000, 100L, "audio/mpeg"), media(13000, 100L, "audio/mpeg"))));
        Assertions.assertThrows(BusinessException.class, () -> AudioInputSupport.validateMedia(List.of(media(1999, 100L, "audio/mpeg"))));
        Assertions.assertThrows(BusinessException.class, () -> AudioInputSupport.validateMedia(List.of(media(15001, 100L, "audio/mpeg"))));
        Assertions.assertThrows(BusinessException.class, () -> AudioInputSupport.validateMedia(List.of(media(3000, 15L * 1024 * 1024 + 1, "audio/mpeg"))));
        Assertions.assertThrows(BusinessException.class, () -> AudioInputSupport.validateMedia(List.of(media(3000, 100L, "video/mp4"))));
        Assertions.assertThrows(BusinessException.class, () -> AudioInputSupport.validateMedia(List.of(media(null, 100L, "audio/mpeg"))));
        Assertions.assertThrows(BusinessException.class, () -> AudioInputSupport.validateMedia(List.of(media(8000, 100L, "audio/mpeg"), media(8000, 100L, "audio/mpeg"))));
        Assertions.assertThrows(BusinessException.class, () -> AudioInputSupport.validateMedia(java.util.Collections.nCopies(4, media(2000, 100L, "audio/mpeg"))));
    }

    /**
     * 创建用于边界检查的存储媒体响应。
     * @param duration Integer 音频时长毫秒
     * @param bytes Long 文件字节数
     * @param mimeType String 媒体类型
     * @return UploadedMediaResponse 媒体记录
     */
    private PersistenceDtos.UploadedMediaResponse media(Integer duration, Long bytes, String mimeType) {
        return new PersistenceDtos.UploadedMediaResponse("audio:test", "https://example.com/audio.mp3", bytes, mimeType, null, null, duration, null);
    }
}
