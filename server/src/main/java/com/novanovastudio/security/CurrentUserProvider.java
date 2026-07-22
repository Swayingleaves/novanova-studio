package com.novanovastudio.security;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;

/**
 * @title        CurrentUserProvider.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  响应式当前登录用户提供器
 * @createTime   2026-06-24 18:20:00
 */
@Component
public class CurrentUserProvider {

    /** Reactor上下文中的当前用户键 */
    public static final String CURRENT_USER_CONTEXT_KEY = CurrentUser.class.getName();

    /**
     * 获取当前登录用户
     *
     * @return Mono<CurrentUser> 当前登录用户
     */
    public Mono<CurrentUser> currentUser() {
        // 从Reactor上下文读取认证过滤器写入的当前用户。
        return Mono.deferContextual(contextView -> {
            if (!contextView.hasKey(CURRENT_USER_CONTEXT_KEY)) {
                return Mono.error(new BusinessException(ErrorCode.TOKEN_INVALID, "请先登录"));
            }
            return Mono.just(contextView.get(CURRENT_USER_CONTEXT_KEY));
        });
    }

    /**
     * 获取当前登录用户ID
     *
     * @return Mono<Long> 当前登录用户ID
     */
    public Mono<Long> currentUserId() {
        // 复用当前用户读取逻辑后提取用户ID。
        return currentUser().map(CurrentUser::id);
    }

    /**
     * 获取可选当前登录用户
     *
     * @return Mono<CurrentUser> 可选当前登录用户
     */
    public Mono<CurrentUser> optionalCurrentUser() {
        // 用于少量可选登录场景，未认证时返回空Mono。
        return Mono.deferContextual(contextView -> contextView.hasKey(CURRENT_USER_CONTEXT_KEY) ? Mono.just(contextView.get(CURRENT_USER_CONTEXT_KEY)) : Mono.empty());
    }
}
