/**
 * @title        AgentLoopProfile.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  Agent Loop Profile 接口
 * @createTime   2026-07-06 10:00:00
 */
package com.novanovastudio.agent;

import com.novanovastudio.agent.dto.AgentChatRequest;
import com.novanovastudio.agent.dto.AgentSession;
import com.novanovastudio.agent.dto.AgentTool;
import com.novanovastudio.agent.dto.AgentToolResult.ToolResult;
import com.novanovastudio.agent.dto.AiMessage;
import java.util.List;
import java.util.Map;
import reactor.core.publisher.Mono;

/**
 * Agent Loop Profile 接口，定义不同场景下的工具集、执行策略和消息构建逻辑。
 * <p>
 * Canvas 和 Generation 两种场景各自实现：工具集、前后端执行位置和消息构建逻辑不同。
 */
public interface AgentLoopProfile {

    /** Profile 标识，匹配 AgentChatRequest.profile */
    String name();

    /** 该 Profile 可用工具列表 */
    List<AgentTool> tools();

    /** 判断工具是否需要转发到前端执行 */
    boolean isFrontendTool(String toolName);

    /**
     * 执行后端工具调用。
     * <p>
     * 前端工具不会进入该方法；Generation 等后端工具会等待异步任务完成并推送进度。
     *
     * @param userId    Long 用户ID
     * @param toolName  String 工具名
     * @param args      Map 工具参数
     * @param attachments List<Attachment> 当前用户上传的媒体附件
     * @param emitter   AgentEventEmitter 事件发射器
     * @param sessionId String 会话ID
     * @param callId    String 工具调用 ID，用于 progress 事件匹配
     * @return Mono<ToolResult> 工具执行结果
     */
    Mono<ToolResult> executeTool(
        Long userId,
        String toolName,
        Map<String, Object> args,
        List<AgentChatRequest.Attachment> attachments,
        AgentEventEmitter emitter,
        String sessionId,
        String callId
    );

    /**
     * 构建 Agent Loop 初始消息列表，包括系统提示词、历史消息和当前用户消息。
     *
     * @param userId  Long 用户ID
     * @param session AgentSession 当前会话
     * @param request AgentChatRequest 用户请求
     * @return Mono<List<AiMessage>> 消息列表
     */
    Mono<List<AiMessage>> buildMessages(
        Long userId,
        AgentSession session,
        AgentChatRequest request
    );

    /** 最大对话步数，防止无限循环 */
    default int maxSteps() { return 999; }

    /**
     * 工具执行完成后是否继续 Agent Loop（将结果喂回 LLM 进行下一轮）。
     * <p>
     * Canvas: 需要 LLM 确认工具结果，返回 true。
     * Generation: 生图/生视频工具是终态操作，执行完即结束，返回 false 避免多余 LLM 调用。
     */
    default boolean shouldContinueAfterToolResults() { return true; }

    /**
     * 判断某个工具是否为终态工具。
     * <p>
     * 终态工具执行完成后 Agent Loop 结束（不再将结果喂回 LLM）；
     * 非终态工具的结果会喂回 LLM 继续对话（如 query_history）。
     * <p>
     * 默认行为：当 shouldContinueAfterToolResults 为 false 时所有工具都是终态，
     * 为 true 时所有工具都不是终态。子类可覆盖以实现混合策略。
     *
     * @param toolName 工具名称
     * @return true 表示该工具是终态工具
     */
    default boolean isTerminalTool(String toolName) {
        return !shouldContinueAfterToolResults();
    }
}
