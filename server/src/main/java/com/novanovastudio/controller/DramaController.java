package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.DramaDtos;
import com.novanovastudio.service.DramaMediaService;
import com.novanovastudio.service.DramaWorkspaceService;
import jakarta.validation.Valid;
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
 * 智能短剧项目和工作台接口。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-14 00:40
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/drama")
@RequiredArgsConstructor
public class DramaController {

    /** 需要脱敏的请求头。 */
    private static final Set<String> SENSITIVE_HEADERS = Set.of("authorization", "cookie", "x-api-key");

    /** 工作台服务。 */
    private final DramaWorkspaceService dramaWorkspaceService;

    /** 图片和视频生成。 */
    private final DramaMediaService dramaMediaService;

    /**
     * 保存创意并创建项目，同时排队制作方案。
     *
     * @param request 创建请求
     * @param httpRequest 当前HTTP请求
     * @return 工作台
     */
    @PostMapping("/createProject")
    public Mono<ApiResponse<DramaDtos.WorkspaceResponse>> createProject(@Valid @RequestBody DramaDtos.CreateProjectRequest request, ServerHttpRequest httpRequest) {
        log.info("创建短剧项目: url={}, headers={}, body={}", httpRequest.getURI(), headers(httpRequest), request);
        return dramaWorkspaceService.createProject(request).map(ApiResponse::ok)
                .doOnNext(response -> log.info("创建短剧项目响应: {}", response));
    }

    /**
     * 分页查询当前用户的短剧项目。
     *
     * @param page 页码
     * @param pageSize 每页数量
     * @param httpRequest 当前HTTP请求
     * @return 项目页
     */
    @GetMapping("/listProjects")
    public Mono<ApiResponse<DramaDtos.ProjectListResponse>> listProjects(@RequestParam(defaultValue = "1") int page,
                                                                        @RequestParam(defaultValue = "20") int pageSize,
                                                                        ServerHttpRequest httpRequest) {
        log.debug("查询短剧项目: url={}, headers={}, page={}, pageSize={}", httpRequest.getURI(), headers(httpRequest), page, pageSize);
        return dramaWorkspaceService.listProjects(page, pageSize).map(ApiResponse::ok)
                .doOnNext(response -> log.debug("查询短剧项目响应: {}", response));
    }

    /**
     * 读取工作台当前进度。
     *
     * @param projectId 项目ID
     * @param httpRequest 当前HTTP请求
     * @return 工作台
     */
    @GetMapping("/getWorkspace")
    public Mono<ApiResponse<DramaDtos.WorkspaceResponse>> getWorkspace(@RequestParam String projectId, ServerHttpRequest httpRequest) {
        log.debug("读取短剧工作台: url={}, headers={}, projectId={}", httpRequest.getURI(), headers(httpRequest), projectId);
        return dramaWorkspaceService.getWorkspace(projectId).map(ApiResponse::ok)
                .doOnNext(response -> log.debug("读取短剧工作台响应: projectId={}", projectId));
    }

    /**
     * 修改项目名称、文本模型或目标时长。
     *
     * @param request 修改请求
     * @param httpRequest 当前HTTP请求
     * @return 工作台
     */
    @PostMapping("/updateProject")
    public Mono<ApiResponse<DramaDtos.WorkspaceResponse>> updateProject(@Valid @RequestBody DramaDtos.UpdateProjectRequest request, ServerHttpRequest httpRequest) {
        log.debug("修改短剧项目: url={}, headers={}, body={}", httpRequest.getURI(), headers(httpRequest), request);
        return dramaWorkspaceService.updateProject(request).map(ApiResponse::ok)
                .doOnNext(response -> log.debug("修改短剧项目响应: projectId={}", request.projectId()));
    }

    /**
     * 手动保存分镜表的行内编辑、时长调整、排序与删除。
     *
     * @param request 分镜保存请求
     * @param httpRequest 当前HTTP请求
     * @return 更新后的工作台
     */
    @PostMapping("/updateShots")
    public Mono<ApiResponse<DramaDtos.WorkspaceResponse>> updateShots(@Valid @RequestBody DramaDtos.UpdateShotsRequest request, ServerHttpRequest httpRequest) {
        log.info("保存短剧分镜编辑: url={}, headers={}, projectId={}, versionId={}, count={}",
                httpRequest.getURI(), headers(httpRequest), request.projectId(), request.versionId(), request.shots().size());
        return dramaWorkspaceService.updateShots(request).map(ApiResponse::ok)
                .doOnNext(response -> log.info("保存短剧分镜编辑响应: projectId={}, revision={}",
                        request.projectId(), response.data() == null ? null : response.data().project().revision()));
    }

    /**
     * 确认当前阶段版本。确认本身不扣费，下一阶段生成另行计费。
     *
     * @param request 确认请求
     * @param httpRequest 当前HTTP请求
     * @return 工作台
     */
    @PostMapping("/confirmStage")
    public Mono<ApiResponse<DramaDtos.WorkspaceResponse>> confirmStage(@Valid @RequestBody DramaDtos.ConfirmStageRequest request, ServerHttpRequest httpRequest) {
        log.debug("确认短剧阶段: url={}, headers={}, body={}", httpRequest.getURI(), headers(httpRequest), request);
        return dramaWorkspaceService.confirmStage(request).map(ApiResponse::ok)
                .doOnNext(response -> log.debug("确认短剧阶段响应: projectId={}", request.projectId()));
    }

    /**
     * 发送工作台对话，并进入现有主Agent队列。
     *
     * @param request 对话请求
     * @param httpRequest 当前HTTP请求
     * @return 工作台
     */
    @PostMapping("/sendMessage")
    public Mono<ApiResponse<DramaDtos.WorkspaceResponse>> sendMessage(@Valid @RequestBody DramaDtos.SendMessageRequest request, ServerHttpRequest httpRequest) {
        log.debug("发送短剧对话: url={}, headers={}, body={}", httpRequest.getURI(), headers(httpRequest), request);
        return dramaWorkspaceService.sendMessage(request).map(ApiResponse::ok)
                .doOnNext(response -> log.debug("发送短剧对话响应: projectId={}", request.projectId()));
    }

    /**
     * 按阶段产物提交真实的图片或视频任务。确认文本阶段不会触发这里。
     *
     * @param request 生成请求
     * @param httpRequest 当前HTTP请求
     * @return 带有新任务的工作台
     */
    @PostMapping("/generateMedia")
    public Mono<ApiResponse<DramaDtos.WorkspaceResponse>> generateMedia(@Valid @RequestBody DramaDtos.GenerateMediaRequest request, ServerHttpRequest httpRequest) {
        log.debug("生成短剧媒体: url={}, headers={}, body={}", httpRequest.getURI(), headers(httpRequest), request);
        return dramaMediaService.generate(request).then(dramaWorkspaceService.getWorkspace(request.projectId())).map(ApiResponse::ok)
                .doOnNext(response -> log.debug("生成短剧媒体响应: projectId={}, target={}", request.projectId(), request.targetKey()));
    }

    /**
     * 手动从指定镜头的已成功视频重新截取尾帧，作为下一镜的首帧参考图。
     *
     * @param request 截帧请求
     * @param httpRequest 当前HTTP请求
     * @return 更新后的工作台
     */
    @PostMapping("/extractLastFrame")
    public Mono<ApiResponse<DramaDtos.WorkspaceResponse>> extractLastFrame(@Valid @RequestBody DramaDtos.ExtractLastFrameRequest request, ServerHttpRequest httpRequest) {
        log.debug("重新截取短剧镜头尾帧: url={}, headers={}, projectId={}, shotRef={}",
                httpRequest.getURI(), headers(httpRequest), request.projectId(), request.shotRef());
        return dramaMediaService.extractLastFrame(request.projectId(), request.shotRef())
                .then(dramaWorkspaceService.getWorkspace(request.projectId()))
                .map(ApiResponse::ok)
                .doOnNext(response -> log.debug("重新截取短剧镜头尾帧响应: projectId={}, shotRef={}", request.projectId(), request.shotRef()));
    }

    /**
     * 重做指定阶段的产物，直接按生成请求入队，不走对话意图判断。
     *
     * @param request 重做请求
     * @param httpRequest 当前HTTP请求
     * @return 工作台
     */
    @PostMapping("/regenerateStage")
    public Mono<ApiResponse<DramaDtos.WorkspaceResponse>> regenerateStage(@Valid @RequestBody DramaDtos.RegenerateStageRequest request, ServerHttpRequest httpRequest) {
        log.debug("重做短剧阶段: url={}, headers={}, body={}", httpRequest.getURI(), headers(httpRequest), request);
        return dramaWorkspaceService.regenerateStage(request).map(ApiResponse::ok)
                .doOnNext(response -> log.debug("重做短剧阶段响应: projectId={}, stage={}", request.projectId(), request.stage()));
    }

    /**
     * 撤销最近一次生成的阶段版本，连同这一版的图片和视频一起删除。
     *
     * @param request 撤销请求
     * @param httpRequest 当前HTTP请求
     * @return 工作台
     */
    @PostMapping("/discardVersion")
    public Mono<ApiResponse<DramaDtos.WorkspaceResponse>> discardVersion(@Valid @RequestBody DramaDtos.DiscardVersionRequest request, ServerHttpRequest httpRequest) {
        log.debug("撤销短剧版本: url={}, headers={}, body={}", httpRequest.getURI(), headers(httpRequest), request);
        return dramaWorkspaceService.discardVersion(request).map(ApiResponse::ok)
                .doOnNext(response -> log.debug("撤销短剧版本响应: projectId={}, versionId={}", request.projectId(), request.versionId()));
    }

    /**
     * 删除短剧项目及其会话，不影响剧本和漫剧项目。
     *
     * @param request 删除请求
     * @param httpRequest 当前HTTP请求
     * @return 空结果
     */
    @PostMapping("/deleteProject")
    public Mono<ApiResponse<Void>> deleteProject(@Valid @RequestBody DramaDtos.DeleteProjectRequest request, ServerHttpRequest httpRequest) {
        log.debug("删除短剧项目: url={}, headers={}, body={}", httpRequest.getURI(), headers(httpRequest), request);
        return dramaWorkspaceService.deleteProject(request).thenReturn(ApiResponse.<Void>ok(null))
                .doOnNext(response -> log.debug("删除短剧项目响应: projectId={}", request.projectId()));
    }

    private String headers(ServerHttpRequest request) {
        StringBuilder builder = new StringBuilder();
        request.getHeaders().forEach((name, values) -> builder.append(name).append('=')
                .append(SENSITIVE_HEADERS.contains(name.toLowerCase()) ? "[已脱敏]" : values).append(';'));
        return builder.toString();
    }
}
