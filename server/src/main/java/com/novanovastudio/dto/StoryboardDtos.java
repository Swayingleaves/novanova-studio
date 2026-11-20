package com.novanovastudio.dto;

import com.alibaba.fastjson2.annotation.JSONField;
import com.novanovastudio.common.CreditAmountWriter;
import io.agentscope.core.tool.ToolParam;
import java.math.BigDecimal;

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
    public record GeneratedStoryboardShot(
            @ToolParam(name = "shotNumber", required = true, description = "从1递增的连续镜号正整数") Integer shotNumber,
            @ToolParam(name = "durationSeconds", required = true, description = "单镜头秒数正整数") Integer durationSeconds,
            @ToolParam(name = "visualDescription", required = true, description = "具体可拍的中文画面描述") String visualDescription,
            @ToolParam(name = "shotSize", required = true, description = "标准景别：大特写、特写、近景、头肩景、中景、中远景、全景、远景、大远景、大全景") String shotSize,
            @ToolParam(name = "lightingAtmosphere", required = false, description = "光影氛围") String lightingAtmosphere,
            @ToolParam(name = "dialogueVoiceover", required = false, description = "对白或旁白") String dialogueVoiceover,
            @ToolParam(name = "soundEffect", required = false, description = "环境声或动作音效") String soundEffect,
            @ToolParam(name = "cameraMovement", required = false, description = "运镜方式") String cameraMovement,
            @ToolParam(name = "assetReferenceKeys", required = true, description = "当前镜头出现的资产referenceKey数组，无关联资产时传空数组[]") List<String> assetReferenceKeys) {
    }

    /**
     * 分镜Agent首次生成的资产结构。
     *
     * @param kind String 资产类别：character、scene、prop
     * @param referenceKey String Agent返回的稳定资产引用键
     * @param name String 资产名称
     * @param description String 资产描述
     */
    public record GeneratedStoryboardAsset(
            @ToolParam(name = "kind", required = true, description = "资产类别：character、scene、prop") String kind,
            @ToolParam(name = "referenceKey", required = true, description = "当前结果内唯一的稳定引用键") String referenceKey,
            @ToolParam(name = "name", required = true, description = "中文资产名称") String name,
            @ToolParam(name = "description", required = false, description = "中文外观或环境特征描述") String description) {
    }

    /**
     * 分镜Agent首次生成的结构化结果。
     *
     * @param shots List<GeneratedStoryboardShot> 镜头列表
     * @param assets List<GeneratedStoryboardAsset> 资产列表
     */
    public record GeneratedStoryboardResult(
            @ToolParam(name = "shots", required = true, description = "非空分镜镜头数组，至少包含1个有效镜头") List<GeneratedStoryboardShot> shots,
            @ToolParam(name = "assets", required = true, description = "提取的角色、场景、道具资产数组，无资产时传空数组[]") List<GeneratedStoryboardAsset> assets) {
    }

    /**
     * 合成提示词Agent返回的单镜头结果。
     *
     * @param shotId String 输入镜头稳定标识
     * @param finalPrompt String 最终中文提示词
     */
    public record StoryboardPrompt(
            @ToolParam(name = "shotId", required = true, description = "与输入shots[].id严格一致的镜头标识") String shotId,
            @ToolParam(name = "finalPrompt", required = true, description = "按固定八段格式生成的中文最终提示词") String finalPrompt) {
    }

    /**
     * 合成提示词Agent返回的结构化结果。
     *
     * @param prompts List<StoryboardPrompt> 镜头提示词映射
     */
    public record PromptCompositionResult(
            @ToolParam(name = "prompts", required = true, description = "与输入镜头数量一致的最终提示词数组") List<StoryboardPrompt> prompts) {
    }

    /**
     * 首次生成分镜脚本响应。
     *
     * @param shots List<StoryboardShot> 带稳定标识的镜头列表
     * @param assets List<StoryboardAsset> 带稳定标识的资产列表
     * @param chargedCredits int 本次实际扣除积分
     */
    public record GenerateStoryboardResponse(List<StoryboardShot> shots, List<StoryboardAsset> assets, @jakarta.validation.constraints.Digits(integer = 18, fraction = 6) @JSONField(serializeUsing = CreditAmountWriter.class) BigDecimal chargedCredits) {
    }

    /**
     * 合成全部提示词响应。
     *
     * @param prompts List<StoryboardPrompt> 按稳定镜头标识返回的提示词映射
     * @param chargedCredits int 本次实际扣除积分
     */
    public record ComposePromptsResponse(List<StoryboardPrompt> prompts, @jakarta.validation.constraints.Digits(integer = 18, fraction = 6) @JSONField(serializeUsing = CreditAmountWriter.class) BigDecimal chargedCredits) {
    }
}
