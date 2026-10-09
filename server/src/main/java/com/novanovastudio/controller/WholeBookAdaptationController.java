package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.WholeBookAdaptationDtos;
import com.novanovastudio.dto.WholeBookAdaptationDtos.Quote;
import com.novanovastudio.dto.WholeBookAdaptationDtos.View;
import com.novanovastudio.service.WholeBookAdaptationService;
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
 * 全书改编接口：报价、启动、进度查询、策略停点确认集数与取消。
 * <p>
 * 集数不随启动请求下发，只能在素材与策略生成后由用户确认并固定全部分集身份。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-10-01 22:40
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/script/wholeBookAdaptation")
@RequiredArgsConstructor
public class WholeBookAdaptationController {
    /** 日志中须脱敏的请求头。 */
    private static final Set<String> SENSITIVE_HEADERS = Set.of("authorization", "proxy-authorization",
            "cookie", "set-cookie", "x-api-key", "api-key", "x-auth-token", "x-access-token", "x-refresh-token");

    /** 全书改编服务。 */
    private final WholeBookAdaptationService wholeBookAdaptationService;

    /**
     * 免费报价：按已确认事实与改编设置给出素材与策略阶段的调用次数和积分。
     *
     * @param request 项目、模型与改编设置
     * @param httpRequest 当前HTTP请求
     * @return 报价与输入指纹
     */
    @PostMapping("/quote")
    public Mono<ApiResponse<Quote>> quote(@Valid @RequestBody WholeBookAdaptationDtos.QuoteRequest request,
                                          ServerHttpRequest httpRequest) {
        return execute("全书改编报价", httpRequest, request, wholeBookAdaptationService.quote(request));
    }

    /**
     * 启动任务并预扣素材与策略阶段积分，集数在策略确认时锁定。
     *
     * @param request 已确认报价的启动请求
     * @param httpRequest 当前HTTP请求
     * @return 任务状态
     */
    @PostMapping("/start")
    public Mono<ApiResponse<View>> start(@Valid @RequestBody WholeBookAdaptationDtos.StartRequest request,
                                         ServerHttpRequest httpRequest) {
        return execute("启动全书改编", httpRequest, request, wholeBookAdaptationService.start(request));
    }

    /**
     * 查询任务阶段、单元进度、建议策略与已锁定集数。
     *
     * @param request 项目与任务标识
     * @param httpRequest 当前HTTP请求
     * @return 任务状态
     */
    @PostMapping("/status")
    public Mono<ApiResponse<View>> status(@Valid @RequestBody WholeBookAdaptationDtos.JobRequest request,
                                          ServerHttpRequest httpRequest) {
        return execute("查询全书改编状态", httpRequest, request, wholeBookAdaptationService.status(request));
    }

    /**
     * 查询项目当前或最近的任务，刷新后保留停点与续跑入口。
     *
     * @param request 项目标识
     * @param httpRequest 当前HTTP请求
     * @return 至多一个任务
     */
    @PostMapping("/active")
    public Mono<ApiResponse<List<View>>> active(@Valid @RequestBody WholeBookAdaptationDtos.ProjectRequest request,
                                                ServerHttpRequest httpRequest) {
        return execute("查询当前全书改编", httpRequest, request,
                wholeBookAdaptationService.active(request.projectId()));
    }

    /**
     * 策略停点确认最终集数，按最大余数法固定全部分集标识与集号。
     *
     * @param request 用户确认的修订、续跑次数与最终集数
     * @param httpRequest 当前HTTP请求
     * @return 已锁定集数的任务状态
     */
    @PostMapping("/advance")
    public Mono<ApiResponse<View>> advance(@Valid @RequestBody WholeBookAdaptationDtos.AdvanceRequest request,
                                           ServerHttpRequest httpRequest) {
        return execute("确认全书改编集数", httpRequest, request, wholeBookAdaptationService.advance(request));
    }

    /**
     * 统一规划停点应用待审草稿，替换概览、大纲、设定与分集并结束任务。
     *
     * @param request 项目与任务标识
     * @param httpRequest 当前HTTP请求
     * @return 任务状态
     */
    @PostMapping("/confirm")
    public Mono<ApiResponse<View>> confirm(@Valid @RequestBody WholeBookAdaptationDtos.JobRequest request,
                                           ServerHttpRequest httpRequest) {
        return execute("应用全书改编统一规划", httpRequest, request, wholeBookAdaptationService.confirm(request));
    }

    /**
     * 从失败处继续，只重跑未完成单元并对该部分重新预扣。
     *
     * @param request 项目与任务标识
     * @param httpRequest 当前HTTP请求
     * @return 任务状态
     */
    @PostMapping("/retry")
    public Mono<ApiResponse<View>> retry(@Valid @RequestBody WholeBookAdaptationDtos.JobRequest request,
                                         ServerHttpRequest httpRequest) {
        return execute("从失败单元继续全书改编", httpRequest, request, wholeBookAdaptationService.retry(request));
    }

    /**
     * 取消任务并按未完成单元退回本阶段预扣积分。
     *
     * @param request 项目与任务标识
     * @param httpRequest 当前HTTP请求
     * @return 任务状态
     */
    @PostMapping("/cancel")
    public Mono<ApiResponse<View>> cancel(@Valid @RequestBody WholeBookAdaptationDtos.JobRequest request,
                                          ServerHttpRequest httpRequest) {
        return execute("取消全书改编", httpRequest, request, wholeBookAdaptationService.cancel(request));
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
