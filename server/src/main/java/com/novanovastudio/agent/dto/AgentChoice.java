package com.novanovastudio.agent.dto;

/**
 * Agent 引导用户时提供的可点击选项。
 * <p>
 * 主Agent在 clarificationQuestion 中需要用户从多个候选中挑选时输出该结构，
 * 服务端将其转为 AgentAction(type=choice) 随 task-complete 事件下发，
 * 前端渲染为按钮，点击后把 value 作为用户消息发送继续对话。
 *
 * @param label String 按钮显示文案
 * @param value String 点击后作为用户消息发送的文本（action 非空时不发送消息）
 * @param multiple Boolean 整组是否支持多选：true 时前端渲染为可勾选多个的按钮组，提交时多个 value 用顿号拼接为一条消息；null/false 为单选（点击即发送）
 * @param action String 特殊动作标识（可为空）：upload_image 表示点击后直接触发页面参考图上传，不发送消息
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-27 00:00
 */
public record AgentChoice(String label, String value, Boolean multiple, String action) {
}
