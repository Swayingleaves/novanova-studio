package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.CreditCardDtos;
import com.novanovastudio.dto.CreditDtos;
import com.novanovastudio.security.AdminGuard;
import com.novanovastudio.security.RequireRole;
import com.novanovastudio.service.CreditCardService;
import com.novanovastudio.service.CreditService;
import jakarta.validation.Valid;
import java.time.LocalDate;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * 管理员积分消耗查询接口。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-19 15:20
 */
@RestController
@RequestMapping("/api/v1/admin/credit")
@RequiredArgsConstructor
@RequireRole("admin")
public class AdminCreditController {

    /** 积分服务 */
    private final CreditService creditService;

    /** 卡密管理服务 */
    private final CreditCardService creditCardService;

    /** 管理员校验 */
    private final AdminGuard adminGuard;

    /**
     * 查询管理员可见的积分消耗概览。
     *
     * @param userId Long 用户ID，可为空表示全部用户
     * @param startDate LocalDate 筛选起始日期
     * @param endDate LocalDate 筛选结束日期
     * @param generationType String 图片或视频任务类型，可为空
     * @param trendUnit String 按日或按月聚合单位
     * @return Mono<ApiResponse<CreditOverviewResponse>> 积分消耗概览
     */
    @GetMapping("/getCreditOverview")
    public Mono<ApiResponse<CreditDtos.CreditOverviewResponse>> getCreditOverview(
            @RequestParam(required = false) Long userId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate startDate,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate endDate,
            @RequestParam(required = false) String generationType,
            @RequestParam String trendUnit) {
        return adminGuard.requireAdmin()
                .then(Mono.defer(() -> creditService.getAdminCreditOverview(userId, startDate, endDate, generationType, trendUnit)))
                .map(ApiResponse::ok);
    }

    /**
     * 分页查询管理员可见的积分消耗明细。
     *
     * @param userId Long 用户ID，可为空表示全部用户
     * @param startDate LocalDate 筛选起始日期
     * @param endDate LocalDate 筛选结束日期
     * @param generationType String 图片或视频任务类型，可为空
     * @param page int 页码
     * @param pageSize int 每页数量
     * @return Mono<ApiResponse<AdminCreditTransactionListResponse>> 积分消耗明细
     */
    @GetMapping("/listCreditTransactions")
    public Mono<ApiResponse<CreditDtos.AdminCreditTransactionListResponse>> listCreditTransactions(
            @RequestParam(required = false) Long userId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate startDate,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate endDate,
            @RequestParam(required = false) String generationType,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize) {
        return adminGuard.requireAdmin()
                .then(Mono.defer(() -> creditService.listAdminCreditTransactions(userId, startDate, endDate, generationType, page, pageSize)))
                .map(ApiResponse::ok);
    }

    /**
     * 批量生成积分卡密。
     *
     * @param request GenerateCreditCardsRequest 生成参数
     * @return Mono<ApiResponse<GenerateCreditCardsResponse>> 生成结果
     */
    @PostMapping("/generateCreditCards")
    public Mono<ApiResponse<CreditCardDtos.GenerateCreditCardsResponse>> generateCreditCards(@Valid @RequestBody CreditCardDtos.GenerateCreditCardsRequest request) {
        return adminGuard.requireAdmin().then(Mono.defer(() -> creditCardService.generateCreditCards(request))).map(ApiResponse::ok);
    }

    /**
     * 分页查询卡密生成批次。
     *
     * @param page int 页码
     * @param pageSize int 每页数量
     * @return Mono<ApiResponse<CreditCardBatchListResponse>> 批次列表
     */
    @GetMapping("/listCreditCardBatches")
    public Mono<ApiResponse<CreditCardDtos.CreditCardBatchListResponse>> listCreditCardBatches(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize) {
        return adminGuard.requireAdmin().then(Mono.defer(() -> creditCardService.listCreditCardBatches(page, pageSize))).map(ApiResponse::ok);
    }

    /**
     * 分页查询卡密库存及兑换详情。
     *
     * @param batchId Long 批次ID
     * @param status String 卡密状态
     * @param cardCode String 卡密完整值或末四位
     * @param redeemedUserKeyword String 兑换用户关键词
     * @param includeCode boolean 是否返回卡密明文
     * @param page int 页码
     * @param pageSize int 每页数量
     * @return Mono<ApiResponse<CreditCardListResponse>> 卡密列表
     */
    @GetMapping("/listCreditCards")
    public Mono<ApiResponse<CreditCardDtos.CreditCardListResponse>> listCreditCards(
            @RequestParam(required = false) Long batchId,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String cardCode,
            @RequestParam(required = false) String redeemedUserKeyword,
            @RequestParam(defaultValue = "false") boolean includeCode,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize) {
        return adminGuard.requireAdmin()
                .then(Mono.defer(() -> creditCardService.listCreditCards(batchId, status, cardCode, redeemedUserKeyword, includeCode, page, pageSize)))
                .map(ApiResponse::ok);
    }
}
