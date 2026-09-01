package com.novanovastudio.agent;

import com.novanovastudio.service.PromptTemplateType;
import com.novanovastudio.service.SystemPromptTemplateService;
import io.agentscope.core.ReActAgent;
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
        String prompt = promptService.get(PromptTemplateType.AGENT_MAIN);
        if (StringUtils.hasText(extraSystemPrompt)) {
            prompt = prompt + "\n\n" + extraSystemPrompt;
        }
        return build("main-agent", prompt, model,
                "只能返回 CreationPlan 结构化结果，不得调用工具。", true);
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
                "只能返回当前请求对应的分镜结构化结果，不得调用工具、解释或输出额外文本。", false);
    }

    /**
     * 创建视频技能工作流对话Agent，负责多轮理解意图并起草阶段提示词。
     *
     * @param model Model 用户明确选择的文本模型
     * @param conversationPrompt String 工作流定义提供的对话系统提示词
     * @return ReActAgent 工作流对话Agent
     */
    public ReActAgent workflowConversationAgent(Model model, String conversationPrompt) {
        return build("workflow-conversation-agent", conversationPrompt, model,
                "只能返回 VideoWorkflowConversationTurn 结构化结果，不得调用工具，不得创建生成任务。", true);
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
        ReActAgent.Builder builder = ReActAgent.builder()
                .name(name)
                .sysPrompt(prompt + "\n\n" + contract)
                .model(model)
                .toolkit(new io.agentscope.core.tool.Toolkit())
                .maxIters(4);
        if (thinkingEnabled) {
            builder.middleware(thinkingEventMiddleware);
        }
        return builder.build();
    }
}
