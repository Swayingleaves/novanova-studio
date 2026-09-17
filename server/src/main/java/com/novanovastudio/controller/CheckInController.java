package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.CheckInDtos;
import com.novanovastudio.service.CheckInService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * 用户每日签到接口。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-17 10:30
 */
@RestController
@RequestMapping("/api/v1/checkIn")
@RequiredArgsConstructor
public class CheckInController {

    /** 签到服务 */
    private final CheckInService checkInService;

    /**
     * 查询当前用户签到状态。
     *
     * @param month String 查询月份，格式 yyyy-MM，为空时取服务端当月
     * @return Mono<ApiResponse<CheckInStatusResponse>> 签到状态
     */
    @GetMapping("/getCheckInStatus")
    public Mono<ApiResponse<CheckInDtos.CheckInStatusResponse>> getCheckInStatus(@RequestParam(required = false) String month) {
        return checkInService.getStatus(month).map(ApiResponse::ok);
    }

    /**
     * 执行当前用户今日签到。
     *
     * @return Mono<ApiResponse<CheckInResultResponse>> 签到结果
     */
    @PostMapping("/checkIn")
    public Mono<ApiResponse<CheckInDtos.CheckInResultResponse>> checkIn() {
        return checkInService.checkIn().map(ApiResponse::ok);
    }
}
