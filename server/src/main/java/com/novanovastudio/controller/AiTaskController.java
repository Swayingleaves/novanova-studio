package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.ai.AiTaskSources;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.service.AiTaskService;
import jakarta.validation.Valid;
import java.util.Arrays;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * @title        AiTaskController.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  响应式AI任务接口
 * @createTime   2026-06-24 18:55:00
 */
@RestController
@RequestMapping("/api/v1/ai")
@RequiredArgsConstructor
public class AiTaskController {

    /** AI任务服务 */
    private final AiTaskService aiTaskService;

    /**
     * 创建AI任务
     *
     * @param request CreateAiTaskRequest 创建请求
     * @return Mono<ApiResponse<AiGenerationTaskResponse>> 任务响应
     */
    @PostMapping("/task/createTask")
    public Mono<ApiResponse<AiTaskDtos.AiGenerationTaskResponse>> createTask(@Valid @RequestBody AiTaskDtos.CreateAiTaskRequest request) {
        return aiTaskService.createTask(request).map(ApiResponse::ok);
    }

    /**
     * 查询AI任务列表
     *
     * @param status String 状态筛选
     * @return Mono<ApiResponse<AiTaskListResponse>> 任务列表
     */
    @GetMapping("/task/listTasks")
    public Mono<ApiResponse<AiTaskDtos.AiTaskListResponse>> listTasks(@RequestParam(required = false) String status) {
        List<String> statuses = status == null || status.isBlank() ? List.of() : Arrays.stream(status.split(",")).map(String::trim).filter(item -> !item.isBlank()).toList();
        return aiTaskService.listTasks(statuses).map(tasks -> ApiResponse.ok(new AiTaskDtos.AiTaskListResponse(tasks)));
    }

    /**
     * 查询AI任务详情
     *
     * @param taskId String 任务ID
     * @param id String 兼容任务ID
     * @return Mono<ApiResponse<AiGenerationTaskResponse>> 任务详情
     */
    @GetMapping("/task/getTaskInfo")
    public Mono<ApiResponse<AiTaskDtos.AiGenerationTaskResponse>> getTaskInfo(@RequestParam(required = false) String taskId, @RequestParam(required = false) String id) {
        String resolvedId = taskId == null || taskId.isBlank() ? id : taskId;
        return aiTaskService.getTask(resolvedId).map(ApiResponse::ok);
    }

    /**
     * 取消AI任务
     *
     * @param request AiTaskIdRequest 请求
     * @return Mono<ApiResponse<AiGenerationTaskResponse>> 任务详情
     */
    @PostMapping("/task/cancelTask")
    public Mono<ApiResponse<AiTaskDtos.AiGenerationTaskResponse>> cancelTask(@Valid @RequestBody AiTaskDtos.AiTaskIdRequest request) {
        return aiTaskService.cancelTask(request.taskId()).map(ApiResponse::ok);
    }

    /**
     * 订阅AI任务事件
     *
     * @return Flux<ServerSentEvent<AiTaskEvent>> SSE事件流
     */
    @GetMapping(value = "/task/subscribe", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<AiTaskDtos.AiTaskEvent>> subscribe() {
        return aiTaskService.subscribe();
    }

    /**
     * 查询服务端AI模型
     *
     * @return Mono<ApiResponse<AiModelListResponse>> 模型列表
     */
    @GetMapping("/model/listModels")
    public Mono<ApiResponse<AiTaskDtos.AiModelListResponse>> listModels() {
        return aiTaskService.listModels().map(ApiResponse::ok);
    }

    /**
     * 兼容旧同步生图接口，内部创建异步任务
     *
     * @param request CreateAiTaskRequest 请求
     * @return Mono<ApiResponse<AiGenerationTaskResponse>> 任务响应
     */
    @PostMapping("/image/generate")
    public Mono<ApiResponse<AiTaskDtos.AiGenerationTaskResponse>> generateImage(@RequestBody AiTaskDtos.CreateAiTaskRequest request) {
        return aiTaskService.createTask(new AiTaskDtos.CreateAiTaskRequest("image", request.prompt(), request.model(), request.parameters(), request.references(), request.videoReferences(), AiTaskSources.IMAGE_PAGE)).map(ApiResponse::ok);
    }

    /**
     * 兼容旧同步视频接口，内部创建异步任务
     *
     * @param request CreateAiTaskRequest 请求
     * @return Mono<ApiResponse<AiGenerationTaskResponse>> 任务响应
     */
    @PostMapping("/video/generate")
    public Mono<ApiResponse<AiTaskDtos.AiGenerationTaskResponse>> generateVideo(@RequestBody AiTaskDtos.CreateAiTaskRequest request) {
        return aiTaskService.createTask(new AiTaskDtos.CreateAiTaskRequest("video", request.prompt(), request.model(), request.parameters(),
                request.references(), request.videoReferences(), AiTaskSources.VIDEO_PAGE, null, null, request.videoGenerationMode())).map(ApiResponse::ok);
    }

    /**
     * 获取视频技能工作流的服务端权威报价。
     *
     * @param request VideoWorkflowQuoteRequest 工作流报价请求
     * @return Mono<ApiResponse<VideoWorkflowQuoteResponse>> 工作流阶段报价
     */
    @PostMapping("/video/workflowQuote")
    public Mono<ApiResponse<AiTaskDtos.VideoWorkflowQuoteResponse>> workflowQuote(
            @RequestBody AiTaskDtos.VideoWorkflowQuoteRequest request) {
        return aiTaskService.quoteVideoWorkflow(request).map(ApiResponse::ok);
    }

    /**
     * 兼容旧视频轮询接口
     *
     * @param taskId String 任务ID
     * @return Mono<ApiResponse<AiGenerationTaskResponse>> 任务详情
     */
    @GetMapping("/video/poll/{taskId}")
    public Mono<ApiResponse<AiTaskDtos.AiGenerationTaskResponse>> pollVideoTask(@PathVariable String taskId) {
        return aiTaskService.getTask(taskId).map(ApiResponse::ok);
    }

}
