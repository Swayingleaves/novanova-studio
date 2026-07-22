package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.CreditDtos;
import com.novanovastudio.dto.UserDtos;
import com.novanovastudio.entity.User;
import com.novanovastudio.repository.UserRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.PasswordLoginLockService;
import com.novanovastudio.security.TokenService;
import com.novanovastudio.task.AiTaskEventPublisher;
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
import java.util.Map;
import java.util.stream.Stream;

/**
 * 用户服务欢迎引导测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-16 00:00
 */
class UserServiceTest {

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

        StepVerifier.create(context.service.updateCurrentUserProfile(new UserDtos.UpdateCurrentUserProfileRequest("creator", "", "")))
                .expectErrorMatches(error -> error instanceof BusinessException && "用户名已被占用".equals(error.getMessage()))
                .verify();

        verify(context.userRepository, never()).findById(8L);
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
        when(context.creditService.adjustUserCredits(8L, 1L, 20, "活动补发")).thenReturn(Mono.just(new CreditDtos.CreditBalanceResponse(8L, 120)));
        when(context.eventPublisher.publish(eq(8L), any(AiTaskDtos.AiTaskEvent.class))).thenReturn(Mono.empty());

        StepVerifier.create(context.service.adjustUserCredits(new CreditDtos.AdjustUserCreditsRequest(8L, 20, "活动补发")))
                .assertNext(response -> assertTrue(response.creditBalance() == 120))
                .verifyComplete();

        verify(context.eventPublisher).publish(eq(8L), argThat(event -> "credit-balance".equals(event.type()) && Integer.valueOf(120).equals(event.creditBalance())));
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
                Arguments.of(1, Duration.ZERO, false, "邮箱或密码错误"),
                Arguments.of(2, Duration.ZERO, false, "邮箱或密码错误"),
                Arguments.of(3, Duration.ZERO, false, "邮箱或密码错误"),
                Arguments.of(4, Duration.ZERO, false, "邮箱或密码错误"),
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
        when(context.tokenService.sign(8L, UserService.ROLE_USER)).thenReturn(new TokenService.SignedToken("token", OffsetDateTime.now().plusHours(1)));

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
        when(context.userRepository.listUsers(1, 20, null, null, null, null, null)).thenReturn(Flux.just(user));
        when(context.userRepository.countUsers(null, null, null, null, null)).thenReturn(Mono.just(1L));
        when(context.passwordLoginLockService.lockedUntilByUserIds(java.util.List.of(8L))).thenReturn(Mono.just(Map.of(8L, lockedUntil)));

        StepVerifier.create(context.service.listUsers(1, 20, null, null, null, null, null))
                .assertNext(response -> assertTrue(lockedUntil.toString().equals(response.users().getFirst().passwordLockedUntil())))
                .verifyComplete();
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
        NovanovaProperties properties = mock(NovanovaProperties.class);
        JavaMailSender mailSender = mock(JavaMailSender.class);
        CreditService creditService = mock(CreditService.class);
        AiTaskEventPublisher eventPublisher = mock(AiTaskEventPublisher.class);
        TransactionalOperator transactionalOperator = mock(TransactionalOperator.class);
        UserService service = new UserService(userRepository, passwordEncoder, tokenService, currentUserProvider, passwordLoginLockService, properties, mailSender, creditService, eventPublisher, transactionalOperator);
        return new TestContext(service, userRepository, passwordEncoder, tokenService, currentUserProvider, passwordLoginLockService, creditService, eventPublisher);
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
                               CreditService creditService,
                               AiTaskEventPublisher eventPublisher) {
    }
}
