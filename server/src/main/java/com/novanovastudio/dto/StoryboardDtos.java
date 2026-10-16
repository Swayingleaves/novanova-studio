package com.novanovastudio.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 分镜脚本接口与Agent结构化结果数据结构。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-08 00:00
 */
public final class StoryboardDtos {

    /** 分镜脚本最多允许的镜头数量。 */
    public static final int MAX_SHOT_COUNT = 100;

    /** 禁止实例化工具类。 */
    private StoryboardDtos() {
    }

    /**
     * 生成分镜脚本请求。
     *
     * @param scriptContent String 来源剧本文本
     * @param instruction String 用户指定的剧情或片段描述
     * @param visualStyle String 分镜整体视觉风格
     * @param model String 选择的channelId::model文本模型
     */
    public record GenerateStoryboardRequest(
            @NotBlank(message = "business.scriptIsRequired") @Size(max = 40000, message = "business.scriptMustNotExceed40000Characters") String scriptContent,
            @NotBlank(message = "business.storyboardDescriptionIsRequired") @Size(max = 8000, message = "business.storyboardDescriptionMustNotExceed8000Characters") String instruction,
            @NotBlank(message = "business.visualStyleIsRequired") @Size(max = 8000, message = "business.visualStyleMustNotExceed8000Characters") String visualStyle,
            @NotBlank(message = "business.textModelIsRequired") @Size(max = 256, message = "business.invalidTextModelLength") String model) {
    }

    /**
     * 合成全部提示词请求。
     *
     * @param scriptContent String 来源剧本文本
     * @param instruction String 用户指定的剧情或片段描述
     * @param visualStyle String 分镜整体视觉风格
     * @param model String 选择的channelId::model文本模型
     * @param shots List<StoryboardShot> 当前可编辑镜头
     * @param assets List<StoryboardAsset> 当前可编辑资产
     */
    public record ComposePromptsRequest(
            @NotBlank(message = "business.scriptIsRequired") @Size(max = 40000, message = "business.scriptMustNotExceed40000Characters") String scriptContent,
            @NotBlank(message = "business.storyboardDescriptionIsRequired") @Size(max = 8000, message = "business.storyboardDescriptionMustNotExceed8000Characters") String instruction,
            @NotBlank(message = "business.visualStyleIsRequired") @Size(max = 8000, message = "business.visualStyleMustNotExceed8000Characters") String visualStyle,
            @NotBlank(message = "business.textModelIsRequired") @Size(max = 256, message = "business.invalidTextModelLength") String model,
            @NotEmpty(message = "business.atLeastOneShotIsRequired") @Size(max = MAX_SHOT_COUNT, message = "business.atMost100Shots") List<@Valid StoryboardShot> shots,
            @Size(max = 300, message = "business.atMost300Assets") List<@Valid StoryboardAsset> assets) {
    }

    /**
     * 分镜资产图片生成任务请求。
     * <p>提示词由服务端按资产类别模板渲染，前端只提交结构化字段。</p>
     *
     * @param nodeId String 分镜节点标识
     * @param asset StoryboardAsset 待生成的资产
     * @param visualStyle String 分镜整体视觉风格
     * @param model String 选择的channelId::model图片模型
     * @param settings AssetImageSettings 图片生成参数
     */
    public record CreateAssetImageTaskRequest(
            @NotBlank(message = "business.storyboardNodeIDIsRequired") @Size(max = 128, message = "business.invalidStoryboardNodeIDLength") String nodeId,
            @NotNull(message = "business.assetIsRequired_09d52f") @Valid StoryboardAsset asset,
            @NotBlank(message = "business.visualStyleIsRequired") @Size(max = 8000, message = "business.visualStyleMustNotExceed8000Characters") String visualStyle,
            @NotBlank(message = "business.imageModelIsRequired") @Size(max = 256, message = "business.invalidImageModelLength") String model,
            @NotNull(message = "business.imageGenerationParametersAreRequired") @Valid AssetImageSettings settings) {
    }

    /**
     * 分镜资产图片生成参数，直接透传给图片生成渠道。
     *
     * @param quality String 图片质量
     * @param resolution String 图片分辨率
     * @param size String 图片尺寸
     */
    public record AssetImageSettings(String quality, String resolution, String size) {
    }

    /**
     * 画布持久化的分镜镜头。
     *
     * @param id String 稳定镜头标识
     * @param shotNumber Integer 镜号
     * @param durationSeconds Integer 时长秒数
     * @param visualDescription String 画面描述
     * @param shotSize String 景别
     * @param lightingAtmosphere String 光影氛围
     * @param dialogueVoiceover String 对白或旁白
     * @param soundEffect String 音效
     * @param cameraMovement String 运镜
     * @param finalPrompt String 最终中文提示词
     * @param assetIds List<String> 关联的画布资产标识
     */
    public record StoryboardShot(
            @NotBlank(message = "business.shotIDIsRequired") @Size(max = 128, message = "business.invalidShotIDLength") String id,
            @NotNull(message = "business.shotNumberIsRequired") @Positive(message = "business.shotNumberMustBePositive") Integer shotNumber,
            @NotNull(message = "business.durationIsRequired") @Positive(message = "business.durationMustBePositive") Integer durationSeconds,
            @NotBlank(message = "business.visualDescriptionIsRequired") @Size(max = 4000, message = "business.visualDescriptionMustNotExceed4000Characters") String visualDescription,
            @NotBlank(message = "business.shotSizeIsRequired") @Size(max = 32, message = "business.invalidShotSizeLength") String shotSize,
            @Size(max = 2000, message = "business.lightingMustNotExceed2000Characters") String lightingAtmosphere,
            @Size(max = 2000, message = "business.dialogueMustNotExceed2000Characters") String dialogueVoiceover,
            @Size(max = 2000, message = "business.soundEffectsMustNotExceed2000Characters") String soundEffect,
            @Size(max = 2000, message = "business.cameraMovementMustNotExceed2000Characters") String cameraMovement,
            @Size(max = 8000, message = "business.finalPromptMustNotExceed8000Characters") String finalPrompt,
            @NotNull(message = "business.linkedAssetsAreRequired") @Size(max = 300, message = "business.atMost300LinkedAssets")
            List<@NotBlank(message = "business.linkedAssetIDIsRequired") @Size(max = 128, message = "business.invalidLinkedAssetIDLength") String> assetIds) {
    }

    /**
     * 画布持久化的分镜资产。
     *
     * @param id String 稳定资产标识
     * @param kind String 资产类别：character、scene、prop
     * @param name String 资产名称
     * @param description String 资产描述
     */
    public record StoryboardAsset(
            @NotBlank(message = "business.assetIDIsRequired") @Size(max = 128, message = "business.invalidAssetIDLength") String id,
            @NotBlank(message = "business.assetCategoryIsRequired") @Size(max = 32, message = "business.invalidAssetCategoryLength") String kind,
            @NotBlank(message = "business.assetNameIsRequired") @Size(max = 200, message = "business.assetNameMustNotExceed200Characters") String name,
            @Size(max = 4000, message = "business.assetDescriptionMustNotExceed4000Characters") String description) {
    }

    /**
     * 分镜Agent首次生成的镜头结构。
     *
     * @param shotNumber Integer 镜号
     * @param durationSeconds Integer 时长秒数
     * @param visualDescription String 画面描述
     * @param shotSize String 景别
     * @param lightingAtmosphere String 光影氛围
     * @param dialogueVoiceover String 对白或旁白
     * @param soundEffect String 音效
     * @param cameraMovement String 运镜
     * @param assetReferenceKeys List<String> 关联资产的稳定引用键
     */
    public record GeneratedStoryboardShot(Integer shotNumber, Integer durationSeconds, String visualDescription,
                                          String shotSize, String lightingAtmosphere, String dialogueVoiceover,
                                          String soundEffect, String cameraMovement, List<String> assetReferenceKeys) {
    }

    /**
     * 分镜Agent首次生成的资产结构。
     *
     * @param kind String 资产类别：character、scene、prop
     * @param referenceKey String Agent返回的稳定资产引用键
     * @param name String 资产名称
     * @param description String 资产描述
     */
    public record GeneratedStoryboardAsset(String kind, String referenceKey, String name, String description) {
    }

    /**
     * 分镜Agent首次生成的结构化结果。
     *
     * @param shots List<GeneratedStoryboardShot> 镜头列表
     * @param assets List<GeneratedStoryboardAsset> 资产列表
     */
    public record GeneratedStoryboardResult(List<GeneratedStoryboardShot> shots, List<GeneratedStoryboardAsset> assets) {
    }

    /**
     * 合成提示词Agent返回的单镜头结果。
     *
     * @param shotId String 输入镜头稳定标识
     * @param finalPrompt String 最终中文提示词
     */
    public record StoryboardPrompt(String shotId, String finalPrompt) {
    }

    /**
     * 合成提示词Agent返回的结构化结果。
     *
     * @param prompts List<StoryboardPrompt> 镜头提示词映射
     */
    public record PromptCompositionResult(List<StoryboardPrompt> prompts) {
    }

    /**
     * 首次生成分镜脚本响应。
     *
     * @param shots List<StoryboardShot> 带稳定标识的镜头列表
     * @param assets List<StoryboardAsset> 带稳定标识的资产列表
     * @param chargedCredits int 本次实际扣除积分
     */
    public record GenerateStoryboardResponse(List<StoryboardShot> shots, List<StoryboardAsset> assets, int chargedCredits) {
    }

    /**
     * 合成全部提示词响应。
     *
     * @param prompts List<StoryboardPrompt> 按稳定镜头标识返回的提示词映射
     * @param chargedCredits int 本次实际扣除积分
     */
    public record ComposePromptsResponse(List<StoryboardPrompt> prompts, int chargedCredits) {
    }
}
