package com.novanovastudio.service;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.dto.NotificationDtos;
import com.novanovastudio.entity.NotificationRecords;
import com.novanovastudio.repository.NotificationRepository;
import com.novanovastudio.security.CurrentUserProvider;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

/**
 * NotificationService 单元测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-24 11:19:00
 */
class NotificationServiceTest {

    private NotificationRepository repository;
    private CurrentUserProvider currentUserProvider;
    private NotificationService service;

    @BeforeEach
    void setUp() {
        repository = mock(NotificationRepository.class);
        currentUserProvider = mock(CurrentUserProvider.class);
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(1L));
        when(repository.createNotification(any())).thenReturn(Mono.just(10L));
        when(repository.updateNotification(any(), any(), any(), any(), any(), any(), any())).thenReturn(Mono.empty());
        service = new NotificationService(repository, currentUserProvider);
    }

    @Test
    void createNotificationRejectsWhenTitleContentAndImageAreAllEmpty() {
        assertThatThrownBy(() -> service.createNotification(new NotificationDtos.CreateNotificationRequest("  ", " ", "normal", "")))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("至少填写一项");
    }

    @Test
    void createNotificationAllowsImageOnlyAnnouncement() {
        StepVerifier.create(service.createNotification(
                        new NotificationDtos.CreateNotificationRequest("", "", "normal", "https://cdn.example.com/poster.png")))
                .verifyComplete();

        verify(repository).createNotification(org.mockito.ArgumentMatchers.argThat((NotificationRecords.SystemNotificationRecord record) ->
                "".equals(record.getTitle())
                        && "".equals(record.getContent())
                        && "https://cdn.example.com/poster.png".equals(record.getImageUrl())));
    }

    @Test
    void createNotificationAllowsContentOnlyAnnouncement() {
        StepVerifier.create(service.createNotification(
                        new NotificationDtos.CreateNotificationRequest(null, "系统维护通知", "normal", null)))
                .verifyComplete();

        verify(repository).createNotification(org.mockito.ArgumentMatchers.argThat((NotificationRecords.SystemNotificationRecord record) ->
                "".equals(record.getTitle())
                        && "系统维护通知".equals(record.getContent())
                        && record.getImageUrl() == null));
    }

    @Test
    void updateNotificationRejectsWhenAllThreeFieldsEmpty() {
        assertThatThrownBy(() -> service.updateNotification(1L, "", "   ", null))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("至少填写一项");
    }

    @Test
    void createNotificationRejectsExternalTargetPath() {
        assertThatThrownBy(() -> service.createNotification(new NotificationDtos.CreateNotificationRequest(
                "新模型上线", "欢迎体验", "normal", null, "去试一试", "https://evil.example.com", "ch-1::gpt-image")))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("站内相对路径");
    }
}
