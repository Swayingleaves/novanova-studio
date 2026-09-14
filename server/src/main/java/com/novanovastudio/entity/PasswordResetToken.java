package com.novanovastudio.entity;

import java.time.OffsetDateTime;
import lombok.Data;

/**
 * @title        PasswordResetToken.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  密码重置令牌实体
 * @createTime   2026-09-11 00:00:00
 */
@Data
public class PasswordResetToken {

    /** 用户ID */
    private Long userId;

    /** 重置令牌哈希 */
    private String tokenHash;

    /** 过期时间 */
    private OffsetDateTime expiresAt;

    /** 使用时间 */
    private OffsetDateTime usedAt;

    /** 创建时间 */
    private OffsetDateTime createdAt;

    /** 更新时间 */
    private OffsetDateTime updatedAt;
}
