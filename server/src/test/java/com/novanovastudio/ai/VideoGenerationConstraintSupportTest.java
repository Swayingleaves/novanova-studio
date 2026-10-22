package com.novanovastudio.ai;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONException;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.dto.VideoBillingConfiguration;
import com.novanovastudio.dto.VideoGenerationConstraints;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * 自定义视频配置及报价、执行共用校验的边界测试。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-22 00:00
 */
class VideoGenerationConstraintSupportTest {
    /** 七种合法比例。 */
    private static final List<String> RATIOS = List.of("16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "auto");
    /** 含音频输入的全能参考能力。 */
    private static final List<String> CAPABILITIES = List.of("reference-to-video", "audio-input");
    /** 计费最低时长。 */
    private static final VideoBillingConfiguration BILLING = new VideoBillingConfiguration("second", 3, Map.of());

    /** 保存后的配置必须能完整回读，小数、溢出和非数字不能静默转换。 */
    @Test
    void shouldRoundTripAndRejectNonIntegers() {
        var expected = constraints(1, 2);
        Assertions.assertEquals(expected, JSON.parseObject(JSON.toJSONString(expected), VideoGenerationConstraints.class));
        for (String invalid : List.of("1.5", "2147483648", "true", "\"3\"")) {
            Assertions.assertThrows(JSONException.class, () -> JSON.parseObject(
                    "{\"minimumDurationSeconds\":" + invalid + "}", VideoGenerationConstraints.class));
        }
    }

    /** 配置缺失、上下限冲突及空比例集合必须明确拒绝。 */
    @Test
    void shouldRejectIncompleteAndConflictingConfigurations() {
        Assertions.assertThrows(BusinessException.class, () -> validate(null));
        for (VideoGenerationConstraints invalid : List.of(
                new VideoGenerationConstraints(0, 10, 0, 2, RATIOS, 2, 4),
                new VideoGenerationConstraints(5, 4, 0, 2, RATIOS, 2, 4),
                new VideoGenerationConstraints(1, 2, 0, 2, RATIOS, 2, 4),
                new VideoGenerationConstraints(1, 10, 3, 2, RATIOS, 2, 4),
                new VideoGenerationConstraints(1, 10, 0, 2, List.of(), 2, 4),
                new VideoGenerationConstraints(1, 10, 0, 2, List.of("2:1"), 2, 4),
                new VideoGenerationConstraints(1, 10, 0, 2, RATIOS, null, 4),
                new VideoGenerationConstraints(1, 10, 0, 2, RATIOS, 2, 0))) {
            Assertions.assertThrows(BusinessException.class, () -> validate(invalid));
        }
    }

    /** 计费与模式时长交集、图片上下边界、七种比例均使用同一校验。 */
    @Test
    void shouldValidateDurationImagesAndEveryAspectRatio() {
        var group = group(constraints(1, 2));
        for (String ratio : RATIOS) for (int seconds : List.of(3, 10)) for (int images : List.of(1, 2)) {
            Assertions.assertDoesNotThrow(() -> input(group, ratio, seconds, images, 2, 4));
        }
        for (int seconds : List.of(2, 11)) Assertions.assertThrows(BusinessException.class, () -> input(group, "16:9", seconds, 1, 0, 0));
        for (int images : List.of(0, 3)) Assertions.assertThrows(BusinessException.class, () -> input(group, "16:9", 5, images, 0, 0));
        Assertions.assertThrows(BusinessException.class, () -> input(group, "1280x720", 5, 1, 0, 0));
        Assertions.assertThrows(BusinessException.class, () -> input(group, null, 5, 1, 0, 0));
        Assertions.assertThrows(BusinessException.class, () -> input(group, "16:9", 5, 1, 3, 0));
        Assertions.assertThrows(BusinessException.class, () -> input(group, "16:9", 5, 1, 0, 5));
    }

    /** 固定模式图片语义、音频开关和至少一类素材都必须满足。 */
    @Test
    void shouldRespectModeSemanticsAndAudioSwitch() {
        for (String mode : List.of("text-to-video", "first-last-frame-to-video")) {
            Assertions.assertThrows(BusinessException.class, () -> VideoGenerationConstraintSupport.validateConfiguration(mode, constraints(1, 2), List.of(mode), BILLING));
            int images = mode.equals("text-to-video") ? 0 : 2;
            Assertions.assertDoesNotThrow(() -> VideoGenerationConstraintSupport.validateConfiguration(mode, constraints(images, images), List.of(mode), BILLING));
        }
        Assertions.assertThrows(BusinessException.class, () -> VideoGenerationConstraintSupport.validateConfiguration("image-to-video", constraints(0, 2), List.of("image-to-video"), BILLING));
        Assertions.assertThrows(BusinessException.class, () -> VideoGenerationConstraintSupport.validateConfiguration("reference-to-video", constraints(0, 2), List.of("reference-to-video"), BILLING));
        var disabledAudio = new VideoGenerationConstraints(1, 10, 0, 0, RATIOS, 1, 0);
        Assertions.assertDoesNotThrow(() -> VideoGenerationConstraintSupport.validateConfiguration("reference-to-video", disabledAudio, List.of("reference-to-video"), BILLING));
        var noMaterials = new VideoGenerationConstraints(1, 10, 0, 0, RATIOS, 0, 0);
        Assertions.assertThrows(BusinessException.class, () -> VideoGenerationConstraintSupport.validateConfiguration("reference-to-video", noMaterials, List.of("reference-to-video"), BILLING));
    }

    /** @param minimum 最少图片数 @param maximum 最多图片数 @return 完整全能参考限制 */
    private VideoGenerationConstraints constraints(int minimum, int maximum) {
        return new VideoGenerationConstraints(2, 10, minimum, maximum, RATIOS, 2, 4);
    }

    /** @param constraints 模式限制 @return 带限制的自定义调用配置 */
    private PersistenceDtos.CustomModelGroupConfig group(VideoGenerationConstraints constraints) {
        return new PersistenceDtos.CustomModelGroupConfig("/generate", "POST", "video", "{}", null, null, "url",
                null, null, null, null, null, null, constraints);
    }

    /** @param constraints 全能参考限制 @throws BusinessException 限制无效时抛出 */
    private void validate(VideoGenerationConstraints constraints) {
        VideoGenerationConstraintSupport.validateConfiguration("reference-to-video", constraints, CAPABILITIES, BILLING);
    }

    /**
     * 校验实际输入。
     * @param group 模式调用配置
     * @param ratio 比例
     * @param seconds 时长
     * @param images 图片数
     * @param videos 视频数
     * @param audios 音频数
     * @throws BusinessException 输入不满足限制时抛出
     */
    private void input(PersistenceDtos.CustomModelGroupConfig group, String ratio, int seconds, int images, int videos, int audios) {
        VideoGenerationConstraintSupport.validateInput("reference-to-video", group, CAPABILITIES, BILLING, ratio, seconds, images, videos, audios);
    }
}
