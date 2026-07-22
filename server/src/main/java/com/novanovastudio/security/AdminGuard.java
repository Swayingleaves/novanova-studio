package com.novanovastudio.security;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;

/**
 * @title        AdminGuard.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  响应式管理员权限校验
 * @createTime   2026-06-24 18:30:00
 */
@Component
@RequiredArgsConstructor
public class AdminGuard {

    /** 当前用户提供器 */
    private final CurrentUserProvider currentUserProvider;

    /**
     * 要求当前用户是管理员
     *
     * @return Mono<CurrentUser> 当前管理员用户
     */
    public Mono<CurrentUser> requireAdmin() {
        // 从Reactor上下文读取当前用户，并校验角色为管理员。
        return currentUserProvider.currentUser().flatMap(currentUser -> {
            if (!"admin".equals(currentUser.role())) {
                return Mono.error(new BusinessException(ErrorCode.PERMISSION_DENIED, "权限不足"));
            }
            return Mono.just(currentUser);
        });
    }
}
