package com.novanovastudio.controller;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.service.TeamWalletService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * 独立钱包查询和团队积分发放接口。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-18 10:00
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class TeamWalletController {
    /** 钱包服务。 */
    private final TeamWalletService service;

    /** @return 当前用户的平台和团队钱包余额 */
    @GetMapping("/credit/getWalletBalances")
    public Mono<ApiResponse<JSONObject>> getWalletBalances() { return service.getWalletBalances().map(ApiResponse::ok); }

    /** @param request 目标成员与精确积分 @return 团队余额 */
    @PostMapping("/team/adjustMemberCredits")
    public Mono<ApiResponse<JSONObject>> adjustMemberCredits(@Valid @RequestBody AdjustRequest request) {
        return service.adjustMemberCredits(request.userId(), request.changeAmount(), request.reason()).map(ApiResponse::ok);
    }

    /**
     * 手动调整请求。
     * @param userId 当前团队成员
     * @param changeAmount 六位小数积分
     * @param reason 调整原因
     */
    public record AdjustRequest(@NotNull Long userId, @NotNull BigDecimal changeAmount, @NotBlank @Size(max = 200) String reason) { }
}
