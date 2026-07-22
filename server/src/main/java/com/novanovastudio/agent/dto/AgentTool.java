/**
 * @title        AgentTool.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  Agent 工具定义
 * @createTime   2026-06-27 10:00:00
 */
package com.novanovastudio.agent.dto;

import com.alibaba.fastjson2.JSONObject;

/**
 * Agent 工具定义
 *
 * @param name        String 工具名
 * @param description String 工具描述
 * @param parameters  JSONObject JSON Schema 参数定义
 * @param frontend    boolean 是否需要前端执行
 */
public record AgentTool(
    String name,
    String description,
    JSONObject parameters,
    boolean frontend
) {
}
