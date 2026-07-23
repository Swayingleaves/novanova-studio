/**
 * @title        AgentSession.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  Agent 会话实体
 * @createTime   2026-06-27 10:00:00
 */
package com.novanovastudio.agent.dto;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * Agent 会话实体
 *
 * @param id        String 会话ID
 * @param userId    Long 用户ID
 * @param title     String 会话标题
 * @param profile   String 入口来源：canvas | imagePage | videoPage
 * @param messages  List<AgentMessage> 消息列表
 * @param createdAt OffsetDateTime 创建时间
 * @param updatedAt OffsetDateTime 更新时间
 */
public record AgentSession(
    String id,
    Long userId,
    String title,
    String profile,
    List<AgentMessage> messages,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {

    /** 画布会话 */
    public static final String PROFILE_CANVAS = "canvas";
    /** 图片创作页会话 */
    public static final String PROFILE_IMAGE_PAGE = "imagePage";
    /** 视频创作页会话 */
    public static final String PROFILE_VIDEO_PAGE = "videoPage";
}
