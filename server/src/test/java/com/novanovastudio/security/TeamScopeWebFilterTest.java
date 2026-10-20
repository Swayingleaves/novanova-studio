package com.novanovastudio.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.controller.TeamController;
import com.novanovastudio.repository.TeamRepository;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.reactive.result.method.annotation.RequestMappingHandlerMapping;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

/**
 * 团队入口权限与作用域绑定验证。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-18 10:00
 */
class TeamScopeWebFilterTest {
    /** 全局轮询配置无需登录，团队页面携带的空间标识不能触发成员校验。 */
    @Test
    void shouldReadPublicRuntimeConfigurationInPlatformScope() {
        TeamRepository repository = mock(TeamRepository.class);
        TeamScopeWebFilter filter = new TeamScopeWebFilter(repository, new CurrentUserProvider());
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.get("/api/v1/config/getRuntimeConfig")
                .header("X-Team-Id", "101"));

        StepVerifier.create(filter.filter(exchange, request -> TeamScope.current().doOnNext(scope -> {
            assertEquals(TeamScope.PLATFORM, scope);
            request.getResponse().setStatusCode(HttpStatus.OK);
        }).then())).verifyComplete();

        assertEquals(HttpStatus.OK, exchange.getResponse().getStatusCode());
        verifyNoInteractions(repository);
    }

    /**
     * 授权查询中的团队是管理目标，平台超级管理员无需入团，普通账号仍受角色校验限制。
     *
     * @throws NoSuchMethodException 授权控制器方法不存在时抛出
     */
    @Test
    void shouldAuthorizeResourceGrantTargetInPlatformScope() throws NoSuchMethodException {
        for (String role : java.util.List.of("admin", "user")) {
            for (String scopeHeader : java.util.List.of("", "0")) {
                TeamRepository repository = mock(TeamRepository.class);
                CurrentUserProvider users = mock(CurrentUserProvider.class);
                when(users.currentUser()).thenReturn(Mono.just(new CurrentUser(9L, "account@example.com", role, 1)));
                when(repository.findMembership(anyLong(), anyLong())).thenReturn(Mono.empty());
                var request = MockServerHttpRequest.get("/api/v1/admin/team/listResourceGrants?teamId=101");
                if (!scopeHeader.isEmpty()) request.header("X-Team-Id", scopeHeader);
                var exchange = MockServerWebExchange.from(request);
                RequestMappingHandlerMapping mapping = mock(RequestMappingHandlerMapping.class);
                when(mapping.getHandler(exchange)).thenReturn(Mono.just(new HandlerMethod(
                        new TeamController(null, null), TeamController.class.getMethod("listResourceGrants", long.class))));
                RoleAuthFilter roleFilter = new RoleAuthFilter(mapping, users);
                StepVerifier.create(new TeamScopeWebFilter(repository, users).filter(exchange, scopedExchange ->
                        roleFilter.filter(scopedExchange, authorizedExchange -> TeamScope.current().doOnNext(scope -> {
                            assertEquals(TeamScope.PLATFORM, scope);
                            assertEquals("101", authorizedExchange.getRequest().getQueryParams().getFirst("teamId"));
                            authorizedExchange.getResponse().setStatusCode(HttpStatus.OK);
                        }).then()))).verifyComplete();
                assertEquals("admin".equals(role) ? HttpStatus.OK : HttpStatus.FORBIDDEN, exchange.getResponse().getStatusCode());
                verifyNoInteractions(repository);
            }
        }
    }

    /** 事件订阅继续按查询参数校验成员关系并绑定团队，不能串用平台事件。 */
    @Test
    void shouldBindEventStreamTeamFromQuery() {
        TeamRepository repository = mock(TeamRepository.class);
        CurrentUserProvider users = mock(CurrentUserProvider.class);
        when(users.currentUser()).thenReturn(Mono.just(new CurrentUser(9L, "member@example.com", "user", 1)));
        when(repository.findMembership(101L, 9L)).thenReturn(Mono.just(JSONObject.of(
                "enabled", true, "memberStatus", "active", "memberRole", "member")));
        TeamScopeWebFilter filter = new TeamScopeWebFilter(repository, users);
        for (String path : java.util.List.of("/api/v1/ai/task/subscribe", "/api/v1/ai/agent/events")) {
            var exchange = MockServerWebExchange.from(MockServerHttpRequest.get(path + "?teamId=101"));
            StepVerifier.create(filter.filter(exchange, request -> TeamScope.current().doOnNext(scope ->
                    assertEquals(new TeamScope(101L, "member"), scope)).then())).verifyComplete();
        }
    }

    /** 事件订阅的团队查询参数不能绕过成员校验。 */
    @Test
    void shouldRejectUnjoinedEventStreamTeam() {
        TeamRepository repository = mock(TeamRepository.class);
        CurrentUserProvider users = mock(CurrentUserProvider.class);
        when(users.currentUser()).thenReturn(Mono.just(new CurrentUser(9L, "member@example.com", "user", 1)));
        when(repository.findMembership(101L, 9L)).thenReturn(Mono.empty());
        TeamScopeWebFilter filter = new TeamScopeWebFilter(repository, users);
        for (String path : java.util.List.of("/api/v1/ai/task/subscribe", "/api/v1/ai/agent/events")) {
            var exchange = MockServerWebExchange.from(MockServerHttpRequest.get(path + "?teamId=101"));
            StepVerifier.create(filter.filter(exchange, request -> Mono.error(new AssertionError("未入团不能订阅团队事件")))).verifyComplete();
            assertEquals(HttpStatus.FORBIDDEN, exchange.getResponse().getStatusCode());
        }
    }

    /**
     * 有效成员请求只能获得当前团队上下文。
     */
    @Test
    void shouldBindVerifiedMembership() {
        TeamRepository repository = mock(TeamRepository.class);
        CurrentUserProvider users = mock(CurrentUserProvider.class);
        when(users.currentUser()).thenReturn(Mono.just(new CurrentUser(9L, "member@example.com", "user", 1)));
        JSONObject member = new JSONObject(); member.put("enabled", true); member.put("memberStatus", "active"); member.put("memberRole", "member");
        when(repository.findMembership(101L, 9L)).thenReturn(Mono.just(member));
        TeamScopeWebFilter filter = new TeamScopeWebFilter(repository, users);
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.get("/api/v1/project/listProjects").header("X-Team-Id", "101"));
        StepVerifier.create(filter.filter(exchange, request -> TeamScope.current().doOnNext(scope -> {
            assertEquals(101L, scope.teamId()); assertEquals("member", scope.memberRole());
        }).then())).verifyComplete();
    }

    /** 同一账号在平台可使用专属邀请，作为团队成员或管理员进入团队后均不能使用邀请奖励。 */
    @Test
    void shouldAllowReferralInvitationsOnlyInPlatformSpace() {
        for (String memberRole : java.util.List.of("member", "administrator")) {
            TeamRepository repository = mock(TeamRepository.class);
            CurrentUserProvider users = mock(CurrentUserProvider.class);
            when(users.currentUser()).thenReturn(Mono.just(new CurrentUser(9L, "member@example.com", "user", 1)));
            when(repository.findMembership(101L, 9L)).thenReturn(Mono.just(JSONObject.of(
                    "enabled", true, "memberStatus", "active", "memberRole", memberRole)));
            TeamScopeWebFilter filter = new TeamScopeWebFilter(repository, users);
            var platformRequest = MockServerWebExchange.from(MockServerHttpRequest.get("/api/v1/invitation/getInvitationInfo"));
            StepVerifier.create(filter.filter(platformRequest, request -> TeamScope.current().doOnNext(scope -> {
                assertEquals(TeamScope.PLATFORM, scope);
                request.getResponse().setStatusCode(HttpStatus.OK);
            }).then())).verifyComplete();
            assertEquals(HttpStatus.OK, platformRequest.getResponse().getStatusCode());
            verifyNoInteractions(repository);

            var teamRequest = MockServerWebExchange.from(MockServerHttpRequest.get("/api/v1/invitation/getInvitationInfo").header("X-Team-Id", "101"));
            StepVerifier.create(filter.filter(teamRequest, request -> Mono.error(new AssertionError("团队空间不能读取平台邀请奖励信息")))).verifyComplete();
            assertEquals(HttpStatus.FORBIDDEN, teamRequest.getResponse().getStatusCode());
        }
    }

    /**
     * 团队管理员不能通过直接请求访问全局用户、接口记录和平台余额流水。
     */
    @Test
    void shouldRejectGlobalAdministrationEndpoints() {
        TeamRepository repository = mock(TeamRepository.class);
        CurrentUserProvider users = mock(CurrentUserProvider.class);
        when(users.currentUser()).thenReturn(Mono.just(new CurrentUser(9L, "admin@example.com", "user", 1)));
        JSONObject member = new JSONObject(); member.put("enabled", true); member.put("memberStatus", "active"); member.put("memberRole", "administrator");
        when(repository.findMembership(anyLong(), anyLong())).thenReturn(Mono.just(member));
        TeamScopeWebFilter filter = new TeamScopeWebFilter(repository, users);
        for (String path : java.util.List.of("/api/v1/admin/user/listUsers", "/api/v1/admin/apiLog/list", "/api/v1/admin/credit/listCreditTransactions", "/api/v1/admin/team/listTeams", "/api/v1/admin/team/listResourceGrants?teamId=202")) {
            var exchange = MockServerWebExchange.from(MockServerHttpRequest.get(path).header("X-Team-Id", "101"));
            StepVerifier.create(filter.filter(exchange, request -> Mono.error(new AssertionError("全局接口不应被执行")))).verifyComplete();
            assertEquals(HttpStatus.FORBIDDEN, exchange.getResponse().getStatusCode());
        }
    }

    /** 普通业务错误必须交给业务异常处理器，不能被转换为团队鉴权失败。 */
    @Test
    void shouldPreserveDownstreamBusinessErrors() {
        TeamRepository repository = mock(TeamRepository.class);
        CurrentUserProvider users = mock(CurrentUserProvider.class);
        when(users.currentUser()).thenReturn(Mono.just(new CurrentUser(9L, "member@example.com", "user", 1)));
        JSONObject member = new JSONObject(); member.put("enabled", true); member.put("memberStatus", "active"); member.put("memberRole", "member");
        when(repository.findMembership(101L, 9L)).thenReturn(Mono.just(member));
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.get("/api/v1/project/listProjects").header("X-Team-Id", "101"));
        var failure = new com.novanovastudio.common.BusinessException(com.novanovastudio.common.ErrorCode.DATA_CONFLICT, "内容已变化");
        StepVerifier.create(new TeamScopeWebFilter(repository, users).filter(exchange, request -> Mono.error(failure)))
                .expectErrorMatches(error -> error == failure).verify();
    }

    /** 团队禁用时不切换到平台配置。 */
    @Test
    void shouldRejectDisabledTeamWithoutPlatformFallback() {
        TeamRepository repository = mock(TeamRepository.class);
        CurrentUserProvider users = mock(CurrentUserProvider.class);
        when(users.currentUser()).thenReturn(Mono.just(new CurrentUser(9L, "member@example.com", "user", 1)));
        JSONObject member = new JSONObject(); member.put("enabled", false); member.put("memberStatus", "active");
        when(repository.findMembership(101L, 9L)).thenReturn(Mono.just(member));
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.get("/api/v1/ai/model/listModels").header("X-Team-Id", "101"));
        StepVerifier.create(new TeamScopeWebFilter(repository, users).filter(exchange, request -> Mono.error(new AssertionError("禁用团队不能读取模型")))).verifyComplete();
        assertEquals(HttpStatus.FORBIDDEN, exchange.getResponse().getStatusCode());
    }
}
