package com.novanovastudio.service;

import java.math.BigDecimal;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.AccountIdentifier;
import com.novanovastudio.common.SystemMessage;
import com.novanovastudio.dto.UserDtos;
import com.novanovastudio.security.PasswordLoginLockService;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.TeamDtos;
import com.novanovastudio.entity.User;
import com.novanovastudio.repository.CreditRepository;
import com.novanovastudio.repository.TeamRepository;
import com.novanovastudio.repository.UserRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.TeamScope;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.reactive.TransactionalOperator;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * 团队管理、受邀确认与成员名额事务编排。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-18 10:00
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class TeamService {
    /** 邀请人昵称缺失时的兜底展示名。 */
    private static final String INVITER_FALLBACK_NAME = "团队管理员";
    /** 团队仓储。 */
    private final TeamRepository repository;
    /** 全局账号仓储。 */
    private final UserRepository userRepository;
    /** 平台积分账户初始化。 */
    private final CreditRepository creditRepository;
    /** 当前身份。 */
    private final CurrentUserProvider currentUserProvider;
    /** 密码编码器。 */
    private final PasswordEncoder passwordEncoder;
    /** 全局密码登录错误锁定服务。 */
    private final PasswordLoginLockService passwordLoginLockService;
    /** 邀请码生成器。 */
    private final InvitationService invitationService;
    /** 团队邀请邮件。 */
    private final TeamInvitationMailService teamInvitationMailService;
    /** 事务操作器。 */
    private final TransactionalOperator transactionalOperator;

    /**
     * 列出所有团队，仅超级管理员控制器调用。
     * @return 团队列表
     */
    public Mono<List<JSONObject>> listTeams() { return repository.listTeams().collectList(); }

    /**
     * 查询公开团队品牌。
     * @param slug 路径标识
     * @return 公开品牌信息
     */
    public Mono<JSONObject> getPublicTeam(String slug) {
        return repository.findPublicTeam(slug).switchIfEmpty(Mono.error(missing("团队不存在")));
    }

    /** @return 当前用户可切换的团队 */
    public Mono<List<JSONObject>> listMyTeams() {
        return currentUserProvider.currentUserId().flatMap(userId -> repository.listUserTeams(userId).collectList());
    }

    /** @return 当前用户待接受邀请 */
    public Mono<List<JSONObject>> listMyInvitations() {
        return currentUserProvider.currentUser().flatMap(user -> repository.listMyInvitations(user.id(), user.email()).collectList());
    }

    /**
     * 创建团队，已有账号必须由本人接受主管理员邀请。
     * @param request 创建参数
     * @return 团队记录
     */
    public Mono<JSONObject> createTeam(TeamDtos.CreateTeamRequest request) {
        AccountIdentifier account = AccountIdentifier.parse(request.account());
        if ("platform".equals(request.teamSlug())) return Mono.error(invalid("平台路径不能用于团队"));
        return currentUserProvider.currentUserId().flatMap(operator -> repository.createTeam(request).flatMap(teamId ->
                findAccount(account).map(Optional::of).defaultIfEmpty(Optional.empty()).flatMap(existing -> {
                    if (existing.isPresent()) {
                        String email = existing.get().getEmail();
                        return requireInvitationMail(email)
                                .then(Mono.defer(() -> repository.createInvitation(teamId, account.value(), email, existing.get().getId(), "administrator", operator)))
                                .flatMap(invitationId -> sendInvitationMail(invitationId, email, request.name(), operator).thenReturn(invitationId))
                                .then(Mono.defer(() -> repository.findTeam(teamId)));
                    }
                    return createAccount(account, request.password(), request.nickname(), null, operator)
                            .flatMap(userId -> repository.addMember(teamId, userId, "administrator"))
                            .then(Mono.defer(() -> repository.findTeam(teamId)));
                })))
                .as(transactionalOperator::transactional)
                .contextWrite(context -> context.put(TeamScope.SYSTEM_KEY, true))
                .doOnSuccess(team -> log.info("团队创建完成：teamId={}", team.getLong("id")));
    }

    /**
     * 更新团队开关和人数上限。
     * @param request 更新参数
     * @return 完成信号
     */
    public Mono<Void> updateSettings(TeamDtos.UpdateTeamSettingsRequest request) {
        return repository.lockTeam(request.teamId()).switchIfEmpty(Mono.error(missing("团队不存在")))
                .flatMap(team -> repository.countMembers(request.teamId()).flatMap(count -> count > request.memberLimit()
                        ? Mono.error(invalid("人数上限不能小于现有子账号数量"))
                        : repository.updateSettings(request, team.getBooleanValue("enabled"))))
                .as(transactionalOperator::transactional);
    }

    /** @return 当前团队管理概况 */
    public Mono<JSONObject> getTeam() {
        return TeamScope.requireAdministrator().flatMap(scope -> repository.findTeam(scope.teamId()));
    }

    /**
     * 修改当前团队品牌。
     * @param request 团队资料
     * @return 完成信号
     */
    public Mono<Void> updateTeam(TeamDtos.UpdateTeamRequest request) {
        if (!request.logoUrl().isEmpty() && !request.logoUrl().startsWith("https://") && !request.logoUrl().startsWith("/"))
            return Mono.error(invalid("团队标志必须使用HTTPS或站内地址"));
        return TeamScope.requireAdministrator().flatMap(scope -> repository.updateTeam(scope.teamId(), request));
    }

    /** @return 当前团队成员与消费统计 */
    public Mono<List<JSONObject>> listMembers() {
        return TeamScope.requireAdministrator().flatMap(scope -> repository.listMembers(scope.teamId()).collectList()
                .contextWrite(context -> context.put(TeamScope.SYSTEM_KEY, true)));
    }

    /**
     * 新建子账号，平台钱包为零，不触发平台注册赠送。
     * @param request 账号资料
     * @return 完成信号
     */
    public Mono<Void> createMember(TeamDtos.CreateMemberRequest request) {
        AccountIdentifier account = AccountIdentifier.parse(request.account());
        return TeamScope.requireAdministrator().flatMap(scope -> currentUserProvider.currentUserId().flatMap(operator -> repository.lockTeam(scope.teamId())
                .flatMap(team -> checkCapacity(team).then(findAccount(account).hasElement()).flatMap(exists -> {
                    if (exists) return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.accountExistsInviteInstead")));
                    return createAccount(account, request.password(), request.nickname(), scope.teamId(), operator)
                            .flatMap(userId -> repository.addMember(scope.teamId(), userId, "member"));
                })).as(transactionalOperator::transactional)
                .contextWrite(context -> context.put(TeamScope.SYSTEM_KEY, true))));
    }

    /**
     * 创建团队成员邀请，用户名必须已经存在，未注册邮箱可等待注册。
     * @param request 受邀账号
     * @return 邀请标识
     */
    public Mono<UUID> inviteMember(TeamDtos.InviteMemberRequest request) {
        AccountIdentifier account = AccountIdentifier.parse(request.account());
        return TeamScope.requireAdministrator().flatMap(scope -> currentUserProvider.currentUserId()
                .flatMap(operator -> repository.lockTeam(scope.teamId()).flatMap(team -> {
                    if (!team.getBooleanValue("enabled")) return Mono.error(denied("团队已禁用"));
                    return findAccount(account).map(Optional::of).defaultIfEmpty(Optional.empty()).flatMap(existing -> {
                        if (existing.isEmpty() && account.email() == null) return Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, SystemMessage.of("business.userNotFound")));
                        String email = existing.map(User::getEmail).orElse(account.email());
                        return requireInvitationMail(email)
                                .then(Mono.defer(() -> repository.createInvitation(scope.teamId(), account.value(), email,
                                        existing.map(User::getId).orElse(null), "member", operator)))
                                .flatMap(invitationId -> sendInvitationMail(invitationId, email, team.getString("name"), operator).thenReturn(invitationId));
                    });
                }))).as(transactionalOperator::transactional);
    }

    /**
     * 按原邀请目标重新发送，不能用旧用户名解析出另一个账号。
     * @param request 原邀请标识
     * @return 新邀请标识
     */
    public Mono<UUID> resendInvitation(TeamDtos.InvitationRequest request) {
        return TeamScope.requireAdministrator().flatMap(scope -> currentUserProvider.currentUserId().flatMap(operator ->
                repository.lockTeam(scope.teamId()).flatMap(team -> {
                    if (!team.getBooleanValue("enabled")) return Mono.error(denied("团队已禁用"));
                    return repository.findInvitation(request.invitationId(), true).switchIfEmpty(Mono.error(missing("邀请不存在")))
                            .flatMap(invitation -> {
                                if (invitation.getLongValue("teamId") != scope.teamId()) return Mono.error(denied("不能修改其他团队邀请"));
                                if ("accepted".equals(invitation.getString("invitationStatus"))) return Mono.error(invalid("邀请已接受"));
                                Long targetId = invitation.getLong("invitedUserId");
                                String email = invitation.getString("email");
                                Mono<UUID> create = targetId != null
                                        ? repository.createInvitation(scope.teamId(), invitation.getString("invitedAccount"), email, targetId, invitation.getString("memberRole"), operator)
                                        // 原目标是未注册邮箱时，仅解析该邮箱，不使用展示快照查找用户名。
                                        : userRepository.findByEmail(email).map(Optional::of).defaultIfEmpty(Optional.empty())
                                                .flatMap(target -> repository.createInvitation(scope.teamId(), invitation.getString("invitedAccount"), email, target.map(User::getId).orElse(null), invitation.getString("memberRole"), operator));
                                return requireInvitationMail(email).then(create)
                                        .flatMap(invitationId -> sendInvitationMail(invitationId, email, team.getString("name"), operator).thenReturn(invitationId));
                            });
                }))).as(transactionalOperator::transactional);
    }

    /**
     * 创建团队仅可重置仍在本团队的无邮箱普通成员，移除与重置共用团队行锁。
     * @param request 目标成员及新密码
     * @return 重置完成信号
     */
    public Mono<Void> resetMemberPassword(UserDtos.AdminResetPasswordRequest request) {
        AccountIdentifier.validatePassword(request.newPassword());
        return TeamScope.requireAdministrator().flatMap(scope -> currentUserProvider.currentUserId().flatMap(operator ->
                repository.lockTeam(scope.teamId()).switchIfEmpty(Mono.error(missing("团队不存在")))
                        .flatMap(team -> {
                            if (!team.getBooleanValue("enabled")) return Mono.error(denied("团队已禁用"));
                            // 再次读取操作者成员状态，防止权限在请求期间发生变化。
                            return repository.findMembership(scope.teamId(), operator)
                                    .filter(member -> "administrator".equals(member.getString("memberRole")) && "active".equals(member.getString("memberStatus")))
                                    .switchIfEmpty(Mono.error(denied("需要当前团队管理员权限")));
                        })
                        .then(Mono.defer(() -> requireMember(scope.teamId(), request.userId())))
                        .then(Mono.defer(() -> userRepository.lockUser(request.userId()).switchIfEmpty(Mono.error(missing("账号不存在")))))
                        .flatMap(user -> {
                            if (user.getEmail() != null || !"user".equals(user.getRole()) || !Long.valueOf(scope.teamId()).equals(user.getCreatedByTeamId()))
                                return Mono.error(new BusinessException(ErrorCode.PERMISSION_DENIED, SystemMessage.of("business.cannotResetMemberPassword")));
                            return Mono.fromCallable(() -> passwordEncoder.encode(request.newPassword())).subscribeOn(Schedulers.boundedElastic())
                                    .flatMap(encoded -> userRepository.updatePasswordAfterReset(user.getId(), encoded));
                        }).as(transactionalOperator::transactional)
                        .then(Mono.defer(() -> passwordLoginLockService.clear(request.userId())))
                        .doOnSuccess(ignored -> log.info("创建团队重置成员全局密码：teamId={}, operatorUserId={}, userId={}", scope.teamId(), operator, request.userId()))
                        .contextWrite(context -> context.put(TeamScope.SYSTEM_KEY, true))));
    }

    /** @return 当前团队最近邀请 */
    public Mono<List<JSONObject>> listInvitations() {
        return TeamScope.requireAdministrator().flatMap(scope -> repository.listTeamInvitations(scope.teamId()).collectList());
    }

    /**
     * 由受邀账号本人接受邀请，重复接受保持幂等。
     * @param request 邀请标识
     * @return 加入的团队
     */
    public Mono<JSONObject> acceptInvitation(TeamDtos.InvitationRequest request) {
        return currentUserProvider.currentUser().flatMap(user -> repository.findInvitation(request.invitationId(), false)
                .switchIfEmpty(Mono.error(missing("邀请不存在")))
                .flatMap(initial -> repository.lockTeam(initial.getLongValue("teamId"))
                        .switchIfEmpty(Mono.error(missing("团队不存在")))
                        .flatMap(team -> repository.findInvitation(request.invitationId(), true).flatMap(invitation -> {
                            Long targetId = invitation.getLong("invitedUserId");
                            boolean matches = targetId != null ? targetId.equals(user.id())
                                    : user.email() != null && user.email().equalsIgnoreCase(invitation.getString("email"));
                            if (!matches) return Mono.error(denied("邀请仅限受邀账号本人接受"));
                            if (!team.getBooleanValue("enabled")) return Mono.error(denied("团队已禁用"));
                            String status = invitation.getString("invitationStatus");
                            if ("accepted".equals(status)) return repository.findTeam(team.getLongValue("id"));
                            if (!"pending".equals(status) || OffsetDateTime.parse(invitation.getString("expiresAt")).isBefore(OffsetDateTime.now()))
                                return Mono.error(invalid("邀请已失效，请联系团队管理员重新邀请"));
                            long teamId = team.getLongValue("id");
                            String role = invitation.getString("memberRole");
                            return repository.cleanupPending(teamId, user.id()).flatMap(pending -> {
                                if (pending) return Mono.error(invalid("成员数据清理尚未完成，请稍后重新加入"));
                                return repository.findMembership(teamId, user.id()).map(member -> !"removed".equals(member.getString("memberStatus"))).defaultIfEmpty(false)
                                        .flatMap(alreadyMember -> {
                                            if (alreadyMember) return repository.updateInvitation(request.invitationId(), "accepted").then(Mono.defer(() -> repository.findTeam(teamId)));
                                            if ("administrator".equals(role) && team.getLong("administratorUserId") != null)
                                                return Mono.error(invalid("团队已经有主管理员"));
                                            return ("member".equals(role) ? checkCapacity(team) : Mono.<Void>empty())
                                                    .then(Mono.defer(() -> repository.addMember(teamId, user.id(), role)))
                                                    .then(Mono.defer(() -> repository.updateInvitation(request.invitationId(), "accepted")))
                                                    .then(Mono.defer(() -> repository.findTeam(teamId)));
                                        });
                            });
                        }))))
                .as(transactionalOperator::transactional)
                .contextWrite(context -> context.put(TeamScope.SYSTEM_KEY, true));
    }

    /**
     * 撤销当前团队邀请。
     * @param request 邀请标识
     * @return 完成信号
     */
    public Mono<Void> revokeInvitation(TeamDtos.InvitationRequest request) {
        return TeamScope.requireAdministrator().flatMap(scope -> repository.findInvitation(request.invitationId(), true)
                .switchIfEmpty(Mono.error(missing("邀请不存在"))).flatMap(invitation -> {
                    if (invitation.getLongValue("teamId") != scope.teamId()) return Mono.error(denied("不能修改其他团队邀请"));
                    if (!"pending".equals(invitation.getString("invitationStatus"))) return Mono.error(invalid("邀请已处理"));
                    return repository.updateInvitation(request.invitationId(), "revoked");
                })).as(transactionalOperator::transactional);
    }

    /**
     * 禁用或恢复当前团队成员，不修改全局账号。
     * @param request 目标成员及状态
     * @return 完成信号
     */
    public Mono<Void> updateMemberStatus(TeamDtos.MemberRequest request) {
        if (request.enabled() == null) return Mono.error(invalid("缺少成员启用状态"));
        return TeamScope.requireAdministrator().flatMap(scope -> requireMember(scope.teamId(), request.userId())
                .then(repository.updateMemberStatus(scope.teamId(), request.userId(), request.enabled() ? "active" : "disabled")));
    }

    /**
     * 在团队行锁内重新确认管理员权限并调整其他成员身份，主管理员与本人身份不能修改。
     * @param request 目标成员及团队身份
     * @return 授权完成信号
     * @throws BusinessException 身份无效、团队停用或当前操作者无权授权时抛出
     */
    public Mono<Void> updateMemberRole(TeamDtos.UpdateMemberRoleRequest request) {
        if (!"administrator".equals(request.memberRole()) && !"member".equals(request.memberRole())) return Mono.error(invalid("团队身份无效"));
        return TeamScope.requireAdministrator().flatMap(scope -> currentUserProvider.currentUserId().flatMap(operator ->
                repository.lockTeam(scope.teamId()).switchIfEmpty(Mono.error(missing("团队不存在")))
                        .flatMap(team -> {
                            if (!team.getBooleanValue("enabled")) return Mono.error(denied("团队已禁用"));
                            if (operator.equals(request.userId())) return Mono.error(denied("不能修改本人的团队身份"));
                            if (request.userId().equals(team.getLong("administratorUserId"))) return Mono.error(denied("不能修改主管理员身份"));
                            // 与移除、密码重置使用同一团队锁，旧请求不能在降权后继续授权。
                            return repository.findMembership(scope.teamId(), operator)
                                    .filter(member -> "administrator".equals(member.getString("memberRole")) && "active".equals(member.getString("memberStatus")))
                                    .switchIfEmpty(Mono.error(denied("需要当前团队管理员权限")));
                        })
                        .then(Mono.defer(() -> repository.findMembership(scope.teamId(), request.userId())
                                .filter(member -> !"removed".equals(member.getString("memberStatus")))
                                .switchIfEmpty(Mono.error(missing("当前团队成员不存在")))))
                        .flatMap(member -> {
                            String previousRole = member.getString("memberRole");
                            if (request.memberRole().equals(previousRole)) return Mono.empty();
                            return repository.updateMemberRole(scope.teamId(), request.userId(), request.memberRole())
                                    .doOnSuccess(ignored -> log.info("团队成员身份已调整：teamId={}, operatorUserId={}, userId={}, previousRole={}, memberRole={}",
                                            scope.teamId(), operator, request.userId(), previousRole, request.memberRole()));
                        }).as(transactionalOperator::transactional)));
    }

    /**
     * 撤销成员权限，冻结团队余额并建立可恢复的清理任务。
     * @param request 目标成员
     * @return 完成信号
     */
    public Mono<Void> removeMember(TeamDtos.MemberRequest request) {
        return TeamScope.requireAdministrator().flatMap(scope -> repository.lockTeam(scope.teamId())
                .then(repository.findMembership(scope.teamId(), request.userId()))
                .filter(member -> "member".equals(member.getString("memberRole")))
                .switchIfEmpty(Mono.error(missing("当前团队子账号不存在")))
                .flatMap(member -> "removed".equals(member.getString("memberStatus")) ? Mono.empty()
                        : repository.updateMemberStatus(scope.teamId(), request.userId(), "removed")
                            .then(repository.requestCleanup(scope.teamId(), request.userId())))
                .as(transactionalOperator::transactional)
                .contextWrite(context -> context.put(TeamScope.SYSTEM_KEY, true)));
    }

    /**
     * 显式替换团队可用平台资源。
     * @param request 授权请求
     * @return 完成信号
     */
    public Mono<Void> updateGrants(TeamDtos.ResourceGrantsRequest request) {
        return repository.lockTeam(request.teamId()).switchIfEmpty(Mono.error(missing("团队不存在")))
                .then(repository.replaceGrants(request.teamId(), "model", request.modelIds()))
                .flatMap(count -> count != request.modelIds().stream().distinct().count() ? Mono.error(invalid("包含不存在的平台模型")) : Mono.just(count))
                .then(repository.replaceGrants(request.teamId(), "objectStorage", request.objectStorageIds()))
                .flatMap(count -> count != request.objectStorageIds().stream().distinct().count() ? Mono.error(invalid("包含不存在的平台对象存储")) : Mono.just(count))
                .then().as(transactionalOperator::transactional);
    }

    /**
     * 读取资源授权。
     * @param teamId 团队标识
     * @return 授权记录
     */
    public Mono<List<JSONObject>> listGrants(long teamId) { return repository.listGrants(teamId).collectList(); }

    /** @return 当前团队内容继承设置 */
    public Mono<List<JSONObject>> listConfigurationModes() {
        return TeamScope.requireAdministrator().flatMap(scope -> repository.listConfigurationModes(scope.teamId()).collectList());
    }

    /**
     * 修改单个内容模块继承方式。
     * @param request 模块开关
     * @return 完成信号
     */
    public Mono<Void> updateConfigurationMode(TeamDtos.ConfigurationModeRequest request) {
        return TeamScope.requireAdministrator().flatMap(scope -> repository.updateConfigurationMode(scope.teamId(), request));
    }

    /**
     * 保存资源启用和默认设置，不能创建无权使用的资源偏好。
     * @param request 资源偏好
     * @return 完成信号
     */
    public Mono<Void> saveResourcePreference(TeamDtos.ResourcePreferenceRequest request) {
        if (request.defaultResource() && !request.enabled()) return Mono.error(invalid("默认资源必须启用"));
        return TeamScope.requireAdministrator().flatMap(scope -> repository.lockTeam(scope.teamId())
                .then(repository.findResource(request.resourceType(), request.resourceId()))
                .switchIfEmpty(Mono.error(missing("资源不存在或未获授权")))
                .flatMap(resource -> repository.savePreference(scope.teamId(), request, resource.getString("modelType") == null ? "" : resource.getString("modelType"))))
                .as(transactionalOperator::transactional);
    }

    /** @return 当前团队资源偏好 */
    public Mono<List<JSONObject>> listResourcePreferences() {
        return TeamScope.requireAdministrator().flatMap(scope -> repository.listPreferences(scope.teamId()).collectList());
    }

    /**
     * 由当前空间管理员读取资源目录，所有密钥留在服务端。
     * @return 资源展示目录
     */
    public Mono<List<JSONObject>> listAvailableResources() { return repository.listAvailableResources().collectList(); }

    /** @return 当前团队流水与收入归属，不返回成员平台余额 */
    public Mono<List<JSONObject>> listCreditTransactions() {
        return TeamScope.requireAdministrator().flatMap(scope -> repository.listTeamTransactions(scope.teamId()).collectList());
    }

    /**
     * 校验还有成员名额，调用者已经锁定团队行。
     * @param team 团队记录
     * @return 校验完成信号
     */
    private Mono<Void> checkCapacity(JSONObject team) {
        if (!team.getBooleanValue("enabled")) return Mono.error(denied("团队已禁用"));
        return repository.countMembers(team.getLongValue("id")).flatMap(count -> count >= team.getInteger("memberLimit")
                ? Mono.error(invalid("团队子账号数量已达到上限")) : Mono.empty());
    }

    /**
     * 验证可操作的普通成员，主管理员不能被删除或禁用。
     * @param teamId 当前团队
     * @param userId 目标用户
     * @return 成员记录
     */
    public Mono<JSONObject> requireMember(long teamId, long userId) {
        return repository.findMembership(teamId, userId).filter(member -> "member".equals(member.getString("memberRole")) && !"removed".equals(member.getString("memberStatus")))
                .switchIfEmpty(Mono.error(missing("当前团队成员不存在或不能执行此操作")));
    }

    /**
     * 创建账号及零余额钱包，保存真实创建归属，不触发注册奖励。
     * @param account 标准化账号
     * @param password 明文密码
     * @param nickname 昵称
     * @param createdByTeamId 创建团队，平台创建为空
     * @param operator 创建操作人
     * @return 新账号标识
     */
    private Mono<Long> createAccount(AccountIdentifier account, String password, String nickname, Long createdByTeamId, long operator) {
        AccountIdentifier.validatePassword(password);
        account.validateCreation();
        return Mono.fromCallable(() -> passwordEncoder.encode(password)).subscribeOn(Schedulers.boundedElastic()).flatMap(encoded -> {
            User user = new User();
            user.setUsername(account.value()); user.setEmail(account.email()); user.setPassword(encoded);
            user.setNickname(nickname == null || nickname.isBlank() ? account.defaultNickname() : nickname.trim());
            user.setCreatedByTeamId(createdByTeamId); user.setCreatedByUserId(operator);
            user.setRole("user"); user.setStatus(1); user.setRegisteredAt(OffsetDateTime.now());
            user.setInvitationCode(invitationService.generateInvitationCode());
            return userRepository.createUser(user).flatMap(userId -> creditRepository.createAccount(userId, BigDecimal.ZERO).thenReturn(userId));
        });
    }

    /**
     * 有邮箱时先确认邮件服务可用，避免写完邀请才发现配置缺失。
     * @param email 受邀邮箱，允许为空
     * @return 校验完成信号
     */
    private Mono<Void> requireInvitationMail(String email) {
        return email == null || email.isBlank() ? Mono.empty() : Mono.fromRunnable(teamInvitationMailService::requireConfigured);
    }

    /**
     * 向受邀邮箱发送团队邀请邮件，无邮箱账号只保留站内邀请。
     * @param invitationId 邀请标识
     * @param email 受邀邮箱，允许为空
     * @param teamName 团队名称
     * @param operator 操作人
     * @return 发送完成信号
     */
    private Mono<Void> sendInvitationMail(UUID invitationId, String email, String teamName, long operator) {
        if (email == null || email.isBlank()) return Mono.empty();
        return userRepository.findById(operator)
                .map(user -> StringUtils.hasText(user.getNickname()) ? user.getNickname() : user.getUsername())
                .defaultIfEmpty(INVITER_FALLBACK_NAME)
                .flatMap(inviterName -> teamInvitationMailService.send(email, teamName, inviterName, invitationId));
    }

    /**
     * 按明确的账号类型查询，不尝试其他标识。
     * @param account 标准化账号
     * @return 已存在的用户
     */
    private Mono<User> findAccount(AccountIdentifier account) {
        return account.email() == null ? userRepository.findByUsername(account.value()) : userRepository.findByEmail(account.email());
    }

    /** @param message 中文参数错误说明 @return 参数异常 */
    private static BusinessException invalid(String message) { return new BusinessException(ErrorCode.PARAM_INVALID, message); }
    /** @param message 中文资源缺失说明 @return 资源异常 */
    private static BusinessException missing(String message) { return new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, message); }
    /** @param message 中文权限错误说明 @return 权限异常 */
    private static BusinessException denied(String message) { return new BusinessException(ErrorCode.PERMISSION_DENIED, message); }
}
