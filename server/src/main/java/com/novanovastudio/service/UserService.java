package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.CreditDtos;
import com.novanovastudio.dto.UserDtos;
import com.novanovastudio.entity.EmailVerificationCode;
import com.novanovastudio.entity.User;
import com.novanovastudio.repository.UserRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.PasswordLoginLockService;
import com.novanovastudio.security.TokenService;
import com.novanovastudio.task.AiTaskEventPublisher;
import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeMessage;
import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.reactive.TransactionalOperator;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * @title        UserService.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  响应式用户体系业务服务
 * @createTime   2026-06-24 18:30:00
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class UserService {

    /** 普通用户角色 */
    public static final String ROLE_USER = "user";

    /** 管理员角色 */
    public static final String ROLE_ADMIN = "admin";

    /** 正常状态 */
    public static final int STATUS_NORMAL = 1;

    /** 禁用状态 */
    public static final int STATUS_DISABLED = 0;

    /** 注册验证码用途 */
    private static final String CODE_PURPOSE_REGISTER = "register";

    /** Bearer Token类型 */
    private static final String TOKEN_TYPE_BEARER = "Bearer";

    /** 密码最小长度 */
    private static final int MIN_PASSWORD_LENGTH = 8;

    /** 邮箱验证码过期分钟数 */
    private static final int EMAIL_CODE_EXPIRE_MINUTES = 10;

    /** 安全随机数 */
    private static final SecureRandom secureRandom = new SecureRandom();

    /** 邮件品牌名称 */
    private static final String MAIL_BRAND_NAME = "Novanova Studio";

    /** 用户仓储 */
    private final UserRepository userRepository;

    /** 密码编码器 */
    private final PasswordEncoder passwordEncoder;

    /** Token服务 */
    private final TokenService tokenService;

    /** 当前用户提供器 */
    private final CurrentUserProvider currentUserProvider;

    /** 密码登录锁定服务 */
    private final PasswordLoginLockService passwordLoginLockService;

    /** 服务配置 */
    private final NovanovaProperties properties;

    /** 邮件发送器 */
    private final JavaMailSender mailSender;

    /** 积分服务 */
    private final CreditService creditService;

    /** 用户实时事件发布器 */
    private final AiTaskEventPublisher eventPublisher;

    /** 响应式事务操作器 */
    private final TransactionalOperator transactionalOperator;

    /**
     * 初始化管理员账号
     */
    @EventListener(ApplicationReadyEvent.class)
    public void ensureInitialAdmin() {
        // 应用完全启动并完成Flyway迁移后，再执行管理员初始化。
        String initialEmail = properties.getAdmin().getInitialEmail();
        String initialPassword = properties.getAdmin().getInitialPassword();
        if (!StringUtils.hasText(initialEmail) || !StringUtils.hasText(initialPassword)) {
            log.warn("未配置初始管理员邮箱或密码，跳过初始管理员创建");
            return;
        }
        String email = normalizeEmail(initialEmail);
        validatePassword(initialPassword);
        // 初始化逻辑只允许原子创建，不会在后续启动时覆盖既有账号。
        Mono.defer(() -> {
                    User user = new User();
                    user.setUsername(email);
                    user.setPassword(passwordEncoder.encode(initialPassword));
                    user.setEmail(email);
                    user.setNickname(firstNonEmpty(properties.getAdmin().getInitialNickname(), emailName(email)));
                    user.setRole(ROLE_ADMIN);
                    user.setStatus(STATUS_NORMAL);
                    user.setRegisteredAt(OffsetDateTime.now(ZoneOffset.UTC));
                    return userRepository.createInitialAdminIfAbsent(user)
                            .flatMap(userId -> creditService.initializeAccount(userId).thenReturn(true))
                            .defaultIfEmpty(false)
                            .as(transactionalOperator::transactional);
                })
                .doOnSuccess(created -> log.info("初始管理员初始化完成: email={}, created={}", email, created))
                .doOnError(exception -> log.error("初始化管理员账号失败: email={}", email, exception))
                .subscribeOn(Schedulers.boundedElastic())
                .subscribe(
                        ignored -> {
                        },
                        exception -> log.error("管理员初始化订阅执行失败: email={}", email, exception)
                );
    }

    /**
     * 发送邮箱验证码
     *
     * @param request SendEmailCodeRequest 请求
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> sendEmailCode(UserDtos.SendEmailCodeRequest request) {
        // 标准化并校验邮箱，避免同一邮箱大小写重复注册。
        String email = normalizeEmail(request.email());
        log.info("发送邮箱验证码: email={}, purpose={}", email, CODE_PURPOSE_REGISTER);
        return userRepository.findByEmail(email)
                .flatMap(existing -> Mono.<Void>error(new BusinessException(ErrorCode.BUSINESS_ERROR, "邮箱已注册")))
                .switchIfEmpty(Mono.defer(() -> {
                    String code = randomNumericCode();
                    return encodePassword(code)
                            .flatMap(codeHash -> {
                                EmailVerificationCode record = new EmailVerificationCode();
                                record.setEmail(email);
                                record.setCodeHash(codeHash);
                                record.setPurpose(CODE_PURPOSE_REGISTER);
                                record.setSendCount(1);
                                record.setStatus(0);
                                record.setExpiresAt(OffsetDateTime.now(ZoneOffset.UTC).plusMinutes(EMAIL_CODE_EXPIRE_MINUTES));
                                return userRepository.createEmailCode(record)
                                        .flatMap(codeId -> sendEmailVerificationCode(email, code)
                                                .onErrorResume(exception -> userRepository.markEmailCodeUsed(codeId)
                                                        .then(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "发送验证码失败: " + exception.getMessage())))));
                            });
                }))
                .then();
    }

    /**
     * 使用邮箱验证码注册
     *
     * @param request RegisterRequest 注册请求
     * @return Mono<AuthResponse> 登录响应
     */
    public Mono<UserDtos.AuthResponse> register(UserDtos.RegisterRequest request) {
        // 注册前统一校验邮箱、密码和邮箱占用状态。
        String email = normalizeEmail(request.email());
        log.info("用户注册: email={}", email);
        validatePassword(request.password());
        return userRepository.findByEmail(email)
                .flatMap(existing -> Mono.<UserDtos.AuthResponse>error(new BusinessException(ErrorCode.BUSINESS_ERROR, "邮箱已注册")))
                .switchIfEmpty(userRepository.latestValidEmailCode(email, CODE_PURPOSE_REGISTER)
                        .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "邮箱验证码无效或已过期")))
                        .flatMap(codeRecord -> matchesPassword(request.code().trim(), codeRecord.getCodeHash())
                                .flatMap(matches -> {
                                    if (!matches) {
                                        return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "邮箱验证码无效或已过期"));
                                    }
                                    return encodePassword(request.password())
                                            .flatMap(passwordHash -> {
                                                User user = new User();
                                                user.setUsername(email);
                                                user.setPassword(passwordHash);
                                                user.setEmail(email);
                                                user.setNickname(firstNonEmpty(request.nickname(), emailName(email)));
                                                user.setRole(ROLE_USER);
                                                user.setStatus(STATUS_NORMAL);
                                                user.setRegisteredAt(OffsetDateTime.now(ZoneOffset.UTC));
                                                return userRepository.registerUserWithEmailCode(user, codeRecord.getId())
                                                        .flatMap(userId -> creditService.initializeAccount(userId).thenReturn(userId))
                                                        .as(transactionalOperator::transactional)
                                                        .map(userId -> {
                                                            user.setId(userId);
                                                            user.setCreatedAt(OffsetDateTime.now(ZoneOffset.UTC));
                                                            return buildAuthResponse(user);
                                                        });
                                            });
                                })));
    }

    /**
     * 邮箱密码登录
     *
     * @param request LoginRequest 登录请求
     * @return Mono<AuthResponse> 登录响应
     */
    public Mono<UserDtos.AuthResponse> login(UserDtos.LoginRequest request) {
        // 按标准化邮箱查找用户，并统一返回账号密码错误以避免枚举邮箱。
        String email = normalizeEmail(request.email());
        log.info("用户登录: email={}", email);
        return userRepository.findByEmail(email)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.AUTH_ERROR, "邮箱或密码错误")))
                .flatMap(user -> passwordLoginLockService.remainingLockDuration(user.getId())
                        .flatMap(duration -> Mono.<UserDtos.AuthResponse>error(passwordLockException(duration)))
                        .switchIfEmpty(matchesPassword(request.password(), user.getPassword()).flatMap(matches -> {
                    if (!matches) {
                            return passwordLoginLockService.recordFailure(user.getId())
                                    .flatMap(lockState -> Mono.<UserDtos.AuthResponse>error(passwordFailureException(lockState)));
                    }
                    return passwordLoginLockService.clear(user.getId()).then(completeLogin(user));
                        })));
    }

    /**
     * 使用本地用户ID完成登录。
     *
     * @param userId Long 本地用户ID
     * @return Mono<AuthResponse> 登录响应
     */
    public Mono<UserDtos.AuthResponse> loginByUserId(Long userId) {
        return userRepository.findById(userId)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.AUTH_ERROR, "用户不存在")))
                .flatMap(this::completeLogin);
    }

    /**
     * 查询当前用户信息
     *
     * @return Mono<UserProfile> 用户信息
     */
    public Mono<UserDtos.UserProfile> userInfo() {
        // 从请求上下文读取当前用户ID，再查询数据库中的最新用户资料。
        return currentUserProvider.currentUserId()
                .flatMap(userRepository::findById)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.AUTH_ERROR, "用户不存在")))
                .map(this::userProfile);
    }

    /**
     * 更新当前用户的基础资料。
     *
     * @param request UpdateCurrentUserProfileRequest 用户资料请求
     * @return Mono<UserProfile> 更新后的用户资料
     */
    public Mono<UserDtos.UserProfile> updateCurrentUserProfile(UserDtos.UpdateCurrentUserProfileRequest request) {
        String username = request.username().trim();
        String nickname = request.nickname() == null ? "" : request.nickname().trim();
        String avatar = request.avatar() == null ? "" : request.avatar().trim();
        return currentUserProvider.currentUserId()
                .flatMap(userId -> userRepository.updateCurrentUserProfile(userId, username, nickname, avatar)
                        .flatMap(updated -> {
                            if (!updated) {
                                return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "用户名已被占用"));
                            }
                            return userRepository.findById(userId)
                                    .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.AUTH_ERROR, "用户不存在")))
                                    .map(this::userProfile);
                        })
                        .doOnSuccess(profile -> log.info("用户资料已更新: userId={}", userId)))
                .onErrorMap(DataIntegrityViolationException.class, exception -> new BusinessException(ErrorCode.BUSINESS_ERROR, "用户名已被占用"));
    }

    /**
     * 修改当前用户密码。
     * <p>
     * 写入新密码前必须验证原密码，密码编码在弹性线程池中执行。
     *
     * @param request ChangeCurrentUserPasswordRequest 修改密码请求
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> changeCurrentUserPassword(UserDtos.ChangeCurrentUserPasswordRequest request) {
        validatePassword(request.newPassword());
        return currentUserProvider.currentUserId()
                .flatMap(userId -> userRepository.findById(userId)
                        .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.AUTH_ERROR, "用户不存在")))
                        .flatMap(user -> matchesPassword(request.currentPassword(), user.getPassword())
                                .flatMap(matches -> {
                                    if (!matches) {
                                        return Mono.error(new BusinessException(ErrorCode.AUTH_ERROR, "原密码错误"));
                                    }
                                    return encodePassword(request.newPassword())
                                            .flatMap(encodedPassword -> userRepository.updateCurrentUserPassword(userId, encodedPassword));
                                }))
                        .doOnSuccess(ignored -> log.info("用户密码已修改: userId={}", userId)));
    }

    /**
     * 标记当前用户已阅读欢迎引导。
     *
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> acknowledgeWelcome() {
        return currentUserProvider.currentUserId()
                .flatMap(userId -> userRepository.markWelcomeRead(userId)
                        .doOnSuccess(ignored -> log.info("用户已阅读欢迎引导: userId={}", userId)));
    }

    /**
     * 查询用户列表（支持搜索和筛选）
     *
     * @param page int 页码
     * @param pageSize int 每页数量
     * @param keyword String 搜索关键字
     * @param role String 角色筛选
     * @param status Integer 状态筛选
     * @param createdAfter String 创建时间起始
     * @param createdBefore String 创建时间截止
     * @return Mono<UserListResponse> 用户列表
     */
    public Mono<UserDtos.UserListResponse> listUsers(int page, int pageSize, String keyword, String role, Integer status, String createdAfter, String createdBefore) {
        int normalizedPage = Math.max(1, page);
        int normalizedPageSize = Math.min(100, Math.max(1, pageSize <= 0 ? 20 : pageSize));
        return userRepository.listUsers(normalizedPage, normalizedPageSize, keyword, role, status, createdAfter, createdBefore)
                .collectList()
                .flatMap(users -> passwordLoginLockService.lockedUntilByUserIds(users.stream().map(User::getId).toList())
                        .map(passwordLockedUntilByUserId -> users.stream()
                                .map(user -> userProfile(user, passwordLockedUntilByUserId.get(user.getId())))
                                .toList()))
                .zipWith(userRepository.countUsers(keyword, role, status, createdAfter, createdBefore))
                .map(tuple -> new UserDtos.UserListResponse(tuple.getT1(), tuple.getT2()));
    }

    /**
     * 更新用户状态
     *
     * @param request UpdateUserStatusRequest 请求
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> updateUserStatus(UserDtos.UpdateUserStatusRequest request) {
        // 仅允许更新为正常或禁用两种状态。
        if (request.status() != STATUS_NORMAL && request.status() != STATUS_DISABLED) {
            return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "用户状态不合法"));
        }
        return Mono.zip(currentUserProvider.currentUserId(), userRepository.findById(request.userId()).switchIfEmpty(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "用户不存在"))))
                .flatMap(tuple -> {
                    Long currentUserId = tuple.getT1();
                    User user = tuple.getT2();
                    if (currentUserId.equals(user.getId()) && request.status() == STATUS_DISABLED) {
                        return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "不能禁用当前登录管理员"));
                    }
                    return userRepository.updateUserStatus(request.userId(), request.status());
                });
    }

    /**
     * 更新用户角色
     *
     * @param request UpdateUserRoleRequest 请求
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> updateUserRole(UserDtos.UpdateUserRoleRequest request) {
        // 角色只允许在普通用户和管理员之间切换。
        if (!ROLE_USER.equals(request.role()) && !ROLE_ADMIN.equals(request.role())) {
            return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "用户角色不合法"));
        }
        return Mono.zip(currentUserProvider.currentUserId(), userRepository.findById(request.userId()).switchIfEmpty(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "用户不存在"))))
                .flatMap(tuple -> {
                    Long currentUserId = tuple.getT1();
                    User user = tuple.getT2();
                    if (currentUserId.equals(user.getId()) && !ROLE_ADMIN.equals(request.role())) {
                        return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "不能移除当前登录管理员角色"));
                    }
                    return userRepository.updateUserRole(request.userId(), request.role());
                });
    }

    /**
     * 管理员新增用户
     *
     * @param request AdminCreateUserRequest 请求
     * @return Mono<Void>
     */
    public Mono<Void> adminCreateUser(UserDtos.AdminCreateUserRequest request) {
        String email = normalizeEmail(request.email());
        return userRepository.findByEmail(email)
                .flatMap(existing -> Mono.<Void>error(new BusinessException(ErrorCode.BUSINESS_ERROR, "邮箱已注册")))
                .switchIfEmpty(encodePassword(request.password())
                        .flatMap(passwordHash -> {
                            User user = new User();
                            user.setUsername(email);
                            user.setPassword(passwordHash);
                            user.setEmail(email);
                            user.setNickname(firstNonEmpty(request.nickname(), emailName(email)));
                            user.setRole(ROLE_ADMIN.equals(request.role()) ? ROLE_ADMIN : ROLE_USER);
                            user.setStatus(STATUS_NORMAL);
                            user.setRegisteredAt(java.time.OffsetDateTime.now());
                            return userRepository.createUser(user)
                                    .flatMap(userId -> creditService.initializeAccount(userId))
                                    .as(transactionalOperator::transactional);
                        }));
    }

    /**
     * 管理员增减用户积分。
     *
     * @param request AdjustUserCreditsRequest 积分调整请求
     * @return Mono<CreditBalanceResponse> 调整后的积分余额
     */
    public Mono<CreditDtos.CreditBalanceResponse> adjustUserCredits(CreditDtos.AdjustUserCreditsRequest request) {
        return Mono.zip(currentUserProvider.currentUserId(), userRepository.findById(request.userId())
                        .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "用户不存在"))))
                .flatMap(tuple -> creditService.adjustUserCredits(request.userId(), tuple.getT1(), request.changeAmount(), request.reason()))
                // 调整提交完成后向目标用户推送新余额，避免侧栏继续展示旧积分。
                .flatMap(response -> eventPublisher.publish(response.userId(), new AiTaskDtos.AiTaskEvent("credit-balance", null, null, response.creditBalance()))
                        .thenReturn(response));
    }

    /**
     * 管理员解除用户密码锁定。
     *
     * @param request UnlockUserPasswordRequest 解锁请求
     * @return Mono<Void> 操作完成信号
     */
    public Mono<Void> unlockUserPassword(UserDtos.UnlockUserPasswordRequest request) {
        return Mono.zip(currentUserProvider.currentUserId(), userRepository.findById(request.userId())
                        .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "用户不存在"))))
                .flatMap(tuple -> passwordLoginLockService.clear(tuple.getT2().getId())
                        .doOnSuccess(ignored -> log.info("管理员解除用户密码锁定: adminUserId={}, userId={}", tuple.getT1(), tuple.getT2().getId())));
    }

    /**
     * 构建登录响应
     *
     * @param user User 用户信息
     * @return AuthResponse 登录响应
     */
    private UserDtos.AuthResponse buildAuthResponse(User user) {
        // 使用当前用户ID和角色签发令牌，再拼装前端依赖的登录响应结构。
        TokenService.SignedToken signedToken = tokenService.sign(user.getId(), user.getRole());
        return new UserDtos.AuthResponse(signedToken.token(), TOKEN_TYPE_BEARER, formatTime(signedToken.expiresAt()), userProfile(user));
    }

    /**
     * 校验用户状态、刷新最后登录时间并签发登录响应。
     *
     * @param user User 本地用户
     * @return Mono<AuthResponse> 登录响应
     */
    private Mono<UserDtos.AuthResponse> completeLogin(User user) {
        if (user.getStatus() == null || user.getStatus() != STATUS_NORMAL) {
            return Mono.error(new BusinessException(ErrorCode.AUTH_ERROR, "账号已被禁用"));
        }
        OffsetDateTime loginTime = OffsetDateTime.now(ZoneOffset.UTC);
        return userRepository.updateLastLoginAt(user.getId()).then(Mono.fromSupplier(() -> {
            user.setLastLoginAt(loginTime);
            return buildAuthResponse(user);
        }));
    }

    /**
     * 转换用户公开资料
     *
     * @param user User 用户信息
     * @return UserProfile 用户公开资料
     */
    private UserDtos.UserProfile userProfile(User user) {
        return userProfile(user, null);
    }

    /**
     * 转换包含密码锁定状态的管理员用户资料。
     *
     * @param user User 用户信息
     * @param passwordLockedUntil OffsetDateTime 密码锁定截止时间
     * @return UserProfile 用户公开资料
     */
    private UserDtos.UserProfile userProfile(User user, OffsetDateTime passwordLockedUntil) {
        // 只返回前端需要的公开字段，密码哈希等敏感字段不进入响应。
        return new UserDtos.UserProfile(
                user.getId(),
                nullToEmpty(user.getEmail()),
                nullToEmpty(user.getUsername()),
                firstNonEmpty(user.getNickname(), user.getUsername()),
                nullToEmpty(user.getAvatar()),
                nullToEmpty(user.getRole()),
                user.getStatus(),
                user.getCreditBalance(),
                formatTime(user.getCreatedAt()),
                formatTime(user.getLastLoginAt()),
                user.getWelcomeReadAt() != null,
                passwordLockedUntil == null ? null : formatTime(passwordLockedUntil)
        );
    }

    /**
     * 构建锁定期间的登录异常。
     *
     * @param remainingLockDuration Duration 锁定剩余时长
     * @return BusinessException 登录锁定异常
     */
    private BusinessException passwordLockException(java.time.Duration remainingLockDuration) {
        long remainingMinutes = Math.max(1, (remainingLockDuration.toSeconds() + 59) / 60);
        return new BusinessException(ErrorCode.AUTH_ERROR, "账号已锁定，请" + remainingMinutes + "分钟后再试");
    }

    /**
     * 根据密码错误次数构建登录异常。
     *
     * @param lockState PasswordFailureResult 原子更新后的锁定状态
     * @return BusinessException 密码错误或锁定异常
     */
    private BusinessException passwordFailureException(PasswordLoginLockService.PasswordFailureResult lockState) {
        if (!lockState.newlyLocked() && !lockState.lockDuration().isZero()) {
            return passwordLockException(lockState.lockDuration());
        }
        return switch (lockState.failedAttempts()) {
            case 5 -> new BusinessException(ErrorCode.AUTH_ERROR, "密码错误次数过多，请5分钟后再试");
            case 6 -> new BusinessException(ErrorCode.AUTH_ERROR, "密码错误次数过多，请10分钟后再试");
            default -> lockState.failedAttempts() >= 7
                    ? new BusinessException(ErrorCode.AUTH_ERROR, "密码错误次数过多，账号已被锁定2小时")
                    : new BusinessException(ErrorCode.AUTH_ERROR, "邮箱或密码错误");
        };
    }

    /**
     * 标准化邮箱
     *
     * @param value String 邮箱
     * @return String 标准化邮箱
     */
    private String normalizeEmail(String value) {
        // 统一小写并校验基础邮箱格式。
        String email = value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
        if (!StringUtils.hasText(email) || !email.matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "邮箱格式不正确");
        }
        return email;
    }

    /**
     * 校验密码强度
     *
     * @param password String 密码
     */
    private void validatePassword(String password) {
        // 通过码点数量判断长度，避免多字节字符被错误计算。
        if (password == null || password.codePointCount(0, password.length()) < MIN_PASSWORD_LENGTH) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "密码至少需要" + MIN_PASSWORD_LENGTH + "位");
        }
    }

    /**
     * 生成6位数字验证码
     *
     * @return String 验证码
     */
    private String randomNumericCode() {
        // 使用安全随机数生成固定6位数字验证码。
        int value = secureRandom.nextInt(1_000_000);
        return "%06d".formatted(value);
    }

    /**
     * 发送邮箱验证码
     *
     * @param email String 收件邮箱
     * @param code String 验证码
     * @return Mono<Void> 发送结果
     */
    private Mono<Void> sendEmailVerificationCode(String email, String code) {
        // 邮件发送属于阻塞IO，放入boundedElastic执行。
        return Mono.fromRunnable(() -> {
            if (!StringUtils.hasText(properties.getEmail().getFrom())) {
                throw new IllegalStateException("邮箱服务未配置，无法发送验证码");
            }
            try {
                // 组装邮件主题和正文，并通过JavaMail发送验证码。
                MimeMessage message = mailSender.createMimeMessage();
                MimeMessageHelper helper = new MimeMessageHelper(message, false, "UTF-8");
                helper.setFrom(properties.getEmail().getFrom());
                helper.setTo(email);
                helper.setSubject(MAIL_BRAND_NAME + " 登录验证码");
                helper.setText(buildVerificationEmailHtml(code), true);
                mailSender.send(message);
            } catch (MessagingException exception) {
                log.error("发送邮箱验证码失败，邮箱={}", email, exception);
                throw new BusinessException(ErrorCode.SYSTEM_ERROR, "发送邮箱验证码失败");
            }
        }).subscribeOn(Schedulers.boundedElastic()).then();
    }

    /**
     * 构建验证码邮件HTML内容
     *
     * @param code String 验证码
     * @return String HTML邮件正文
     */
    private String buildVerificationEmailHtml(String code) {
        // 生成接近设计稿的验证码邮件模板，使用表格和内联样式提升邮箱客户端兼容性。
        return """
                <!DOCTYPE html>
                <html lang="zh-CN">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>%s 登录验证码</title>
                </head>
                <body style="margin:0;padding:0;background-color:#f5f7fb;font-family:'PingFang SC','Microsoft YaHei',Arial,sans-serif;color:#2f3a4a;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%%" style="background-color:#f5f7fb;margin:0;padding:0;width:100%%;">
                        <tr>
                            <td align="center" style="padding:40px 16px;">
                                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%%" style="max-width:960px;background-color:#f3f5f8;border-radius:12px;overflow:hidden;">
                                    <tr>
                                        <td align="center" style="padding:28px 24px 20px;font-size:18px;font-weight:700;color:#223046;">
                                            %s 登录验证码
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding:0 22px 28px;">
                                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%%" style="background-color:#ffffff;border-radius:12px;">
                                                <tr>
                                                    <td style="padding:34px 22px 18px;font-size:15px;line-height:1.9;color:#314056;">
                                                        <div style="margin-bottom:8px;">您好！</div>
                                                        <div>您正在登录 %s 服务，您的验证码是：</div>
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td align="center" style="padding:0 22px 18px;">
                                                        <div style="display:inline-block;padding:16px 30px;border:2px dashed #2f80ff;border-radius:12px;color:#1677ff;font-size:30px;font-weight:700;letter-spacing:10px;line-height:1;">
                                                            %s
                                                        </div>
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td style="padding:0 22px 34px;font-size:14px;line-height:1.9;color:#314056;">
                                                        <div style="font-weight:700;margin-bottom:2px;">注意事项：</div>
                                                        <div>• 验证码有效期为 %d 分钟</div>
                                                        <div>• 请勿将验证码告诉他人</div>
                                                        <div>• 如果您没有进行此操作，请忽略此邮件</div>
                                                    </td>
                                                </tr>
                                            </table>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td align="center" style="padding:0 24px 40px;font-size:12px;line-height:1.8;color:#8a94a6;">
                                            <div>此邮件由系统自动发送，请勿回复</div>
                                            <div>如有疑问，请联系平台支持</div>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>
                </body>
                </html>
                """.formatted(MAIL_BRAND_NAME, MAIL_BRAND_NAME, MAIL_BRAND_NAME, code, EMAIL_CODE_EXPIRE_MINUTES);
    }

    /**
     * 编码密码
     *
     * @param rawPassword String 原始密码
     * @return Mono<String> 哈希密码
     */
    private Mono<String> encodePassword(String rawPassword) {
        // BCrypt属于CPU密集阻塞操作，放入boundedElastic执行。
        return Mono.fromCallable(() -> passwordEncoder.encode(rawPassword)).subscribeOn(Schedulers.boundedElastic());
    }

    /**
     * 匹配密码
     *
     * @param rawPassword String 原始密码
     * @param encodedPassword String 哈希密码
     * @return Mono<Boolean> 是否匹配
     */
    private Mono<Boolean> matchesPassword(String rawPassword, String encodedPassword) {
        // BCrypt匹配同样放入boundedElastic执行。
        return Mono.fromCallable(() -> passwordEncoder.matches(rawPassword, encodedPassword)).subscribeOn(Schedulers.boundedElastic());
    }

    /**
     * 获取邮箱名前缀
     *
     * @param email String 邮箱
     * @return String 邮箱名前缀
     */
    private String emailName(String email) {
        // 取邮箱@之前的部分作为默认昵称候选。
        int index = email.indexOf('@');
        return index <= 0 ? email : email.substring(0, index);
    }

    /**
     * 返回第一个非空字符串
     *
     * @param values String[] 候选值
     * @return String 第一个非空值
     */
    private String firstNonEmpty(String... values) {
        // 依次寻找第一个有实际文本的候选值。
        for (String value : values) {
            if (StringUtils.hasText(value)) {
                return value.trim();
            }
        }
        return "";
    }

    /**
     * 空值转空字符串
     *
     * @param value String 原始值
     * @return String 处理后的值
     */
    private String nullToEmpty(String value) {
        // 对外响应统一使用空字符串，避免前端处理null分支。
        return value == null ? "" : value;
    }

    /**
     * 格式化时间
     *
     * @param value OffsetDateTime 时间
     * @return String RFC3339时间
     */
    private String formatTime(OffsetDateTime value) {
        // 对外接口时间统一使用ISO偏移时间字符串。
        return value == null ? "" : value.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME);
    }
}
