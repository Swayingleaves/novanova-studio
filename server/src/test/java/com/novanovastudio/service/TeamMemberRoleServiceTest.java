package com.novanovastudio.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.dto.TeamDtos;
import com.novanovastudio.repository.TeamRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.TeamScope;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

/**
 * 团队成员授权、主管理员保护与事务内重新鉴权测试。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-18 21:50
 */
class TeamMemberRoleServiceTest {
    /** 团队仓储。 */
    private TeamRepository repository;
    /** 授权业务入口。 */
    private TeamService service;
    /** 锁定的团队记录。 */
    private JSONObject team;

    /** 初始化团队主管理员、当前授权管理员与普通成员。 */
    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        repository = mock(TeamRepository.class);
        CurrentUserProvider users = mock(CurrentUserProvider.class);
        when(users.currentUserId()).thenReturn(Mono.just(1L));
        TransactionalOperator transactions = mock(TransactionalOperator.class);
        when(transactions.transactional(any(Mono.class))).thenAnswer(invocation -> invocation.getArgument(0));
        service = new TeamService(repository, null, null, users, null, null, null, null, transactions);
        team = JSONObject.of("id", 101L, "enabled", true, "administratorUserId", 2L);
        when(repository.lockTeam(101L)).thenReturn(Mono.just(team));
        when(repository.findMembership(101L, 1L)).thenReturn(Mono.just(JSONObject.of("memberRole", "administrator", "memberStatus", "active")));
        when(repository.findMembership(101L, 8L)).thenReturn(Mono.just(JSONObject.of("memberRole", "member", "memberStatus", "active")));
        when(repository.updateMemberRole(anyLong(), anyLong(), anyString())).thenReturn(Mono.empty());
    }

    /**
     * 团队管理员可升降其他成员，写入之前必须持有团队锁并重新读取双方身份。
     * @param role 目标团队身份
     */
    @ParameterizedTest
    @ValueSource(strings = {"administrator", "member"})
    void shouldAssignRoleAfterLockAndAuthorization(String role) {
        when(repository.findMembership(101L, 8L)).thenReturn(Mono.just(JSONObject.of(
                "memberRole", "administrator".equals(role) ? "member" : "administrator", "memberStatus", "active")));
        StepVerifier.create(assign(8L, role)).verifyComplete();
        var order = inOrder(repository);
        order.verify(repository).lockTeam(101L);
        order.verify(repository).findMembership(101L, 1L);
        order.verify(repository).findMembership(101L, 8L);
        order.verify(repository).updateMemberRole(101L, 8L, role);
        verify(repository, never()).addMember(anyLong(), anyLong(), anyString());
        verify(repository, never()).updateMemberStatus(anyLong(), anyLong(), anyString());
    }

    /** 重复授予同一身份保持幂等，不重新加入团队或初始化钱包。 */
    @Test
    void shouldIgnoreUnchangedRole() {
        StepVerifier.create(assign(8L, "member")).verifyComplete();
        verify(repository, never()).updateMemberRole(anyLong(), anyLong(), anyString());
        verify(repository, never()).addMember(anyLong(), anyLong(), anyString());
    }

    /** 禁用成员可调整身份，但不会恢复其访问状态。 */
    @Test
    void shouldKeepDisabledMemberStatus() {
        when(repository.findMembership(101L, 8L)).thenReturn(Mono.just(JSONObject.of("memberRole", "member", "memberStatus", "disabled")));
        StepVerifier.create(assign(8L, "administrator")).verifyComplete();
        verify(repository).updateMemberRole(101L, 8L, "administrator");
        verify(repository, never()).updateMemberStatus(anyLong(), anyLong(), anyString());
    }

    /**
     * 本人和主管理员不能被成员授权接口调整。
     * @param userId 本人或主管理员的用户标识
     */
    @ParameterizedTest
    @ValueSource(longs = {1L, 2L})
    void shouldProtectSelfAndPrimaryAdministrator(long userId) {
        StepVerifier.create(assign(userId, "member")).expectError(BusinessException.class).verify();
        verify(repository, never()).updateMemberRole(anyLong(), anyLong(), anyString());
    }

    /**
     * 移除成员及未加入当前团队的其他账号不能被授权。
     * @param removed 是否模拟已移除成员，否则模拟不属于当前团队
     */
    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void shouldRejectRemovedOrForeignMember(boolean removed) {
        when(repository.findMembership(101L, 8L)).thenReturn(removed
                ? Mono.just(JSONObject.of("memberRole", "member", "memberStatus", "removed")) : Mono.empty());
        StepVerifier.create(assign(8L, "administrator")).expectError(BusinessException.class).verify();
        verify(repository, never()).updateMemberRole(anyLong(), anyLong(), anyString());
    }

    /**
     * 请求持有旧管理员身份，事务内已降权、禁用或移除的操作者仍必须被拒绝。
     * @param state 操作者当前的身份或成员状态
     */
    @ParameterizedTest
    @ValueSource(strings = {"demoted", "disabled", "removed", "missing"})
    void shouldRejectStaleAdministrator(String state) {
        when(repository.findMembership(101L, 1L)).thenReturn("missing".equals(state) ? Mono.empty() : Mono.just(JSONObject.of(
                "memberRole", "demoted".equals(state) ? "member" : "administrator", "memberStatus", "demoted".equals(state) ? "active" : state)));
        StepVerifier.create(assign(8L, "administrator")).expectError(BusinessException.class).verify();
        verify(repository, never()).findMembership(101L, 8L);
        verify(repository, never()).updateMemberRole(anyLong(), anyLong(), anyString());
    }

    /** 团队停用后不能继续授权。 */
    @Test
    void shouldRejectDisabledTeam() {
        team.put("enabled", false);
        StepVerifier.create(assign(8L, "administrator")).expectError(BusinessException.class).verify();
        verify(repository, never()).updateMemberRole(anyLong(), anyLong(), anyString());
    }

    /**
     * 普通成员没有授权入口，平台身份也不能冒用团队管理员。
     * @param role 普通成员或平台空间的模拟身份
     */
    @ParameterizedTest
    @ValueSource(strings = {"member", "platform"})
    void shouldRejectWithoutTeamAdministrator(String role) {
        StepVerifier.create(service.updateMemberRole(new TeamDtos.UpdateMemberRoleRequest(8L, "administrator"))
                .contextWrite(new TeamScope("platform".equals(role) ? 0 : 101, role)::apply)).expectError(BusinessException.class).verify();
        verifyNoInteractions(repository);
    }

    /**
     * 非预设身份不能写入数据库。
     * @param role 缺失或非法的目标身份
     */
    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"admin", "owner", "superAdmin"})
    void shouldRejectInvalidRole(String role) {
        StepVerifier.create(assign(8L, role)).expectError(BusinessException.class).verify();
        verifyNoInteractions(repository);
    }

    /**
     * 在当前团队管理员上下文调用授权。
     * @param userId 目标成员
     * @param role 目标身份
     * @return 授权完成信号
     */
    private Mono<Void> assign(long userId, String role) {
        return service.updateMemberRole(new TeamDtos.UpdateMemberRoleRequest(userId, role)).contextWrite(new TeamScope(101, "administrator")::apply);
    }
}
