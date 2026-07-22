/**
 * @title        CanvasProfile.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  画布 Agent Loop Profile
 * @createTime   2026-07-06 10:00:00
 */
package com.novanovastudio.agent;

import com.novanovastudio.agent.dto.AgentChatRequest;
import com.novanovastudio.agent.dto.AgentMessage;
import com.novanovastudio.agent.dto.AgentSession;
import com.novanovastudio.agent.dto.AgentTool;
import com.novanovastudio.agent.dto.AgentToolResult.ToolResult;
import com.novanovastudio.agent.dto.AiMessage;
import com.novanovastudio.service.PromptTemplateType;
import com.novanovastudio.service.SystemPromptTemplateService;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;

/**
 * 画布 Agent Profile。
 * <p>
 * 工具含画布操作（canvas_get_state、canvas_apply_ops 等）和内容生成工具；
 * 所有画布写入及生成操作均通过 SSE 转发到前端执行。
 */
@Component
public class CanvasProfile implements AgentLoopProfile {

    private final AgentToolRegistry toolRegistry;

    /** 系统提示词模板服务 */
    private final SystemPromptTemplateService systemPromptTemplateService;

    /**
     * 创建画布Agent Profile。
     *
     * @param toolRegistry Agent工具注册表
     * @param systemPromptTemplateService SystemPromptTemplateService 系统提示词模板服务
     */
    public CanvasProfile(AgentToolRegistry toolRegistry, SystemPromptTemplateService systemPromptTemplateService) {
        this.toolRegistry = toolRegistry;
        this.systemPromptTemplateService = systemPromptTemplateService;
    }

    /**
     * 获取Profile名称。
     *
     * @return String Profile名称
     */
    @Override public String name() { return "canvas"; }

    /**
     * 获取画布可用工具。
     *
     * @return List<AgentTool> 工具列表
     */
    @Override public List<AgentTool> tools() { return toolRegistry.allTools(); }

    /**
     * 判断工具是否由前端执行。
     *
     * @param toolName String 工具名称
     * @return boolean 是否由前端执行
     */
    @Override public boolean isFrontendTool(String toolName) { return toolRegistry.isFrontend(toolName); }

    /**
     * 拒绝在后端执行画布工具。
     *
     * @param userId Long 用户ID
     * @param toolName String 工具名称
     * @param args Map 工具参数
     * @param attachments List<Attachment> 当前用户上传的媒体附件
     * @param emitter AgentEventEmitter 事件发射器
     * @param sessionId String 会话ID
     * @param callId String 工具调用ID
     * @return Mono<ToolResult> 不支持结果
     */
    @Override
    public Mono<ToolResult> executeTool(Long userId, String toolName, Map<String, Object> args, List<AgentChatRequest.Attachment> attachments,
                                         AgentEventEmitter emitter, String sessionId, String callId) {
        return Mono.just(new ToolResult(false, "画布工具必须由前端执行: " + toolName));
    }

    /**
     * 构建包含画布快照的Agent消息。
     *
     * @param userId Long 用户ID
     * @param session AgentSession 会话
     * @param request AgentChatRequest 请求
     * @return Mono<List<AiMessage>> Agent消息列表
     */
    @Override
    public Mono<List<AiMessage>> buildMessages(Long userId, AgentSession session, AgentChatRequest request) {
        List<AiMessage> messages = new ArrayList<>();
        messages.add(new AiMessage("system", systemPromptTemplateService.get(PromptTemplateType.AGENT_CANVAS)));
        if (request.history() != null && !request.history().isEmpty()) {
            // 前端历史只包含用户和助手的自然语言消息，避免持久化工具JSON干扰多轮补参语义。
            for (AgentChatRequest.HistoryMessage historyMessage : request.history()) {
                if (!"user".equals(historyMessage.role()) && !"assistant".equals(historyMessage.role())) continue;
                messages.add(new AiMessage(historyMessage.role(), historyMessage.text() != null ? historyMessage.text() : ""));
            }
        } else {
            // 前端未携带历史时使用服务端会话兜底，确保跨端请求仍具备上下文。
            for (AgentMessage message : session.messages()) {
                if (!"user".equals(message.role()) && !"assistant".equals(message.role())) continue;
                messages.add(new AiMessage(message.role(), message.text() != null ? message.text() : ""));
            }
        }
        // 将当前画布快照作为上下文注入用户消息
        String userMsg = request.message();
        if (request.canvasSnapshot() != null && !request.canvasSnapshot().isEmpty()) {
            userMsg += "\n当前画布JSON:\n" +
                com.alibaba.fastjson2.JSON.toJSONString(request.canvasSnapshot());
        }
        messages.add(new AiMessage("user", userMsg));
        return Mono.just(messages);
    }

    /**
     * 获取单次对话最大循环步数。
     *
     * @return int 最大循环步数
     */
    @Override public int maxSteps() { return 4; }

}
