package com.novanovastudio.security;

import java.lang.reflect.Method;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.reactive.result.method.annotation.RequestMappingHandlerMapping;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import reactor.core.publisher.Mono;

/**
 * @title        RoleAuthFilterTest.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  角色权限过滤器测试
 * @createTime   2026-06-29 17:35:00
 */
class RoleAuthFilterTest {

    /**
     * 普通接口没有角色注解时只放行一次下游过滤器链。
     *
     * @return void 无返回值
     * @throws NoSuchMethodException 测试控制器方法不存在时抛出
     */
    @Test
    void shouldFilterChainOnlyOnceWhenHandlerHasNoRequireRole() throws NoSuchMethodException {
        // 普通业务接口没有角色注解时，过滤器只负责透传，不应重复触发Controller。
        MockServerWebExchange exchange = MockServerWebExchange.from(MockServerHttpRequest.post("/api/v1/ai/task/createTask").build());
        RequestMappingHandlerMapping handlerMapping = handlerMapping(exchange, TestController.class.getDeclaredMethod("createTask"));
        RoleAuthFilter filter = new RoleAuthFilter(handlerMapping, new CurrentUserProvider());
        AtomicInteger chainInvokeCount = new AtomicInteger();

        filter.filter(exchange, currentExchange -> Mono.fromRunnable(chainInvokeCount::incrementAndGet)).block();

        Assertions.assertEquals(1, chainInvokeCount.get());
    }

    /**
     * 角色匹配时只放行一次下游过滤器链。
     *
     * @return void 无返回值
     * @throws NoSuchMethodException 测试控制器方法不存在时抛出
     */
    @Test
    void shouldFilterChainOnlyOnceWhenRoleMatched() throws NoSuchMethodException {
        // 角色校验成功后只应继续一次请求链，避免重复触发受保护接口。
        MockServerWebExchange exchange = MockServerWebExchange.from(MockServerHttpRequest.post("/api/v1/admin/users").build());
        RequestMappingHandlerMapping handlerMapping = handlerMapping(exchange, TestController.class.getDeclaredMethod("adminTask"));
        RoleAuthFilter filter = new RoleAuthFilter(handlerMapping, new CurrentUserProvider());
        AtomicInteger chainInvokeCount = new AtomicInteger();

        filter.filter(exchange, currentExchange -> Mono.fromRunnable(chainInvokeCount::incrementAndGet))
                .contextWrite(context -> context.put(CurrentUserProvider.CURRENT_USER_CONTEXT_KEY, new CurrentUser(1L, "admin@admin.com", "admin", 1)))
                .block();

        Assertions.assertEquals(1, chainInvokeCount.get());
    }

    /**
     * 角色接口未登录时拒绝请求且不放行下游过滤器链。
     *
     * @return void 无返回值
     * @throws NoSuchMethodException 测试控制器方法不存在时抛出
     */
    @Test
    void shouldRejectRequireRoleRequestWhenUserMissing() throws NoSuchMethodException {
        // 没有当前用户上下文时直接返回权限错误，不能继续触发Controller。
        MockServerWebExchange exchange = MockServerWebExchange.from(MockServerHttpRequest.post("/api/v1/admin/users").build());
        RequestMappingHandlerMapping handlerMapping = handlerMapping(exchange, TestController.class.getDeclaredMethod("adminTask"));
        RoleAuthFilter filter = new RoleAuthFilter(handlerMapping, new CurrentUserProvider());
        AtomicInteger chainInvokeCount = new AtomicInteger();

        filter.filter(exchange, currentExchange -> Mono.fromRunnable(chainInvokeCount::incrementAndGet)).block();

        Assertions.assertEquals(0, chainInvokeCount.get());
        Assertions.assertEquals(403, exchange.getResponse().getStatusCode().value());
    }

    /**
     * 构造固定返回测试处理器的映射。
     *
     * @param exchange MockServerWebExchange 请求交换对象
     * @param method Method 测试控制器方法
     * @return RequestMappingHandlerMapping 处理器映射
     */
    private RequestMappingHandlerMapping handlerMapping(MockServerWebExchange exchange, Method method) {
        RequestMappingHandlerMapping handlerMapping = Mockito.mock(RequestMappingHandlerMapping.class);
        HandlerMethod handlerMethod = new HandlerMethod(new TestController(), method);
        Mockito.when(handlerMapping.getHandler(exchange)).thenReturn(Mono.just(handlerMethod));
        return handlerMapping;
    }

    /**
     * @title        TestController
     * @author       zhenglin.cn.cq@gmail.com
     * @description  测试用控制器
     * @createTime   2026-06-29 17:35:00
     */
    private static class TestController {

        /**
         * 模拟创建任务接口。
         *
         * @return void 无返回值
         */
        void createTask() {
        }

        /**
         * 模拟管理员接口。
         *
         * @return void 无返回值
         */
        @RequireRole("admin")
        void adminTask() {
        }
    }
}
