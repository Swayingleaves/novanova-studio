package com.novanovastudio.entity;

import java.time.OffsetDateTime;
import lombok.Data;

/**
 * 第三方用户身份绑定实体
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-15 00:00
 */
@Data
public class UserIdentityBinding {

    /** 绑定记录ID */
    private Long id;

    /** 本地用户ID */
    private Long userId;

    /** 第三方认证渠道 */
    private String provider;

    /** 第三方平台用户唯一标识 */
    private String providerUserId;

    /** 第三方平台邮箱 */
    private String providerEmail;

    /** 第三方平台昵称 */
    private String providerNickname;

    /** 第三方平台头像地址 */
    private String providerAvatar;

    /** 创建时间 */
    private OffsetDateTime createdAt;

    /** 更新时间 */
    private OffsetDateTime updatedAt;
}
