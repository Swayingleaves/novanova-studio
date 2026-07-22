/**
 * @title        AiMessage.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  Agent Loop 内部消息结构
 * @createTime   2026-07-06 10:00:00
 */
package com.novanovastudio.agent.dto;

/**
 * Agent Loop 内部消息结构。
 *
 * @param role     String 角色：system | user | assistant | tool
 * @param content  String 消息内容
 * @param toolName String tool 角色时的工具名
 */
public record AiMessage(String role, String content, String toolName) {

    public AiMessage(String role, String content) {
        this(role, content, null);
    }
}
