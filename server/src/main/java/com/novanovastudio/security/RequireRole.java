package com.novanovastudio.security;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * @title        RequireRole.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  角色权限注解，标注在Controller类或方法上，要求当前用户拥有指定角色
 * @createTime   2026-06-26 14:00:00
 */
@Target({ElementType.TYPE, ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
public @interface RequireRole {

    /**
     * 需要的角色值，如 "admin"
     *
     * @return String 角色
     */
    String value() default "admin";
}
