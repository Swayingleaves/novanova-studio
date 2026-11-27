package com.novanovastudio.dto;

import java.util.List;

/**
 * 剧本创作对话式 Nana助手结构化输出契约。
 * <p>模型仅使用批内短序号（如 ep1、sc1）引用分集与场次，服务端映射回真实标识后再返回前端；
 * 创作者要求写入概览/大纲/人物/世界观时，通过 {@code proposedWrites} 输出待用户确认的结构化提案。</p>
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-27 19:58
 */
public final class ScriptChatContracts {

    /** 禁止实例化契约工具类。 */
    private ScriptChatContracts() {
    }

    /**
     * 编剧助手单轮结构化回复。
     *
     * @param reply 给创作者的简洁专业中文回复
     * @param recommendedActions 推荐一键触发的正式剧本 AI 动作列表，无建议时为空
     * @param proposedWrites 待创作者确认后写入剧本的结构化内容提案，无写入意图时为空
     */
    public record AgentTurnResult(
            String reply,
            List<RecommendedAction> recommendedActions,
            List<ProposedWrite> proposedWrites) {
    }

    /**
     * 推荐执行的正式剧本 AI 动作。
     *
     * @param actionType 动作编码，必须来自 ScriptAiActions.ALL
     * @param label 卡片按钮或标题文案
     * @param description 简短说明为什么建议执行该动作
     * @param instruction 预填给草稿生成接口的具体创作要求
     * @param targetRef 批内目标短序号（如 ep1、sc2），可为空
     * @param episodeDurationSeconds 单集目标时长（仅 episodePlan/episodeDraft 有效，可为空）
     */
    public record RecommendedAction(
            String actionType,
            String label,
            String description,
            String instruction,
            String targetRef,
            Integer episodeDurationSeconds) {
    }

    /**
     * 待创作者确认的结构化写入提案（支持概览、大纲、人物、世界观）。
     *
     * @param targetSection 目标板块：overview / outline / characters / world
     * @param summary 简短中文说明本次将写入哪些内容
     * @param overview 故事概览字段补丁（仅 targetSection = overview 时填写，未改动字段留 null）
     * @param outlineSections 故事大纲结构段列表（仅 targetSection = outline 时填写）
     * @param characters 人物设定列表（仅 targetSection = characters 时填写）
     * @param worldSetting 世界观基础设定补丁（仅 targetSection = world 时填写）
     * @param worldItems 世界观规则/势力条目列表（仅 targetSection = world 时填写）
     * @param locations 场景地点列表（仅 targetSection = world 时填写）
     */
    public record ProposedWrite(
            String targetSection,
            String summary,
            OverviewPatch overview,
            List<OutlineSectionPatch> outlineSections,
            List<CharacterPatch> characters,
            WorldSettingPatch worldSetting,
            List<WorldItemPatch> worldItems,
            List<LocationPatch> locations) {
    }

    /** 故事概览字段补丁（仅填需要写入的字段，null 表示保留原值）。 */
    public record OverviewPatch(
            String title,
            String genre,
            String logline,
            String synopsis,
            Integer targetEpisodeCount,
            Integer targetDurationSeconds,
            String narrativeStyle,
            String theme,
            String mainPlot,
            String mainConflict,
            String endingDirection) {
    }

    /** 大纲结构段提案。 */
    public record OutlineSectionPatch(
            String sectionType,
            String title,
            String content) {
    }

    /** 人物设定提案。 */
    public record CharacterPatch(
            String name,
            String roleType,
            String identity,
            String age,
            String occupation,
            String personality,
            String goal,
            String desire,
            String fear,
            String motivation,
            String appearanceDescription,
            String speechStyle,
            String backgroundStory,
            String characterArc) {
    }

    /** 世界观基础设定补丁。 */
    public record WorldSettingPatch(
            String era,
            String region,
            String socialBackground,
            String overallTone) {
    }

    /** 世界观条目提案。 */
    public record WorldItemPatch(
            String itemType,
            String name,
            String description) {
    }

    /** 场景地点提案。 */
    public record LocationPatch(
            String name,
            String spacePurpose,
            String narrativeRole,
            String defaultTime,
            String weather,
            String atmosphere,
            String keyObjects) {
    }
}
