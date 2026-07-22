/**
 * @title        ToolCallFunction.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  工具调用的函数信息
 * @createTime   2026-07-06 10:00:00
 */
package com.novanovastudio.agent.dto;

/**
 * 工具调用的函数信息。
 *
 * @param name      String 函数名
 * @param arguments String 参数 JSON
 */
public record ToolCallFunction(String name, String arguments) {
}
