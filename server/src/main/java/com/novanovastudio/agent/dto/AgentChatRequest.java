/**
 * @title        AgentChatRequest.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  Agent 对话请求 DTO
 * @createTime   2026-06-27 10:00:00
 */
package com.novanovastudio.agent.dto;

import java.util.List;
import java.util.Map;

/**
 * Agent 对话请求
 *
 * @param sessionId      String 会话ID，为空表示新建
 * @param profile        String 会话类型：canvas | generation，默认 canvas
 * @param message        String 用户消息
 * @param canvasSnapshot Map 画布快照（canvas profile 使用，generation 可为 null）
 * @param references     List<Reference> 选中节点引用
 * @param attachments    List<Attachment> 附件（图片参考等，generation profile 使用）
 * @param history        List<HistoryMessage> 前端对话历史
 * @param model          String 用户选择的模型编码
 */
public record AgentChatRequest(
    String sessionId,
    String profile,
    String message,
    Map<String, Object> canvasSnapshot,
    List<Reference> references,
    List<Attachment> attachments,
    List<HistoryMessage> history,
    String model
) {

    /**
     * 选中节点引用
     *
     * @param title String 节点标题
     * @param text  String 节点文本
     */
    public record Reference(String title, String text) {
    }

    /**
     * 附件（参考图等）
     *
     * @param url  String 文件URL
     * @param type String MIME类型
     * @param name String 文件名
     * @param storageKey String 后端媒体存储键
     */
    public record Attachment(String url, String type, String name, String storageKey) {
    }

    /**
     * 前端当前对话历史消息
     *
     * @param role String 角色：user | assistant
     * @param text String 消息文本
     */
    public record HistoryMessage(String role, String text) {
    }
}
