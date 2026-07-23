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
 * @param entrySource    String 入口来源：imagePage | videoPage | canvas
 * @param message        String 用户消息
 * @param canvasSnapshot Map 画布快照（canvas profile 使用，generation 可为 null）
 * @param references     List<Reference> 选中节点引用
 * @param attachments    List<Attachment> 附件（图片参考等，generation profile 使用）
 * @param history        List<HistoryMessage> 前端对话历史
 * @param creationSettings CreationSettings 页面选择的生成设置
 */
public record AgentChatRequest(
    String sessionId,
    String entrySource,
    String message,
    Map<String, Object> canvasSnapshot,
    List<Reference> references,
    List<Attachment> attachments,
    List<HistoryMessage> history,
    CreationSettings creationSettings
) {

    /**
     * 将入口来源转换为旧画布编排器使用的Profile名称。
     *
     * @return String 旧Profile名称
     */
    public String profile() {
        return switch (entrySource == null ? "" : entrySource) {
            case "imagePage" -> "generation";
            case "videoPage" -> "video";
            default -> "canvas";
        };
    }

    /**
     * 获取页面选择的模型编码，供旧画布编排器读取。
     *
     * @return String 模型编码
     */
    public String model() {
        return creationSettings == null ? null : creationSettings.model();
    }

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
