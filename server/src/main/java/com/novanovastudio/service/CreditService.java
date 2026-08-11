package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.CreditDtos;
import com.novanovastudio.repository.CreditRepository;
import com.novanovastudio.security.CurrentUserProvider;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Mono;

/**
 * @title        CreditService.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  用户积分账户与流水服务
 * @createTime   2026-07-16 14:00:00
 */
@Service
@RequiredArgsConstructor
public class CreditService {

    /** 积分统计业务时区 */
    private static final ZoneId CREDIT_TIME_ZONE = ZoneId.of("Asia/Shanghai");

    /** 按日趋势聚合单位 */
    private static final String TREND_UNIT_DAY = "day";

    /** 按月趋势聚合单位 */
    private static final String TREND_UNIT_MONTH = "month";

    /** 初始积分流水类型 */
    public static final String TRANSACTION_INITIAL_GRANT = "initial_grant";

    /** 任务扣费流水类型 */
    public static final String TRANSACTION_TASK_CHARGE = "task_charge";

    /** 任务退款流水类型 */
    public static final String TRANSACTION_TASK_REFUND = "task_refund";

    /** 管理员调整流水类型 */
    public static final String TRANSACTION_ADMIN_ADJUSTMENT = "admin_adjustment";

    /** 积分仓储 */
    private final CreditRepository creditRepository;

    /** 当前用户提供器 */
    private final CurrentUserProvider currentUserProvider;

    /** 响应式事务操作器 */
    private final TransactionalOperator transactionalOperator;

    /**
     * 查询积分设置。
     *
     * @return Mono<CreditSettingsResponse> 积分设置
     */
    public Mono<CreditDtos.CreditSettingsResponse> getSettings() {
        return creditRepository.getInitialCredits().map(CreditDtos.CreditSettingsResponse::new);
    }

    /**
     * 更新积分设置。
     *
     * @param request UpdateCreditSettingsRequest 积分设置请求
     * @return Mono<CreditSettingsResponse> 保存后的积分设置
     */
    public Mono<CreditDtos.CreditSettingsResponse> updateSettings(CreditDtos.UpdateCreditSettingsRequest request) {
        return creditRepository.updateInitialCredits(request.initialCredits())
                .thenReturn(new CreditDtos.CreditSettingsResponse(request.initialCredits()));
    }

    /**
     * 为新用户创建积分账户并记录初始发放流水。
     *
     * @param userId Long 新用户ID
     * @return Mono<Void> 操作完成信号
     */
    public Mono<Void> initializeAccount(Long userId) {
        return creditRepository.getInitialCredits()
                .flatMap(initialCredits -> creditRepository.createAccount(userId, initialCredits)
                        .then(initialCredits == 0
                                ? Mono.empty()
                                : creditRepository.createTransaction(userId, TRANSACTION_INITIAL_GRANT, null, initialCredits, initialCredits, "新用户初始发放")));
    }

    /**
     * 扣除AI任务积分。
     *
     * @param userId Long 用户ID
     * @param taskId String AI任务ID
     * @param credits int 应扣积分
     * @param taskType String 任务类型
     * @param generationSource String 生成来源
     * @return Mono<Void> 操作完成信号
     */
    public Mono<Void> chargeTask(Long userId, String taskId, int credits, String taskType, String generationSource) {
        if (credits == 0) {
            return Mono.empty();
        }
        return creditRepository.claimTaskTransaction(userId, taskId, TRANSACTION_TASK_CHARGE, -credits, taskReason(taskType, "扣费"), generationSource)
                .flatMap(transactionId -> creditRepository.changeBalance(userId, -credits)
                        .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "积分不足，无法创建生成任务")))
                        .flatMap(balance -> creditRepository.updateTransactionBalance(transactionId, balance)))
                .then();
    }

    /**
     * 退还失败或取消AI任务的原始扣费积分。
     *
     * @param userId Long 用户ID
     * @param taskId String AI任务ID
     * @param taskType String 任务类型
     * @return Mono<Void> 操作完成信号
     */
    public Mono<Void> refundTask(Long userId, String taskId, String taskType) {
        return creditRepository.getTaskChargeAmount(taskId)
                .flatMap(credits -> creditRepository.claimTaskTransaction(userId, taskId, TRANSACTION_TASK_REFUND, credits, taskReason(taskType, "退款"), null)
                        .flatMap(transactionId -> creditRepository.changeBalance(userId, credits)
                                .flatMap(balance -> creditRepository.updateTransactionBalance(transactionId, balance)))
                        .then())
                .then();
    }

    /**
     * 扣除同步业务操作积分。
     * <p>
     * 操作标识只在当前业务的扣费与退款之间关联，不会改变普通文本生成的零积分规则。
     *
     * @param userId Long 用户ID
     * @param operationId String 稳定操作标识
     * @param credits int 应扣积分
     * @param operationName String 业务名称
     * @return Mono<Void> 操作完成信号
     */
    public Mono<Void> chargeOperation(Long userId, String operationId, int credits, String operationName) {
        if (credits < 0) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "积分扣费金额不能小于0"));
        }
        if (credits == 0) {
            return Mono.empty();
        }
        String chargeReason = operationReason(operationName, "扣费", operationId);
        return creditRepository.claimOperationTransaction(userId, operationId, TRANSACTION_TASK_CHARGE, -credits, chargeReason)
                .flatMap(transactionId -> creditRepository.changeBalance(userId, -credits)
                        .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "积分不足，无法执行" + operationName)))
                        .flatMap(balance -> creditRepository.updateTransactionBalance(transactionId, balance)))
                .then()
                .as(transactionalOperator::transactional);
    }

    /**
     * 退还失败同步业务操作的原始扣费积分。
     *
     * @param userId Long 用户ID
     * @param operationId String 稳定操作标识
     * @param operationName String 业务名称
     * @return Mono<Void> 操作完成信号
     */
    public Mono<Void> refundOperation(Long userId, String operationId, String operationName) {
        String chargeReason = operationReason(operationName, "扣费", operationId);
        String refundReason = operationReason(operationName, "退款", operationId);
        return creditRepository.getOperationChargeAmount(userId, chargeReason)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "未找到需要退款的" + operationName + "扣费流水")))
                .flatMap(credits -> creditRepository.claimOperationTransaction(userId, operationId, TRANSACTION_TASK_REFUND, credits, refundReason)
                        .flatMap(transactionId -> creditRepository.changeBalance(userId, credits)
                                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, operationName + "退款失败")))
                                .flatMap(balance -> creditRepository.updateTransactionBalance(transactionId, balance)))
                        .then())
                .then()
                .as(transactionalOperator::transactional);
    }

    /**
     * 管理员增减用户积分。
     *
     * @param userId Long 目标用户ID
     * @param operatorUserId Long 操作管理员ID
     * @param changeAmount int 积分变动值
     * @param reason String 调整原因
     * @return Mono<CreditBalanceResponse> 调整后的用户积分余额
     */
    public Mono<CreditDtos.CreditBalanceResponse> adjustUserCredits(Long userId, Long operatorUserId, int changeAmount, String reason) {
        if (changeAmount == 0) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "积分变动值不能为0"));
        }
        return creditRepository.changeBalance(userId, changeAmount)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "积分不足，无法完成扣减")))
                .flatMap(balance -> creditRepository.createTransaction(userId, TRANSACTION_ADMIN_ADJUSTMENT, operatorUserId, changeAmount, balance, reason.trim())
                        .thenReturn(new CreditDtos.CreditBalanceResponse(userId, balance)))
                .as(transactionalOperator::transactional);
    }

    /**
     * 查询当前用户的积分消耗概览。
     *
     * @param startDate LocalDate 筛选起始日期
     * @param endDate LocalDate 筛选结束日期
     * @param generationType String 图片或视频任务类型，可为空
     * @param trendUnit String 按日或按月聚合单位
     * @return Mono<CreditOverviewResponse> 积分消耗概览
     */
    public Mono<CreditDtos.CreditOverviewResponse> getCreditOverview(LocalDate startDate, LocalDate endDate, String generationType, String trendUnit) {
        return currentUserProvider.currentUserId().flatMap(userId -> queryCreditOverview(userId, startDate, endDate, generationType, trendUnit));
    }

    /**
     * 查询管理员可见的积分消耗概览。
     *
     * @param userId Long 用户ID，可为空表示全部用户
     * @param startDate LocalDate 筛选起始日期
     * @param endDate LocalDate 筛选结束日期
     * @param generationType String 图片或视频任务类型，可为空
     * @param trendUnit String 按日或按月聚合单位
     * @return Mono<CreditOverviewResponse> 积分消耗概览
     */
    public Mono<CreditDtos.CreditOverviewResponse> getAdminCreditOverview(Long userId, LocalDate startDate, LocalDate endDate, String generationType, String trendUnit) {
        return Mono.defer(() -> queryCreditOverview(userId, startDate, endDate, generationType, trendUnit));
    }

    /**
     * 分页查询当前用户的积分消耗明细。
     *
     * @param startDate LocalDate 筛选起始日期
     * @param endDate LocalDate 筛选结束日期
     * @param generationType String 图片或视频任务类型，可为空
     * @param page int 页码
     * @param pageSize int 每页数量
     * @return Mono<CreditTransactionListResponse> 积分消耗明细
     */
    public Mono<CreditDtos.CreditTransactionListResponse> listCreditTransactions(LocalDate startDate, LocalDate endDate, String generationType, int page, int pageSize) {
        if (page < 1 || pageSize < 1 || pageSize > 100) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "分页参数不合法"));
        }
        return currentUserProvider.currentUserId().flatMap(userId -> {
            CreditRepository.CreditConsumptionQuery query = createConsumptionQuery(userId, startDate, endDate, generationType);
            return Mono.zip(
                            creditRepository.listCreditTransactions(query, page, pageSize).collectList(),
                            creditRepository.countCreditTransactions(query))
                    .map(result -> new CreditDtos.CreditTransactionListResponse(result.getT1(), result.getT2()));
        });
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
     * @return Mono<AdminCreditTransactionListResponse> 积分消耗明细
     */
    public Mono<CreditDtos.AdminCreditTransactionListResponse> listAdminCreditTransactions(Long userId, LocalDate startDate, LocalDate endDate, String generationType, int page, int pageSize) {
        if (page < 1 || pageSize < 1 || pageSize > 100) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "分页参数不合法"));
        }
        return Mono.defer(() -> {
            CreditRepository.CreditConsumptionQuery query = createConsumptionQuery(userId, startDate, endDate, generationType);
            return Mono.zip(
                            creditRepository.listAdminCreditTransactions(query, page, pageSize).collectList(),
                            creditRepository.countCreditTransactions(query))
                    .map(result -> new CreditDtos.AdminCreditTransactionListResponse(result.getT1(), result.getT2()));
        });
    }

    /**
     * 查询指定范围内的积分消耗概览。
     *
     * @param userId Long 用户ID，可为空表示全部用户
     * @param startDate LocalDate 筛选起始日期
     * @param endDate LocalDate 筛选结束日期
     * @param generationType String 图片或视频任务类型，可为空
     * @param trendUnit String 按日或按月聚合单位
     * @return Mono<CreditOverviewResponse> 积分消耗概览
     */
    private Mono<CreditDtos.CreditOverviewResponse> queryCreditOverview(Long userId, LocalDate startDate, LocalDate endDate, String generationType, String trendUnit) {
        CreditRepository.CreditConsumptionQuery query = createConsumptionQuery(userId, startDate, endDate, generationType);
        validateTrendUnit(trendUnit);
        return Mono.zip(
                        creditRepository.listGenerationTypeDistribution(query).collectList(),
                        creditRepository.listModelDistribution(query).collectList(),
                        creditRepository.listTrend(query, trendUnit).collectList())
                .map(result -> new CreditDtos.CreditOverviewResponse(
                        result.getT1(),
                        result.getT2(),
                        completeTrend(query.startDate(), query.endDate(), trendUnit, result.getT3())));
    }

    /**
     * 构建并校验积分消耗查询条件。
     *
     * @param userId Long 用户ID，可为空表示全部用户
     * @param startDate LocalDate 筛选起始日期
     * @param endDate LocalDate 筛选结束日期
     * @param generationType String 图片或视频任务类型，可为空
     * @return CreditConsumptionQuery 已校验的查询条件
     */
    private CreditRepository.CreditConsumptionQuery createConsumptionQuery(Long userId, LocalDate startDate, LocalDate endDate, String generationType) {
        if (startDate == null || endDate == null || startDate.isAfter(endDate)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "积分筛选日期不合法");
        }
        if (generationType != null && !List.of("image", "video").contains(generationType)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "积分筛选类型仅支持image或video");
        }
        OffsetDateTime startAt = startDate.atStartOfDay(CREDIT_TIME_ZONE).toOffsetDateTime();
        OffsetDateTime endAt = endDate.plusDays(1).atStartOfDay(CREDIT_TIME_ZONE).toOffsetDateTime();
        return new CreditRepository.CreditConsumptionQuery(userId, startDate, endDate, startAt, endAt, generationType);
    }

    /**
     * 校验趋势聚合单位。
     *
     * @param trendUnit String 按日或按月聚合单位
     * @return void 无返回值
     */
    private void validateTrendUnit(String trendUnit) {
        if (!TREND_UNIT_DAY.equals(trendUnit) && !TREND_UNIT_MONTH.equals(trendUnit)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "积分趋势单位仅支持day或month");
        }
    }

    /**
     * 为没有消耗记录的日或月补零。
     *
     * @param startDate LocalDate 筛选起始日期
     * @param endDate LocalDate 筛选结束日期
     * @param trendUnit String 按日或按月聚合单位
     * @param trendItems List<CreditTrendItem> 已产生消耗的趋势项
     * @return List<CreditTrendItem> 完整连续趋势项
     */
    private List<CreditDtos.CreditTrendItem> completeTrend(LocalDate startDate,
                                                            LocalDate endDate,
                                                            String trendUnit,
                                                            List<CreditDtos.CreditTrendItem> trendItems) {
        Map<String, Long> consumedCreditsByPeriod = new HashMap<>();
        trendItems.forEach(item -> consumedCreditsByPeriod.put(item.period(), item.consumedCredits()));
        LocalDate currentDate = TREND_UNIT_DAY.equals(trendUnit) ? startDate : startDate.withDayOfMonth(1);
        LocalDate lastDate = TREND_UNIT_DAY.equals(trendUnit) ? endDate : endDate.withDayOfMonth(1);
        DateTimeFormatter formatter = TREND_UNIT_DAY.equals(trendUnit) ? DateTimeFormatter.ISO_LOCAL_DATE : DateTimeFormatter.ofPattern("yyyy-MM");
        java.util.ArrayList<CreditDtos.CreditTrendItem> completedTrend = new java.util.ArrayList<>();
        while (!currentDate.isAfter(lastDate)) {
            String period = currentDate.format(formatter);
            completedTrend.add(new CreditDtos.CreditTrendItem(period, consumedCreditsByPeriod.getOrDefault(period, 0L)));
            currentDate = TREND_UNIT_DAY.equals(trendUnit) ? currentDate.plusDays(1) : currentDate.plusMonths(1);
        }
        return completedTrend;
    }

    /**
     * 构建任务积分流水原因。
     *
     * @param taskType String 任务类型
     * @param action String 积分动作
     * @return String 流水原因
     */
    private String taskReason(String taskType, String action) {
        return ("video".equals(taskType) ? "视频" : "图片") + "生成任务" + action;
    }

    /**
     * 构建可追溯的同步业务积分流水原因。
     *
     * @param operationName String 业务名称
     * @param action String 扣费或退款
     * @param operationId String 稳定操作标识
     * @return String 流水原因
     */
    private String operationReason(String operationName, String action, String operationId) {
        String normalizedName = operationName == null ? "业务操作" : operationName.trim();
        String normalizedId = operationId == null ? "" : operationId.trim();
        if (normalizedName.isEmpty() || normalizedId.isEmpty()) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "业务积分操作标识不能为空");
        }
        return normalizedName + action + "（操作ID：" + normalizedId + "）";
    }
}
