package com.novanovastudio.entity;

import com.alibaba.fastjson2.annotation.JSONField;
import com.novanovastudio.common.CreditAmountWriter;
import java.math.BigDecimal;

import java.time.OffsetDateTime;
import lombok.Data;

/**
 * @title        User.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  用户实体
 * @createTime   2026-06-24 10:50:00
 */
@Data
public class User {

    /** 主键ID */
    private Long id;

    /** 用户名 */
    private String username;

    /** 密码哈希 */
    private String password;

    /** 邮箱 */
    private String email;

    /** 昵称 */
    private String nickname;

    /** 头像URL */
    private String avatar;

    /** 用户角色 */
    private String role;

    /** 状态 */
    private Integer status;

    /** 登录令牌版本 */
    private Integer tokenVersion;

    /** 可用积分 */
    @JSONField(serializeUsing = CreditAmountWriter.class)
    private BigDecimal creditBalance;

    /** 首次创建账号的团队，平台创建或历史账号为空。 */
    private Long createdByTeamId;

    /** 首次创建账号的管理员，公开注册或历史账号为空。 */
    private Long createdByUserId;

    /** 用户唯一邀请码 */
    private String invitationCode;

    /** 邀请人用户ID */
    private Long invitedByUserId;

    /** 最后登录时间 */
    private OffsetDateTime lastLoginAt;

    /** 欢迎引导已读时间 */
    private OffsetDateTime welcomeReadAt;

    /** 已完成的产品引导版本，0 表示尚未完成 */
    private Integer onboardingVersion;

    /** 注册时间 */
    private OffsetDateTime registeredAt;

    /** 创建时间 */
    private OffsetDateTime createdAt;

    /** 更新时间 */
    private OffsetDateTime updatedAt;
}
