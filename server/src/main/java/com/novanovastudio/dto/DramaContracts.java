package com.novanovastudio.dto;

import java.util.List;

/**
 * 智能短剧导演Agent的结构化输出。身份、版本和确认状态不在这里，由服务端填写。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-14 00:40
 */
public final class DramaContracts {

    private DramaContracts() {
    }

    /**
     * 一轮导演回复。生成请求只读取目标阶段的产物；对话请求按意图决定是否落版本。
     *
     * @param reply 给用户看的回复
     * @param intent answer、revise、regenerate、confirm 或 media
     * @param targetStage 要修改的阶段，生成请求可为空
     * @param plan 制作方案
     * @param script 剧本
     * @param cast 角色与场景
     * @param shot 分镜镜头
     * @param preview 成片说明
     * @param media 要提交的图片或视频，不出图时为空
     */
    public record DirectorResult(String reply, String intent, String targetStage, PlanBody plan, ScriptBody script,
                                 CastBody cast, ShotBody shot, PreviewBody preview, MediaPlan media) {
    }

    /**
     * 主 Agent 规划出的出图或出视频。每个目标都必须带上提示词，服务端不再拼装文案。
     *
     * @param items 要提交的目标、提示词和参考图顺序
     * @param regenerate 是否连已经成功的也重新生成
     */
    public record MediaPlan(List<MediaItem> items, Boolean regenerate) {
    }

    /**
     * 一次生成目标的完整提交内容。
     *
     * @param targetKey 目标，如 character:c1、location:l1、shot-first:sh1、shot-last:sh1、shot-video:sh1
     * @param prompt 交给图片或视频模型的完整提示词
     * @param referenceKeys 参考图顺序，按语义从先到后排列
     */
    public record MediaItem(String targetKey, String prompt, List<String> referenceKeys) {
    }

    /**
     * 短剧提示词 Agent 的输出。
     *
     * @param prompt 交给图片或视频模型的完整提示词
     * @param referenceKeys 参考图顺序，按语义从先到后排列
     */
    public record MediaPrompt(String prompt, List<String> referenceKeys) {
    }

    /** @param title 作品标题 @param genre 题材 @param style 视觉风格 @param durationSeconds 目标秒数 @param aspectRatio 画幅比例，必须与输入一致 @param understanding 创意理解 @param storyDirection 故事方向 */
    public record PlanBody(String title, String genre, String style, Integer durationSeconds, String aspectRatio, String understanding, String storyDirection) {
    }

    /** @param synopsis 本集梗概 @param scenes 场景 */
    public record ScriptBody(String synopsis, List<SceneBody> scenes) {
    }

    /** @param ref 场景短序号sc1 @param heading 内/外·地点·时间 @param action 看得见的动作、表情和环境，每场至少两三句 @param lines 来回对白 */
    public record SceneBody(String ref, String heading, String action, List<LineBody> lines) {
    }

    /** @param characterRef 角色短序号，旁白可空 @param speaker 角色姓名，与 characterRef 全程对应 @param text 这句对白，不解释剧情 */
    public record LineBody(String characterRef, String speaker, String text) {
    }

    /** @param characters 角色 @param locations 场景 */
    public record CastBody(List<CharacterBody> characters, List<LocationBody> locations) {
    }

    /** @param ref 角色短序号c1 @param name 姓名 @param personality 性格 @param appearance 外形 */
    public record CharacterBody(String ref, String name, String personality, String appearance) {
    }

    /** @param ref 场景短序号l1 @param name 名称 @param visual 视觉说明 */
    public record LocationBody(String ref, String name, String visual) {
    }

    /** @param shots 分镜镜头列表 */
    public record ShotBody(List<ShotItem> shots) {
    }

    /** @param ref 镜头短序号sh1 @param order 顺序 @param durationSeconds 这一镜的时长（整数秒） @param size 景别 @param camera 运镜 @param picture 画面描述 @param dialogue 对白 @param characterRef 角色短序号 @param locationRef 场景短序号 @param videoPrompt 视频提示词，描述这一镜从首帧到尾帧的动作与情节 */
    public record ShotItem(String ref, Integer order, Integer durationSeconds, String size, String camera, String picture,
                           String dialogue, String characterRef, String locationRef, String videoPrompt) {
    }

    /** @param summary 制作总结 @param checklist 检查项 */
    public record PreviewBody(String summary, List<CheckItem> checklist) {
    }

    /** @param item 检查内容 @param passed 是否通过 */
    public record CheckItem(String item, Boolean passed) {
    }
}
