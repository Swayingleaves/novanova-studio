package com.novanovastudio.agent;

import com.novanovastudio.service.PromptTemplateType;
import com.novanovastudio.service.SystemPromptTemplateService;
import io.agentscope.core.ReActAgent;
import io.agentscope.core.middleware.MiddlewareBase;
import io.agentscope.core.model.Model;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * 固定主Agent、图片子Agent和视频子Agent工厂。
 * <p>每次请求创建独立ReActAgent实例，避免不同会话共享Agent运行状态。</p>
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-23 00:00
 */
@Component
@RequiredArgsConstructor
public class AgentScopeAgentFactory {

    /** Prompt模板服务 */
    private final SystemPromptTemplateService promptService;
    /** 主Agent思考事件中间件 */
    private final AgentThinkingEventMiddleware thinkingEventMiddleware;
    /** 短剧回复流中间件 */
    private final DramaReplyStreamMiddleware dramaReplyStreamMiddleware;
    /** 创作对话回复流中间件 */
    private final CreationReplyStreamMiddleware creationReplyStreamMiddleware;

    /**
     * 创建主Agent。
     *
     * @param model AgentScope文本模型
     * @return ReActAgent 主Agent
     */
    public ReActAgent mainAgent(Model model) {
        return mainAgent(model, null);
    }

    /**
     * 创建主Agent，可追加技能流程系统提示词。
     *
     * @param model AgentScope文本模型
     * @param extraSystemPrompt String 追加到主Agent系统提示词末尾的技能流程指令，可为空
     * @return ReActAgent 主Agent
     */
    public ReActAgent mainAgent(Model model, String extraSystemPrompt) {
        String prompt = promptService.get(PromptTemplateType.AGENT_MAIN) + "\n\n" + promptService.get(PromptTemplateType.AGENT_USER_ACTIONS);
        if (StringUtils.hasText(extraSystemPrompt)) {
            prompt = prompt + "\n\n" + extraSystemPrompt;
        }
        return build("main-agent", prompt, model,
                "只能返回 CreationPlan 结构化结果，不得调用工具。", true, creationReplyStreamMiddleware);
    }

    /**
     * 创建主Agent失败恢复模式实例。
     *
     * @param model AgentScope文本模型
     * @return ReActAgent 主Agent恢复模式实例
     */
    public ReActAgent recoveryAgent(Model model) {
        return build("main-agent-recovery", promptService.get(PromptTemplateType.AGENT_RECOVERY), model,
                "只能返回 CreationRecoveryPlan 结构化结果，不得调用工具或重新规划任务。", true);
    }

    /**
     * 创建固定图片子Agent。
     *
     * @param model AgentScope文本模型
     * @return ReActAgent 图片子Agent
     */
    public ReActAgent imageAgent(Model model) {
        return build("image-specialist-agent", promptService.get(PromptTemplateType.AGENT_IMAGE), model,
                "只返回 SpecialistAgentResult；只能选择 KEEP 或 OPTIMIZE，不得调用生成工具。", false);
    }

    /**
     * 创建固定视频子Agent。
     *
     * @param model AgentScope文本模型
     * @return ReActAgent 视频子Agent
     */
    public ReActAgent videoAgent(Model model) {
        return build("video-specialist-agent", promptService.get(PromptTemplateType.AGENT_VIDEO), model,
                "只返回 SpecialistAgentResult；只能选择 KEEP 或 OPTIMIZE，不得调用生成工具。", false);
    }

    /**
     * 创建分镜脚本Agent。
     *
     * @param model Model 用户明确选择的文本模型
     * @return ReActAgent 分镜脚本Agent
     */
    public ReActAgent storyboardAgent(Model model) {
        return build("storyboard-agent", promptService.get(PromptTemplateType.AGENT_STORYBOARD), model,
                "只能通过框架要求的结构化输出提交当前请求对应的分镜结果；除该机制外不得调用业务工具、不得解释或输出额外文本。", false);
    }

    /**
     * 创建智能短剧导演Agent。
     *
     * @param model Model 用户选择的文本模型
     * @return ReActAgent 短剧导演Agent
     */
    public ReActAgent dramaAgent(Model model) {
        return build("drama-agent", promptService.get(PromptTemplateType.AGENT_DRAMA), model,
                "只能返回当前请求对应的短剧结构化结果，不得调用工具、解释或输出额外文本。", false, dramaReplyStreamMiddleware);
    }

    /**
     * 创建智能短剧提示词Agent，只负责把一个生成目标写成图片或视频提示词。
     *
     * @param model Model 用户选择的文本模型
     * @return ReActAgent 短剧提示词Agent
     */
    public ReActAgent dramaMediaAgent(Model model) {
        return build("drama-media-agent", promptService.get(PromptTemplateType.AGENT_DRAMA_MEDIA), model,
                "只能返回 MediaPrompt 结构化结果，不得调用工具、解释或输出额外文本。", false);
    }

    /**
     * 创建剧本创作Agent。
     *
     * @param model Model 用户明确选择的文本模型
     * @return ReActAgent 剧本创作Agent
     */
    public ReActAgent scriptAgent(Model model) {
        return build("script-agent", promptService.get(PromptTemplateType.AGENT_SCRIPT), model,
                "若当前请求提供 generate_response 工具，必须通过该工具提交剧本结构化结果，并将结果对象放入 response 参数。"
                        + "未提供该工具时，按请求指定的原生结构化输出模式提交。不得调用其他工具、输出解释或额外文本。", false);
    }

    /**
     * 创建故事知识库分析Agent。
     *
     * @param model Model 用户明确选择的文本模型
     * @return ReActAgent 故事知识库分析Agent
     */
    public ReActAgent storyBibleAgent(Model model) {
        return build("story-bible-agent", promptService.get(PromptTemplateType.AGENT_STORY_BIBLE), model,
                "只能返回当前请求对应的故事知识库结构化结果，不得调用工具、解释或输出额外文本；证据必须逐字摘自输入原文。", false);
    }

    /**
     * 创建小说章节目录识别Agent，仅根据提取出的短行候选列表筛选真正的章节标题。
     *
     * @param model Model 用户选择的文本模型
     * @return ReActAgent 章节目录识别Agent
     */
    public ReActAgent chapterDetectAgent(Model model) {
        String prompt = """
                你是小说章节目录识别专家。输入包含从小说原文中提取的候选短行列表（每行包含 id 和 text）。
                请判断哪些候选行是真正的小说章节、卷、回、序章、楔子、尾声或番外标题，过滤掉试读声明、广告、作者感言、正文中偶发的短句或对话。
                只返回属于章节标题的候选行 id 列表（按原文顺序升序排列）；如果原文确实没有章节标题，返回空列表。
                """;
        return build("chapter-detect-agent", prompt, model,
                "只能返回结构化结果，不得调用工具、不得解释或输出额外文本。", false);
    }

    /**
     * 创建视频技能工作流对话Agent，负责多轮理解意图并起草阶段提示词。
     *
     * @param model Model 用户明确选择的文本模型
     * @param conversationPrompt String 工作流定义提供的对话系统提示词
     * @return ReActAgent 工作流对话Agent
     */
    public ReActAgent workflowConversationAgent(Model model, String conversationPrompt) {
        return build("workflow-conversation-agent", conversationPrompt + "\n\n" + promptService.get(PromptTemplateType.AGENT_USER_ACTIONS), model,
                "只能返回 VideoWorkflowConversationTurn 结构化结果，不得调用工具，不得创建生成任务。", true, creationReplyStreamMiddleware);
    }

    /**
     * 创建漫剧制片助手Agent，负责理解当前分集与镜头上下文、直接产出镜头/提示词修订，并为扣费生成动作给出明确建议。
     *
     * @param model Model 用户选择的文本模型
     * @return ReActAgent 漫剧制片助手Agent
     */
    public ReActAgent comicDramaAgent(Model model) {
        String prompt = """
                你是 Novanova Studio 的 Nana助手（Nana Agent），负责漫剧制片协作，协助创作者高效完成单集分镜编排、镜头画面与对白打磨、最终视频提示词优化及出片流程诊断。
                核心规则：
                1. 你看到的镜头均使用批内短序号（s1、s2...，从 1 起），严禁编造或改写不存在的序号，也不要输出数据库 UUID。
                2. 创作者要求修改镜头景别、运镜、时长、画面描述、动作、光影、对白、音效或最终视频提示词时，直接在 shotEdits 中填写要改动的字段（未改动字段留 null），服务端会立即保存生效。
                3. 涉及拆镜头、生成资产图、批量生成提示词、生成镜头视频、一键出集或导出成片等扣费/异步任务时，不要伪造已完成结果，而是在 proposedActions 中返回清晰动作建议（actionType 仅限 oneClickEpisode / splitEpisode / generateAssets / composePrompts / generateVideos / exportVideo），由创作者确认预算后触发。
                4. 回复简明、专业、动作导向，直接说明已应用的修改和下一步建议。
                """;
        return build("comic-drama-agent", prompt, model,
                "只能返回 ComicDramaAgentContracts.AgentTurnResult 结构化结果，不得调用业务工具，不得输出额外解释文本。", false);
    }

    /**
     * 创建剧本创作对话式编剧助手Agent，负责多轮剧情探讨、诊断优化并推荐可一键执行的正式草稿动作。
     *
     * @param model Model 用户选择的文本模型
     * @return ReActAgent 剧本对话助手Agent
     */
    public ReActAgent scriptChatAgent(Model model) {
        String prompt = """
                你是 Novanova Studio 的 Nana助手（Nana Agent），担任资深剧本编剧搭档，正在与创作者并肩打磨剧本。
                核心规则：
                1. 根据当前剧本上下文（故事概览、大纲、人物、世界观、选中分集或场次正文）提供具体、可落地的编剧建议，避免空泛套话。
                2. 上下文中的分集和场次使用批内短序号（ep1、ep2...；sc1、sc2...，从 1 起），严禁编造或输出数据库 UUID。
                3. 当创作者希望实际生成或改写剧本内容（如生成故事方向、生成大纲、人物设定、世界观、分集规划、单集正文，或润色/扩写/缩写/改写/优化对白/强化冲突/增强悬疑/加强反转/完善动机/强化情绪/抬升爽点高潮/调整节奏/统一文风）时，在 recommendedActions 中给出 1~3 个最贴切的正式动作建议：
                   - actionType 必须严格取自输入中 availableActions 列表；
                   - instruction 写成可直接交给草稿生成引擎执行的精炼中文创作要求；
                   - 若针对特定分集或场次，targetRef 填写对应的短序号（如 ep1 或 sc2），否则留空。
                4. 你不会直接覆盖正式剧本，所有推荐动作都会由创作者确认预算后生成审核草稿。回复应简洁清晰、直击重点。
                """;
        return build("script-chat-agent", prompt, model,
                "只能返回 ScriptChatContracts.AgentTurnResult 结构化结果，不得调用业务工具，不得输出额外解释文本。", false);
    }

    /**
     * 构建无业务工具权限的ReActAgent。
     *
     * @param name String Agent名称
     * @param prompt String 外部系统提示词
     * @param model Model AgentScope模型
     * @param contract String Java固定的结构化契约补充
     * @param thinkingEnabled boolean 是否转发思考事件
     * @return ReActAgent Agent实例
     */
    private ReActAgent build(String name, String prompt, Model model, String contract, boolean thinkingEnabled) {
        return build(name, prompt, model, contract, thinkingEnabled, null);
    }

    /**
     * 构建无业务工具权限的ReActAgent，并可追加一个额外的旁路中间件。
     *
     * @param name String Agent名称
     * @param prompt String 外部系统提示词
     * @param model Model AgentScope模型
     * @param contract String Java固定的结构化契约补充
     * @param thinkingEnabled boolean 是否转发思考事件
     * @param middleware MiddlewareBase 额外中间件，可为空
     * @return ReActAgent Agent实例
     */
    private ReActAgent build(String name, String prompt, Model model, String contract, boolean thinkingEnabled,
                             MiddlewareBase middleware) {
        ReActAgent.Builder builder = ReActAgent.builder()
                .name(name)
                .sysPrompt(prompt + "\n\n" + contract)
                .model(model)
                .toolkit(new io.agentscope.core.tool.Toolkit())
                .maxIters(4);
        if (thinkingEnabled) {
            builder.middleware(thinkingEventMiddleware);
        }
        if (middleware != null) {
            builder.middleware(middleware);
        }
        return builder.build();
    }
}
