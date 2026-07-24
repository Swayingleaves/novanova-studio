package com.novanovastudio.repository;

import com.novanovastudio.entity.EmailVerificationCode;
import com.novanovastudio.entity.User;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * @title        UserRepository.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  响应式用户仓储
 * @createTime   2026-06-24 18:25:00
 */
@Repository
@RequiredArgsConstructor
public class UserRepository {

    /** 数据库客户端 */
    private final DatabaseClient databaseClient;

    /**
     * 根据用户ID查询用户
     *
     * @param id Long 用户ID
     * @return Mono<User> 用户信息
     */
    public Mono<User> findById(Long id) {
        // 按主键查询单个用户。
        return databaseClient.sql("SELECT users.*, accounts.credit_balance FROM users JOIN user_credit_accounts accounts ON accounts.user_id = users.id WHERE users.id = :id")
                .bind("id", id)
                .map((row, metadata) -> RowMappers.user(row))
                .one();
    }

    /**
     * 根据邮箱查询用户
     *
     * @param email String 邮箱
     * @return Mono<User> 用户信息
     */
    public Mono<User> findByEmail(String email) {
        // 邮箱字段有唯一索引，适合登录和注册占用校验。
        return databaseClient.sql("SELECT users.*, accounts.credit_balance FROM users JOIN user_credit_accounts accounts ON accounts.user_id = users.id WHERE users.email = :email")
                .bind("email", email)
                .map((row, metadata) -> RowMappers.user(row))
                .one();
    }

    /**
     * 根据用户名查询用户
     *
     * @param username String 用户名
     * @return Mono<User> 用户信息
     */
    public Mono<User> findByUsername(String username) {
        // 用户名字段有唯一索引，主要用于初始管理员兼容查找。
        return databaseClient.sql("SELECT users.*, accounts.credit_balance FROM users JOIN user_credit_accounts accounts ON accounts.user_id = users.id WHERE users.username = :username")
                .bind("username", username)
                .map((row, metadata) -> RowMappers.user(row))
                .one();
    }

    /**
     * 创建用户
     *
     * @param user User 用户信息
     * @return Mono<Long> 用户ID
     */
    public Mono<Long> createUser(User user) {
        // 插入用户并通过RETURNING直接取回数据库生成的主键ID。
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                INSERT INTO users(username, password, email, nickname, avatar, role, status, registered_at)
                VALUES (:username, :password, :email, :nickname, :avatar, :role, :status, :registeredAt)
                RETURNING id
                """)
                .bind("username", user.getUsername())
                .bind("password", user.getPassword())
                .bind("email", user.getEmail())
                .bind("nickname", user.getNickname());
        spec = R2dbcBindings.bindNullable(spec, "avatar", user.getAvatar(), String.class)
                .bind("role", user.getRole())
                .bind("status", user.getStatus())
                .bind("registeredAt", user.getRegisteredAt());
        return spec
                .map((row, metadata) -> row.get("id", Long.class))
                .one();
    }

    /**
     * 仅在初始管理员不存在时创建
     *
     * @param user User 管理员用户
     * @return Mono<Long> 新建管理员ID，管理员已存在时为空
     */
    public Mono<Long> createInitialAdminIfAbsent(User user) {
        // 利用唯一约束原子创建，账号已存在时绝不更新其密码、角色或状态。
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                INSERT INTO users(username, password, email, nickname, avatar, role, status, registered_at)
                VALUES (:username, :password, :email, :nickname, :avatar, :role, :status, :registeredAt)
                ON CONFLICT DO NOTHING
                RETURNING id
                """)
                .bind("username", user.getUsername())
                .bind("password", user.getPassword())
                .bind("email", user.getEmail())
                .bind("nickname", user.getNickname());
        spec = R2dbcBindings.bindNullable(spec, "avatar", user.getAvatar(), String.class)
                .bind("role", user.getRole())
                .bind("status", user.getStatus())
                .bind("registeredAt", user.getRegisteredAt());
        return spec.map((row, metadata) -> row.get("id", Long.class)).one();
    }

    /**
     * 创建邮箱验证码
     *
     * @param record EmailVerificationCode 验证码记录
     * @return Mono<Long> 验证码ID
     */
    public Mono<Long> createEmailCode(EmailVerificationCode record) {
        // 验证码只保存哈希值，明文验证码不落库。
        return databaseClient.sql("""
                INSERT INTO email_verification_codes(email, code_hash, purpose, send_count, status, expires_at)
                VALUES (:email, :codeHash, :purpose, :sendCount, :status, :expiresAt)
                RETURNING id
                """)
                .bind("email", record.getEmail())
                .bind("codeHash", record.getCodeHash())
                .bind("purpose", record.getPurpose())
                .bind("sendCount", record.getSendCount())
                .bind("status", record.getStatus())
                .bind("expiresAt", record.getExpiresAt())
                .map((row, metadata) -> row.get("id", Long.class))
                .one();
    }

    /**
     * 查询最新有效验证码
     *
     * @param email String 邮箱
     * @param purpose String 用途
     * @return Mono<EmailVerificationCode> 验证码
     */
    public Mono<EmailVerificationCode> latestValidEmailCode(String email, String purpose) {
        // 只读取未使用且未过期的最新验证码。
        return databaseClient.sql("""
                SELECT * FROM email_verification_codes
                WHERE email = :email AND purpose = :purpose AND status = 0 AND expires_at > CURRENT_TIMESTAMP
                ORDER BY id DESC
                LIMIT 1
                """)
                .bind("email", email)
                .bind("purpose", purpose)
                .map((row, metadata) -> RowMappers.emailCode(row))
                .one();
    }

    /**
     * 标记验证码已使用
     *
     * @param id Long 验证码ID
     * @return Mono<Long> 更新数量
     */
    public Mono<Long> markEmailCodeUsed(Long id) {
        // 使用状态和过期时间作为更新条件，避免重复消费验证码。
        return databaseClient.sql("""
                UPDATE email_verification_codes
                SET status = 1, used_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE id = :id AND status = 0 AND expires_at > CURRENT_TIMESTAMP
                """).bind("id", id).fetch().rowsUpdated();
    }

    /**
     * 注册用户并标记验证码已使用
     *
     * @param user User 用户信息
     * @param emailCodeId Long 验证码ID
     * @return Mono<Long> 用户ID
     */
    public Mono<Long> registerUserWithEmailCode(User user, Long emailCodeId) {
        // 事务由用户服务统一包裹，保证用户、验证码和积分账户同时成功或回滚。
        return createUser(user)
                .flatMap(userId -> markEmailCodeUsed(emailCodeId)
                        .flatMap(updated -> updated == 0 ? Mono.error(new IllegalStateException("邮箱验证码无效或已使用")) : Mono.just(userId)));
    }

    /**
     * 更新最后登录时间
     *
     * @param userId Long 用户ID
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> updateLastLoginAt(Long userId) {
        // 登录成功后刷新最后登录时间和更新时间。
        return databaseClient.sql("UPDATE users SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = :id")
                .bind("id", userId)
                .fetch()
                .rowsUpdated()
                .then();
    }

    /**
     * 标记欢迎引导已读。
     * <p>
     * 使用未读条件保证重复请求不会改写首次已读时间。
     *
     * @param userId Long 用户ID
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> markWelcomeRead(Long userId) {
        return databaseClient.sql("""
                UPDATE users
                SET welcome_read_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE id = :id AND welcome_read_at IS NULL
                """)
                .bind("id", userId)
                .fetch()
                .rowsUpdated()
                .then();
    }

    /**
     * 分页查询用户列表（支持搜索和筛选）
     */
    public Flux<User> listUsers(int page, int pageSize, String keyword, String role, Integer status, String createdAfter, String createdBefore) {
        StringBuilder sql = new StringBuilder("SELECT users.*, accounts.credit_balance FROM users JOIN user_credit_accounts accounts ON accounts.user_id = users.id WHERE 1=1");
        if (StringUtils.hasText(keyword)) sql.append(" AND (users.username ILIKE :keyword OR users.nickname ILIKE :keyword OR users.email ILIKE :keyword)");
        if (StringUtils.hasText(role)) sql.append(" AND users.role = :role");
        if (status != null) sql.append(" AND users.status = :status");
        if (StringUtils.hasText(createdAfter)) sql.append(" AND users.created_at >= :createdAfter");
        if (StringUtils.hasText(createdBefore)) sql.append(" AND users.created_at <= :createdBefore");
        sql.append(" ORDER BY users.created_at DESC OFFSET :offset LIMIT :limit");
        var spec = databaseClient.sql(sql.toString())
                .bind("offset", (page - 1) * pageSize)
                .bind("limit", pageSize);
        if (StringUtils.hasText(keyword)) spec = spec.bind("keyword", "%" + keyword.trim() + "%");
        if (StringUtils.hasText(role)) spec = spec.bind("role", role.trim());
        if (status != null) spec = spec.bind("status", status);
        if (StringUtils.hasText(createdAfter)) spec = spec.bind("createdAfter", java.time.LocalDateTime.parse(createdAfter.trim()));
        if (StringUtils.hasText(createdBefore)) spec = spec.bind("createdBefore", java.time.LocalDateTime.parse(createdBefore.trim()));
        return spec.map((row, metadata) -> RowMappers.user(row)).all();
    }

    /**
     * 查询用户总数（支持搜索和筛选）
     */
    public Mono<Long> countUsers(String keyword, String role, Integer status, String createdAfter, String createdBefore) {
        StringBuilder sql = new StringBuilder("SELECT COUNT(*) AS total FROM users WHERE 1=1");
        if (StringUtils.hasText(keyword)) sql.append(" AND (username ILIKE :keyword OR nickname ILIKE :keyword OR email ILIKE :keyword)");
        if (StringUtils.hasText(role)) sql.append(" AND role = :role");
        if (status != null) sql.append(" AND status = :status");
        if (StringUtils.hasText(createdAfter)) sql.append(" AND created_at >= :createdAfter");
        if (StringUtils.hasText(createdBefore)) sql.append(" AND created_at <= :createdBefore");
        var spec = databaseClient.sql(sql.toString());
        if (StringUtils.hasText(keyword)) spec = spec.bind("keyword", "%" + keyword.trim() + "%");
        if (StringUtils.hasText(role)) spec = spec.bind("role", role.trim());
        if (status != null) spec = spec.bind("status", status);
        if (StringUtils.hasText(createdAfter)) spec = spec.bind("createdAfter", java.time.LocalDateTime.parse(createdAfter.trim()));
        if (StringUtils.hasText(createdBefore)) spec = spec.bind("createdBefore", java.time.LocalDateTime.parse(createdBefore.trim()));
        return spec.map((row, metadata) -> row.get("total", Long.class)).one().defaultIfEmpty(0L);
    }

    /**
     * 更新用户状态
     *
     * @param userId Long 用户ID
     * @param status int 用户状态
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> updateUserStatus(Long userId, int status) {
        // 只更新状态和更新时间。
        return databaseClient.sql("UPDATE users SET status = :status, updated_at = CURRENT_TIMESTAMP WHERE id = :id")
                .bind("status", status)
                .bind("id", userId)
                .fetch()
                .rowsUpdated()
                .then();
    }

    /**
     * 更新用户角色
     *
     * @param userId Long 用户ID
     * @param role String 用户角色
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> updateUserRole(Long userId, String role) {
        // 只更新角色和更新时间。
        return databaseClient.sql("UPDATE users SET role = :role, updated_at = CURRENT_TIMESTAMP WHERE id = :id")
                .bind("role", role)
                .bind("id", userId)
                .fetch()
                .rowsUpdated()
                .then();
    }

    /**
     * 更新当前用户的基础资料。
     * <p>
     * 使用用户名唯一性条件完成原子校验，避免并发更新时产生重复用户名。
     *
     * @param userId Long 当前用户ID
     * @param username String 新用户名
     * @param nickname String 新昵称
     * @param avatar String 新头像URL
     * @return Mono<Boolean> 是否更新成功
     */
    public Mono<Boolean> updateCurrentUserProfile(Long userId, String username, String nickname, String avatar) {
        return databaseClient.sql("""
                UPDATE users
                SET username = :username,
                    nickname = :nickname,
                    avatar = :avatar,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = :userId
                  AND NOT EXISTS (SELECT 1 FROM users WHERE username = :username AND id <> :userId)
                """)
                .bind("username", username)
                .bind("nickname", nickname)
                .bind("avatar", avatar)
                .bind("userId", userId)
                .fetch()
                .rowsUpdated()
                .map(updatedRows -> updatedRows > 0);
    }

    /**
     * 更新当前用户的密码哈希。
     *
     * @param userId Long 当前用户ID
     * @param encodedPassword String 新密码哈希
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> updateCurrentUserPassword(Long userId, String encodedPassword) {
        return databaseClient.sql("UPDATE users SET password = :password, updated_at = CURRENT_TIMESTAMP WHERE id = :userId")
                .bind("password", encodedPassword)
                .bind("userId", userId)
                .fetch()
                .rowsUpdated()
                .then();
    }
}
