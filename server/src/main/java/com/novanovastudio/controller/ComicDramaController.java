package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.ComicDramaDtos;
import com.novanovastudio.service.ComicDramaService;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * 漫剧生产项目、视觉资产、镜头、媒体、声音与画布接口。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-21 13:00
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/comicDrama")
@RequiredArgsConstructor
public class ComicDramaController {

    /** 日志中需要脱敏的请求头。 */
    private static final Set<String> SENSITIVE_HEADERS = Set.of("authorization", "cookie", "set-cookie", "x-api-key",
            "api-key", "x-auth-token", "x-access-token", "x-refresh-token");

    /** 漫剧生产业务服务。 */
    private final ComicDramaService service;

    /** 分页查询当前用户漫剧项目。 */
    @GetMapping("/listProjects")
    public Mono<ApiResponse<ComicDramaDtos.ProjectListResponse>> listProjects(
            @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(defaultValue = "") String keyword, ServerHttpRequest httpRequest) {
        return execute("查询漫剧项目", httpRequest, Map.of("page", page, "pageSize", pageSize, "keyword", keyword),
                service.listProjects(page, pageSize, keyword));
    }

    /** 查询项目生产工作区。 */
    @PostMapping("/getWorkspace")
    public Mono<ApiResponse<ComicDramaDtos.Workspace>> getWorkspace(
            @Valid @RequestBody ComicDramaDtos.ProjectIdRequest request, ServerHttpRequest httpRequest) {
        return execute("查询漫剧工作区", httpRequest, request, service.getWorkspace(request.projectId()));
    }

    /** 初始化共享剧本的一对一漫剧项目。 */
    @PostMapping("/initializeProject")
    public Mono<ApiResponse<ComicDramaDtos.Workspace>> initializeProject(
            @Valid @RequestBody ComicDramaDtos.InitializeProjectRequest request, ServerHttpRequest httpRequest) {
        return execute("初始化漫剧项目", httpRequest, request, service.initializeProject(request));
    }

    /** 更新项目生产设置。 */
    @PostMapping("/updateSettings")
    public Mono<ApiResponse<ComicDramaDtos.MutationResult>> updateSettings(
            @Valid @RequestBody ComicDramaDtos.UpdateSettingsRequest request, ServerHttpRequest httpRequest) {
        return execute("更新漫剧生产设置", httpRequest, request, service.updateSettings(request));
    }

    /** 查询视觉资产。 */
    @PostMapping("/listAssets")
    public Mono<ApiResponse<List<ComicDramaDtos.Asset>>> listAssets(
            @Valid @RequestBody ComicDramaDtos.ListAssetsRequest request, ServerHttpRequest httpRequest) {
        return execute("查询漫剧视觉资产", httpRequest, request, service.listAssets(request));
    }

    /** 保存视觉资产。 */
    @PostMapping("/saveAsset")
    public Mono<ApiResponse<ComicDramaDtos.Asset>> saveAsset(
            @Valid @RequestBody ComicDramaDtos.SaveAssetRequest request, ServerHttpRequest httpRequest) {
        return execute("保存漫剧视觉资产", httpRequest, request, service.saveAsset(request));
    }

    /** 查询视觉资产版本。 */
    @PostMapping("/listAssetVersions")
    public Mono<ApiResponse<List<ComicDramaDtos.AssetVersion>>> listAssetVersions(
            @Valid @RequestBody ComicDramaDtos.ListAssetVersionsRequest request, ServerHttpRequest httpRequest) {
        return execute("查询漫剧资产版本", httpRequest, request, service.listAssetVersions(request));
    }

    /** 保存视觉资产版本。 */
    @PostMapping("/saveAssetVersion")
    public Mono<ApiResponse<ComicDramaDtos.AssetVersion>> saveAssetVersion(
            @Valid @RequestBody ComicDramaDtos.SaveAssetVersionRequest request, ServerHttpRequest httpRequest) {
        return execute("保存漫剧资产版本", httpRequest, request, service.saveAssetVersion(request));
    }

    /** 查询共享剧本生产准备度。 */
    @PostMapping("/getReadiness")
    public Mono<ApiResponse<ComicDramaDtos.Readiness>> getReadiness(
            @Valid @RequestBody ComicDramaDtos.ProjectIdRequest request, ServerHttpRequest httpRequest) {
        return execute("查询漫剧生产准备度", httpRequest, request, service.getReadiness(request.projectId()));
    }

    /** 生成待确认镜头草稿。 */
    @PostMapping("/generateShotDraft")
    public Mono<ApiResponse<ComicDramaDtos.ShotDraft>> generateShotDraft(
            @Valid @RequestBody ComicDramaDtos.GenerateShotDraftRequest request, ServerHttpRequest httpRequest) {
        return execute("生成漫剧镜头草稿", httpRequest, request, service.generateShotDraft(request));
    }

    /** 确认镜头草稿并追加正式镜头。 */
    @PostMapping("/confirmShotDraft")
    public Mono<ApiResponse<ComicDramaDtos.MutationResult>> confirmShotDraft(
            @Valid @RequestBody ComicDramaDtos.ConfirmShotDraftRequest request, ServerHttpRequest httpRequest) {
        return execute("确认漫剧镜头草稿", httpRequest, request, service.confirmShotDraft(request));
    }

    /** 保存编辑后的镜头草稿。 */
    @PostMapping("/updateShotDraft")
    public Mono<ApiResponse<ComicDramaDtos.ShotDraft>> updateShotDraft(
            @Valid @RequestBody ComicDramaDtos.UpdateShotDraftRequest request, ServerHttpRequest httpRequest) {
        return execute("保存漫剧镜头草稿", httpRequest, request, service.updateShotDraft(request));
    }

    /** 放弃待确认镜头草稿。 */
    @PostMapping("/discardShotDraft")
    public Mono<ApiResponse<ComicDramaDtos.MutationResult>> discardShotDraft(
            @Valid @RequestBody ComicDramaDtos.DiscardShotDraftRequest request, ServerHttpRequest httpRequest) {
        return execute("放弃漫剧镜头草稿", httpRequest, request, service.discardShotDraft(request));
    }

    /** 查询镜头清单。 */
    @PostMapping("/listShots")
    public Mono<ApiResponse<List<ComicDramaDtos.Shot>>> listShots(
            @Valid @RequestBody ComicDramaDtos.ListShotsRequest request, ServerHttpRequest httpRequest) {
        return execute("查询漫剧镜头", httpRequest, request, service.listShots(request));
    }

    /** 保存正式镜头。 */
    @PostMapping("/saveShot")
    public Mono<ApiResponse<ComicDramaDtos.Shot>> saveShot(
            @Valid @RequestBody ComicDramaDtos.SaveShotRequest request, ServerHttpRequest httpRequest) {
        return execute("保存漫剧镜头", httpRequest, request, service.saveShot(request));
    }

    /** 调整全部镜头顺序。 */
    @PostMapping("/reorderShots")
    public Mono<ApiResponse<ComicDramaDtos.MutationResult>> reorderShots(
            @Valid @RequestBody ComicDramaDtos.ReorderShotsRequest request, ServerHttpRequest httpRequest) {
        return execute("调整漫剧镜头顺序", httpRequest, request, service.reorderShots(request));
    }

    /** 删除用户已确认的镜头。 */
    @PostMapping("/deleteShot")
    public Mono<ApiResponse<ComicDramaDtos.MutationResult>> deleteShot(
            @Valid @RequestBody ComicDramaDtos.DeleteShotRequest request, ServerHttpRequest httpRequest) {
        return execute("删除漫剧镜头", httpRequest, request, service.deleteShot(request));
    }

    /** 查询删除镜头将影响的媒体结果，供用户二次确认。 */
    @PostMapping("/getShotDeleteImpact")
    public Mono<ApiResponse<ComicDramaDtos.ShotDeleteImpact>> getShotDeleteImpact(
            @Valid @RequestBody ComicDramaDtos.ShotDeleteImpactRequest request, ServerHttpRequest httpRequest) {
        return execute("查询镜头删除影响", httpRequest, request,
                service.getShotDeleteImpact(request.projectId(), request.shotId()));
    }

    /** 合成待确认镜头提示词。 */
    @PostMapping("/composePrompt")
    public Mono<ApiResponse<ComicDramaDtos.PromptVersion>> composePrompt(
            @Valid @RequestBody ComicDramaDtos.ComposePromptRequest request, ServerHttpRequest httpRequest) {
        return execute("合成漫剧镜头提示词", httpRequest, request, service.composePrompt(request));
    }

    /** 保存用户编辑后的提示词版本。 */
    @PostMapping("/savePrompt")
    public Mono<ApiResponse<ComicDramaDtos.PromptVersion>> savePrompt(
            @Valid @RequestBody ComicDramaDtos.SavePromptRequest request, ServerHttpRequest httpRequest) {
        return execute("保存漫剧镜头提示词", httpRequest, request, service.savePrompt(request));
    }

    /** 估算生成任务数量和积分。 */
    @PostMapping("/estimateGeneration")
    public Mono<ApiResponse<ComicDramaDtos.GenerationEstimate>> estimateGeneration(
            @Valid @RequestBody ComicDramaDtos.EstimateGenerationRequest request, ServerHttpRequest httpRequest) {
        return execute("估算漫剧生成费用", httpRequest, request, service.estimateGeneration(request));
    }

    /** 创建用户已确认的图片或视频生成任务。 */
    @PostMapping("/createGenerationTask")
    public Mono<ApiResponse<ComicDramaDtos.GenerationTaskResult>> createGenerationTask(
            @Valid @RequestBody ComicDramaDtos.CreateGenerationTaskRequest request, ServerHttpRequest httpRequest) {
        return execute("创建漫剧媒体任务", httpRequest, request, service.createGenerationTask(request));
    }

    /** 查询媒体任务和生成结果。 */
    @PostMapping("/listMedia")
    public Mono<ApiResponse<List<ComicDramaDtos.MediaResult>>> listMedia(
            @Valid @RequestBody ComicDramaDtos.ListMediaRequest request, ServerHttpRequest httpRequest) {
        return execute("查询漫剧媒体结果", httpRequest, request, service.listMedia(request));
    }

    /** 采用一个媒体生成版本。 */
    @PostMapping("/adoptMedia")
    public Mono<ApiResponse<ComicDramaDtos.MutationResult>> adoptMedia(
            @Valid @RequestBody ComicDramaDtos.AdoptMediaRequest request, ServerHttpRequest httpRequest) {
        return execute("采用漫剧媒体结果", httpRequest, request, service.adoptMedia(request));
    }

    /** 查询上游变化影响。 */
    @GetMapping("/listImpacts")
    public Mono<ApiResponse<List<ComicDramaDtos.ChangeImpact>>> listImpacts(
            @RequestParam String projectId, ServerHttpRequest httpRequest) {
        return execute("查询漫剧变化影响", httpRequest, projectId, service.listImpacts(projectId));
    }

    /** 确认用户选择的影响更新范围。 */
    @PostMapping("/confirmUpdate")
    public Mono<ApiResponse<ComicDramaDtos.MutationResult>> confirmUpdate(
            @Valid @RequestBody ComicDramaDtos.ConfirmUpdateRequest request, ServerHttpRequest httpRequest) {
        return execute("确认漫剧更新范围", httpRequest, request, service.confirmUpdate(request));
    }

    /** 查询P1结构化声音轨。 */
    @PostMapping("/listVoiceTracks")
    public Mono<ApiResponse<List<ComicDramaDtos.VoiceTrack>>> listVoiceTracks(
            @Valid @RequestBody ComicDramaDtos.ListVoiceTracksRequest request, ServerHttpRequest httpRequest) {
        return execute("查询漫剧声音轨", httpRequest, request, service.listVoiceTracks(request));
    }

    /** 保存P1结构化声音轨。 */
    @PostMapping("/saveVoiceTrack")
    public Mono<ApiResponse<ComicDramaDtos.VoiceTrack>> saveVoiceTrack(
            @Valid @RequestBody ComicDramaDtos.SaveVoiceTrackRequest request, ServerHttpRequest httpRequest) {
        return execute("保存漫剧声音轨", httpRequest, request, service.saveVoiceTrack(request));
    }

    /** 查询P1批量生产任务。 */
    @GetMapping("/listBatchTasks")
    public Mono<ApiResponse<List<ComicDramaDtos.BatchTask>>> listBatchTasks(
            @RequestParam String projectId, ServerHttpRequest httpRequest) {
        return execute("查询漫剧批量任务", httpRequest, projectId, service.listBatchTasks(projectId));
    }

    /** 创建用户已确认的P1批量生产计划。 */
    @PostMapping("/createBatchTask")
    public Mono<ApiResponse<ComicDramaDtos.BatchTask>> createBatchTask(
            @Valid @RequestBody ComicDramaDtos.CreateBatchTaskRequest request, ServerHttpRequest httpRequest) {
        return execute("创建漫剧批量任务", httpRequest, request, service.createBatchTask(request));
    }

    /** 查询无限画布绑定。 */
    @GetMapping("/listCanvasBindings")
    public Mono<ApiResponse<List<ComicDramaDtos.CanvasBinding>>> listCanvasBindings(
            @RequestParam String projectId, ServerHttpRequest httpRequest) {
        return execute("查询漫剧画布绑定", httpRequest, projectId, service.listCanvasBindings(projectId));
    }

    /** 创建或更新无限画布节点绑定。 */
    @PostMapping("/bindCanvas")
    public Mono<ApiResponse<ComicDramaDtos.CanvasBinding>> bindCanvas(
            @Valid @RequestBody ComicDramaDtos.BindCanvasRequest request, ServerHttpRequest httpRequest) {
        return execute("绑定漫剧画布节点", httpRequest, request, service.bindCanvas(request));
    }

    /** 检查相邻镜头视觉资产版本连续性。 */
    @PostMapping("/checkContinuity")
    public Mono<ApiResponse<List<ComicDramaDtos.ContinuityIssue>>> checkContinuity(
            @Valid @RequestBody ComicDramaDtos.ProjectIdRequest request, ServerHttpRequest httpRequest) {
        return execute("检查漫剧视觉连续性", httpRequest, request, service.checkContinuity(request.projectId()));
    }

    /**
     * 统一记录请求、脱敏请求头、请求内容与响应内容。
     *
     * @param action 接口动作名称
     * @param request 当前HTTP请求
     * @param body 请求内容
     * @param operation 业务操作
     * @return 统一成功响应
     */
    private <T> Mono<ApiResponse<T>> execute(String action, ServerHttpRequest request, Object body, Mono<T> operation) {
        log.debug("{}请求: url={}, headers={}, request={}", action, request.getURI(), sanitizedHeaders(request), body);
        return operation.map(ApiResponse::ok)
                .doOnNext(response -> log.debug("{}响应: response={}", action, response))
                .doOnError(error -> log.error("{}失败: url={}, message={}", action, request.getURI(), error.getMessage(), error));
    }

    /**
     * 对敏感请求头脱敏后用于日志。
     *
     * @param request 当前HTTP请求
     * @return 可安全记录的请求头映射
     */
    private Map<String, List<String>> sanitizedHeaders(ServerHttpRequest request) {
        Map<String, List<String>> result = new java.util.LinkedHashMap<>();
        request.getHeaders().forEach((name, values) -> result.put(name,
                SENSITIVE_HEADERS.contains(name.toLowerCase(Locale.ROOT)) ? List.of("[已脱敏]") : values));
        return result;
    }
}
