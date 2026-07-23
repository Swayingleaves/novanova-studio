package com.novanovastudio.agent;

import com.novanovastudio.service.PromptTemplateType;
import com.novanovastudio.service.SystemPromptTemplateService;
import io.agentscope.core.ReActAgent;
import io.agentscope.core.model.Model;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

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

    /**
     * 创建主Agent。
     *
     * @param model AgentScope文本模型
     * @return ReActAgent 主Agent
     */
    public ReActAgent mainAgent(Model model) {
        return build("main-agent", promptService.get(PromptTemplateType.AGENT_MAIN), model,
                "只能返回 CreationPlan 结构化结果，不得调用工具。");
    }

    /**
     * 创建固定图片子Agent。
     *
     * @param model AgentScope文本模型
     * @return ReActAgent 图片子Agent
     */
    public ReActAgent imageAgent(Model model) {
        return build("image-specialist-agent", promptService.get(PromptTemplateType.AGENT_IMAGE), model,
                "只返回 SpecialistAgentResult；只能选择 KEEP 或 OPTIMIZE，不得调用生成工具。");
    }

    /**
     * 创建固定视频子Agent。
     *
     * @param model AgentScope文本模型
     * @return ReActAgent 视频子Agent
     */
    public ReActAgent videoAgent(Model model) {
        return build("video-specialist-agent", promptService.get(PromptTemplateType.AGENT_VIDEO), model,
                "只返回 SpecialistAgentResult；只能选择 KEEP 或 OPTIMIZE，不得调用生成工具。");
    }

    /**
     * 构建无业务工具权限的ReActAgent。
     *
     * @param name String Agent名称
     * @param prompt String 外部系统提示词
     * @param model Model AgentScope模型
     * @param contract String Java固定的结构化契约补充
     * @return ReActAgent Agent实例
     */
    private ReActAgent build(String name, String prompt, Model model, String contract) {
        return ReActAgent.builder()
                .name(name)
                .sysPrompt(prompt + "\n\n" + contract)
                .model(model)
                .toolkit(new io.agentscope.core.tool.Toolkit())
                .maxIters(4)
                .build();
    }
}
