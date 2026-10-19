package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.repository.TeamRepository;
import com.novanovastudio.repository.TeamTaskRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.TeamScope;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

/**
 * 后台任务始终恢复持久化空间，系统扫描权限不能进入业务执行。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-18 10:00
 */
class TeamTaskScopeServiceTest {
    /** 切换到其他团队不会改变已创建任务的作用域。 */
    @Test
    void shouldRestorePersistedTeamAndRemoveSystemPrivileges() {
        TeamTaskRepository tasks = mock(TeamTaskRepository.class);
        TeamRepository teams = mock(TeamRepository.class);
        JSONObject task = new JSONObject(); task.put("teamId", 101L); task.put("userId", 9L);
        JSONObject member = new JSONObject(); member.put("memberRole", "member");
        when(tasks.findScope("ai_generation_tasks", "task-a")).thenReturn(Mono.just(task));
        when(teams.findMembership(101L, 9L)).thenReturn(Mono.just(member));
        TeamTaskScopeService service = new TeamTaskScopeService(tasks, teams, new CurrentUserProvider());
        StepVerifier.create(service.execute("ai_generation_tasks", "task-a", () -> Mono.deferContextual(context -> {
            assertEquals(101L, TeamScope.from(context).teamId());
            assertFalse(context.getOrDefault(TeamScope.SYSTEM_KEY, false));
            return new CurrentUserProvider().currentUserId().doOnNext(userId -> assertEquals(9L, userId)).then();
        })).contextWrite(context -> new TeamScope(102, "member").apply(context).put(TeamScope.SYSTEM_KEY, true))).verifyComplete();
    }
    /** 停用后下一条事件立即停止，旧长连接不能继续接收业务内容。 */
    @Test
    void shouldStopEventsAfterMembershipRevoked() {
        TeamRepository teams = mock(TeamRepository.class);
        CurrentUserProvider users = new CurrentUserProvider();
        when(teams.findMembership(101L, 9L)).thenReturn(Mono.just(JSONObject.of("enabled", true, "memberStatus", "active")),
                Mono.just(JSONObject.of("enabled", true, "memberStatus", "removed")));
        TeamTaskScopeService service = new TeamTaskScopeService(mock(TeamTaskRepository.class), teams, users);
        StepVerifier.create(service.guardEvents(reactor.core.publisher.Flux.just("first", "second"))
                .contextWrite(context -> new TeamScope(101, "member").apply(context)
                        .put(CurrentUserProvider.CURRENT_USER_CONTEXT_KEY, new com.novanovastudio.security.CurrentUser(9L, null, "user", 1))))
                .expectNext("first").expectError(com.novanovastudio.common.BusinessException.class).verify();
    }

}
