package com.novanovastudio.service;

/**
 * AI系统提示词模板类型。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-17 00:00
 */
public enum PromptTemplateType {

    /** 图片提示词优化模板 */
    OPTIMIZATION_IMAGE,
    /** 视频提示词优化模板 */
    OPTIMIZATION_VIDEO,
    /** 图片生成Agent模板 */
    AGENT_IMAGE,
    /** 视频生成Agent模板 */
    AGENT_VIDEO,
    /** 画布Agent模板 */
    AGENT_CANVAS
}
