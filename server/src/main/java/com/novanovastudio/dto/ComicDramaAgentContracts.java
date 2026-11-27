package com.novanovastudio.dto;

import java.math.BigDecimal;
import java.util.List;

/**
 * 漫剧制片助手Agent结构化输出契约。
 * <p>模型仅使用批内短序号（如 s1、s2）引用镜头，服务端落库前统一映射回真实标识。</p>
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-27 19:25
 */
public final class ComicDramaAgentContracts {

    /** 禁止实例化契约工具类。 */
    private ComicDramaAgentContracts() {
    }

    /**
     * 漫剧制片助手单轮结构化响应。
     *
     * @param reply 给创作者的简洁中文回复
     * @param shotEdits 直接落库生效的镜头及提示词修改列表，无修改时为空
     * @param proposedActions 需要创作者确认费用或一键执行的建议动作列表，无建议时为空
     */
    public record AgentTurnResult(
            String reply,
            List<ShotEdit> shotEdits,
            List<ProposedAction> proposedActions) {
    }

    /**
     * 单个镜头的直接修改项；未修改的属性置空，服务端仅覆写非空字段。
     *
     * @param shotRef 批内短序号（如 s1、s2），必须来自输入清单
     * @param shotSize 景别（如 远景/全景/中景/近景/特写/大特写）
     * @param cameraMovement 运镜方式
     * @param durationSeconds 预估时长（秒）
     * @param visualDescription 画面构图与视觉描述
     * @param actionDescription 人物与物体动作描述
     * @param lightingAtmosphere 光线天气与氛围
     * @param dialogueVoiceover 对白或旁白
     * @param soundDescription 环境音与音效
     * @param finalPrompt 修改后的最终视频提示词（若填写将保存为新的采用版本）
     */
    public record ShotEdit(
            String shotRef,
            String shotSize,
            String cameraMovement,
            BigDecimal durationSeconds,
            String visualDescription,
            String actionDescription,
            String lightingAtmosphere,
            String dialogueVoiceover,
            String soundDescription,
            String finalPrompt) {
    }

    /**
     * 需要创作者确认后执行的动作建议（如拆镜头、补资产图、批量提示词、生视频、一键出集、导出成片）。
     *
     * @param actionType 动作类型：oneClickEpisode | splitEpisode | generateAssets | composePrompts | generateVideos | exportVideo
     * @param label 按钮中文文案
     * @param description 动作简短说明
     * @param shotRefs 关联镜头短序号列表（可为空）
     */
    public record ProposedAction(
            String actionType,
            String label,
            String description,
            List<String> shotRefs) {
    }
}
