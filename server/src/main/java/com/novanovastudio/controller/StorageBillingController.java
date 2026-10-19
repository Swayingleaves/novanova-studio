package com.novanovastudio.controller;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.security.AdminGuard;
import com.novanovastudio.service.StorageBillingService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Mono;

/**
 * 存储占用、费率和账单接口。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-18 10:00
 */
@RestController
@RequestMapping("/api/v1/storage")
@RequiredArgsConstructor
public class StorageBillingController {
    /** 存储计费服务。 */
    private final StorageBillingService service;
    /** 当前空间管理员校验。 */
    private final AdminGuard adminGuard;

    /** @return 本人当前空间存储占用 */
    @GetMapping("/getUsage")
    public Mono<ApiResponse<List<JSONObject>>> getUsage() { return service.getUsage(false).map(ApiResponse::ok); }
    /** @return 管理员可见的当前空间存储占用汇总 */
    @GetMapping("/getTeamUsage")
    public Mono<ApiResponse<List<JSONObject>>> getTeamUsage() { return adminGuard.requireAdmin().then(service.getUsage(true)).map(ApiResponse::ok); }
    /** @return 本人当前空间账单 */
    @GetMapping("/listBills")
    public Mono<ApiResponse<List<JSONObject>>> listBills() { return service.listBills(false).map(ApiResponse::ok); }
    /** @return 当前空间成员账单 */
    @GetMapping("/listTeamBills")
    public Mono<ApiResponse<List<JSONObject>>> listTeamBills() { return adminGuard.requireAdmin().then(service.listBills(true)).map(ApiResponse::ok); }
    /** @return 当前空间存储费率 */
    @GetMapping("/listBillingRates")
    public Mono<ApiResponse<List<JSONObject>>> listBillingRates() { return adminGuard.requireAdmin().then(service.listRates()).map(ApiResponse::ok); }
    /** @return 历史文件待确认存储身份，不包含成员私有内容 */
    @GetMapping("/listUnregisteredStorageGroups")
    public Mono<ApiResponse<List<JSONObject>>> listUnregisteredStorageGroups() { return adminGuard.requireAdmin().then(service.listUnregisteredStorageGroups()).map(ApiResponse::ok); }
    /** @param request 管理员明确选择的存储 @return 历史对象补录结果 */
    @PostMapping("/registerExistingMedia")
    public Mono<ApiResponse<String>> registerExistingMedia(@Valid @RequestBody ExistingMediaRequest request) {
        return adminGuard.requireAdmin().then(service.registerExistingMedia(request.storageId())).thenReturn(ApiResponse.ok("ok"));
    }
    /** @param storageId 明确确认的自有存储配置 */
    public record ExistingMediaRequest(@NotBlank String storageId) { }
    /** @param request 自有存储费率 @return 操作结果 */
    @PostMapping("/saveBillingRate")
    public Mono<ApiResponse<String>> saveBillingRate(@Valid @RequestBody RateRequest request) {
        return adminGuard.requireAdmin().then(service.saveRate(request.storageId(), request.creditsPerGigabyteMonth(), request.enabledDate())).thenReturn(ApiResponse.ok("ok"));
    }
    /**
     * 存储费率设置。
     * @param storageId 自有存储配置
     * @param creditsPerGigabyteMonth 每GB月积分
     * @param enabledDate 首次启用日期
     */
    public record RateRequest(@NotBlank String storageId, @NotNull BigDecimal creditsPerGigabyteMonth, LocalDate enabledDate) { }
}
