package com.novanovastudio.security;

/**
 * @title        CurrentUser.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  当前登录用户
 * @createTime   2026-06-24 11:08:00
 */
public record CurrentUser(Long id, String email, String role, Integer status) {
}
