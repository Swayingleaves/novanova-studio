package com.novanovastudio.logging;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;
import reactor.util.context.Context;

/**
 * MDC（映射诊断上下文）管理工具测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-01 00:00
 */
class MappedDiagnosticContextTest {

    /**
     * 每个测试结束后清理当前线程MDC。
     */
    @AfterEach
    void clearMappedDiagnosticContext() {
        MDC.clear();
    }

    /**
     * 验证业务标识可以写入Reactor上下文。
     */
    @Test
    void shouldStoreValuesInReactorContext() {
        Context context = MappedDiagnosticContext.put(Context.empty(), MappedDiagnosticContext.REQUEST_ID, "request-123");
        context = MappedDiagnosticContext.put(context, MappedDiagnosticContext.USER_ID, 100L);

        assertEquals("request-123", MappedDiagnosticContext.values(context).get(MappedDiagnosticContext.REQUEST_ID));
        assertEquals("100", MappedDiagnosticContext.values(context).get(MappedDiagnosticContext.USER_ID));
    }

    /**
     * 验证MDC作用域结束后会恢复原始线程上下文。
     */
    @Test
    void shouldRestorePreviousThreadContextAfterScopeClosed() {
        MDC.put("traceId", "trace-123");

        try (MappedDiagnosticContext.Scope ignored = MappedDiagnosticContext.open(
                Map.of(MappedDiagnosticContext.TASK_ID, "task-123"))) {
            assertEquals("trace-123", MDC.get("traceId"));
            assertEquals("task-123", MDC.get(MappedDiagnosticContext.TASK_ID));
        }

        assertEquals("trace-123", MDC.get("traceId"));
        assertNull(MDC.get(MappedDiagnosticContext.TASK_ID));
    }

    /**
     * 验证Reactor切换线程后仍可从MDC读取请求标识。
     */
    @Test
    void shouldPropagateContextAcrossReactorThreadSwitch() {
        MappedDiagnosticContextConfiguration configuration = new MappedDiagnosticContextConfiguration();
        configuration.registerReactorHook();
        try {
            String requestId = Mono.just("value")
                    .publishOn(Schedulers.boundedElastic())
                    .map(ignored -> MDC.get(MappedDiagnosticContext.REQUEST_ID))
                    .contextWrite(context -> MappedDiagnosticContext.put(
                            context, MappedDiagnosticContext.REQUEST_ID, "request-123"))
                    .block();

            assertEquals("request-123", requestId);
        } finally {
            configuration.removeReactorHook();
        }
    }
}
