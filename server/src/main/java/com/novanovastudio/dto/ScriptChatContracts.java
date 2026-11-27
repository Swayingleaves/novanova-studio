package com.novanovastudio.dto;

import java.util.List;

/**
 * 剧本创作对话式编剧助手结构化输出契约。
 * <p>模型仅使用批内短序号（如 ep1、sc1）引用分集与场次，服务端映射回真实标识后再返回前端。</p>
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
     */
    public record AgentTurnResult(
            String reply,
            List<RecommendedAction> recommendedActions) {
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
}
