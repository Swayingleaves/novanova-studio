package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.NotificationDtos;
import com.novanovastudio.security.AdminGuard;
import com.novanovastudio.security.RequireRole;
import com.novanovastudio.service.NotificationService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * @title        NotificationController.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  系统公告接口
 * @createTime   2026-06-26 10:00:00
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class NotificationController {

    private final NotificationService notificationService;
    private final AdminGuard adminGuard;

    /**
     * 管理员：查询所有公告
     *
     * @return Mono<ApiResponse<NotificationListResponse>> 公告列表
     */
    @GetMapping("/admin/notification/list")
    @RequireRole("admin")
    public Mono<ApiResponse<NotificationDtos.NotificationListResponse>> listAllNotifications() {
        return adminGuard.requireAdmin()
                .then(notificationService.listAllNotifications())
                .map(list -> ApiResponse.ok(new NotificationDtos.NotificationListResponse(list)));
    }

    /**
     * 管理员：创建公告
     *
     * @param request CreateNotificationRequest 创建请求
     * @return Mono<ApiResponse<String>> 响应
     */
    @PostMapping("/admin/notification/create")
    @RequireRole("admin")
    public Mono<ApiResponse<String>> createNotification(@Valid @RequestBody NotificationDtos.CreateNotificationRequest request) {
        return adminGuard.requireAdmin()
                .then(notificationService.createNotification(request))
                .thenReturn(ApiResponse.ok("ok"));
    }

    /**
     * 管理员：更新公告
     *
     * @param request UpdateNotificationRequest 请求
     * @return Mono<ApiResponse<String>> 响应
     */
    @PostMapping("/admin/notification/update")
    @RequireRole("admin")
    public Mono<ApiResponse<String>> updateNotification(@Valid @RequestBody NotificationDtos.UpdateNotificationRequest request) {
        return adminGuard.requireAdmin()
                .then(notificationService.updateNotification(request.id(), request.title(), request.content()))
                .thenReturn(ApiResponse.ok("ok"));
    }

    /**
     * 管理员：发布公告
     *
     * @param id Long 公告ID
     * @return Mono<ApiResponse<String>> 响应
     */
    @PostMapping("/admin/notification/publish")
    @RequireRole("admin")
    public Mono<ApiResponse<String>> publishNotification(@RequestParam Long id) {
        return adminGuard.requireAdmin()
                .then(notificationService.publishNotification(id))
                .thenReturn(ApiResponse.ok("ok"));
    }

    /**
     * 用户：查询我的公告
     *
     * @return Mono<ApiResponse<NotificationListResponse>> 公告列表
     */
    @GetMapping("/notification/list")
    public Mono<ApiResponse<NotificationDtos.NotificationListResponse>> listMyNotifications() {
        return notificationService.listUserNotifications()
                .map(list -> ApiResponse.ok(new NotificationDtos.NotificationListResponse(list)));
    }

    /**
     * 用户：标记公告已读
     *
     * @param request ReadNotificationRequest 请求
     * @return Mono<ApiResponse<String>> 响应
     */
    @PostMapping("/notification/read")
    public Mono<ApiResponse<String>> markAsRead(@Valid @RequestBody NotificationDtos.ReadNotificationRequest request) {
        return notificationService.markAsRead(request).thenReturn(ApiResponse.ok("ok"));
    }

    /**
     * 用户：标记全部已发布公告已读。
     *
     * @return Mono<ApiResponse<String>> 响应
     */
    @PostMapping("/notification/markAllRead")
    public Mono<ApiResponse<String>> markAllAsRead() {
        return notificationService.markAllAsRead().thenReturn(ApiResponse.ok("ok"));
    }
}
