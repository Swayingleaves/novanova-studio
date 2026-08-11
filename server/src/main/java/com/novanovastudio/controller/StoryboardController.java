package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.StoryboardDtos;
import com.novanovastudio.service.StoryboardAgentService;
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
 * 分镜脚本生成与中文提示词合成接口。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-08 00:00
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/ai/storyboard")
@RequiredArgsConstructor
public class StoryboardController {

    /** 分镜脚本业务服务。 */
    private final StoryboardAgentService storyboardAgentService;

    /**
     * 根据剧本文本和剧情描述生成分镜与资产清单。
     *
     * @param request GenerateStoryboardRequest 分镜生成请求
     * @param httpRequest ServerHttpRequest HTTP请求
     * @return Mono<ApiResponse<GenerateStoryboardResponse>> 分镜生成结果
     */
    @PostMapping("/generateStoryboard")
    public Mono<ApiResponse<StoryboardDtos.GenerateStoryboardResponse>> generateStoryboard(
            @Valid @RequestBody StoryboardDtos.GenerateStoryboardRequest request, ServerHttpRequest httpRequest) {
        log.info("分镜生成请求: url=/api/v1/ai/storyboard/generateStoryboard, headers={}, request={}", httpRequest.getHeaders(), request);
        return storyboardAgentService.generateStoryboard(request)
                .doOnNext(response -> log.info("分镜生成响应: response={}", response))
                .map(ApiResponse::ok);
    }

    /**
     * 为当前镜头和资产一次性合成全部中文最终提示词。
     *
     * @param request ComposePromptsRequest 提示词合成请求
     * @param httpRequest ServerHttpRequest HTTP请求
     * @return Mono<ApiResponse<ComposePromptsResponse>> 提示词合成结果
     */
    @PostMapping("/composePrompts")
    public Mono<ApiResponse<StoryboardDtos.ComposePromptsResponse>> composePrompts(
            @Valid @RequestBody StoryboardDtos.ComposePromptsRequest request, ServerHttpRequest httpRequest) {
        log.info("分镜提示词合成请求: url=/api/v1/ai/storyboard/composePrompts, headers={}, request={}", httpRequest.getHeaders(), request);
        return storyboardAgentService.composePrompts(request)
                .doOnNext(response -> log.info("分镜提示词合成响应: response={}", response))
                .map(ApiResponse::ok);
    }
}
