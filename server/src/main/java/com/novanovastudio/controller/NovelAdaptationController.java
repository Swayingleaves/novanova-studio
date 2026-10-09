package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.NovelAdaptationDtos;
import com.novanovastudio.dto.ScriptDtos;
import com.novanovastudio.service.NovelAdaptationService;
import jakarta.validation.Valid;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * 小说改编的事实溯源、资产关联与一致性检查接口。
 * <p>
 * 一键改编已由 {@link WholeBookAdaptationController} 的全书流程取代：分批生成整套大纲与分集再合并的做法
 * 会让每批各自产生“第一集”，因此本控制器不再暴露改编生成入口，只保留分析与溯源能力。
 * 原有服务与执行器仅用于服务升级前遗留任务，不承接新的改编请求。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-28 18:00
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/script/novelAdaptation")
@RequiredArgsConstructor
public class NovelAdaptationController {
    /** 日志中须脱敏的请求头。 */
    private static final Set<String> SENSITIVE_HEADERS = Set.of("authorization", "proxy-authorization",
            "cookie", "set-cookie", "x-api-key", "api-key", "x-auth-token", "x-access-token", "x-refresh-token");

    /** 改编服务。 */
    private final NovelAdaptationService novelAdaptationService;

    /**
     * 查询改编草稿对应的事实与设置快照。
     *
     * @param request 项目标识
     * @param httpRequest 当前HTTP请求
     * @return 草稿来源列表
     */
    @PostMapping("/listDraftSources")
    public Mono<ApiResponse<List<NovelAdaptationDtos.DraftSource>>> listDraftSources(
            @Valid @RequestBody NovelAdaptationDtos.ProjectRequest request, ServerHttpRequest httpRequest) {
        return execute("查询改编草稿来源", httpRequest, request, novelAdaptationService.listDraftSources(request.projectId()));
    }

    /**
     * 查询正式改编内容的事实修订差异。
     *
     * @param request 项目标识
     * @param httpRequest 当前HTTP请求
     * @return 受影响的正式内容及原因
     */
    @PostMapping("/listSourceImpacts")
    public Mono<ApiResponse<List<NovelAdaptationDtos.SourceImpact>>> listSourceImpacts(
            @Valid @RequestBody NovelAdaptationDtos.ProjectRequest request, ServerHttpRequest httpRequest) {
        return execute("查询改编来源影响", httpRequest, request, novelAdaptationService.listSourceImpacts(request.projectId()));
    }

    /**
     * 查询人物、地点事实与漫剧视觉资产的关联。
     *
     * @param request 项目标识
     * @param httpRequest 当前HTTP请求
     * @return 资产关联列表
     */
    @PostMapping("/listAssetLinks")
    public Mono<ApiResponse<List<NovelAdaptationDtos.AssetLink>>> listAssetLinks(
            @Valid @RequestBody NovelAdaptationDtos.ProjectRequest request, ServerHttpRequest httpRequest) {
        return execute("查询故事事实视觉资产关联", httpRequest, request,
                novelAdaptationService.listAssetLinks(request.projectId()));
    }

    /**
     * 按用户确认建立人物或地点与现有或新视觉资产的关联。
     *
     * @param request 事实、资产及生产项目修订号
     * @param httpRequest 当前HTTP请求
     * @return 已建立的关联
     */
    @PostMapping("/linkAsset")
    public Mono<ApiResponse<NovelAdaptationDtos.AssetLink>> linkAsset(
            @Valid @RequestBody NovelAdaptationDtos.LinkAssetRequest request, ServerHttpRequest httpRequest) {
        return execute("关联故事事实与视觉资产", httpRequest, request, novelAdaptationService.linkAsset(request));
    }

    /**
     * 免费检查事实来源与时间线等明确规则。
     *
     * @param request 项目标识
     * @param httpRequest 当前HTTP请求
     * @return 规则问题列表
     */
    @PostMapping("/checkConsistency")
    public Mono<ApiResponse<List<NovelAdaptationDtos.ConsistencyIssue>>> checkConsistency(
            @Valid @RequestBody NovelAdaptationDtos.ProjectRequest request, ServerHttpRequest httpRequest) {
        return execute("检查小说改编一致性", httpRequest, request,
                novelAdaptationService.checkConsistency(request.projectId()));
    }

    /**
     * 用户确认文本模型费用后执行深入一致性分析。
     *
     * @param request 项目修订、模型与所选事实
     * @param httpRequest 当前HTTP请求
     * @return 已保存的分析报告
     */
    @PostMapping("/analyzeConsistency")
    public Mono<ApiResponse<ScriptDtos.AnalysisReport>> analyzeConsistency(
            @Valid @RequestBody NovelAdaptationDtos.AnalyzeRequest request, ServerHttpRequest httpRequest) {
        return execute("深入分析小说改编一致性", httpRequest, request,
                novelAdaptationService.analyzeConsistency(request));
    }

    /**
     * 统一记录请求、脱敏请求头及响应。
     *
     * @param name 操作名称
     * @param httpRequest 当前HTTP请求
     * @param request 请求内容
     * @param operation 业务调用
     * @param <T> 响应数据类型
     * @return 统一接口响应
     */
    private <T> Mono<ApiResponse<T>> execute(String name, ServerHttpRequest httpRequest, Object request,
                                             Mono<T> operation) {
        Map<String, List<String>> headers = new LinkedHashMap<>();
        httpRequest.getHeaders().forEach((key, values) -> headers.put(key,
                SENSITIVE_HEADERS.contains(key.toLowerCase(Locale.ROOT)) ? List.of("[已脱敏]") : List.copyOf(values)));
        log.debug("{}请求: url={}, headers={}, request={}", name, httpRequest.getURI(), headers, request);
        return operation.map(ApiResponse::ok).doOnNext(response -> log.debug("{}响应: response={}", name, response));
    }
}
