package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.GenerationStyleDtos;
import com.novanovastudio.security.AdminGuard;
import com.novanovastudio.security.RequireRole;
import com.novanovastudio.service.GenerationStyleService;
import jakarta.validation.Valid;
import java.time.Duration;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * 图片和视频生成风格接口。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-31 00:00
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class GenerationStyleController {

    /** 风格服务。 */
    private final GenerationStyleService generationStyleService;
    /** 管理员权限校验。 */
    private final AdminGuard adminGuard;

    /**
     * 查询用户侧启用风格。
     *
     * @param generationType 生成类型
     * @return 用户侧风格列表
     */
    @GetMapping("/style/listStyles")
    public Mono<ApiResponse<GenerationStyleDtos.StyleOptionListResponse>> listStyles(
            @RequestParam String generationType) {
        return generationStyleService.listUserStyles(generationType).map(ApiResponse::ok);
    }

    /**
     * 查询管理端风格。
     *
     * @param keyword 关键词
     * @param generationType 生成类型
     * @param status 状态
     * @param page 页码
     * @param pageSize 每页数量
     * @return 管理端风格列表
     */
    @GetMapping("/admin/style/listStyles")
    @RequireRole("admin")
    public Mono<ApiResponse<GenerationStyleDtos.StyleListResponse>> listAdminStyles(
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) String generationType,
            @RequestParam(required = false) Integer status,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize) {
        return adminGuard.requireAdmin()
                .then(generationStyleService.listAdminStyles(new GenerationStyleDtos.StyleListRequest(keyword, generationType, status, page, pageSize)))
                .map(ApiResponse::ok);
    }

    /** 创建风格。 */
    @PostMapping("/admin/style/createStyle")
    @RequireRole("admin")
    public Mono<ApiResponse<String>> createStyle(@Valid @RequestBody GenerationStyleDtos.CreateStyleRequest request) {
        return adminGuard.requireAdmin().then(generationStyleService.createStyle(request)).thenReturn(ApiResponse.ok("ok"));
    }

    /** 更新风格。 */
    @PostMapping("/admin/style/updateStyle")
    @RequireRole("admin")
    public Mono<ApiResponse<String>> updateStyle(@Valid @RequestBody GenerationStyleDtos.UpdateStyleRequest request) {
        return adminGuard.requireAdmin().then(generationStyleService.updateStyle(request)).thenReturn(ApiResponse.ok("ok"));
    }

    /**
     * 查询已启用风格的原图访问地址。
     * @param styleId 风格标识
     * @return 原图访问地址
     */
    @GetMapping("/style/getCoverPreview")
    public Mono<ApiResponse<String>> getCoverPreview(@RequestParam long styleId) {
        return generationStyleService.readCoverPreview(styleId, true).map(ApiResponse::ok);
    }

    /**
     * 查询管理端风格的原图访问地址。
     * @param styleId 风格标识
     * @return 原图访问地址
     */
    @GetMapping("/admin/style/getCoverPreview")
    @RequireRole("admin")
    public Mono<ApiResponse<String>> getAdminCoverPreview(@RequestParam long styleId) {
        return adminGuard.requireAdmin().then(Mono.defer(() -> generationStyleService.readCoverPreview(styleId, false)))
                .map(ApiResponse::ok);
    }

    /**
     * 读取已启用风格的缩略图。
     * @param styleId 风格标识
     * @param version 缩略图缓存版本
     * @return WebP 图片响应
     */
    @GetMapping("/style/getCoverThumbnail")
    public Mono<ResponseEntity<byte[]>> getCoverThumbnail(@RequestParam long styleId, @RequestParam String version) {
        return thumbnailResponse(styleId, version, true);
    }

    /**
     * 读取管理端风格缩略图，包括停用风格。
     * @param styleId 风格标识
     * @param version 缩略图缓存版本
     * @return WebP 图片响应
     */
    @GetMapping("/admin/style/getCoverThumbnail")
    @RequireRole("admin")
    public Mono<ResponseEntity<byte[]>> getAdminCoverThumbnail(@RequestParam long styleId, @RequestParam String version) {
        return adminGuard.requireAdmin().then(Mono.defer(() -> thumbnailResponse(styleId, version, false)));
    }

    /**
     * 读取系统对象存储中的封面供后台压缩。
     * @param styleId 风格标识
     * @param coverRevision 开始压缩时的封面版本
     * @return 封面字节，外链由浏览器读取
     */
    @GetMapping("/admin/style/readCoverForCompression")
    @RequireRole("admin")
    public Mono<ResponseEntity<byte[]>> readCoverForCompression(@RequestParam long styleId, @RequestParam String coverRevision) {
        return adminGuard.requireAdmin().then(Mono.defer(() -> generationStyleService.readCoverForCompression(styleId, coverRevision)))
                .map(image -> ResponseEntity.ok().cacheControl(CacheControl.noStore())
                        .header(HttpHeaders.CONTENT_DISPOSITION, "attachment")
                        .contentType(MediaType.parseMediaType(image.mimeType())).body(image.data()))
                .defaultIfEmpty(ResponseEntity.noContent().build());
    }

    /**
     * 保存压缩后的封面和缩略图。
     * @param request 替换请求
     * @return 操作结果
     */
    @PostMapping("/admin/style/replaceCover")
    @RequireRole("admin")
    public Mono<ApiResponse<String>> replaceCover(@Valid @RequestBody GenerationStyleDtos.ReplaceCoverRequest request) {
        return adminGuard.requireAdmin().then(Mono.defer(() -> generationStyleService.replaceCover(request))).thenReturn(ApiResponse.ok("ok"));
    }

    /**
     * 组装带浏览器缓存策略的缩略图响应，按会话和团队隔离。
     * @param styleId 风格标识
     * @param version 缓存版本
     * @param userOnly 是否只读取启用风格
     * @return 缩略图响应
     */
    private Mono<ResponseEntity<byte[]>> thumbnailResponse(long styleId, String version, boolean userOnly) {
        return generationStyleService.readThumbnail(styleId, version, userOnly)
                .map(bytes -> ResponseEntity.ok()
                        .cacheControl(CacheControl.maxAge(Duration.ofDays(7)).cachePrivate().immutable())
                        .varyBy(HttpHeaders.AUTHORIZATION, HttpHeaders.COOKIE, "X-Team-Id")
                        .contentType(MediaType.parseMediaType("image/webp"))
                        .body(bytes))
                .defaultIfEmpty(ResponseEntity.notFound().build());
    }

    /** 更新风格启用状态。 */
    @PostMapping("/admin/style/updateStyleStatus")
    @RequireRole("admin")
    public Mono<ApiResponse<String>> updateStyleStatus(@Valid @RequestBody GenerationStyleDtos.UpdateStyleStatusRequest request) {
        return adminGuard.requireAdmin().then(generationStyleService.updateStyleStatus(request)).thenReturn(ApiResponse.ok("ok"));
    }

    /** 批量软删除风格。 */
    @PostMapping("/admin/style/deleteStyles")
    @RequireRole("admin")
    public Mono<ApiResponse<String>> deleteStyles(@Valid @RequestBody GenerationStyleDtos.DeleteStylesRequest request) {
        return adminGuard.requireAdmin().then(generationStyleService.deleteStyles(request)).thenReturn(ApiResponse.ok("ok"));
    }
}
