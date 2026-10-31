package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.ScriptSourceDtos;
import com.novanovastudio.service.ScriptSourceService;
import jakarta.validation.Valid;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.codec.multipart.FilePart;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * 剧本与小说原文导入、进度查询与结构校对接口。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-09-26 00:00
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/script/source")
@RequiredArgsConstructor
public class ScriptSourceController {

    /** 请求日志中必须脱敏的敏感请求头。 */
    private static final Set<String> SENSITIVE_HEADER_NAMES = Set.of(
            "authorization", "proxy-authorization", "cookie", "set-cookie",
            "x-api-key", "api-key", "x-auth-token", "x-access-token", "x-refresh-token");

    /** 日志脱敏占位文本。 */
    private static final String MASKED_VALUE = "[已脱敏]";

    /** 原文导入服务。 */
    private final ScriptSourceService scriptSourceService;

    /**
     * 上传剧本或小说原文件并创建剧本项目。
     *
     * @param file 上传文件
     * @param sourceType 小说或剧本
     * @param contentType 内容形式
     * @param title 项目名称，缺省取文件名
     * @param encoding TXT编码
     * @param clientRequestId 客户端幂等请求标识
     * @param httpRequest 当前HTTP请求
     * @return 项目、原文和任务标识
     */
    @PostMapping("/uploadSource")
    public Mono<ApiResponse<ScriptSourceDtos.UploadResult>> uploadSource(
            @RequestPart("file") Mono<FilePart> file,
            @RequestPart("sourceType") String sourceType,
            @RequestPart(value = "contentType", required = false) String contentType,
            @RequestPart(value = "title", required = false) String title,
            @RequestPart(value = "encoding", required = false) String encoding,
            @RequestPart("clientRequestId") String clientRequestId,
            ServerHttpRequest httpRequest) {
        log.info("上传原文请求: url={}, headers={}, sourceType={}, contentType={}, title={}, encoding={}, clientRequestId={}",
                httpRequest.getURI(), sanitizedHeaders(httpRequest), sourceType, contentType, title, encoding, clientRequestId);
        return file.flatMap(filePart -> scriptSourceService.upload(filePart, sourceType, contentType, title, encoding, clientRequestId))
                .map(ApiResponse::ok)
                .doOnNext(response -> log.info("上传原文响应: response={}", response));
    }

    /**
     * 查询原文导入进度。
     *
     * @param request 项目标识请求
     * @param httpRequest 当前HTTP请求
     * @return 导入进度
     */
    @PostMapping("/getImportStatus")
    public Mono<ApiResponse<ScriptSourceDtos.ImportStatus>> getImportStatus(
            @Valid @RequestBody ScriptSourceDtos.ProjectRequest request, ServerHttpRequest httpRequest) {
        return execute("查询原文导入进度", httpRequest, request, scriptSourceService.status(request.projectId()));
    }

    /**
     * 重试失败的原文导入任务。
     *
     * @param request 重试请求，可携带新的TXT编码
     * @param httpRequest 当前HTTP请求
     * @return 重试后的导入进度
     */
    @PostMapping("/retryImport")
    public Mono<ApiResponse<ScriptSourceDtos.ImportStatus>> retryImport(
            @Valid @RequestBody ScriptSourceDtos.RetryRequest request, ServerHttpRequest httpRequest) {
        return execute("重试原文导入", httpRequest, request, scriptSourceService.retry(request));
    }

    /**
     * 读取原文章节与场次目录。
     *
     * @param request 项目标识请求
     * @param httpRequest 当前HTTP请求
     * @return 原文目录
     */
    @PostMapping("/getSourceTree")
    public Mono<ApiResponse<ScriptSourceDtos.SourceTree>> getSourceTree(
            @Valid @RequestBody ScriptSourceDtos.ProjectRequest request, ServerHttpRequest httpRequest) {
        return execute("查询原文目录", httpRequest, request, scriptSourceService.tree(request.projectId()));
    }

    /**
     * 按需读取结构段正文。
     *
     * @param request 结构段查询请求
     * @param httpRequest 当前HTTP请求
     * @return 结构段与正文
     */
    @PostMapping("/getSourceSection")
    public Mono<ApiResponse<ScriptSourceDtos.SectionDetail>> getSourceSection(
            @Valid @RequestBody ScriptSourceDtos.SectionRequest request, ServerHttpRequest httpRequest) {
        return execute("查询原文结构段", httpRequest, request, scriptSourceService.section(request));
    }

    /**
     * 修改结构段标题。
     *
     * @param request 改名请求
     * @param httpRequest 当前HTTP请求
     * @return 校对完成后的修订号
     */
    @PostMapping("/renameSection")
    public Mono<ApiResponse<ScriptSourceDtos.MutationResult>> renameSection(
            @Valid @RequestBody ScriptSourceDtos.RenameRequest request, ServerHttpRequest httpRequest) {
        return execute("修改原文结构段标题", httpRequest, request, scriptSourceService.rename(request));
    }

    /**
     * 在段落边界拆分结构段。
     *
     * @param request 拆分请求
     * @param httpRequest 当前HTTP请求
     * @return 校对完成后的修订号
     */
    @PostMapping("/splitSection")
    public Mono<ApiResponse<ScriptSourceDtos.MutationResult>> splitSection(
            @Valid @RequestBody ScriptSourceDtos.SplitRequest request, ServerHttpRequest httpRequest) {
        return execute("拆分原文结构段", httpRequest, request, scriptSourceService.split(request));
    }

    /**
     * 合并相邻同级结构段。
     *
     * @param request 合并请求
     * @param httpRequest 当前HTTP请求
     * @return 校对完成后的修订号
     */
    @PostMapping("/mergeSections")
    public Mono<ApiResponse<ScriptSourceDtos.MutationResult>> mergeSections(
            @Valid @RequestBody ScriptSourceDtos.MergeRequest request, ServerHttpRequest httpRequest) {
        return execute("合并原文结构段", httpRequest, request, scriptSourceService.merge(request));
    }

    /**
     * 确认当前原文结构修订。
     *
     * @param request 确认请求
     * @param httpRequest 当前HTTP请求
     * @return 确认后的导入进度
     */
    @PostMapping("/confirmStructure")
    public Mono<ApiResponse<ScriptSourceDtos.ImportStatus>> confirmStructure(
            @Valid @RequestBody ScriptSourceDtos.ConfirmStructureRequest request, ServerHttpRequest httpRequest) {
        return execute("确认原文结构", httpRequest, request, scriptSourceService.confirmStructure(request));
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
