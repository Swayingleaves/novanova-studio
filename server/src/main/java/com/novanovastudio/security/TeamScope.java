package com.novanovastudio.security;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import reactor.core.publisher.Mono;
import reactor.util.context.Context;
import reactor.util.context.ContextView;

/**
 * 请求和后台任务共用的团队作用域，平台空间的标识固定为零。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-18 10:00
 */
public record TeamScope(long teamId, String memberRole) {
    /** 团队作用域上下文键。 */
    public static final String CONTEXT_KEY = TeamScope.class.getName();
    /** 仅供受信任的后台扫描和超级管理员聚合查询使用。 */
    public static final String SYSTEM_KEY = CONTEXT_KEY + ".system";
    /** 实际扣费资源的所属团队，零表示平台钱包。 */
    public static final String WALLET_KEY = CONTEXT_KEY + ".wallet";
    /** 后台任务创建时固定的对象存储，空串表示创建时未选择。 */
    public static final String STORAGE_KEY = CONTEXT_KEY + ".storage";
    /** 同步扣费关联的资源标识。 */
    public static final String RESOURCE_KEY = CONTEXT_KEY + ".resource";
    /** 超级管理员筛选统计时的团队标识，与当前空间独立。 */
    public static final String FILTER_KEY = CONTEXT_KEY + ".filter";
    /** 移除成员后仍允许结算已发生的存储账单。 */
    public static final String HISTORICAL_KEY = CONTEXT_KEY + ".historical";
    /** 已通过派发校验的外部调用可以保存本次响应文件，不得用于启动后续任务。 */
    public static final String IN_FLIGHT_KEY = CONTEXT_KEY + ".inFlight";
    /** 平台空间。 */
    public static final TeamScope PLATFORM = new TeamScope(0, "");

    /**
     * 获取当前作用域，未进入团队的请求属于明确的平台空间。
     * @param context 响应式上下文
     * @return 当前作用域
     */
    public static TeamScope from(ContextView context) {
        return context.getOrDefault(CONTEXT_KEY, PLATFORM);
    }

    /**
     * 响应式读取团队作用域。
     * @return 当前作用域
     */
    public static Mono<TeamScope> current() {
        return Mono.deferContextual(context -> Mono.just(from(context)));
    }

    /**
     * 要求当前请求来自团队管理员。
     * @return 当前团队作用域
     * @throws BusinessException 当前请求没有团队管理权限时抛出
     */
    public static Mono<TeamScope> requireAdministrator() {
        return current().filter(scope -> scope.teamId > 0 && "administrator".equals(scope.memberRole))
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.PERMISSION_DENIED, "需要当前团队管理员权限")));
    }

    /**
     * 写入作用域并关闭系统扫描权限，避免后台权限传播到业务执行链。
     * @param context 原始上下文
     * @return 已限定团队的上下文
     */
    public Context apply(Context context) {
        return context.put(CONTEXT_KEY, this).delete(SYSTEM_KEY).delete(WALLET_KEY).delete(STORAGE_KEY).delete(RESOURCE_KEY).delete(FILTER_KEY).delete(HISTORICAL_KEY).delete(IN_FLIGHT_KEY);
    }
}
