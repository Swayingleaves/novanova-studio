package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.ScriptDtos;
import com.novanovastudio.service.ScriptAgentService;
import com.novanovastudio.service.ScriptService;
import jakarta.validation.Valid;
import java.util.LinkedHashMap;
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
 * 剧本创作项目、编辑、版本与生产准备度接口。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-20 12:00
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/script")
@RequiredArgsConstructor
public class ScriptController {

    /** 请求日志中必须脱敏的敏感请求头。 */
    private static final Set<String> SENSITIVE_HEADER_NAMES = Set.of(
            "authorization", "proxy-authorization", "cookie", "set-cookie",
            "x-api-key", "api-key", "x-auth-token", "x-access-token", "x-refresh-token");

    /** 日志脱敏占位文本。 */
    private static final String MASKED_VALUE = "[已脱敏]";

    /** 剧本创作业务服务。 */
    private final ScriptService scriptService;

    /** 剧本专用AI服务。 */
    private final ScriptAgentService scriptAgentService;

    /**
     * 分页查询当前用户的剧本项目。
     *
     * @param page 页码，从1开始
     * @param pageSize 每页数量
     * @param keyword 项目名称或一句话创意关键字
     * @param stage 创作阶段筛选
     * @param contentType 内容形式筛选
     * @param httpRequest 当前HTTP请求
     * @return 剧本项目分页结果
     */
    @GetMapping("/listProjects")
    public Mono<ApiResponse<ScriptDtos.ProjectListResponse>> listProjects(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(defaultValue = "") String keyword,
            @RequestParam(defaultValue = "") String stage,
            @RequestParam(defaultValue = "") String contentType,
            ServerHttpRequest httpRequest) {
        log.info("剧本项目列表请求: url={}, headers={}, page={}, pageSize={}, keyword={}, stage={}, contentType={}",
                httpRequest.getURI(), sanitizedHeaders(httpRequest), page, pageSize, keyword, stage, contentType);
        return scriptService.listProjects(page, pageSize, keyword, stage, contentType).map(ApiResponse::ok)
                .doOnNext(response -> log.debug("剧本项目列表响应: response={}", response));
    }

    /**
     * 查询全部启用的剧本模板。
     *
     * @param httpRequest 当前HTTP请求
     * @return 剧本模板及其结构段列表
     */
    @GetMapping("/listTemplates")
    public Mono<ApiResponse<java.util.List<ScriptDtos.ScriptTemplate>>> listTemplates(ServerHttpRequest httpRequest) {
        log.info("剧本模板列表请求: url={}, headers={}", httpRequest.getURI(), sanitizedHeaders(httpRequest));
        return scriptService.listTemplates().map(ApiResponse::ok)
                .doOnNext(response -> log.info("剧本模板列表响应: response={}", response));
    }

    /**
     * 创建空白或模板剧本项目。
     *
     * @param request 创建项目请求
     * @param httpRequest 当前HTTP请求
     * @return 新建剧本项目详情
     */
    @PostMapping("/createProject")
    public Mono<ApiResponse<ScriptDtos.ProjectDetail>> createProject(
            @Valid @RequestBody ScriptDtos.CreateProjectRequest request, ServerHttpRequest httpRequest) {
        return execute("创建剧本项目", httpRequest, request, scriptService.createProject(request));
    }

    /**
     * 查询剧本项目基础详情。
     *
     * @param request 项目标识请求
     * @param httpRequest 当前HTTP请求
     * @return 不包含分集正文的项目详情
     */
    @PostMapping("/getProject")
    public Mono<ApiResponse<ScriptDtos.ProjectDetail>> getProject(
            @Valid @RequestBody ScriptDtos.ProjectIdRequest request, ServerHttpRequest httpRequest) {
        return execute("查询剧本项目", httpRequest, request, scriptService.getProject(request.projectId()));
    }

    /**
     * 批量软删除当前用户的剧本项目。
     *
     * @param request 待删除项目标识列表
     * @param httpRequest 当前HTTP请求
     * @return 每个项目的最新修订信息
     */
    @PostMapping("/deleteProjects")
    public Mono<ApiResponse<java.util.List<ScriptDtos.DeletedProjectResult>>> deleteProjects(
            @Valid @RequestBody ScriptDtos.DeleteProjectsRequest request, ServerHttpRequest httpRequest) {
        return execute("删除剧本项目", httpRequest, request, scriptService.deleteProjects(request.projects()));
    }

    /**
     * 保存故事概览并校验项目修订号。
     *
     * @param request 故事概览保存请求
     * @param httpRequest 当前HTTP请求
     * @return 最新项目修订信息
     */
    @PostMapping("/saveOverview")
    public Mono<ApiResponse<ScriptDtos.MutationResult>> saveOverview(
            @Valid @RequestBody ScriptDtos.SaveOverviewRequest request, ServerHttpRequest httpRequest) {
        return execute("保存故事概览", httpRequest, request, scriptService.saveOverview(request));
    }

    /**
     * 保存故事大纲及关键事件。
     *
     * @param request 大纲保存请求
     * @param httpRequest 当前HTTP请求
     * @return 最新项目修订信息
     */
    @PostMapping("/saveOutline")
    public Mono<ApiResponse<ScriptDtos.MutationResult>> saveOutline(
            @Valid @RequestBody ScriptDtos.SaveOutlineRequest request, ServerHttpRequest httpRequest) {
        return execute("保存故事大纲", httpRequest, request, scriptService.saveOutline(request));
    }

    /**
     * 保存人物设定和人物关系。
     *
     * @param request 人物区块保存请求
     * @param httpRequest 当前HTTP请求
     * @return 最新项目修订信息
     */
    @PostMapping("/saveCharacters")
    public Mono<ApiResponse<ScriptDtos.MutationResult>> saveCharacters(
            @Valid @RequestBody ScriptDtos.SaveCharactersRequest request, ServerHttpRequest httpRequest) {
        return execute("保存人物设定", httpRequest, request, scriptService.saveCharacters(request));
    }

    /**
     * 保存世界观、分类条目和场景地点。
     *
     * @param request 世界观区块保存请求
     * @param httpRequest 当前HTTP请求
     * @return 最新项目修订信息
     */
    @PostMapping("/saveWorld")
    public Mono<ApiResponse<ScriptDtos.MutationResult>> saveWorld(
            @Valid @RequestBody ScriptDtos.SaveWorldRequest request, ServerHttpRequest httpRequest) {
        return execute("保存世界观", httpRequest, request, scriptService.saveWorld(request));
    }

    /**
     * 查询单集场次和结构化正文。
     *
     * @param request 项目及分集标识
     * @param httpRequest 当前HTTP请求
     * @return 单集完整内容
     */
    @PostMapping("/getEpisode")
    public Mono<ApiResponse<ScriptDtos.EpisodeDetail>> getEpisode(
            @Valid @RequestBody ScriptDtos.EpisodeIdRequest request, ServerHttpRequest httpRequest) {
        return execute("查询单集正文", httpRequest, request, scriptService.getEpisode(request.projectId(), request.episodeId()));
    }

    /**
     * 保存单集、场次、人物引用和正文块。
     *
     * @param request 单集保存请求
     * @param httpRequest 当前HTTP请求
     * @return 最新项目修订信息
     */
    @PostMapping("/saveEpisode")
    public Mono<ApiResponse<ScriptDtos.MutationResult>> saveEpisode(
            @Valid @RequestBody ScriptDtos.SaveEpisodeRequest request, ServerHttpRequest httpRequest) {
        return execute("保存单集正文", httpRequest, request, scriptService.saveEpisode(request));
    }

    /**
     * 调整项目全部分集的顺序。
     *
     * @param request 分集顺序保存请求
     * @param httpRequest 当前HTTP请求
     * @return 最新项目修订信息
     */
    @PostMapping("/reorderEpisodes")
    public Mono<ApiResponse<ScriptDtos.MutationResult>> reorderEpisodes(
            @Valid @RequestBody ScriptDtos.ReorderEpisodesRequest request, ServerHttpRequest httpRequest) {
        return execute("调整分集顺序", httpRequest, request, scriptService.reorderEpisodes(request));
    }

    /**
     * 删除指定分集及其级联内容。
     *
     * @param request 分集删除请求
     * @param httpRequest 当前HTTP请求
     * @return 最新项目修订信息
     */
    @PostMapping("/deleteEpisode")
    public Mono<ApiResponse<ScriptDtos.MutationResult>> deleteEpisode(
            @Valid @RequestBody ScriptDtos.DeleteEpisodeRequest request, ServerHttpRequest httpRequest) {
        return execute("删除分集", httpRequest, request, scriptService.deleteEpisode(request));
    }

    /**
     * 查询项目版本摘要列表。
     *
     * @param projectId 剧本项目标识
     * @param httpRequest 当前HTTP请求
     * @return 版本摘要列表
     */
    @GetMapping("/listVersions")
    public Mono<ApiResponse<java.util.List<ScriptDtos.VersionSummary>>> listVersions(
            @RequestParam String projectId, ServerHttpRequest httpRequest) {
        return execute("查询剧本版本", httpRequest, projectId, scriptService.listVersions(projectId));
    }

    /**
     * 创建用户命名的不可变剧本版本。
     *
     * @param request 版本创建请求
     * @param httpRequest 当前HTTP请求
     * @return 新建版本摘要
     */
    @PostMapping("/createVersion")
    public Mono<ApiResponse<ScriptDtos.VersionSummary>> createVersion(
            @Valid @RequestBody ScriptDtos.CreateVersionRequest request, ServerHttpRequest httpRequest) {
        return execute("创建剧本版本", httpRequest, request, scriptService.createVersion(request));
    }

    /**
     * 查询指定版本的完整快照。
     *
     * @param request 项目及版本标识
     * @param httpRequest 当前HTTP请求
     * @return 版本详情
     */
    @PostMapping("/getVersion")
    public Mono<ApiResponse<ScriptDtos.VersionDetail>> getVersion(
            @Valid @RequestBody ScriptDtos.VersionIdRequest request, ServerHttpRequest httpRequest) {
        return execute("查询版本详情", httpRequest, request, scriptService.getVersion(request.projectId(), request.versionId()));
    }

    /**
     * 将指定版本快照恢复到正式关系数据。
     *
     * @param request 版本恢复请求
     * @param httpRequest 当前HTTP请求
     * @return 最新项目修订信息
     */
    @PostMapping("/restoreVersion")
    public Mono<ApiResponse<ScriptDtos.MutationResult>> restoreVersion(
            @Valid @RequestBody ScriptDtos.RestoreVersionRequest request, ServerHttpRequest httpRequest) {
        return execute("恢复剧本版本", httpRequest, request, scriptService.restoreVersion(request));
    }

    /**
     * 查询项目AI草稿列表。
     *
     * @param projectId 剧本项目标识
     * @param httpRequest 当前HTTP请求
     * @return AI草稿列表
     */
    @GetMapping("/listAiDrafts")
    public Mono<ApiResponse<java.util.List<ScriptDtos.AiDraft>>> listAiDrafts(
            @RequestParam String projectId, ServerHttpRequest httpRequest) {
        return execute("查询剧本AI草稿", httpRequest, projectId, scriptService.listAiDrafts(projectId));
    }

    /**
     * 放弃待确认AI草稿。
     *
     * @param request 草稿放弃请求
     * @param httpRequest 当前HTTP请求
     * @return 当前项目修订信息
     */
    @PostMapping("/discardAiDraft")
    public Mono<ApiResponse<ScriptDtos.MutationResult>> discardAiDraft(
            @Valid @RequestBody ScriptDtos.DiscardAiDraftRequest request, ServerHttpRequest httpRequest) {
        return execute("放弃剧本AI草稿", httpRequest, request, scriptService.discardAiDraft(request));
    }

    /**
     * 调用文本模型生成待确认的结构化AI草稿。
     *
     * @param request AI草稿生成请求
     * @param httpRequest 当前HTTP请求
     * @return 已持久化的待确认草稿
     */
    @PostMapping("/generateDraft")
    public Mono<ApiResponse<ScriptDtos.AiDraft>> generateDraft(
            @Valid @RequestBody ScriptDtos.GenerateDraftRequest request, ServerHttpRequest httpRequest) {
        return execute("生成剧本AI草稿", httpRequest, request, scriptAgentService.generateDraft(request));
    }

    /**
     * 确认应用用户编辑后的AI草稿。
     *
     * @param request AI草稿应用请求
     * @param httpRequest 当前HTTP请求
     * @return 最新项目修订信息
     */
    @PostMapping("/applyAiDraft")
    public Mono<ApiResponse<ScriptDtos.MutationResult>> applyAiDraft(
            @Valid @RequestBody ScriptDtos.ApplyAiDraftRequest request, ServerHttpRequest httpRequest) {
        return execute("应用剧本AI草稿", httpRequest, request, scriptAgentService.applyAiDraft(request));
    }

    /**
     * 执行全项目或单集专业分析。
     *
     * @param request 专业分析请求
     * @param httpRequest 当前HTTP请求
     * @return 已持久化的分析报告
     */
    @PostMapping("/analyzeScript")
    public Mono<ApiResponse<ScriptDtos.AnalysisReport>> analyzeScript(
            @Valid @RequestBody ScriptDtos.AnalyzeScriptRequest request, ServerHttpRequest httpRequest) {
        return execute("分析剧本", httpRequest, request, scriptAgentService.analyzeScript(request));
    }

    /**
     * 查询项目分析报告列表。
     *
     * @param projectId 剧本项目标识
     * @param httpRequest 当前HTTP请求
     * @return 分析报告摘要列表
     */
    @GetMapping("/listAnalysisReports")
    public Mono<ApiResponse<java.util.List<ScriptDtos.AnalysisReport>>> listAnalysisReports(
            @RequestParam String projectId, ServerHttpRequest httpRequest) {
        return execute("查询剧本分析报告", httpRequest, projectId, scriptService.listAnalysisReports(projectId));
    }

    /**
     * 查询分析报告及其问题明细。
     *
     * @param projectId 剧本项目标识
     * @param reportId 分析报告标识
     * @param httpRequest 当前HTTP请求
     * @return 分析报告详情
     */
    @GetMapping("/getAnalysisReport")
    public Mono<ApiResponse<ScriptDtos.AnalysisReport>> getAnalysisReport(
            @RequestParam String projectId, @RequestParam String reportId, ServerHttpRequest httpRequest) {
        return execute("查询剧本分析详情", httpRequest, projectId + ":" + reportId,
                scriptService.getAnalysisReport(projectId, reportId));
    }

    /**
     * 查询进入漫剧创作前的生产准备度。
     *
     * @param request 项目标识请求
     * @param httpRequest 当前HTTP请求
     * @return 准备度检查结果
     */
    @PostMapping("/getProductionReadiness")
    public Mono<ApiResponse<ScriptDtos.ProductionReadiness>> getProductionReadiness(
            @Valid @RequestBody ScriptDtos.ProjectIdRequest request, ServerHttpRequest httpRequest) {
        return execute("查询剧本生产准备度", httpRequest, request, scriptService.getProductionReadiness(request.projectId()));
    }

    /**
     * 标记项目已进入漫剧创作阶段。
     *
     * @param request 带期望修订号的项目请求
     * @param httpRequest 当前HTTP请求
     * @return 最新项目修订信息
     */
    @PostMapping("/enterComicDrama")
    public Mono<ApiResponse<ScriptDtos.MutationResult>> enterComicDrama(
            @Valid @RequestBody ScriptDtos.ProjectRevisionRequest request, ServerHttpRequest httpRequest) {
        return execute("进入漫剧创作", httpRequest, request,
                scriptService.enterComicDrama(request.projectId(), request.expectedRevision()));
    }

    /**
     * 统一记录请求内容与响应内容。
     *
     * @param operationName String 操作名称
     * @param httpRequest ServerHttpRequest HTTP请求
     * @param request Object 请求内容
     * @param operation Mono<T> 业务操作
     * @return Mono<ApiResponse<T>> 统一响应
     * @param <T> 响应数据类型
     */
    private <T> Mono<ApiResponse<T>> execute(String operationName, ServerHttpRequest httpRequest,
                                             Object request, Mono<T> operation) {
        log.info("{}请求: url={}, headers={}, request={}", operationName, httpRequest.getURI(),
                sanitizedHeaders(httpRequest), request);
        return operation.map(ApiResponse::ok).doOnNext(response -> log.debug("{}响应: response={}", operationName, response));
    }

    /**
     * 复制请求头并隐藏鉴权令牌、Cookie和外部服务密钥。
     *
     * @param httpRequest ServerHttpRequest 当前HTTP请求
     * @return Map&lt;String, List&lt;String&gt;&gt; 可安全写入日志的请求头副本
     */
    private Map<String, List<String>> sanitizedHeaders(ServerHttpRequest httpRequest) {
        Map<String, List<String>> headers = new LinkedHashMap<>();
        httpRequest.getHeaders().forEach((name, values) -> headers.put(name,
                SENSITIVE_HEADER_NAMES.contains(name.toLowerCase(Locale.ROOT))
                        ? List.of(MASKED_VALUE) : List.copyOf(values)));
        return headers;
    }
}
