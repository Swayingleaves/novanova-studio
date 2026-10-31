package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.repository.TeamRepository;
import com.novanovastudio.repository.TeamTaskRepository;
import com.novanovastudio.security.TeamScope;
import com.novanovastudio.security.CurrentUser;
import com.novanovastudio.security.CurrentUserProvider;
import java.util.function.Supplier;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Flux;
import java.time.Duration;

/**
 * 将队列任务恢复到创建时的团队和钱包，禁止继承调度线程的空间。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-18 10:00
 */
@Service
@RequiredArgsConstructor
public class TeamTaskScopeService {
    /** 任务归属仓储。 */
    private final TeamTaskRepository taskRepository;
    /** 成员和资源归属仓储。 */
    private final TeamRepository teamRepository;
    /** 当前后台执行者身份。 */
    private final CurrentUserProvider currentUserProvider;

    /** @return 当前模型调用者的团队状态校验 */
    public Mono<Void> requireCurrentActive() {
        return TeamScope.current().flatMap(scope -> scope.teamId() == 0 ? Mono.empty() : currentUserProvider.currentUserId().flatMap(this::requireActive));
    }

    /**
     * 工具结果回传必须关联当前用户、当前空间的会话。
     * @param userId 登录用户
     * @param sessionId 原会话标识
     * @return 权限验证完成信号
     */
    public Mono<Void> requireSessionAccess(long userId, String sessionId) {
        return taskRepository.ownsSession(userId, sessionId).flatMap(owned -> owned ? Mono.empty()
                : Mono.error(new BusinessException(ErrorCode.PERMISSION_DENIED, "会话不属于当前用户或空间")));
    }

    /**
     * 对每条事件重新检查团队权限，并在没有事件时定时结束已失效的长连接。
     * @param events 原始事件流
     * @param <T> 事件类型
     * @return 只向有效成员发送的事件流
     */
    public <T> Flux<T> guardEvents(Flux<T> events) {
        return events.concatMap(event -> requireCurrentActive().thenReturn(event))
                .takeUntilOther(Flux.interval(Duration.ofSeconds(5)).concatMap(ignored -> requireCurrentActive()));
    }

    /**
     * 为后台执行恢复持久化作用域。
     * @param table 任务类型表
     * @param taskId 任务标识
     * @param action 需要延迟构造的执行链
     * @return 已限定作用域的任务执行
     */
    public Mono<Void> execute(String table, String taskId, Supplier<Mono<Void>> action) {
        return taskRepository.findScope(table, taskId).contextWrite(context -> context.put(TeamScope.SYSTEM_KEY, true))
                .flatMap(task -> {
                    long teamId = task.getLongValue("teamId");
                    if (teamId == 0) return Mono.defer(action).contextWrite(context -> taskContext(TeamScope.PLATFORM, task, context).put(CurrentUserProvider.CURRENT_USER_CONTEXT_KEY, new CurrentUser(task.getLongValue("userId"), null, "user", 1)));
                    return teamRepository.findMembership(teamId, task.getLongValue("userId"))
                            .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.PERMISSION_DENIED, "任务所属团队成员已不存在")))
                            .flatMap(member -> {
                                TeamScope scope = new TeamScope(teamId, member.getString("memberRole"));
                                return Mono.defer(action).contextWrite(context -> taskContext(scope, task, context).put(CurrentUserProvider.CURRENT_USER_CONTEXT_KEY, new CurrentUser(task.getLongValue("userId"), null, "user", 1)));
                            });
                });
    }

    /**
     * 只有保存存储快照的任务绑定该值，纯文本任务不覆盖嵌套业务的存储选择。
     * @param scope 原团队
     * @param task 持久化归属
     * @param context 调度上下文
     * @return 清除系统权限后的执行上下文
     */
    private reactor.util.context.Context taskContext(TeamScope scope, com.alibaba.fastjson2.JSONObject task, reactor.util.context.Context context) {
        var result = scope.apply(context);
        return task.containsKey("storageIdSnapshot") ? result.put(TeamScope.STORAGE_KEY, task.getString("storageIdSnapshot") == null ? "" : task.getString("storageIdSnapshot")) : result;
    }

    /**
     * 外部请求发出前重新确认成员与团队状态。
     * @param userId 任务所属用户
     * @return 校验完成信号
     */
    public Mono<Void> requireActive(long userId) {
        return TeamScope.current().flatMap(scope -> scope.teamId() == 0 ? Mono.empty()
                : teamRepository.findMembership(scope.teamId(), userId)
                    .filter(member -> member.getBooleanValue("enabled") && "active".equals(member.getString("memberStatus")))
                    .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.PERMISSION_DENIED, "团队或成员已停用，停止派发任务"))).then());
    }

    /**
     * 模型业务在开始事务前确定实际钱包，平台模型保持使用平台余额。
     * @param modelConfigId 模型配置标识
     * @param action 已准备的业务链
     * @param <T> 业务结果类型
     * @return 按资源归属执行的业务结果
     */
    public <T> Mono<T> usingModel(String modelConfigId, Mono<T> action) {
        return teamRepository.findResource("model", modelConfigId)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "模型不存在或团队未获授权")))
                .flatMap(resource -> action.contextWrite(context -> context.put(TeamScope.WALLET_KEY, resource.getLongValue("teamId")).put(TeamScope.RESOURCE_KEY, modelConfigId)));
    }
}
