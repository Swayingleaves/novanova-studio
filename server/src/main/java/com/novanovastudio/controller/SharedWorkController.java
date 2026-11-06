package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.SharedWorkDtos;
import com.novanovastudio.security.RequireRole;
import com.novanovastudio.service.SharedWorkCopyService;
import com.novanovastudio.service.SharedWorkService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.http.CacheControl;
import org.springframework.http.server.reactive.ServerHttpResponse;
import reactor.core.publisher.Mono;

/**
 * 用户作品投稿、审核、公开查看及独立画布复制接口。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-06 10:00
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class SharedWorkController {
    /** 作品业务。 */
    private final SharedWorkService service;
    /** 画布独立复制。 */
    private final SharedWorkCopyService copyService;

    /** @param request 分享来源及选项 @return 实际公开内容预览 */
    @PostMapping("/sharedWork/previewWork")
    public Mono<ApiResponse<SharedWorkDtos.PreviewResult>> preview(@Valid @RequestBody SharedWorkDtos.SubmitRequest request) { return service.preview(request).map(ApiResponse::ok); }

    /** @param request 分享来源及表单 @return 待审核投稿 */
    @PostMapping("/sharedWork/submitWork")
    public Mono<ApiResponse<SharedWorkDtos.WorkItem>> submit(@Valid @RequestBody SharedWorkDtos.SubmitRequest request) { return service.submit(request).map(ApiResponse::ok); }

    /** @param page 页码 @param status 状态 @return 本人投稿列表 */
    @GetMapping("/sharedWork/listMyWorks")
    public Mono<ApiResponse<SharedWorkDtos.WorkPage>> mine(@RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "") String status) { return service.list(false, status, page).map(ApiResponse::ok); }

    /** @param shareCode 分享标识 @return 作者或审核者获准查看的投稿 */
    @GetMapping("/sharedWork/getWorkDetail")
    public Mono<ApiResponse<SharedWorkDtos.WorkDetail>> detail(@RequestParam String shareCode) { return service.detail(shareCode).map(ApiResponse::ok); }

    /** @param shareCode 分享标识 @param response 禁止缓存临时授权的响应 @return 访客可见的作品详情 */
    @GetMapping("/sharedWork/getPublicWork")
    public Mono<ApiResponse<SharedWorkDtos.WorkDetail>> publicDetail(@RequestParam String shareCode, ServerHttpResponse response) { response.getHeaders().setCacheControl(CacheControl.noStore()); return service.publicDetail(shareCode).map(ApiResponse::ok); }

    /** @param shareCode 作品标识 @param assetId 作品内媒体标识 @param response 禁止缓存临时授权的响应 @return 五分钟媒体地址 */
    @GetMapping("/sharedWork/getMediaAccess")
    public Mono<ApiResponse<SharedWorkDtos.MediaAccess>> access(@RequestParam String shareCode, @RequestParam String assetId, ServerHttpResponse response) { response.getHeaders().setCacheControl(CacheControl.noStore()); return service.publicMedia(shareCode, assetId).map(ApiResponse::ok); }

    /** @param request 本人投稿标识 @return 撤回结果 */
    @PostMapping("/sharedWork/withdrawWork")
    public Mono<ApiResponse<String>> withdraw(@Valid @RequestBody SharedWorkDtos.WorkRequest request) { return service.withdraw(request.shareCode()).thenReturn(ApiResponse.ok("ok")); }

    /** @param request 已公开画布标识 @return 独立个人画布 */
    @PostMapping("/sharedWork/copyCanvas")
    public Mono<ApiResponse<SharedWorkDtos.CopyResult>> copy(@Valid @RequestBody SharedWorkDtos.WorkRequest request) { return copyService.copy(request.shareCode()).map(ApiResponse::ok); }

    /** @param page 页码 @param status 状态 @return 当前空间审核队列 */
    @GetMapping("/admin/sharedWork/listReviews")
    @RequireRole("admin")
    public Mono<ApiResponse<SharedWorkDtos.WorkPage>> reviews(@RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "pending") String status) { return service.list(true, status, page).map(ApiResponse::ok); }

    /** @param request 审核动作及原因 @return 审核结果 */
    @PostMapping({"/admin/sharedWork/reviewWork", "/admin/sharedWork/takeDownWork"})
    @RequireRole("admin")
    public Mono<ApiResponse<String>> review(@Valid @RequestBody SharedWorkDtos.ReviewRequest request) { return service.review(request).thenReturn(ApiResponse.ok("ok")); }

    /** @param workType 媒体类型 @param category 分类 @param keyword 关键词 @param page 页码 @param response 禁止缓存临时授权的响应 @return 首页混合作品 */
    @GetMapping("/homepage/listFantasticWorks")
    public Mono<ApiResponse<SharedWorkDtos.FantasticPage>> fantastic(@RequestParam(defaultValue = "") String workType,
            @RequestParam(defaultValue = "") String category, @RequestParam(defaultValue = "") String keyword, @RequestParam(defaultValue = "1") int page, ServerHttpResponse response) {
        response.getHeaders().setCacheControl(CacheControl.noStore());
        return service.fantastic(workType, category, keyword, page).map(ApiResponse::ok);
    }

    /** @param request 首页内容标识 @return 切换后的点赞状态与总数 */
    @PostMapping("/homepage/toggleFantasticLike")
    public Mono<ApiResponse<SharedWorkDtos.LikeResult>> toggleFantasticLike(@Valid @RequestBody SharedWorkDtos.LikeRequest request) {
        return service.toggleFantasticLike(request.targetKey()).map(ApiResponse::ok);
    }
}
