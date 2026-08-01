package com.novanovastudio.logging;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import org.reactivestreams.Subscription;
import org.slf4j.MDC;
import reactor.core.CoreSubscriber;
import reactor.util.context.Context;
import reactor.util.context.ContextView;

/**
 * MDC（Mapped Diagnostic Context，映射诊断上下文）管理工具。
 * <p>
 * 业务标识先写入 Reactor Context，再由订阅器在每次响应式信号回调前同步到线程 MDC，
 * 避免 WebFlux 切换线程后日志上下文丢失或线程复用导致上下文串联。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-01 00:00
 */
public final class MappedDiagnosticContext {

    /** HTTP请求标识 */
    public static final String REQUEST_ID = "requestId";

    /** 用户标识 */
    public static final String USER_ID = "userId";

    /** AI任务标识 */
    public static final String TASK_ID = "taskId";

    /** Agent会话标识 */
    public static final String SESSION_ID = "sessionId";

    /** Agent计划标识 */
    public static final String PLAN_ID = "planId";

    /** Agent计划子任务标识 */
    public static final String PLAN_TASK_ID = "planTaskId";

    /** Reactor Context中的MDC数据键 */
    private static final String REACTOR_CONTEXT_KEY = MappedDiagnosticContext.class.getName();

    /** 本组件负责维护的MDC字段 */
    private static final Set<String> MANAGED_KEYS = Set.of(
            REQUEST_ID, USER_ID, TASK_ID, SESSION_ID, PLAN_ID, PLAN_TASK_ID);

    /**
     * 工具类禁止实例化。
     */
    private MappedDiagnosticContext() {
    }

    /**
     * 向Reactor上下文写入一个MDC字段。
     *
     * @param context Context Reactor上下文
     * @param key String MDC字段名称
     * @param value Object MDC字段值
     * @return Context 写入后的Reactor上下文
     */
    public static Context put(Context context, String key, Object value) {
        if (value == null || value.toString().isBlank()) {
            return context;
        }
        Map<String, String> values = new LinkedHashMap<>(values(context));
        values.put(key, value.toString());
        return context.put(REACTOR_CONTEXT_KEY, Map.copyOf(values));
    }

    /**
     * 向Reactor上下文批量写入MDC字段。
     *
     * @param context Context Reactor上下文
     * @param additions Map<String, String> 待写入的MDC字段
     * @return Context 写入后的Reactor上下文
     */
    public static Context putAll(Context context, Map<String, String> additions) {
        Context updatedContext = context;
        for (Map.Entry<String, String> entry : additions.entrySet()) {
            updatedContext = put(updatedContext, entry.getKey(), entry.getValue());
        }
        return updatedContext;
    }

    /**
     * 读取Reactor上下文中的MDC字段。
     *
     * @param contextView ContextView Reactor只读上下文
     * @return Map<String, String> MDC字段只读副本
     */
    public static Map<String, String> values(ContextView contextView) {
        if (!contextView.hasKey(REACTOR_CONTEXT_KEY)) {
            return Map.of();
        }
        return contextView.get(REACTOR_CONTEXT_KEY);
    }

    /**
     * 读取当前线程中的MDC字段，用于将请求上下文传入独立订阅流程。
     *
     * @return Map<String, String> 当前线程MDC字段副本
     */
    public static Map<String, String> currentValues() {
        Map<String, String> current = MDC.getCopyOfContextMap();
        return current == null ? Map.of() : Map.copyOf(current);
    }

    /**
     * 在当前线程临时启用指定MDC字段，作用域结束后恢复原上下文。
     *
     * @param values Map<String, String> 本次作用域使用的MDC字段
     * @return Scope 可自动关闭的MDC作用域
     */
    public static Scope open(Map<String, String> values) {
        Map<String, String> previous = MDC.getCopyOfContextMap();
        Map<String, String> active = previous == null ? new LinkedHashMap<>() : new LinkedHashMap<>(previous);
        MANAGED_KEYS.forEach(active::remove);
        active.putAll(values);
        replace(active);
        return () -> replace(previous);
    }

    /**
     * 创建负责同步Reactor上下文与线程MDC的订阅器。
     *
     * @param actual CoreSubscriber<? super T> 原始订阅器
     * @param <T> 响应式数据类型
     * @return CoreSubscriber<T> 包装后的订阅器
     */
    static <T> CoreSubscriber<T> subscriber(CoreSubscriber<? super T> actual) {
        return new ContextSubscriber<>(actual);
    }

    /**
     * 使用指定Reactor上下文临时启用线程MDC。
     *
     * @param contextView ContextView Reactor只读上下文
     * @return Scope 可自动关闭的MDC作用域
     */
    private static Scope open(ContextView contextView) {
        return open(values(contextView));
    }

    /**
     * 替换当前线程MDC，并正确处理空上下文。
     *
     * @param values Map<String, String> 新的MDC字段，可为空
     */
    private static void replace(Map<String, String> values) {
        if (values == null || values.isEmpty()) {
            MDC.clear();
            return;
        }
        MDC.setContextMap(values);
    }

    /**
     * MDC作用域，关闭时恢复进入作用域前的线程上下文。
     */
    @FunctionalInterface
    public interface Scope extends AutoCloseable {

        /**
         * 关闭当前MDC作用域。
         */
        @Override
        void close();
    }

    /**
     * 将每次Reactor信号携带的上下文同步到线程MDC的订阅器。
     *
     * @param <T> 响应式数据类型
     */
    private static final class ContextSubscriber<T> implements CoreSubscriber<T> {

        /** 原始订阅器 */
        private final CoreSubscriber<? super T> actual;

        /**
         * 创建MDC上下文订阅器。
         *
         * @param actual CoreSubscriber<? super T> 原始订阅器
         */
        private ContextSubscriber(CoreSubscriber<? super T> actual) {
            this.actual = actual;
        }

        /**
         * 返回当前Reactor上下文。
         *
         * @return Context Reactor上下文
         */
        @Override
        public Context currentContext() {
            return actual.currentContext();
        }

        /**
         * 在订阅回调期间同步MDC。
         *
         * @param subscription Subscription 响应式订阅
         */
        @Override
        public void onSubscribe(Subscription subscription) {
            try (Scope ignored = open(currentContext())) {
                actual.onSubscribe(subscription);
            }
        }

        /**
         * 在数据回调期间同步MDC。
         *
         * @param value T 响应式数据
         */
        @Override
        public void onNext(T value) {
            try (Scope ignored = open(currentContext())) {
                actual.onNext(value);
            }
        }

        /**
         * 在异常回调期间同步MDC。
         *
         * @param throwable Throwable 响应式异常
         */
        @Override
        public void onError(Throwable throwable) {
            try (Scope ignored = open(currentContext())) {
                actual.onError(throwable);
            }
        }

        /**
         * 在完成回调期间同步MDC。
         */
        @Override
        public void onComplete() {
            try (Scope ignored = open(currentContext())) {
                actual.onComplete();
            }
        }
    }
}
