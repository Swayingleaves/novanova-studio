package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.CreditDtos;
import com.novanovastudio.dto.UserDtos;
import com.novanovastudio.entity.PasswordResetToken;
import com.novanovastudio.entity.User;
import com.novanovastudio.entity.EmailVerificationCode;
import com.novanovastudio.repository.UserRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.PasswordLoginLockService;
import com.novanovastudio.security.TokenService;
import com.novanovastudio.task.AiTaskEventPublisher;
import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Flux;
import reactor.test.StepVerifier;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Map;
import java.util.Properties;
import java.util.stream.Stream;

/**
 * 用户服务欢迎引导测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-16 00:00
 */
class UserServiceTest {

    /**
     * 有效邀请码注册应记录邀请关系并在同一注册流程发放邀请奖励。
     */
    @Test
    @DisplayName("有效邀请码完成邮箱注册并发放邀请奖励")
    void shouldRegisterWithInvitationReward() {
        TestContext context = testContext();
        EmailVerificationCode emailCode = new EmailVerificationCode();
        emailCode.setId(3L);
        emailCode.setCodeHash("code-hash");
        User createdUser = normalUser(8L);
        createdUser.setCreditBalance(java.math.BigDecimal.valueOf(100));
        when(context.invitationService.resolveInviterUserId("INVITATIONCODE01")).thenReturn(Mono.just(5L));
        when(context.userRepository.findByEmail("new@example.com")).thenReturn(Mono.empty());
        when(context.userRepository.latestValidEmailCode("new@example.com", "register")).thenReturn(Mono.just(emailCode));
        when(context.passwordEncoder.matches("123456", "code-hash")).thenReturn(true);
        when(context.passwordEncoder.encode("password123")).thenReturn("password-hash");
        when(context.invitationService.generateInvitationCode()).thenReturn("NEWINVITATION001");
        when(context.userRepository.registerUserWithEmailCode(argThat(user -> user.getInvitedByUserId().equals(5L)
                && "NEWINVITATION001".equals(user.getInvitationCode())), eq(3L))).thenReturn(Mono.just(8L));
        when(context.creditService.initializeAccount(8L)).thenReturn(Mono.empty());
        when(context.creditService.grantInvitationReward(5L, 8L)).thenReturn(Mono.empty());
        when(context.userRepository.findById(8L)).thenReturn(Mono.just(createdUser));
        when(context.tokenService.sign(8L, UserService.ROLE_USER, 0))
                .thenReturn(new TokenService.SignedToken("token", OffsetDateTime.now().plusHours(1)));

        StepVerifier.create(context.service.register(new UserDtos.RegisterRequest(
                        "new@example.com", "123456", "password123", "新用户", "INVITATIONCODE01")))
                .expectNextCount(1)
                .verifyComplete();

        verify(context.creditService).grantInvitationReward(5L, 8L);
    }

    /**
     * 无效邀请码应在读取验证码和创建用户前阻止邮箱注册。
     */
    @Test
    @DisplayName("无效邀请码阻止邮箱注册")
    void shouldRejectInvalidInvitationCodeBeforeRegistration() {
        TestContext context = testContext();
        when(context.invitationService.resolveInviterUserId("INVALIDCODE"))
                .thenReturn(Mono.error(new BusinessException(com.novanovastudio.common.ErrorCode.BUSINESS_ERROR, "邀请码无效")));

        StepVerifier.create(context.service.register(new UserDtos.RegisterRequest(
                        "new@example.com", "123456", "password123", "新用户", "INVALIDCODE")))
                .expectError(BusinessException.class)
                .verify();

        verify(context.userRepository, never()).findByEmail(any());
    }

    /**
     * 验证正常用户请求找回密码时保存令牌并发送邮件。
     */
    @Test
    @DisplayName("正常用户可接收密码重置邮件")
    void shouldSendPasswordResetEmailForNormalUser() {
        TestContext context = testContext();
        User user = normalUser(8L);
        context.properties.getApp().setFrontendBaseUrl("https://www.novanovastudio.cn");
        context.properties.getEmail().setFrom("noreply@novanovastudio.cn");
        when(context.userRepository.findByEmail("user@example.com")).thenReturn(Mono.just(user));
        when(context.userRepository.upsertPasswordResetToken(argThat(token -> token.getUserId().equals(8L)
                && token.getTokenHash().length() == 64))).thenReturn(Mono.empty());
        when(context.mailSender.createMimeMessage()).thenReturn(new MimeMessage(Session.getInstance(new Properties())));

        StepVerifier.create(context.service.requestPasswordReset(new UserDtos.RequestPasswordResetRequest("user@example.com")))
                .verifyComplete();

        verify(context.mailSender).send(any(MimeMessage.class));
    }

    /**
     * 验证邮件发送失败时立即使本次令牌失效并返回明确错误。
     */
    @Test
    @DisplayName("密码重置邮件发送失败时令牌失效")
    void shouldInvalidatePasswordResetTokenWhenEmailFails() {
        TestContext context = testContext();
        User user = normalUser(8L);
        when(context.userRepository.findByEmail("user@example.com")).thenReturn(Mono.just(user));
        when(context.userRepository.upsertPasswordResetToken(any())).thenReturn(Mono.empty());
        when(context.mailSender.createMimeMessage()).thenThrow(new IllegalStateException("SMTP不可用"));
        when(context.userRepository.invalidatePasswordResetToken(any())).thenReturn(Mono.empty());

        StepVerifier.create(context.service.requestPasswordReset(new UserDtos.RequestPasswordResetRequest("user@example.com")))
                .expectErrorMatches(error -> error instanceof BusinessException && "发送密码重置邮件失败".equals(error.getMessage()))
                .verify();

        verify(context.userRepository).invalidatePasswordResetToken(any());
    }

    /**
     * 验证前端地址缺失或非法时不会查询账号或创建令牌。
     */
    @Test
    @DisplayName("前端地址非法时拒绝生成重置链接")
    void shouldRejectInvalidFrontendBaseUrl() {
        TestContext context = testContext();
        context.properties.getApp().setFrontendBaseUrl("ftp://example.com");

        StepVerifier.create(context.service.requestPasswordReset(new UserDtos.RequestPasswordResetRequest("user@example.com")))
                .expectErrorMatches(error -> error instanceof BusinessException && error.getMessage().contains("FRONTEND_BASE_URL"))
                .verify();

        verify(context.userRepository, never()).findByEmail(any());
    }

    /**
     * 验证未知或禁用用户不会得到可用重置令牌。
     */
    @Test
    @DisplayName("未知或禁用邮箱保持统一重置响应")
    void shouldKeepPasswordResetResponseForUnknownOrDisabledUser() {
        TestContext unknownContext = testContext();
        when(unknownContext.userRepository.findByEmail("unknown@example.com")).thenReturn(Mono.empty());

        StepVerifier.create(unknownContext.service.requestPasswordReset(new UserDtos.RequestPasswordResetRequest("unknown@example.com")))
                .verifyComplete();

        verify(unknownContext.userRepository, never()).upsertPasswordResetToken(any());

        TestContext disabledContext = testContext();
        User disabledUser = normalUser(9L);
        disabledUser.setStatus(UserService.STATUS_DISABLED);
        when(disabledContext.userRepository.findByEmail("user@example.com")).thenReturn(Mono.just(disabledUser));

        StepVerifier.create(disabledContext.service.requestPasswordReset(new UserDtos.RequestPasswordResetRequest("user@example.com")))
                .verifyComplete();

        verify(disabledContext.userRepository, never()).upsertPasswordResetToken(any());
    }

    /**
     * 验证有效重置令牌更新密码、递增令牌版本并清除登录锁定。
     */
    @Test
    @DisplayName("有效重置令牌修改密码并使旧令牌失效")
    void shouldResetPasswordAndIncrementTokenVersion() {
        TestContext context = testContext();
        User user = normalUser(8L);
        PasswordResetToken resetToken = new PasswordResetToken();
        resetToken.setUserId(8L);
        when(context.userRepository.findActivePasswordResetToken(any())).thenReturn(Mono.just(resetToken));
        when(context.userRepository.findById(8L)).thenReturn(Mono.just(user));
        when(context.passwordLoginLockService.clear(8L)).thenReturn(Mono.empty());
        when(context.passwordEncoder.encode("new-password")).thenReturn("encoded-new-password");
        when(context.userRepository.consumePasswordResetToken(any())).thenReturn(Mono.just(8L));
        when(context.userRepository.updatePasswordAfterReset(8L, "encoded-new-password")).thenReturn(Mono.empty());

        StepVerifier.create(context.service.resetPassword(new UserDtos.ResetPasswordRequest("reset-token", "new-password")))
                .verifyComplete();

        verify(context.passwordLoginLockService).clear(8L);
        verify(context.userRepository).updatePasswordAfterReset(8L, "encoded-new-password");
    }

    /**
     * 验证失效重置令牌不会修改密码。
     */
    @Test
    @DisplayName("失效重置令牌拒绝修改密码")
    void shouldRejectExpiredPasswordResetToken() {
        TestContext context = testContext();
        when(context.userRepository.findActivePasswordResetToken(any())).thenReturn(Mono.empty());

        StepVerifier.create(context.service.resetPassword(new UserDtos.ResetPasswordRequest("expired-token", "new-password")))
                .expectErrorMatches(error -> error instanceof BusinessException && "重置链接已失效或已使用".equals(error.getMessage()))
                .verify();

        verify(context.passwordEncoder, never()).encode(any());
        verify(context.userRepository, never()).updatePasswordAfterReset(any(), any());
    }

    /**
     * 验证用户资料准确反映欢迎引导已读状态。
     */
    @Test
    @DisplayName("用户资料返回欢迎引导已读状态")
    void shouldExposeWelcomeReadState() {
        TestContext context = testContext();
        User user = normalUser(8L);
        user.setWelcomeReadAt(null);
        when(context.currentUserProvider.currentUserId()).thenReturn(Mono.just(8L));
        when(context.userRepository.findById(8L)).thenReturn(Mono.just(user));

        StepVerifier.create(context.service.userInfo())
                .assertNext(profile -> assertFalse(profile.welcomeRead()))
                .verifyComplete();

        user.setWelcomeReadAt(java.time.OffsetDateTime.now());
        StepVerifier.create(context.service.userInfo())
                .assertNext(profile -> assertTrue(profile.welcomeRead()))
                .verifyComplete();
    }

    /**
     * 验证用户资料返回已完成的产品引导版本，空值按 0 处理。
     */
    @Test
    @DisplayName("用户资料返回产品引导版本")
    void shouldExposeOnboardingVersion() {
        TestContext context = testContext();
        User user = normalUser(8L);
        user.setOnboardingVersion(null);
        when(context.currentUserProvider.currentUserId()).thenReturn(Mono.just(8L));
        when(context.userRepository.findById(8L)).thenReturn(Mono.just(user));

        StepVerifier.create(context.service.userInfo())
                .assertNext(profile -> assertEquals(0, profile.onboardingVersion()))
                .verifyComplete();

        user.setOnboardingVersion(2);
        StepVerifier.create(context.service.userInfo())
                .assertNext(profile -> assertEquals(2, profile.onboardingVersion()))
                .verifyComplete();
    }

    /**
     * 验证创作页导览版本随用户资料返回，空值按 0 处理。
     */
    @Test
    @DisplayName("用户资料返回创作页导览版本")
    void shouldExposeCreationTourVersion() {
        TestContext context = testContext();
        User user = normalUser(8L);
        user.setCreationTourVersion(null);
        when(context.currentUserProvider.currentUserId()).thenReturn(Mono.just(8L));
        when(context.userRepository.findById(8L)).thenReturn(Mono.just(user));

        StepVerifier.create(context.service.userInfo())
                .assertNext(profile -> assertEquals(0, profile.creationTourVersion()))
                .verifyComplete();

        user.setCreationTourVersion(1);
        StepVerifier.create(context.service.userInfo())
                .assertNext(profile -> assertEquals(1, profile.creationTourVersion()))
                .verifyComplete();
    }

    /**
     * 验证完成引导时把异常版本号规整为下限 1。
     */
    @Test
    @DisplayName("完成产品引导规整版本号")
    void shouldNormalizeOnboardingVersion() {
        TestContext context = testContext();
        when(context.currentUserProvider.currentUserId()).thenReturn(Mono.just(8L));
        when(context.userRepository.markOnboardingCompleted(8L, 1)).thenReturn(Mono.empty());

        StepVerifier.create(context.service.completeOnboarding(0)).verifyComplete();
        StepVerifier.create(context.service.completeOnboarding(-5)).verifyComplete();

        verify(context.userRepository, times(2)).markOnboardingCompleted(8L, 1);
    }

    /**
     * 验证完成创作页导览时同样把异常版本号规整为下限 1。
     */
    @Test
    @DisplayName("完成创作页导览规整版本号")
    void shouldNormalizeCreationTourVersion() {
        TestContext context = testContext();
        when(context.currentUserProvider.currentUserId()).thenReturn(Mono.just(8L));
        when(context.userRepository.markCreationTourCompleted(8L, 1)).thenReturn(Mono.empty());

        StepVerifier.create(context.service.completeCreationTour(0)).verifyComplete();
        StepVerifier.create(context.service.completeCreationTour(-3)).verifyComplete();

        verify(context.userRepository, times(2)).markCreationTourCompleted(8L, 1);
    }

    /**
     * 验证用户只能更新当前登录账号的基础资料，并返回不含密码的资料响应。
     */
    @Test
    @DisplayName("更新当前用户基础资料")
    void shouldUpdateCurrentUserProfile() {
        TestContext context = testContext();
        User user = normalUser(8L);
        user.setUsername("creator");
        user.setNickname("创作者");
        user.setAvatar("https://example.com/avatar.png");
        user.setPassword("encoded-password");
        when(context.currentUserProvider.currentUserId()).thenReturn(Mono.just(8L));
        when(context.userRepository.updateCurrentUserProfile(8L, "creator", "创作者", "https://example.com/avatar.png")).thenReturn(Mono.just(true));
        when(context.userRepository.findById(8L)).thenReturn(Mono.just(user));

        StepVerifier.create(context.service.updateCurrentUserProfile(new UserDtos.UpdateCurrentUserProfileRequest(" creator ", " 创作者 ", " https://example.com/avatar.png ")))
                .assertNext(profile -> {
                    assertTrue("creator".equals(profile.username()));
                    assertTrue("创作者".equals(profile.nickname()));
                    assertTrue("https://example.com/avatar.png".equals(profile.avatar()));
                })
                .verifyComplete();

        verify(context.userRepository).updateCurrentUserProfile(8L, "creator", "创作者", "https://example.com/avatar.png");
    }

    /**
     * 验证用户名被其他账号占用时拒绝更新。
     */
    @Test
    @DisplayName("用户名被占用时拒绝更新资料")
    void shouldRejectCurrentUserProfileWhenUsernameOccupied() {
        TestContext context = testContext();
        when(context.currentUserProvider.currentUserId()).thenReturn(Mono.just(8L));
        when(context.userRepository.updateCurrentUserProfile(8L, "creator", "", "")).thenReturn(Mono.just(false));
        when(context.userRepository.findById(8L)).thenReturn(Mono.just(normalUser(8L)));

        StepVerifier.create(context.service.updateCurrentUserProfile(new UserDtos.UpdateCurrentUserProfileRequest("creator", "", "")))
                .expectErrorMatches(error -> error instanceof BusinessException && "用户名已被占用".equals(error.getMessage()))
                .verify();

        verify(context.userRepository).findById(8L);
    }

    /**
     * 验证原密码正确且新密码符合长度要求时更新密码哈希。
     */
    @Test
    @DisplayName("原密码正确时修改当前用户密码")
    void shouldChangeCurrentUserPassword() {
        TestContext context = testContext();
        User user = normalUser(8L);
        user.setPassword("encoded-current-password");
        when(context.currentUserProvider.currentUserId()).thenReturn(Mono.just(8L));
        when(context.userRepository.findById(8L)).thenReturn(Mono.just(user));
        when(context.passwordEncoder.matches("current-password", "encoded-current-password")).thenReturn(true);
        when(context.passwordEncoder.encode("new-password")).thenReturn("encoded-new-password");
        when(context.userRepository.updateCurrentUserPassword(8L, "encoded-new-password")).thenReturn(Mono.empty());

        StepVerifier.create(context.service.changeCurrentUserPassword(new UserDtos.ChangeCurrentUserPasswordRequest("current-password", "new-password")))
                .verifyComplete();

        verify(context.userRepository).updateCurrentUserPassword(8L, "encoded-new-password");
    }

    /**
     * 验证原密码错误时不生成或写入新密码。
     */
    @Test
    @DisplayName("原密码错误时拒绝修改密码")
    void shouldRejectPasswordChangeWhenCurrentPasswordIsWrong() {
        TestContext context = testContext();
        User user = normalUser(8L);
        user.setPassword("encoded-current-password");
        when(context.currentUserProvider.currentUserId()).thenReturn(Mono.just(8L));
        when(context.userRepository.findById(8L)).thenReturn(Mono.just(user));
        when(context.passwordEncoder.matches("wrong-password", "encoded-current-password")).thenReturn(false);

        StepVerifier.create(context.service.changeCurrentUserPassword(new UserDtos.ChangeCurrentUserPasswordRequest("wrong-password", "new-password")))
                .expectErrorMatches(error -> error instanceof BusinessException && "原密码错误".equals(error.getMessage()))
                .verify();

        verify(context.passwordEncoder, never()).encode(any());
        verify(context.userRepository, never()).updateCurrentUserPassword(any(), any());
    }

    /**
     * 验证新密码不足8位时在访问用户数据前拒绝请求。
     */
    @Test
    @DisplayName("新密码不足8位时拒绝修改密码")
    void shouldRejectPasswordChangeWhenNewPasswordIsTooShort() {
        TestContext context = testContext();

        StepVerifier.create(context.service.changeCurrentUserPassword(new UserDtos.ChangeCurrentUserPasswordRequest("current-password", "short")))
                .expectErrorMatches(error -> error instanceof BusinessException && "密码至少需要8位".equals(error.getMessage()))
                .verify();

        verify(context.currentUserProvider, never()).currentUserId();
        verify(context.userRepository, never()).updateCurrentUserPassword(any(), any());
    }

    /**
     * 验证当前用户阅读欢迎引导后写入已读状态。
     */
    @Test
    @DisplayName("阅读欢迎引导后写入当前用户已读状态")
    void shouldMarkCurrentUserWelcomeAsRead() {
        TestContext context = testContext();
        when(context.currentUserProvider.currentUserId()).thenReturn(Mono.just(8L));
        when(context.userRepository.markWelcomeRead(8L)).thenReturn(Mono.empty());

        StepVerifier.create(context.service.acknowledgeWelcome()).verifyComplete();

        verify(context.userRepository).markWelcomeRead(8L);
    }

    /**
     * 验证管理员调整积分后向目标用户推送最新余额。
     */
    @Test
    @DisplayName("管理员调整积分后推送最新余额")
    void shouldPublishCreditBalanceAfterAdjustment() {
        TestContext context = testContext();
        User user = normalUser(8L);
        when(context.currentUserProvider.currentUserId()).thenReturn(Mono.just(1L));
        when(context.userRepository.findById(8L)).thenReturn(Mono.just(user));
        when(context.creditService.adjustUserCredits(8L, 1L, java.math.BigDecimal.valueOf(20), "活动补发")).thenReturn(Mono.just(new CreditDtos.CreditBalanceResponse(8L, java.math.BigDecimal.valueOf(120))));
        when(context.eventPublisher.publish(eq(8L), any(AiTaskDtos.AiTaskEvent.class))).thenReturn(Mono.empty());

        StepVerifier.create(context.service.adjustUserCredits(new CreditDtos.AdjustUserCreditsRequest(8L, java.math.BigDecimal.valueOf(20), "活动补发")))
                .assertNext(response -> assertTrue(response.creditBalance().compareTo(java.math.BigDecimal.valueOf(120)) == 0))
                .verifyComplete();

        verify(context.eventPublisher).publish(eq(8L), argThat(event -> "credit-balance".equals(event.type()) && java.math.BigDecimal.valueOf(120).compareTo(event.creditBalance()) == 0));
    }

    /**
     * 验证密码错误提示和阶梯锁定提示。
     *
     * @param failedAttempts int 连续密码错误次数
     * @param lockDuration Duration 本次触发的锁定时长
     * @param newlyLocked boolean 是否由本次错误触发锁定
     * @param expectedMessage String 预期错误提示
     */
    @ParameterizedTest
    @MethodSource("passwordLockScenarios")
    @DisplayName("密码错误按次数返回正确提示")
    void shouldReturnMessageByPasswordFailureCount(int failedAttempts, Duration lockDuration, boolean newlyLocked, String expectedMessage) {
        TestContext context = testContext();
        User user = normalUser(8L);
        user.setPassword("encoded-password");
        when(context.userRepository.findByEmail("user@example.com")).thenReturn(Mono.just(user));
        when(context.passwordLoginLockService.remainingLockDuration(8L)).thenReturn(Mono.empty());
        when(context.passwordEncoder.matches("wrong-password", "encoded-password")).thenReturn(false);
        when(context.passwordLoginLockService.recordFailure(8L))
                .thenReturn(Mono.just(new PasswordLoginLockService.PasswordFailureResult(failedAttempts, lockDuration, newlyLocked)));

        StepVerifier.create(context.service.login(new com.novanovastudio.dto.UserDtos.LoginRequest("user@example.com", "wrong-password")))
                .expectErrorMatches(error -> error instanceof BusinessException && expectedMessage.equals(error.getMessage()))
                .verify();
    }

    /**
     * 提供密码错误和锁定阶梯测试参数。
     *
     * @return Stream<Arguments> 错误次数、锁定时长、是否新锁定和错误提示
     */
    private static Stream<Arguments> passwordLockScenarios() {
        return Stream.of(
                Arguments.of(1, Duration.ZERO, false, "账号或密码错误"),
                Arguments.of(2, Duration.ZERO, false, "账号或密码错误"),
                Arguments.of(3, Duration.ZERO, false, "账号或密码错误"),
                Arguments.of(4, Duration.ZERO, false, "账号或密码错误"),
                Arguments.of(5, Duration.ofMinutes(5), true, "密码错误次数过多，请5分钟后再试"),
                Arguments.of(6, Duration.ofMinutes(10), true, "密码错误次数过多，请10分钟后再试"),
                Arguments.of(7, Duration.ofHours(2), true, "密码错误次数过多，账号已被锁定2小时")
        );
    }

    /**
     * 验证锁定期间不会执行密码校验或增加错误次数。
     */
    @Test
    @DisplayName("密码锁定期间不校验密码且不累计错误")
    void shouldRejectLockedUserBeforePasswordVerification() {
        TestContext context = testContext();
        User user = normalUser(8L);
        user.setPassword("encoded-password");
        when(context.userRepository.findByEmail("user@example.com")).thenReturn(Mono.just(user));
        when(context.passwordLoginLockService.remainingLockDuration(8L)).thenReturn(Mono.just(Duration.ofMinutes(5)));

        StepVerifier.create(context.service.login(new com.novanovastudio.dto.UserDtos.LoginRequest("user@example.com", "wrong-password")))
                .expectErrorMatches(error -> error instanceof BusinessException && "账号已锁定，请5分钟后再试".equals(error.getMessage()))
                .verify();

        verify(context.passwordEncoder, never()).matches(any(), any());
        verify(context.passwordLoginLockService, never()).recordFailure(8L);
    }

    /**
     * 验证密码正确后清空Redis中的错误次数和锁定状态。
     */
    @Test
    @DisplayName("密码正确登录后清空锁定状态")
    void shouldClearPasswordLockAfterSuccessfulLogin() {
        TestContext context = testContext();
        User user = normalUser(8L);
        user.setPassword("encoded-password");
        when(context.userRepository.findByEmail("user@example.com")).thenReturn(Mono.just(user));
        when(context.passwordLoginLockService.remainingLockDuration(8L)).thenReturn(Mono.empty());
        when(context.passwordEncoder.matches("correct-password", "encoded-password")).thenReturn(true);
        when(context.passwordLoginLockService.clear(8L)).thenReturn(Mono.empty());
        when(context.userRepository.updateLastLoginAt(8L)).thenReturn(Mono.empty());
        when(context.tokenService.sign(8L, UserService.ROLE_USER, 0)).thenReturn(new TokenService.SignedToken("token", OffsetDateTime.now().plusHours(1)));

        StepVerifier.create(context.service.login(new com.novanovastudio.dto.UserDtos.LoginRequest("user@example.com", "correct-password")))
                .expectNextCount(1)
                .verifyComplete();

        verify(context.passwordLoginLockService).clear(8L);
    }

    /**
     * 验证管理员解除密码锁定时清空Redis状态。
     */
    @Test
    @DisplayName("管理员解除密码锁定清空Redis状态")
    void shouldClearPasswordLockWhenAdminUnlocksUser() {
        TestContext context = testContext();
        when(context.currentUserProvider.currentUserId()).thenReturn(Mono.just(1L));
        when(context.userRepository.findById(8L)).thenReturn(Mono.just(normalUser(8L)));
        when(context.passwordLoginLockService.clear(8L)).thenReturn(Mono.empty());

        StepVerifier.create(context.service.unlockUserPassword(new com.novanovastudio.dto.UserDtos.UnlockUserPasswordRequest(8L)))
                .verifyComplete();

        verify(context.passwordLoginLockService).clear(8L);
    }

    /**
     * 验证管理员用户列表返回Redis中的密码锁定截止时间。
     */
    @Test
    @DisplayName("用户列表返回密码锁定截止时间")
    void shouldExposePasswordLockedUntilInUserList() {
        TestContext context = testContext();
        User user = normalUser(8L);
        OffsetDateTime lockedUntil = OffsetDateTime.now().plusMinutes(5);
        when(context.userRepository.listUsers(1, 20, null, 8L, null, null, null, null)).thenReturn(Flux.just(user));
        when(context.userRepository.countUsers(null, 8L, null, null, null, null)).thenReturn(Mono.just(1L));
        when(context.passwordLoginLockService.lockedUntilByUserIds(java.util.List.of(8L))).thenReturn(Mono.just(Map.of(8L, lockedUntil)));

        StepVerifier.create(context.service.listUsers(1, 20, null, 8L, null, null, null, null))
                .assertNext(response -> assertTrue(DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(lockedUntil).equals(response.users().getFirst().passwordLockedUntil())))
                .verifyComplete();

        verify(context.userRepository).listUsers(1, 20, null, 8L, null, null, null, null);
        verify(context.userRepository).countUsers(null, 8L, null, null, null, null);
    }

    /** 无邮箱账号按大小写敏感的用户名登录，不查询邮箱。 */
    @Test
    void shouldLoginByUsernameWithoutEmailFallback() {
        TestContext context = testContext();
        User user = normalUser(8L);
        user.setUsername("Creator"); user.setEmail(null); user.setPassword("encoded-password");
        when(context.userRepository.findByUsername("Creator")).thenReturn(Mono.just(user));
        when(context.passwordLoginLockService.remainingLockDuration(8L)).thenReturn(Mono.empty());
        when(context.passwordEncoder.matches("correct-password", "encoded-password")).thenReturn(true);
        when(context.passwordLoginLockService.clear(8L)).thenReturn(Mono.empty());
        when(context.userRepository.updateLastLoginAt(8L)).thenReturn(Mono.empty());
        when(context.tokenService.sign(8L, UserService.ROLE_USER, 0)).thenReturn(new TokenService.SignedToken("token", OffsetDateTime.now().plusHours(1)));
        StepVerifier.create(context.service.login(new UserDtos.LoginRequest(" Creator ", "correct-password")))
                .assertNext(response -> assertTrue("Creator".equals(response.user().username()) && response.user().email().isEmpty()))
                .verifyComplete();
        verify(context.userRepository, never()).findByEmail(any());
    }

    /** 用户名不存在或大小写不一致时统一拒绝，不再按邮箱查找。 */
    @Test
    void shouldNotFallbackForUnknownUsername() {
        TestContext context = testContext();
        when(context.userRepository.findByUsername("creator")).thenReturn(Mono.empty());
        StepVerifier.create(context.service.login(new UserDtos.LoginRequest("creator", "password123")))
                .expectErrorMatches(error -> error instanceof BusinessException && error.getMessage().equals("账号或密码错误")).verify();
        verify(context.userRepository, never()).findByEmail(any());
    }

    /** 管理员手工创建用户名账号不填虚拟邮箱，记录实际操作人。 */
    @Test
    void shouldCreateUsernameAccountWithExistingPlatformCreditRules() {
        TestContext context = testContext();
        when(context.currentUserProvider.currentUserId()).thenReturn(Mono.just(1L));
        when(context.userRepository.findByUsername("Creator")).thenReturn(Mono.empty());
        when(context.passwordEncoder.encode("password123")).thenReturn("encoded");
        when(context.invitationService.generateInvitationCode()).thenReturn("INVITATION01");
        when(context.userRepository.createUser(any())).thenReturn(Mono.just(8L));
        when(context.creditService.initializeAccount(8L)).thenReturn(Mono.empty());
        StepVerifier.create(context.service.adminCreateUser(new UserDtos.AdminCreateUserRequest("Creator", "password123", null, "user"))).verifyComplete();
        verify(context.userRepository).createUser(argThat(user -> user.getEmail() == null && "Creator".equals(user.getUsername())
                && user.getCreatedByUserId().equals(1L) && user.getCreatedByTeamId() == null));
        verify(context.creditService).initializeAccount(8L);
    }

    /** 平台管理员重置无邮箱账号后更新令牌版本，并清除错误锁定。 */
    @Test
    void shouldResetPasswordAccountByPlatformAdministrator() {
        TestContext context = testContext();
        when(context.currentUserProvider.currentUser()).thenReturn(Mono.just(new com.novanovastudio.security.CurrentUser(1L, "admin@example.com", "admin", 1)));
        User target = normalUser(8L); target.setEmail(null);
        when(context.userRepository.lockUser(8L)).thenReturn(Mono.just(target));
        when(context.passwordEncoder.encode("new-password")).thenReturn("new-hash");
        when(context.userRepository.updatePasswordAfterReset(8L, "new-hash")).thenReturn(Mono.empty());
        when(context.passwordLoginLockService.clear(8L)).thenReturn(Mono.empty());
        StepVerifier.create(context.service.resetUserPassword(new UserDtos.AdminResetPasswordRequest(8L, "new-password"))).verifyComplete();
        var order = org.mockito.Mockito.inOrder(context.userRepository, context.passwordLoginLockService);
        order.verify(context.userRepository).lockUser(8L);
        order.verify(context.userRepository).updatePasswordAfterReset(8L, "new-hash");
        order.verify(context.passwordLoginLockService).clear(8L);
    }

    /** 有邮箱账号仍使用邮件找回，不允许该入口越过邮箱身份校验。 */
    @Test
    void shouldRejectResetForEmailAccount() {
        TestContext context = testContext();
        User user = normalUser(8L); user.setEmail("member@example.com");
        when(context.currentUserProvider.currentUser()).thenReturn(Mono.just(new com.novanovastudio.security.CurrentUser(1L, "admin@example.com", "admin", 1)));
        when(context.userRepository.lockUser(8L)).thenReturn(Mono.just(user));
        StepVerifier.create(context.service.resetUserPassword(new UserDtos.AdminResetPasswordRequest(8L, "new-password")))
                .expectError(BusinessException.class).verify();
        verify(context.userRepository, never()).updatePasswordAfterReset(any(), any());
        verify(context.passwordLoginLockService, never()).clear(any());
    }

    /** 团队上下文即使持有全局角色也不能调用平台重置入口。 */
    @Test
    void shouldRejectPlatformPasswordResetFromTeamContext() {
        TestContext context = testContext();
        when(context.currentUserProvider.currentUser()).thenReturn(Mono.just(new com.novanovastudio.security.CurrentUser(1L, "admin@example.com", "admin", 1)));
        StepVerifier.create(context.service.resetUserPassword(new UserDtos.AdminResetPasswordRequest(8L, "new-password"))
                        .contextWrite(new com.novanovastudio.security.TeamScope(101, "administrator")::apply))
                .expectError(BusinessException.class).verify();
        verify(context.userRepository, never()).lockUser(any());
    }

    /**
     * 创建用户服务测试上下文。
     *
     * @return TestContext 测试依赖上下文
     */
    private TestContext testContext() {
        UserRepository userRepository = mock(UserRepository.class);
        PasswordEncoder passwordEncoder = mock(PasswordEncoder.class);
        TokenService tokenService = mock(TokenService.class);
        CurrentUserProvider currentUserProvider = mock(CurrentUserProvider.class);
        PasswordLoginLockService passwordLoginLockService = mock(PasswordLoginLockService.class);
        NovanovaProperties properties = new NovanovaProperties();
        properties.getApp().setFrontendBaseUrl("https://www.novanovastudio.cn");
        properties.getEmail().setFrom("noreply@novanovastudio.cn");
        JavaMailSender mailSender = mock(JavaMailSender.class);
        CreditService creditService = mock(CreditService.class);
        InvitationService invitationService = mock(InvitationService.class);
        AiTaskEventPublisher eventPublisher = mock(AiTaskEventPublisher.class);
        TransactionalOperator transactionalOperator = mock(TransactionalOperator.class);
        when(transactionalOperator.transactional(org.mockito.ArgumentMatchers.<Mono<Object>>any()))
                .thenAnswer(invocation -> invocation.getArgument(0));
        UserService service = new UserService(userRepository, passwordEncoder, tokenService, currentUserProvider, passwordLoginLockService, properties, mailSender, creditService, invitationService, eventPublisher, transactionalOperator);
        return new TestContext(service, userRepository, passwordEncoder, tokenService, currentUserProvider, passwordLoginLockService, properties, mailSender, creditService, invitationService, eventPublisher);
    }

    /**
     * 创建正常状态用户。
     *
     * @param userId Long 用户ID
     * @return User 正常用户
     */
    private User normalUser(Long userId) {
        User user = new User();
        user.setId(userId);
        user.setEmail("user@example.com");
        user.setUsername("user");
        user.setNickname("用户");
        user.setRole(UserService.ROLE_USER);
        user.setStatus(UserService.STATUS_NORMAL);
        user.setTokenVersion(0);
        return user;
    }

    /**
     * 用户服务测试依赖。
     *
     * @param service UserService 待测试服务
     * @param userRepository UserRepository 用户仓储
     * @param currentUserProvider CurrentUserProvider 当前用户提供器
     */
    private record TestContext(UserService service,
                               UserRepository userRepository,
                               PasswordEncoder passwordEncoder,
                               TokenService tokenService,
                               CurrentUserProvider currentUserProvider,
                               PasswordLoginLockService passwordLoginLockService,
                               NovanovaProperties properties,
                               JavaMailSender mailSender,
                               CreditService creditService,
                               InvitationService invitationService,
                               AiTaskEventPublisher eventPublisher) {
    }
}
