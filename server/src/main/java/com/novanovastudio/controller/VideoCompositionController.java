package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.VideoCompositionDtos;
import com.novanovastudio.service.VideoCompositionTaskService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * 画布视频合成任务接口。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-11 00:00
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/ai/video")
@RequiredArgsConstructor
public class VideoCompositionController {

    /** 视频合成任务服务 */
    private final VideoCompositionTaskService videoCompositionTaskService;

    /**
     * 创建视频合成任务。
     *
     * @param request CreateVideoCompositionRequest 创建请求
     * @param httpRequest ServerHttpRequest HTTP请求
     * @return Mono<ApiResponse<VideoCompositionTaskResponse>> 创建结果
     */
    @PostMapping("/composeVideo")
    public Mono<ApiResponse<VideoCompositionDtos.VideoCompositionTaskResponse>> composeVideo(
            @Valid @RequestBody VideoCompositionDtos.CreateVideoCompositionRequest request, ServerHttpRequest httpRequest) {
        log.info("视频合成请求: url=/api/v1/ai/video/composeVideo, headers={}, request={}", httpRequest.getHeaders(), request);
        return videoCompositionTaskService.createTask(request)
                .doOnNext(response -> log.info("视频合成任务已创建: response={}", response))
                .map(ApiResponse::ok);
    }

    /**
     * 查询视频合成任务状态。
     *
     * @param request VideoCompositionTaskIdRequest 任务ID请求
     * @param httpRequest ServerHttpRequest HTTP请求
     * @return Mono<ApiResponse<VideoCompositionTaskResponse>> 查询结果
     */
    @PostMapping("/getCompositionTask")
    public Mono<ApiResponse<VideoCompositionDtos.VideoCompositionTaskResponse>> getCompositionTask(
            @Valid @RequestBody VideoCompositionDtos.VideoCompositionTaskIdRequest request, ServerHttpRequest httpRequest) {
        log.info("查询视频合成任务: url=/api/v1/ai/video/getCompositionTask, headers={}, request={}", httpRequest.getHeaders(), request);
        return videoCompositionTaskService.getTask(request.taskId())
                .doOnNext(response -> log.info("视频合成任务查询响应: response={}", response))
                .map(ApiResponse::ok);
    }

    /**
     * 取消视频合成任务。
     *
     * @param request VideoCompositionTaskIdRequest 任务ID请求
     * @param httpRequest ServerHttpRequest HTTP请求
     * @return Mono<ApiResponse<VideoCompositionTaskResponse>> 取消结果
     */
    @PostMapping("/cancelCompositionTask")
    public Mono<ApiResponse<VideoCompositionDtos.VideoCompositionTaskResponse>> cancelCompositionTask(
            @Valid @RequestBody VideoCompositionDtos.VideoCompositionTaskIdRequest request, ServerHttpRequest httpRequest) {
        log.info("取消视频合成任务: url=/api/v1/ai/video/cancelCompositionTask, headers={}, request={}", httpRequest.getHeaders(), request);
        return videoCompositionTaskService.cancelTask(request.taskId())
                .doOnNext(response -> log.info("视频合成任务取消响应: response={}", response))
                .map(ApiResponse::ok);
    }
}
