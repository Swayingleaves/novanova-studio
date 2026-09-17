package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.CheckInDtos;
import com.novanovastudio.repository.CheckInRepository;
import com.novanovastudio.repository.CreditRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.task.AiTaskEventPublisher;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Mono;

/**
 * @title        CheckInService.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  用户每日签到服务
 * @createTime   2026-09-17 10:30:00
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class CheckInService {

    /** 签到业务时区，与积分统计保持一致 */
    private static final ZoneId CHECK_IN_TIME_ZONE = ZoneId.of("Asia/Shanghai");

    /** 月份参数格式 */
    private static final DateTimeFormatter MONTH_FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM");

    /** 签到积分有效小时数 */
    private static final long CREDIT_VALID_HOURS = 24;

    /** 签到记录仓储 */
    private final CheckInRepository checkInRepository;

    /** 积分仓储 */
    private final CreditRepository creditRepository;

    /** 会过期的积分发放批次服务 */
    private final CreditGrantService creditGrantService;

    /** 当前用户提供器 */
    private final CurrentUserProvider currentUserProvider;

    /** AI任务事件推送器，用于签到后同步前端积分余额 */
    private final AiTaskEventPublisher eventPublisher;

    /** 响应式事务操作器 */
    private final TransactionalOperator transactionalOperator;

    /**
     * 查询当前用户的签到状态。
     *
     * @param month String 查询月份，格式 yyyy-MM，为空时取服务端当月
     * @return Mono<CheckInStatusResponse> 签到状态
     */
    public Mono<CheckInDtos.CheckInStatusResponse> getStatus(String month) {
        LocalDate today = LocalDate.now(CHECK_IN_TIME_ZONE);
        return Mono.defer(() -> {
            YearMonth targetMonth = parseMonth(month, today);
            LocalDate monthStart = targetMonth.atDay(1);
            LocalDate monthEnd = targetMonth.plusMonths(1).atDay(1);
            return currentUserProvider.currentUserId().flatMap(userId -> Mono.zip(
                            checkInRepository.listCheckInDates(userId, monthStart, monthEnd).collectList(),
                            checkInRepository.getCheckIn(userId, today).map(Optional::of).defaultIfEmpty(Optional.empty()),
                            getRewardSettings())
                    .map(result -> new CheckInDtos.CheckInStatusResponse(
                            today.toString(),
                            result.getT2().isPresent(),
                            result.getT1().size(),
                            result.getT1().stream().map(LocalDate::toString).toList(),
                            result.getT3().checkInCredits(),
                            result.getT2().map(CheckInRepository.CheckInRecord::credits).orElse(0))));
        });
    }

    /**
     * 执行当前用户今日签到。
     * <p>
     * 每天只能签到一次，签到积分自签到时刻起24小时内有效，同一天重复提交由签到记录唯一约束拦截。
     *
     * @return Mono<CheckInResultResponse> 签到结果
     */
    public Mono<CheckInDtos.CheckInResultResponse> checkIn() {
        LocalDate today = LocalDate.now(CHECK_IN_TIME_ZONE);
        return currentUserProvider.currentUserId()
                .flatMap(userId -> transactionalOperator.transactional(doCheckIn(userId, today))
                        .flatMap(result -> eventPublisher.publish(userId, new AiTaskDtos.AiTaskEvent("credit-balance", null, null, result.creditBalance()))
                                .thenReturn(result)));
    }

    /**
     * 查询签到积分设置。
     *
     * @return Mono<CheckInRewardSettingsResponse> 签到积分设置
     */
    public Mono<CheckInDtos.CheckInRewardSettingsResponse> getRewardSettings() {
        return creditRepository.getCheckInCredits().map(CheckInDtos.CheckInRewardSettingsResponse::new);
    }

    /**
     * 更新签到积分设置。
     *
     * @param request UpdateCheckInRewardSettingsRequest 签到积分设置请求
     * @return Mono<CheckInRewardSettingsResponse> 保存后的签到积分设置
     */
    public Mono<CheckInDtos.CheckInRewardSettingsResponse> updateRewardSettings(CheckInDtos.UpdateCheckInRewardSettingsRequest request) {
        return creditRepository.updateCheckInCredits(request.checkInCredits())
                .thenReturn(new CheckInDtos.CheckInRewardSettingsResponse(request.checkInCredits()));
    }

    /**
     * 在事务内写入签到记录并发放签到积分。
     *
     * @param userId Long 用户ID
     * @param today LocalDate 服务端今天日期
     * @return Mono<CheckInResultResponse> 签到结果
     */
    private Mono<CheckInDtos.CheckInResultResponse> doCheckIn(Long userId, LocalDate today) {
        return Mono.zip(
                        checkInRepository.getCheckIn(userId, today).map(Optional::of).defaultIfEmpty(Optional.empty()),
                        getRewardSettings())
                .flatMap(result -> {
                    if (result.getT1().isPresent()) {
                        return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "今日已签到，明天再来"));
                    }
                    int earnedCredits = result.getT2().checkInCredits();
                    return checkInRepository.claimCheckIn(userId, today, earnedCredits)
                            .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "今日已签到，明天再来")))
                            .flatMap(recordId -> grantCredits(userId, earnedCredits, recordId))
                            .map(balance -> new CheckInDtos.CheckInResultResponse(today.toString(), earnedCredits, balance))
                            .doOnSuccess(response -> log.info("用户签到成功: userId={}, date={}, earnedCredits={}",
                                    userId, today, response.earnedCredits()));
                });
    }

    /**
     * 发放签到积分并写入流水。
     * <p>
     * 签到积分自签到时刻起 24 小时内有效，写入会过期的发放批次；积分配置为0时只保留签到记录，不创建零金额流水。
     *
     * @param userId Long 用户ID
     * @param earnedCredits int 本次签到获得的积分
     * @param checkInRecordId Long 签到记录ID，用于追溯发放批次
     * @return Mono<Integer> 发放后的积分余额
     */
    private Mono<Integer> grantCredits(Long userId, int earnedCredits, Long checkInRecordId) {
        if (earnedCredits == 0) {
            return creditRepository.getCreditBalance(userId)
                    .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "积分账户不存在，无法签到")));
        }
        OffsetDateTime expiresAt = OffsetDateTime.now(CHECK_IN_TIME_ZONE).plusHours(CREDIT_VALID_HOURS);
        return creditGrantService.grantExpiringCredits(userId, CreditService.TRANSACTION_DAILY_CHECK_IN, String.valueOf(checkInRecordId), earnedCredits, expiresAt)
                .flatMap(balance -> creditRepository.createTransaction(userId, CreditService.TRANSACTION_DAILY_CHECK_IN, null, earnedCredits, balance, "每日签到")
                        .thenReturn(balance));
    }

    /**
     * 解析查询月份。
     *
     * @param month String 月份参数，为空时取服务端当月
     * @param today LocalDate 服务端今天日期
     * @return YearMonth 目标月份
     */
    private static YearMonth parseMonth(String month, LocalDate today) {
        if (month == null || month.isBlank()) {
            return YearMonth.from(today);
        }
        try {
            return YearMonth.parse(month.trim(), MONTH_FORMATTER);
        } catch (DateTimeParseException exception) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "月份参数格式应为yyyy-MM");
        }
    }
}
