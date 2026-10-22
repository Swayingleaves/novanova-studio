package com.novanovastudio.ai;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.common.SystemMessage;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.dto.VideoBillingConfiguration;
import com.novanovastudio.dto.VideoGenerationConstraints;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 自定义视频配置保存、报价与任务执行共用的限制校验。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-22 00:00
 */
public final class VideoGenerationConstraintSupport {
    /** 系统支持的比例值，自动比例沿用任务参数 auto。 */
    private static final Set<String> ASPECT_RATIOS = Set.of("auto", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9");

    /** 禁止实例化无状态校验工具。 */
    private VideoGenerationConstraintSupport() { }

    /**
     * 提取可向用户展示的模式限制，不暴露调用模板。
     * @param groups Map 自定义模式配置
     * @return Map 模式到限制的映射，缺失配置不补默认值
     */
    public static Map<String, VideoGenerationConstraints> constraintsByMode(Map<String, PersistenceDtos.CustomModelGroupConfig> groups) {
        Map<String, VideoGenerationConstraints> result = new LinkedHashMap<>();
        if (groups != null) groups.forEach((mode, group) -> {
            if (VideoGenerationMode.isSupported(mode) && group != null && group.videoGenerationConstraints() != null) {
                result.put(mode, group.videoGenerationConstraints());
            }
        });
        return result;
    }

    /**
     * 校验完整模式配置和既有模式语义。
     * @param mode String 视频生成模式
     * @param constraints VideoGenerationConstraints 模式限制
     * @param capabilities List 模型能力
     * @param billing VideoBillingConfiguration 计费配置
     * @throws BusinessException 配置缺失、数值无效或规则冲突时抛出
     */
    public static void validateConfiguration(String mode, VideoGenerationConstraints constraints, List<String> capabilities,
            VideoBillingConfiguration billing) {
        if (constraints == null || constraints.minimumDurationSeconds() == null || constraints.maximumDurationSeconds() == null
                || constraints.minimumImageCount() == null || constraints.maximumImageCount() == null
                || constraints.supportedAspectRatios() == null || constraints.supportedAspectRatios().isEmpty()
                || VideoGenerationMode.REFERENCE_TO_VIDEO.equals(mode)
                && (constraints.maximumVideoCount() == null || constraints.maximumAudioCount() == null)) {
            throw invalid("business.videoConstraintsIncomplete", mode);
        }
        if (constraints.minimumDurationSeconds() < 1 || constraints.maximumDurationSeconds() < constraints.minimumDurationSeconds()
                || constraints.minimumImageCount() < 0 || constraints.maximumImageCount() < constraints.minimumImageCount()
                || constraints.supportedAspectRatios().stream().anyMatch(ratio -> ratio == null || !ASPECT_RATIOS.contains(ratio))) {
            throw invalid("business.videoConstraintsInvalid", mode);
        }
        int billingMinimum = billing == null || billing.minimumDurationSeconds() == null ? 1 : billing.minimumDurationSeconds();
        if (Math.max(billingMinimum, constraints.minimumDurationSeconds()) > constraints.maximumDurationSeconds()) {
            throw invalid("business.videoConstraintsBillingConflict", mode);
        }
        boolean reference = VideoGenerationMode.REFERENCE_TO_VIDEO.equals(mode);
        if (VideoGenerationMode.TEXT_TO_VIDEO.equals(mode) && (constraints.minimumImageCount() != 0 || constraints.maximumImageCount() != 0)
                || VideoGenerationMode.FIRST_LAST_FRAME_TO_VIDEO.equals(mode) && (constraints.minimumImageCount() != 2 || constraints.maximumImageCount() != 2)
                || VideoGenerationMode.IMAGE_TO_VIDEO.equals(mode) && constraints.minimumImageCount() < 1) {
            throw invalid("business.videoConstraintsImageModeConflict", mode);
        }
        if (reference) {
            boolean audioEnabled = capabilities != null && capabilities.contains(AudioInputSupport.CAPABILITY);
            if (constraints.maximumVideoCount() < 0 || constraints.maximumAudioCount() < 0
                    || audioEnabled && constraints.maximumAudioCount() < 1 || !audioEnabled && constraints.maximumAudioCount() != 0
                    || (long) constraints.maximumImageCount() + constraints.maximumVideoCount() + constraints.maximumAudioCount() < 1) {
                throw invalid("business.videoConstraintsReferenceConflict", mode);
            }
        }
    }

    /**
     * 按完整配置检查实际任务参数及素材数量。
     * @param mode String 生成模式
     * @param group CustomModelGroupConfig 当前模式配置
     * @param capabilities List 模型能力
     * @param billing VideoBillingConfiguration 计费配置
     * @param size String 所选比例
     * @param seconds int 时长秒数
     * @param images int 图片数量
     * @param videos int 视频数量
     * @param audios int 音频数量
     * @throws BusinessException 参数不满足配置时抛出
     */
    public static void validateInput(String mode, PersistenceDtos.CustomModelGroupConfig group, List<String> capabilities,
            VideoBillingConfiguration billing, String size, int seconds, int images, int videos, int audios) {
        VideoGenerationConstraints constraints = group == null ? null : group.videoGenerationConstraints();
        validateConfiguration(mode, constraints, capabilities, billing);
        int minimum = Math.max(constraints.minimumDurationSeconds(), billing == null || billing.minimumDurationSeconds() == null ? 1 : billing.minimumDurationSeconds());
        if (seconds < minimum || seconds > constraints.maximumDurationSeconds()) {
            throw invalid("business.videoConstraintDurationRange", minimum, constraints.maximumDurationSeconds(), seconds);
        }
        if (size == null || !constraints.supportedAspectRatios().contains(size)) {
            throw invalid("business.videoConstraintAspectRatio", String.join("、", constraints.supportedAspectRatios()), size);
        }
        if (images < constraints.minimumImageCount() || images > constraints.maximumImageCount()) {
            throw invalid("business.videoConstraintImageRange", constraints.minimumImageCount(), constraints.maximumImageCount(), images);
        }
        if (VideoGenerationMode.REFERENCE_TO_VIDEO.equals(mode)) {
            if (videos > constraints.maximumVideoCount()) throw invalid("business.videoConstraintVideoMaximum", constraints.maximumVideoCount(), videos);
            if (audios > constraints.maximumAudioCount()) throw invalid("business.videoConstraintAudioMaximum", constraints.maximumAudioCount(), audios);
            if (images + videos + audios == 0) throw invalid("business.universalReferenceNeedsAnImageVideoOrAudio");
        } else {
            if (videos > 0) throw invalid("business.imageToVideoCannotIncludeVideoReferences");
            if (audios > 0) throw invalid("business.audioInputRequiresUniversalReferenceMode");
        }
    }

    /**
     * 构建语言中立的参数错误。
     * @param key String 消息键
     * @param arguments Object[] 消息参数
     * @return BusinessException 参数异常
     */
    private static BusinessException invalid(String key, Object... arguments) {
        return new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of(key, arguments));
    }
}
