package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.InvitationDtos;
import com.novanovastudio.service.InvitationService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * 当前用户邀请信息接口。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-09 00:00
 */
@RestController
@RequestMapping("/api/v1/invitation")
@RequiredArgsConstructor
public class InvitationController {

    /** 邀请服务 */
    private final InvitationService invitationService;

    /**
     * 查询当前用户的邀请码。
     *
     * @return 当前用户邀请信息
     */
    @GetMapping("/getInvitationInfo")
    public Mono<ApiResponse<InvitationDtos.InvitationInfoResponse>> getInvitationInfo() {
        return invitationService.getInvitationInfo().map(ApiResponse::ok);
    }
}
