package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.dto.TeamDtos;
import com.novanovastudio.dto.UserDtos;
import com.novanovastudio.entity.User;
import com.novanovastudio.repository.CreditRepository;
import com.novanovastudio.repository.TeamRepository;
import com.novanovastudio.repository.UserRepository;
import com.novanovastudio.security.CurrentUser;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.PasswordLoginLockService;
import com.novanovastudio.security.TeamScope;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

/**
 * 用户名团队账号、稳定邀请目标与创建团队重置权限测试。
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-18 17:00
 */
class TeamAccountServiceTest {
    /** 团队仓储。 */
    private TeamRepository teams;
    /** 账号仓储。 */
    private UserRepository accounts;
    /** 当前操作者。 */
    private CurrentUserProvider currentUser;
    /** 密码编码器。 */
    private PasswordEncoder passwords;
    /** 登录锁定服务。 */
    private PasswordLoginLockService locks;
    /** 积分钱包仓储。 */
    private CreditRepository credits;
    /** 待验证服务。 */
    private TeamService service;
    /** 当前团队。 */
    private JSONObject team;
    /** 待验证的账号。 */
    private User target;

    /** 准备创建团队管理员、普通无邮箱成员与无外部依赖的事务执行器。 */
    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        teams = mock(TeamRepository.class); accounts = mock(UserRepository.class);
        currentUser = mock(CurrentUserProvider.class); passwords = mock(PasswordEncoder.class);
        locks = mock(PasswordLoginLockService.class); credits = mock(CreditRepository.class);
        InvitationService invitationService = mock(InvitationService.class);
        TeamInvitationMailService invitationMail = mock(TeamInvitationMailService.class);
        TransactionalOperator transactions = mock(TransactionalOperator.class);
        when(transactions.transactional(any(Mono.class))).thenAnswer(invocation -> invocation.getArgument(0));
        service = new TeamService(teams, accounts, credits, currentUser, passwords, locks, invitationService, invitationMail, transactions);
        when(currentUser.currentUserId()).thenReturn(Mono.just(1L));
        when(currentUser.currentUser()).thenReturn(Mono.just(new CurrentUser(1L, "admin@example.com", "user", 1)));
        team = JSONObject.of("id", 101L, "enabled", true, "memberLimit", 2);
        when(teams.lockTeam(101L)).thenReturn(Mono.just(team));
        when(teams.findMembership(101L, 1L)).thenReturn(Mono.just(JSONObject.of("memberRole", "administrator", "memberStatus", "active")));
        when(teams.findMembership(101L, 8L)).thenReturn(Mono.just(JSONObject.of("memberRole", "member", "memberStatus", "active")));
        target = new User(); target.setId(8L); target.setUsername("Creator"); target.setRole("user"); target.setCreatedByTeamId(101L);
        when(accounts.lockUser(8L)).thenReturn(Mono.just(target));
        when(passwords.encode("new-password")).thenReturn("new-hash");
        when(accounts.updatePasswordAfterReset(8L, "new-hash")).thenReturn(Mono.empty());
        when(locks.clear(8L)).thenReturn(Mono.empty());
        when(invitationService.generateInvitationCode()).thenReturn("INVITATION01");
        // 有邮箱的邀请会查操作人昵称并发信，测试环境按无昵称、无真实邮件处理。
        when(accounts.findById(1L)).thenReturn(Mono.empty());
        when(invitationMail.send(any(), any(), any(), any())).thenReturn(Mono.empty());
    }

    /** 新建无邮箱子账号记录归属且只初始化零余额平台钱包。 */
    @Test
    void shouldCreateUsernameMemberWithZeroWallet() {
        when(teams.countMembers(101L)).thenReturn(Mono.just(0L));
        when(accounts.findByUsername("Creator")).thenReturn(Mono.empty());
        when(passwords.encode("password123")).thenReturn("hash");
        when(accounts.createUser(any())).thenReturn(Mono.just(8L));
        when(credits.createAccount(eq(8L), any(BigDecimal.class))).thenReturn(Mono.empty());
        when(teams.addMember(101L, 8L, "member")).thenReturn(Mono.empty());
        StepVerifier.create(service.createMember(new TeamDtos.CreateMemberRequest("Creator", "password123", null))
                .contextWrite(new TeamScope(101, "administrator")::apply)).verifyComplete();
        verify(accounts).createUser(argThat(user -> user.getEmail() == null && "Creator".equals(user.getUsername())
                && Long.valueOf(101).equals(user.getCreatedByTeamId()) && Long.valueOf(1).equals(user.getCreatedByUserId())));
        verify(credits).createAccount(8L, BigDecimal.ZERO);
    }

    /** 新用户名可直接成为团队主管理员，不获得全局管理员角色。 */
    @Test
    void shouldCreatePasswordOnlyTeamAdministrator() {
        when(teams.createTeam(any())).thenReturn(Mono.just(101L));
        when(teams.findTeam(101L)).thenReturn(Mono.just(team));
        when(accounts.findByUsername("Creator")).thenReturn(Mono.empty());
        when(passwords.encode("password123")).thenReturn("hash");
        when(accounts.createUser(any())).thenReturn(Mono.just(8L));
        when(credits.createAccount(eq(8L), any(BigDecimal.class))).thenReturn(Mono.empty());
        when(teams.addMember(101L, 8L, "administrator")).thenReturn(Mono.empty());
        StepVerifier.create(service.createTeam(new TeamDtos.CreateTeamRequest("团队甲", "team-a", 2, "Creator", "password123", null)))
                .expectNext(team).verifyComplete();
        verify(accounts).createUser(argThat(user -> user.getEmail() == null && "user".equals(user.getRole()) && user.getCreatedByTeamId() == null));
        verify(teams).addMember(101L, 8L, "administrator");
    }

    /** 已有用户名只能收到主管理员邀请，提交的新密码不会覆盖原账号。 */
    @Test
    void shouldInviteExistingUsernameAsAdministratorWithoutReplacingPassword() {
        UUID invitation = UUID.randomUUID();
        when(teams.createTeam(any())).thenReturn(Mono.just(101L));
        when(teams.findTeam(101L)).thenReturn(Mono.just(team));
        when(accounts.findByUsername("Creator")).thenReturn(Mono.just(target));
        when(teams.createInvitation(101L, "Creator", null, 8L, "administrator", 1L)).thenReturn(Mono.just(invitation));
        StepVerifier.create(service.createTeam(new TeamDtos.CreateTeamRequest("团队甲", "team-a", 2, "Creator", "ignored-password", null)))
                .expectNext(team).verifyComplete();
        verify(accounts, never()).createUser(any());
        verify(passwords, never()).encode(any());
    }

    /** 未注册邮箱仍可收到待注册邀请，不会提前创建账号。 */
    @Test
    void shouldPreserveInvitationForUnregisteredEmail() {
        UUID invitation = UUID.randomUUID();
        when(accounts.findByEmail("future@example.com")).thenReturn(Mono.empty());
        when(teams.createInvitation(101L, "future@example.com", "future@example.com", null, "member", 1L)).thenReturn(Mono.just(invitation));
        StepVerifier.create(service.inviteMember(new TeamDtos.InviteMemberRequest("Future@Example.com"))
                .contextWrite(new TeamScope(101, "administrator")::apply)).expectNext(invitation).verifyComplete();
        verify(accounts, never()).createUser(any());
    }

    /** 已有用户名必须邀请，不能覆盖其密码。 */
    @Test
    void shouldRejectCreatingExistingUsername() {
        when(teams.countMembers(101L)).thenReturn(Mono.just(0L));
        when(accounts.findByUsername("Creator")).thenReturn(Mono.just(target));
        StepVerifier.create(service.createMember(new TeamDtos.CreateMemberRequest("Creator", "password123", null))
                .contextWrite(new TeamScope(101, "administrator")::apply)).expectError(BusinessException.class).verify();
        verify(accounts, never()).createUser(any());
    }

    /** 用户名邀请绑定用户标识，无需伪造邮箱。 */
    @Test
    void shouldInviteUsernameByStableUserId() {
        UUID invitationId = UUID.randomUUID();
        when(accounts.findByUsername("Creator")).thenReturn(Mono.just(target));
        when(teams.createInvitation(101L, "Creator", null, 8L, "member", 1L)).thenReturn(Mono.just(invitationId));
        StepVerifier.create(service.inviteMember(new TeamDtos.InviteMemberRequest("Creator"))
                .contextWrite(new TeamScope(101, "administrator")::apply)).expectNext(invitationId).verifyComplete();
    }

    /** 重发已绑定邀请保持原用户，不查询已更名的旧用户名。 */
    @Test
    void shouldResendToOriginalUserAfterRename() {
        UUID original = UUID.randomUUID(), replacement = UUID.randomUUID();
        JSONObject invitation = JSONObject.of("teamId", 101L, "invitedAccount", "OldName", "invitedUserId", 8L, "memberRole", "member", "invitationStatus", "revoked");
        when(teams.findInvitation(original, true)).thenReturn(Mono.just(invitation));
        when(teams.createInvitation(101L, "OldName", null, 8L, "member", 1L)).thenReturn(Mono.just(replacement));
        StepVerifier.create(service.resendInvitation(new TeamDtos.InvitationRequest(original))
                .contextWrite(new TeamScope(101, "administrator")::apply)).expectNext(replacement).verifyComplete();
        verifyNoInteractions(accounts);
    }

    /** 改名后原账号仍能接受，持有旧账号名的其他人不能冒领邀请。 */
    @Test
    void shouldAcceptInvitationByUserIdAfterRename() {
        UUID id = UUID.randomUUID();
        JSONObject invitation = JSONObject.of("teamId", 101L, "invitedUserId", 8L, "invitedAccount", "OldName", "memberRole", "member", "invitationStatus", "accepted", "expiresAt", OffsetDateTime.now().plusDays(7).toString());
        when(teams.findInvitation(id, false)).thenReturn(Mono.just(invitation));
        when(teams.findInvitation(id, true)).thenReturn(Mono.just(invitation));
        when(teams.findTeam(101L)).thenReturn(Mono.just(team));
        when(currentUser.currentUser()).thenReturn(Mono.just(new CurrentUser(8L, null, "user", 1)));
        StepVerifier.create(service.acceptInvitation(new TeamDtos.InvitationRequest(id))).expectNext(team).verifyComplete();
        when(currentUser.currentUser()).thenReturn(Mono.just(new CurrentUser(9L, null, "user", 1)));
        StepVerifier.create(service.acceptInvitation(new TeamDtos.InvitationRequest(id))).expectError(BusinessException.class).verify();
    }

    /** 创建团队可重置被禁用成员，但不会恢复成员或全局状态。 */
    @Test
    void shouldResetDisabledMemberCreatedByTeam() {
        when(teams.findMembership(101L, 8L)).thenReturn(Mono.just(JSONObject.of("memberRole", "member", "memberStatus", "disabled")));
        StepVerifier.create(service.resetMemberPassword(new UserDtos.AdminResetPasswordRequest(8L, "new-password"))
                .contextWrite(new TeamScope(101, "administrator")::apply)).verifyComplete();
        var order = inOrder(teams, accounts, locks);
        order.verify(teams).lockTeam(101L);
        order.verify(teams).findMembership(101L, 1L);
        order.verify(teams).findMembership(101L, 8L);
        order.verify(accounts).lockUser(8L);
        order.verify(accounts).updatePasswordAfterReset(8L, "new-hash");
        order.verify(locks).clear(8L);
        verify(teams, never()).updateMemberStatus(anyLong(), anyLong(), anyString());
    }

    /**
     * 邮箱账号、外部来源、历史来源及全局管理员均不能由团队重置。
     * @param scenario 不允许重置的账号类型
     */
    @ParameterizedTest
    @ValueSource(strings = {"email", "otherTeam", "historical", "globalAdministrator"})
    void shouldRejectUnownedOrPrivilegedAccount(String scenario) {
        switch (scenario) {
            case "email" -> target.setEmail("member@example.com");
            case "otherTeam" -> target.setCreatedByTeamId(102L);
            case "historical" -> target.setCreatedByTeamId(null);
            case "globalAdministrator" -> target.setRole("admin");
            default -> throw new IllegalArgumentException("未知测试场景");
        }
        StepVerifier.create(service.resetMemberPassword(new UserDtos.AdminResetPasswordRequest(8L, "new-password"))
                .contextWrite(new TeamScope(101, "administrator")::apply)).expectError(BusinessException.class).verify();
        verify(accounts, never()).updatePasswordAfterReset(any(), any());
        verify(locks, never()).clear(any());
    }

    /**
     * 目标已移除、目标为主管理员或操作者失效后都不能重置。
     * @param scenario 权限已失效的具体情形
     */
    @ParameterizedTest
    @ValueSource(strings = {"removed", "administrator", "operatorDisabled", "teamDisabled"})
    void shouldRecheckMembershipInsideLock(String scenario) {
        if ("removed".equals(scenario)) when(teams.findMembership(101L, 8L)).thenReturn(Mono.just(JSONObject.of("memberRole", "member", "memberStatus", "removed")));
        if ("administrator".equals(scenario)) when(teams.findMembership(101L, 8L)).thenReturn(Mono.just(JSONObject.of("memberRole", "administrator", "memberStatus", "active")));
        if ("operatorDisabled".equals(scenario)) when(teams.findMembership(101L, 1L)).thenReturn(Mono.just(JSONObject.of("memberRole", "administrator", "memberStatus", "disabled")));
        if ("teamDisabled".equals(scenario)) team.put("enabled", false);
        StepVerifier.create(service.resetMemberPassword(new UserDtos.AdminResetPasswordRequest(8L, "new-password"))
                .contextWrite(new TeamScope(101, "administrator")::apply)).expectError(BusinessException.class).verify();
        verify(accounts, never()).updatePasswordAfterReset(any(), any());
        verify(locks, never()).clear(any());
    }
}
