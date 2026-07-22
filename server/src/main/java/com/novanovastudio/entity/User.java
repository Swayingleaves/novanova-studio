package com.novanovastudio.entity;

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

    /** 可用积分 */
    private Integer creditBalance;

    /** 最后登录时间 */
    private OffsetDateTime lastLoginAt;

    /** 欢迎引导已读时间 */
    private OffsetDateTime welcomeReadAt;

    /** 注册时间 */
    private OffsetDateTime registeredAt;

    /** 创建时间 */
    private OffsetDateTime createdAt;

    /** 更新时间 */
    private OffsetDateTime updatedAt;
}
