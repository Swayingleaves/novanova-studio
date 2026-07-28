package com.novanovastudio.ai;

import com.alibaba.fastjson2.JSONObject;
import reactor.core.publisher.Mono;

/**
 * @title        AiProviderAdapter.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  AI渠道供应商适配器接口
 * @createTime   2026-06-24 20:35:00
 */
public interface AiProviderAdapter {

    /**
     * 获取渠道调用格式
     *
     * @return String 渠道调用格式，例如openai、agnes、gemini、seedance
     */
    String apiFormat();

    /**
     * 判断当前适配器是否支持任务类型
     *
     * @param taskType String 任务类型，取值为text、image、video
     * @return boolean 是否支持
     */
    boolean supports(String taskType);

    /**
     * 执行AI任务
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @return Mono<JSONObject> 任务结果JSON
     */
    Mono<JSONObject> execute(AiTaskExecutionContext context);
}
