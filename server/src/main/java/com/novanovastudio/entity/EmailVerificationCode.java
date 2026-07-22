package com.novanovastudio.entity;

import java.time.OffsetDateTime;
import lombok.Data;

/**
 * @title        EmailVerificationCode.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  邮箱验证码实体
 * @createTime   2026-06-24 10:50:00
 */
@Data
public class EmailVerificationCode {

    /** 主键ID */
    private Long id;

    /** 邮箱 */
    private String email;

    /** 验证码哈希 */
    private String codeHash;

    /** 验证码用途 */
    private String purpose;

    /** 发送次数 */
    private Integer sendCount;

    /** 状态 */
    private Integer status;

    /** 过期时间 */
    private OffsetDateTime expiresAt;

    /** 使用时间 */
    private OffsetDateTime usedAt;

    /** 创建时间 */
    private OffsetDateTime createdAt;

    /** 更新时间 */
    private OffsetDateTime updatedAt;
}
