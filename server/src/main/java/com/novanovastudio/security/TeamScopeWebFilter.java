package com.novanovastudio.security;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.repository.TeamRepository;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;

/**
 * 在认证后验证团队成员关系并绑定本次请求唯一作用域。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-18 10:00
 */
@Component
@RequiredArgsConstructor
@Order(Ordered.HIGHEST_PRECEDENCE + 12)
public class TeamScopeWebFilter implements WebFilter {
    /** 团队仓储。 */
    private final TeamRepository repository;
    /** 当前登录身份。 */
    private final CurrentUserProvider currentUserProvider;
    /** 可由团队管理员复用的后台控制器，其他管理入口保持全局专属。 */
    private static final Set<String> TEAM_ADMIN_PREFIXES = Set.of("/api/v1/admin/prompt/", "/api/v1/admin/notification/",
            "/api/v1/admin/style/", "/api/v1/admin/skill/", "/api/v1/admin/homepage/",
            "/api/v1/admin/storyBible/", "/api/v1/admin/episodeBodies/");
    /** 浏览器原生事件订阅无法携带自定义请求头，仅这两个入口从查询参数读取当前团队。 */
    private static final Set<String> EVENT_STREAM_PATHS = Set.of("/api/v1/ai/task/subscribe", "/api/v1/ai/agent/events");

    /**
     * 校验显式团队标识，身份和全局运行时配置接口始终在平台空间执行。
     * @param exchange 当前请求
     * @param chain 后续过滤器
     * @return 请求处理结果
     */
    @Override
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        String path = exchange.getRequest().getPath().value();
        String teamValue = exchange.getRequest().getHeaders().getFirst("X-Team-Id");
        // 管理接口的 teamId 是操作目标，不能被误判为当前团队并触发入团校验。
        if (teamValue == null && EVENT_STREAM_PATHS.contains(path)) teamValue = exchange.getRequest().getQueryParams().getFirst("teamId");
        String filterValue = exchange.getRequest().getQueryParams().getFirst("filterTeamId");
        if (filterValue != null && (teamValue == null || "0".equals(teamValue)) && path.startsWith("/api/v1/admin/")) {
            if (exchange.getRequest().getMethod() != org.springframework.http.HttpMethod.GET || !Set.of(
                    "/api/v1/admin/user/listUsers", "/api/v1/admin/user/getUserStatistics", "/api/v1/admin/credit/getCreditOverview",
                    "/api/v1/admin/credit/listCreditTransactions").contains(path)) return reject(exchange, "此接口不支持团队统计筛选");
            long filterTeamId;
            try { filterTeamId = Long.parseLong(filterValue); if (filterTeamId < 0) throw new NumberFormatException(); }
            catch (NumberFormatException exception) { return reject(exchange, "团队筛选标识无效"); }
            return currentUserProvider.currentUser().filter(user -> "admin".equals(user.role()))
                    .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.PERMISSION_DENIED, "仅超级管理员可以跨团队筛选")))
                    .onErrorResume(BusinessException.class, error -> reject(exchange, error.getMessage()).then(Mono.empty()))
                    .flatMap(user -> chain.filter(exchange).contextWrite(context -> TeamScope.PLATFORM.apply(context).put(TeamScope.FILTER_KEY, filterTeamId)));
        }
        if (teamValue == null || teamValue.isBlank() || "0".equals(teamValue) || isPlatformPath(path))
            return chain.filter(exchange).contextWrite(TeamScope.PLATFORM::apply);
        long teamId;
        try { teamId = Long.parseLong(teamValue); if (teamId < 1) throw new NumberFormatException(); }
        catch (NumberFormatException exception) { return reject(exchange, "团队标识无效"); }
        return currentUserProvider.currentUser().flatMap(user -> repository.findMembership(teamId, user.id()))
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.PERMISSION_DENIED, "尚未加入当前团队")))
                .onErrorResume(BusinessException.class, error -> reject(exchange, error.getMessage()).then(Mono.empty()))
                .flatMap(member -> {
                    if (!member.getBooleanValue("enabled")) return reject(exchange, "团队已被禁用");
                    if (!"active".equals(member.getString("memberStatus"))) return reject(exchange, "团队成员已被禁用或移除");
                    if (path.startsWith("/api/v1/admin/") && TEAM_ADMIN_PREFIXES.stream().noneMatch(path::startsWith))
                        return reject(exchange, "团队空间无法访问全局管理功能");
                    if (path.startsWith("/api/v1/checkIn/") || path.startsWith("/api/v1/invitation/") || path.equals("/api/v1/credit/redeemCredits") || path.equals("/api/v1/credit/listRedemptionRecords") || path.contains("CreditCard") || path.contains("/config/credit/") || path.contains("/config/checkIn/") || path.contains("/config/invitation/"))
                        return reject(exchange, "团队积分仅支持管理员手动发放");
                    TeamScope scope = new TeamScope(teamId, member.getString("memberRole"));
                    if (exchange.getRequest().getMethod() == org.springframework.http.HttpMethod.POST && path.startsWith("/api/v1/admin/")) {
                        String module = path.startsWith("/api/v1/admin/prompt/") ? "prompts" : path.startsWith("/api/v1/admin/notification/") ? "notifications"
                                : path.startsWith("/api/v1/admin/style/") ? "styles" : path.startsWith("/api/v1/admin/skill/") ? "skills"
                                : path.startsWith("/api/v1/admin/homepage/") ? "homepage" : "";
                        if (!module.isEmpty()) return repository.listConfigurationModes(teamId)
                                .filter(mode -> module.equals(mode.getString("moduleName"))).single()
                                .flatMap(mode -> mode.getBooleanValue("inheritGlobal") ? reject(exchange, "当前模块正在继承全局，请先切换为团队独立配置") : chain.filter(exchange).contextWrite(scope::apply));
                    }
                    return chain.filter(exchange).contextWrite(scope::apply);
                });
    }

    /**
     * 全局身份、邀请管理和公开运行时配置不受URL团队切换影响。
     * @param path 请求路径
     * @return 是否独立于团队上下文
     */
    private boolean isPlatformPath(String path) {
        return path.startsWith("/api/v1/auth/") || Set.of("/api/v1/team/getPublicTeam", "/api/v1/team/listMyTeams",
                "/api/v1/team/listMyInvitations", "/api/v1/team/acceptInvitation", "/api/v1/config/getRuntimeConfig").contains(path);
    }

    /**
     * 拒绝无权限团队请求，不清除全局登录状态。
     * @param exchange 当前请求
     * @param message 中文错误说明
     * @return 错误响应
     */
    private Mono<Void> reject(ServerWebExchange exchange, String message) {
        exchange.getResponse().setStatusCode(HttpStatus.FORBIDDEN);
        exchange.getResponse().getHeaders().setContentType(MediaType.APPLICATION_JSON);
        return exchange.getResponse().writeWith(Mono.just(exchange.getResponse().bufferFactory()
                .wrap(JSON.toJSONBytes(ApiResponse.fail(ErrorCode.PERMISSION_DENIED, message)))));
    }
}
