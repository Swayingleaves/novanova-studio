package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.StoryBibleDtos;
import com.novanovastudio.service.StoryBibleService;
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
 * 故事知识库分析与条目审阅接口。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-09-27 00:00
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/script/storyBible")
@RequiredArgsConstructor
public class StoryBibleController {

    /** 请求日志中必须脱敏的敏感请求头。 */
    private static final Set<String> SENSITIVE_HEADER_NAMES = Set.of(
            "authorization", "proxy-authorization", "cookie", "set-cookie",
            "x-api-key", "api-key", "x-auth-token", "x-access-token", "x-refresh-token");

    /** 日志脱敏占位文本。 */
    private static final String MASKED_VALUE = "[已脱敏]";

    /** 故事知识库服务。 */
    private final StoryBibleService storyBibleService;

    /**
     * 按模型与范围报价。
     *
     * @param request 报价请求
     * @param httpRequest 当前HTTP请求
     * @return 报价
     */
    @PostMapping("/quoteAnalysis")
    public Mono<ApiResponse<StoryBibleDtos.Quote>> quoteAnalysis(@RequestBody StoryBibleDtos.QuoteRequest request,
                                                                ServerHttpRequest httpRequest) {
        return execute("故事知识库报价", httpRequest, request, storyBibleService.quoteAnalysis(request));
    }

    /**
     * 确认报价后启动分析并预扣积分。
     *
     * @param request 启动请求
     * @param httpRequest 当前HTTP请求
     * @return 任务状态
     */
    @PostMapping("/startAnalysis")
    public Mono<ApiResponse<StoryBibleDtos.JobStatus>> startAnalysis(@RequestBody StoryBibleDtos.StartRequest request,
                                                                    ServerHttpRequest httpRequest) {
        return execute("启动故事知识库分析", httpRequest, request, storyBibleService.startAnalysis(request));
    }

    /**
     * 查询分析任务状态。
     *
     * @param request 任务请求，任务标识为空时返回最近一次任务
     * @param httpRequest 当前HTTP请求
     * @return 任务状态
     */
    @PostMapping("/getAnalysisStatus")
    public Mono<ApiResponse<StoryBibleDtos.JobStatus>> getAnalysisStatus(@RequestBody StoryBibleDtos.JobRequest request,
                                                                        ServerHttpRequest httpRequest) {
        // 项目尚未发起过分析时返回空数据，而不是空响应体。
        return execute("查询故事知识库分析状态", httpRequest, request, storyBibleService.getAnalysisStatus(request))
                .defaultIfEmpty(ApiResponse.ok(null));
    }

    /**
     * 续跑可重试任务。
     *
     * @param request 任务请求
     * @param httpRequest 当前HTTP请求
     * @return 任务状态
     */
    @PostMapping("/retryAnalysis")
    public Mono<ApiResponse<StoryBibleDtos.JobStatus>> retryAnalysis(@RequestBody StoryBibleDtos.JobRequest request,
                                                                    ServerHttpRequest httpRequest) {
        return execute("续跑故事知识库分析", httpRequest, request, storyBibleService.retryAnalysis(request));
    }

    /**
     * 取消分析，保留已完成内容并退还未成功完成批次的积分。
     *
     * @param request 任务请求
     * @param httpRequest 当前HTTP请求
     * @return 任务状态
     */
    @PostMapping("/cancelAnalysis")
    public Mono<ApiResponse<StoryBibleDtos.JobStatus>> cancelAnalysis(@RequestBody StoryBibleDtos.JobRequest request,
                                                                     ServerHttpRequest httpRequest) {
        return execute("取消故事知识库分析", httpRequest, request, storyBibleService.cancelAnalysis(request));
    }

    /**
     * 分页查询条目。
     *
     * @param request 查询请求
     * @param httpRequest 当前HTTP请求
     * @return 条目分页
     */
    @PostMapping("/listItems")
    public Mono<ApiResponse<StoryBibleDtos.ItemPage>> listItems(@RequestBody StoryBibleDtos.ListItemsRequest request,
                                                               ServerHttpRequest httpRequest) {
        return execute("查询故事知识库条目", httpRequest, request, storyBibleService.listItems(request));
    }

    /**
     * 读取条目详情。
     *
     * @param request 查询请求
     * @param httpRequest 当前HTTP请求
     * @return 条目详情
     */
    @PostMapping("/getItem")
    public Mono<ApiResponse<StoryBibleDtos.ItemDetail>> getItem(@RequestBody StoryBibleDtos.GetItemRequest request,
                                                               ServerHttpRequest httpRequest) {
        return execute("查询故事知识库条目详情", httpRequest, request, storyBibleService.getItem(request));
    }

    /**
     * 新建或编辑条目。
     *
     * @param request 保存请求
     * @param httpRequest 当前HTTP请求
     * @return 条目详情
     */
    @PostMapping("/saveItem")
    public Mono<ApiResponse<StoryBibleDtos.ItemDetail>> saveItem(@RequestBody StoryBibleDtos.SaveItemRequest request,
                                                                ServerHttpRequest httpRequest) {
        return execute("保存故事知识库条目", httpRequest, request, storyBibleService.saveItem(request));
    }

    /**
     * 确认条目或待审建议。
     *
     * @param request 条目请求
     * @param httpRequest 当前HTTP请求
     * @return 条目详情
     */
    @PostMapping("/confirmItem")
    public Mono<ApiResponse<StoryBibleDtos.ItemDetail>> confirmItem(@RequestBody StoryBibleDtos.ItemRequest request,
                                                                   ServerHttpRequest httpRequest) {
        return execute("确认故事知识库条目", httpRequest, request, storyBibleService.confirmItem(request));
    }

    /**
     * 在一次事务中确认多条知识库条目或待审建议。
     *
     * @param request 批量确认请求
     * @param httpRequest 当前HTTP请求
     * @return 批量确认结果
     */
    @PostMapping("/confirmItems")
    public Mono<ApiResponse<StoryBibleDtos.BatchConfirmResult>> confirmItems(@RequestBody StoryBibleDtos.BatchConfirmRequest request,
                                                                             ServerHttpRequest httpRequest) {
        return execute("批量确认故事知识库条目", httpRequest, request, storyBibleService.confirmItems(request));
    }

    /**
     * 全量确认指定分类下所有待确认条目。
     *
     * @param request 全量确认请求
     * @param httpRequest 当前HTTP请求
     * @return 全量确认结果
     */
    @PostMapping("/confirmAllItems")
    public Mono<ApiResponse<StoryBibleDtos.BatchConfirmResult>> confirmAllItems(@RequestBody StoryBibleDtos.BatchConfirmAllRequest request,
                                                                                ServerHttpRequest httpRequest) {
        return execute("全量确认故事知识库条目", httpRequest, request, storyBibleService.confirmAllItems(request));
    }

    /**
     * 拒绝条目或待审建议。
     *
     * @param request 条目请求
     * @param httpRequest 当前HTTP请求
     * @return 条目详情
     */
    @PostMapping("/rejectItem")
    public Mono<ApiResponse<StoryBibleDtos.ItemDetail>> rejectItem(@RequestBody StoryBibleDtos.ItemRequest request,
                                                                  ServerHttpRequest httpRequest) {
        return execute("拒绝故事知识库条目", httpRequest, request, storyBibleService.rejectItem(request));
    }

    /**
     * 合并人物或地点。
     *
     * @param request 合并请求
     * @param httpRequest 当前HTTP请求
     * @return 合并后的条目
     */
    @PostMapping("/mergeEntities")
    public Mono<ApiResponse<StoryBibleDtos.ItemDetail>> mergeEntities(@RequestBody StoryBibleDtos.MergeRequest request,
                                                                     ServerHttpRequest httpRequest) {
        return execute("合并故事知识库实体", httpRequest, request, storyBibleService.mergeEntities(request));
    }

    /**
     * 拆分人物或地点。
     *
     * @param request 拆分请求
     * @param httpRequest 当前HTTP请求
     * @return 新条目
     */
    @PostMapping("/splitEntity")
    public Mono<ApiResponse<StoryBibleDtos.ItemDetail>> splitEntity(@RequestBody StoryBibleDtos.SplitRequest request,
                                                                   ServerHttpRequest httpRequest) {
        return execute("拆分故事知识库实体", httpRequest, request, storyBibleService.splitEntity(request));
    }

    /**
     * 统一记录请求内容与响应内容。
     *
     * @param operationName String 操作名称
     * @param httpRequest ServerHttpRequest HTTP请求
     * @param request Object 请求内容
     * @param operation Mono&lt;T&gt; 业务操作
     * @return Mono&lt;ApiResponse&lt;T&gt;&gt; 统一响应
     * @param <T> 响应数据类型
     */
    private <T> Mono<ApiResponse<T>> execute(String operationName, ServerHttpRequest httpRequest,
                                             Object request, Mono<T> operation) {
        log.debug("{}请求: url={}, headers={}, request={}", operationName, httpRequest.getURI(),
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
