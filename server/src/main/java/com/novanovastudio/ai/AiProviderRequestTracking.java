package com.novanovastudio.ai;

import java.util.function.Supplier;
import reactor.core.publisher.Mono;

/**
 * 图片和视频任务是否已经向供应商发出生成请求。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-09 17:40
 */
public final class AiProviderRequestTracking {

    /** 反应式上下文中的标记器，仅图片和视频任务写入。 */
    public static final String CONTEXT_KEY = "aiProviderRequestSent";

    private AiProviderRequestTracking() {
    }

    /**
     * 在当前图片或视频任务上标记供应商请求已发出。
     *
     * @return Mono<Boolean> true 表示任务仍可继续发送；false 表示任务已取消
     */
    public static Mono<Boolean> markIfPresent() {
        return Mono.deferContextual(contextView -> {
            if (!contextView.hasKey(CONTEXT_KEY)) {
                return Mono.just(true);
            }
            @SuppressWarnings("unchecked")
            Supplier<Mono<Boolean>> marker = (Supplier<Mono<Boolean>>) contextView.get(CONTEXT_KEY);
            return marker.get().defaultIfEmpty(false);
        });
    }
}
