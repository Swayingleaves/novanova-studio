package com.novanovastudio.service;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.novanovastudio.repository.NotificationRepository;
import com.novanovastudio.security.CurrentUserProvider;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

/**
 * 系统公告服务测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-19 16:10
 */
class NotificationServiceTest {

    /** 公告仓储 */
    private NotificationRepository notificationRepository;

    /** 当前用户提供器 */
    private CurrentUserProvider currentUserProvider;

    /** 待测试公告服务 */
    private NotificationService notificationService;

    /**
     * 初始化测试依赖。
     */
    @BeforeEach
    void setUp() {
        notificationRepository = mock(NotificationRepository.class);
        currentUserProvider = mock(CurrentUserProvider.class);
        notificationService = new NotificationService(notificationRepository, currentUserProvider);
    }

    /**
     * 批量已读应仅使用当前用户ID。
     */
    @Test
    void shouldMarkAllPublishedNotificationsReadForCurrentUser() {
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(8L));
        when(notificationRepository.markAllAsRead(8L)).thenReturn(Mono.empty());

        StepVerifier.create(notificationService.markAllAsRead()).verifyComplete();

        verify(notificationRepository).markAllAsRead(8L);
    }
}
