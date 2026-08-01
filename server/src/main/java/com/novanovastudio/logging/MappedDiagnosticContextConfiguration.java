package com.novanovastudio.logging;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.springframework.context.annotation.Configuration;
import reactor.core.publisher.Hooks;
import reactor.core.publisher.Operators;

/**
 * WebFlux MDC（映射诊断上下文）传播配置。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-01 00:00
 */
@Configuration
public class MappedDiagnosticContextConfiguration {

    /** Reactor全局钩子名称 */
    private static final String REACTOR_HOOK_KEY = MappedDiagnosticContextConfiguration.class.getName();

    /**
     * 注册Reactor信号与线程MDC之间的同步钩子。
     */
    @PostConstruct
    public void registerReactorHook() {
        Hooks.onEachOperator(REACTOR_HOOK_KEY,
                Operators.lift((scannable, subscriber) -> MappedDiagnosticContext.subscriber(subscriber)));
    }

    /**
     * 应用关闭时移除Reactor钩子，避免测试或热重启污染后续上下文。
     */
    @PreDestroy
    public void removeReactorHook() {
        Hooks.resetOnEachOperator(REACTOR_HOOK_KEY);
    }
}
