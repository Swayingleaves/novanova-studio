package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.CreditCardDtos;
import com.novanovastudio.dto.CreditDtos;
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
 * 用户积分消耗查询接口。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-19 16:00
 */
@RestController
@RequestMapping("/api/v1/credit")
@RequiredArgsConstructor
public class CreditController {

    /** 积分服务 */
    private final CreditService creditService;

    /** 卡密兑换服务 */
    private final CreditCardService creditCardService;

    /**
     * 查询当前用户的积分消耗概览。
     *
     * @param startDate LocalDate 筛选起始日期
     * @param endDate LocalDate 筛选结束日期
     * @param generationType String 图片或视频任务类型，可为空
     * @param trendUnit String 按日或按月聚合单位
     * @return Mono<ApiResponse<CreditOverviewResponse>> 积分消耗概览
     */
    @GetMapping("/getCreditOverview")
    public Mono<ApiResponse<CreditDtos.CreditOverviewResponse>> getCreditOverview(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate startDate,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate endDate,
            @RequestParam(required = false) String generationType,
            @RequestParam String trendUnit) {
        return creditService.getCreditOverview(startDate, endDate, generationType, trendUnit).map(ApiResponse::ok);
    }

    /**
     * 分页查询当前用户的积分明细（含增加与消耗）。
     *
     * @param startDate LocalDate 筛选起始日期
     * @param endDate LocalDate 筛选结束日期
     * @param direction String 变动方向：all/add/spend，可为空
     * @param source String 来源筛选：image/video/task_refund/card_redeem/admin_adjustment/initial_grant，可为空
     * @param page int 页码
     * @param pageSize int 每页数量
     * @return Mono<ApiResponse<UserCreditTransactionListResponse>> 积分明细
     */
    @GetMapping("/listCreditTransactions")
    public Mono<ApiResponse<CreditDtos.UserCreditTransactionListResponse>> listCreditTransactions(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate startDate,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate endDate,
            @RequestParam(required = false) String direction,
            @RequestParam(required = false) String source,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize) {
        return creditService.listCreditTransactions(startDate, endDate, direction, source, page, pageSize).map(ApiResponse::ok);
    }

    /**
     * 兑换积分卡密。
     *
     * @param request RedeemCreditsRequest 卡密兑换请求
     * @return Mono<ApiResponse<RedeemCreditsResponse>> 兑换结果
     */
    @PostMapping("/redeemCredits")
    public Mono<ApiResponse<CreditCardDtos.RedeemCreditsResponse>> redeemCredits(@Valid @RequestBody CreditCardDtos.RedeemCreditsRequest request) {
        return creditCardService.redeemCredits(request.cardCode()).map(ApiResponse::ok);
    }

    /**
     * 查询当前用户的卡密兑换记录。
     *
     * @param startDate LocalDate 起始日期
     * @param endDate LocalDate 结束日期
     * @param cardCode String 卡密完整值或末四位
     * @param page int 页码
     * @param pageSize int 每页数量
     * @return Mono<ApiResponse<RedemptionRecordListResponse>> 兑换记录
     */
    @GetMapping("/listRedemptionRecords")
    public Mono<ApiResponse<CreditCardDtos.RedemptionRecordListResponse>> listRedemptionRecords(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate startDate,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate endDate,
            @RequestParam(required = false) String cardCode,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize) {
        return creditCardService.listRedemptionRecords(startDate, endDate, cardCode, page, pageSize).map(ApiResponse::ok);
    }
}
