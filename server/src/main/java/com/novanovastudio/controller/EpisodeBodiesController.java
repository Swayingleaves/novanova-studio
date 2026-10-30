package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.EpisodeBodiesDtos;
import com.novanovastudio.service.EpisodeBodiesService;
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
 * 逐集正文批量生成接口：报价、启动、进度查询、缺失分集续跑与取消。
 * <p>
 * 集数与分集身份由全书改编固定，这里只按已固定的分集生成场次与正文。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-10-09 11:45
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/script/episodeBodies")
@RequiredArgsConstructor
public class EpisodeBodiesController {
    /** 日志中须脱敏的请求头。 */
    private static final Set<String> SENSITIVE_HEADERS = Set.of("authorization", "proxy-authorization",
            "cookie", "set-cookie", "x-api-key", "api-key", "x-auth-token", "x-access-token", "x-refresh-token");

    /** 逐集正文批量服务。 */
    private final EpisodeBodiesService episodeBodiesService;

    /**
     * 查询所选文本模型的每集积分，供界面在报价前显示单价。
     *
     * @param request 模型值
     * @param httpRequest 当前HTTP请求
     * @return 每集积分，尚未定价时为空
     */
    @PostMapping("/unitPrice")
    public Mono<ApiResponse<EpisodeBodiesDtos.UnitPrice>> unitPrice(
            @Valid @RequestBody EpisodeBodiesDtos.UnitPriceRequest request, ServerHttpRequest httpRequest) {
        return execute("查询分集正文单价", httpRequest, request, episodeBodiesService.unitPrice(request.model()));
    }

    /**
     * 免费报价：按目标分集与模型单价给出调用次数和预扣积分。
     *
     * @param request 项目、修订、模型、模式与目标分集
     * @param httpRequest 当前HTTP请求
     * @return 报价与输入指纹
     */
    @PostMapping("/quote")
    public Mono<ApiResponse<EpisodeBodiesDtos.Quote>> quote(@Valid @RequestBody EpisodeBodiesDtos.QuoteRequest request,
                                                            ServerHttpRequest httpRequest) {
        return execute("分集正文批量报价", httpRequest, request, episodeBodiesService.quote(request));
    }

    /**
     * 启动任务并按分集预扣积分，随后由后台队列逐集生成。
     *
     * @param request 已确认报价的启动请求
     * @param httpRequest 当前HTTP请求
     * @return 任务进度
     */
    @PostMapping("/start")
    public Mono<ApiResponse<EpisodeBodiesDtos.Job>> start(@Valid @RequestBody EpisodeBodiesDtos.StartRequest request,
                                                          ServerHttpRequest httpRequest) {
        return execute("启动分集正文批量生成", httpRequest, request, episodeBodiesService.start(request));
    }

    /**
     * 查询任务进度。
     *
     * @param request 项目与任务标识
     * @param httpRequest 当前HTTP请求
     * @return 任务进度
     */
    @PostMapping("/status")
    public Mono<ApiResponse<EpisodeBodiesDtos.Job>> status(@Valid @RequestBody EpisodeBodiesDtos.JobRequest request,
                                                           ServerHttpRequest httpRequest) {
        return execute("查询分集正文批量进度", httpRequest, request,
                episodeBodiesService.status(request.projectId(), request.jobId()));
    }

    /**
     * 查询项目最近一次任务，刷新后保留进度与续跑入口；项目还没有任务时返回空响应体。
     * <p>
     * 空任务无法表达为 {@code data:null}：Reactor 不允许流中出现 null 值，因此这里保持 HTTP 200 空响应体，
     * 由前端把空响应体当作“没有任务”处理。
     *
     * @param request 项目标识
     * @param httpRequest 当前HTTP请求
     * @return 最近任务，没有任务时为空响应体
     */
    @PostMapping("/latest")
    public Mono<ApiResponse<EpisodeBodiesDtos.Job>> latest(@Valid @RequestBody EpisodeBodiesDtos.ProjectRequest request,
                                                           ServerHttpRequest httpRequest) {
        return execute("查询最近分集正文批量", httpRequest, request, episodeBodiesService.latest(request.projectId()));
    }

    /**
     * 从失败或取消处继续，只重做未完成的分集。
     *
     * @param request 项目与任务标识
     * @param httpRequest 当前HTTP请求
     * @return 任务进度
     */
    @PostMapping("/retry")
    public Mono<ApiResponse<EpisodeBodiesDtos.Job>> retry(@Valid @RequestBody EpisodeBodiesDtos.JobRequest request,
                                                          ServerHttpRequest httpRequest) {
        return execute("从缺失分集继续生成正文", httpRequest, request, episodeBodiesService.retry(request));
    }

    /**
     * 取消任务并退还未完成分集的预扣积分。
     *
     * @param request 项目与任务标识
     * @param httpRequest 当前HTTP请求
     * @return 任务进度
     */
    @PostMapping("/cancel")
    public Mono<ApiResponse<EpisodeBodiesDtos.Job>> cancel(@Valid @RequestBody EpisodeBodiesDtos.JobRequest request,
                                                           ServerHttpRequest httpRequest) {
        return execute("取消分集正文批量生成", httpRequest, request, episodeBodiesService.cancel(request));
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
