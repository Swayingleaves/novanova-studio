package com.novanovastudio.ai;

import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.entity.AiGenerationTask;
import java.util.function.Function;
import java.util.function.IntFunction;
import java.util.function.Supplier;
import reactor.core.publisher.Mono;

/**
 * @title        AiTaskExecutionContext.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  AI任务执行上下文
 * @createTime   2026-06-24 20:35:00
 * @param task AiGenerationTask 当前任务实体
 * @param channel AiChannelConfig 当前渠道配置
 * @param model String 实际请求模型
 * @param thinkingEnabled boolean 是否开启思考模式
 * @param reasoningEffort String 思考强度
 * @param request CreateAiTaskRequest 原始任务请求
 * @param cancelChecker Supplier<Mono<Boolean>> 取消状态检查器
 * @param progressReporter IntFunction<Mono<Void>> 进度上报器
 * @param deltaEmitter Function<String, Mono<Void>> 流式文本片段推送器，输入增量文本，返回推送结果
 */
public record AiTaskExecutionContext(AiGenerationTask task,
                                     AiTaskDtos.AiChannelConfig channel,
                                     String model,
                                     boolean thinkingEnabled,
                                     String reasoningEffort,
                                     AiTaskDtos.CreateAiTaskRequest request,
                                     Supplier<Mono<Boolean>> cancelChecker,
                                     IntFunction<Mono<Void>> progressReporter,
                                     Function<String, Mono<Void>> deltaEmitter) {

    /**
     * 判断任务是否已请求取消
     *
     * @return Mono<Boolean> true表示已请求取消
     */
    public Mono<Boolean> isCancelRequested() {
        return cancelChecker.get();
    }

    /**
     * 上报运行中进度
     *
     * @param progress int 任务进度，范围0到100
     * @return Mono<Void> 上报结果
     */
    public Mono<Void> updateRunningProgress(int progress) {
        return progressReporter.apply(progress);
    }

    /**
     * 推送流式文本增量片段
     *
     * @param delta String 增量文本片段
     * @return Mono<Void> 推送结果
     */
    public Mono<Void> emitTextDelta(String delta) {
        if (deltaEmitter == null || delta == null || delta.isEmpty()) {
            return Mono.empty();
        }
        return deltaEmitter.apply(delta);
    }
}
