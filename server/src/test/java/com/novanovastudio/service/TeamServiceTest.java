package com.novanovastudio.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.dto.TeamDtos;
import com.novanovastudio.repository.TeamRepository;
import com.novanovastudio.security.CurrentUser;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.TeamScope;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

/**
 * 邮箱邀请确认、成员名额及重复接受的业务验证。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-18 12:00
 */
class TeamServiceTest {
    /** 团队数据访问。 */
    private TeamRepository repository;
    /** 业务入口。 */
    private TeamService service;
    /** 测试邀请标识。 */
    private final UUID invitationId = UUID.randomUUID();
    /** 团队信息。 */
    private JSONObject team;
    /** 邀请内容。 */
    private JSONObject invitation;

    /** 初始化固定的团队、登录邮箱和未过期邀请。 */
    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        repository = mock(TeamRepository.class);
        CurrentUserProvider users = mock(CurrentUserProvider.class);
        when(users.currentUser()).thenReturn(Mono.just(new CurrentUser(9L, "member@example.com", "user", 1)));
        TransactionalOperator transactions = mock(TransactionalOperator.class);
        when(transactions.transactional(any(Mono.class))).thenAnswer(invocation -> invocation.getArgument(0));
        service = new TeamService(repository, null, null, users, null, null, null, null, transactions);
        team = JSONObject.of("id", 101L, "enabled", true, "memberLimit", 1);
        invitation = JSONObject.of("teamId", 101L, "email", "member@example.com", "memberRole", "member",
                "invitationStatus", "pending", "expiresAt", OffsetDateTime.now().plusDays(7).toString());
        when(repository.findInvitation(invitationId, false)).thenReturn(Mono.just(invitation));
        when(repository.lockTeam(101L)).thenReturn(Mono.just(team));
        when(repository.findInvitation(invitationId, true)).thenReturn(Mono.just(invitation));
    }

    /** 邀请标识泄露也不能让不同邮箱接受。 */
    @Test
    void shouldRequireInvitedEmail() {
        invitation.put("email", "another@example.com");
        StepVerifier.create(service.acceptInvitation(new TeamDtos.InvitationRequest(invitationId)))
                .expectErrorMatches(error -> error instanceof BusinessException && error.getMessage().contains("本人接受"))
                .verify();
        verify(repository, never()).addMember(anyLong(), anyLong(), anyString());
    }

    /** 重复接受不占用名额，不重复创建钱包或恢复已移除成员。 */
    @Test
    void shouldAcceptIdempotentlyWithoutRecreatingMember() {
        invitation.put("invitationStatus", "accepted");
        when(repository.findTeam(101L)).thenReturn(Mono.just(team));
        StepVerifier.create(service.acceptInvitation(new TeamDtos.InvitationRequest(invitationId))).expectNext(team).verifyComplete();
        verify(repository, never()).countMembers(anyLong());
        verify(repository, never()).addMember(anyLong(), anyLong(), anyString());
    }

    /** 锁定团队后人数已满时不能创建成员或确认邀请。 */
    @Test
    void shouldRejectFullTeamInsideTeamLock() {
        when(repository.cleanupPending(101L, 9L)).thenReturn(Mono.just(false));
        when(repository.findMembership(101L, 9L)).thenReturn(Mono.empty());
        when(repository.countMembers(101L)).thenReturn(Mono.just(1L));
        StepVerifier.create(service.acceptInvitation(new TeamDtos.InvitationRequest(invitationId)))
                .expectErrorMatches(error -> error instanceof BusinessException && error.getMessage().contains("达到上限"))
                .verify();
        var order = inOrder(repository);
        order.verify(repository).lockTeam(101L);
        order.verify(repository).countMembers(101L);
        verify(repository, never()).addMember(anyLong(), anyLong(), anyString());
        verify(repository, never()).updateInvitation(any(), anyString());
    }

    /** 移除后的清理未完成时不能恢复旧数据访问。 */
    @Test
    void shouldWaitForCleanupBeforeRestoringMembership() {
        when(repository.cleanupPending(101L, 9L)).thenReturn(Mono.just(true));
        StepVerifier.create(service.acceptInvitation(new TeamDtos.InvitationRequest(invitationId)))
                .expectErrorMatches(error -> error instanceof BusinessException && error.getMessage().contains("清理尚未完成"))
                .verify();
        verify(repository, never()).addMember(anyLong(), anyLong(), anyString());
    }

    /** 新邀请确认后恢复成员与被冻结的钱包，原内容由清理流程独立删除。 */
    @Test
    void shouldRestoreRemovedMemberOnlyAfterNewInvitation() {
        when(repository.cleanupPending(101L, 9L)).thenReturn(Mono.just(false));
        when(repository.findMembership(101L, 9L)).thenReturn(Mono.just(JSONObject.of("memberStatus", "removed")));
        when(repository.countMembers(101L)).thenReturn(Mono.just(0L));
        when(repository.addMember(101L, 9L, "member")).thenReturn(Mono.empty());
        when(repository.updateInvitation(invitationId, "accepted")).thenReturn(Mono.empty());
        when(repository.findTeam(101L)).thenReturn(Mono.just(team));
        StepVerifier.create(service.acceptInvitation(new TeamDtos.InvitationRequest(invitationId))).expectNext(team).verifyComplete();
        verify(repository).addMember(101L, 9L, "member");
        verify(repository).updateInvitation(invitationId, "accepted");
    }

    /** 重复移除只确认现状，不能重新清理已经恢复的钱包或其他空间。 */
    @Test
    void shouldRemoveMemberIdempotently() {
        when(repository.findMembership(101L, 9L)).thenReturn(Mono.just(JSONObject.of("memberRole", "member", "memberStatus", "removed")));
        StepVerifier.create(service.removeMember(new TeamDtos.MemberRequest(9L, null))
                .contextWrite(context -> new TeamScope(101, "administrator").apply(context))).verifyComplete();
        verify(repository, never()).updateMemberStatus(anyLong(), anyLong(), anyString());
        verify(repository, never()).requestCleanup(anyLong(), anyLong());
    }
}
