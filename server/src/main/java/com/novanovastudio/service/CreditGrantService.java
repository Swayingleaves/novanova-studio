package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.repository.CreditRepository;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * @title        CreditGrantService.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  会过期的积分发放批次服务（目前仅每日签到发放使用）
 * @createTime   2026-09-17 12:20:00
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class CreditGrantService {

    /** 发放与过期判定统一使用上海时区 */
    private static final ZoneId CREDIT_TIME_ZONE = ZoneId.of("Asia/Shanghai");

    /** 单次兜底清理处理的用户数上限 */
    private static final int EXPIRE_USER_LIMIT = 500;

    /** 积分仓储 */
    private final CreditRepository creditRepository;

    /** 响应式事务操作器 */
    private final TransactionalOperator transactionalOperator;

    /**
     * 发放会过期的积分并累加账户余额。
     * <p>
     * 必须在事务内调用，批次写入与余额更新需要同时生效。
     *
     * @param userId Long 用户ID
     * @param sourceType String 发放来源流水类型
     * @param sourceRef String 来源业务ID，可为null
     * @param credits int 发放积分
     * @param expiresAt OffsetDateTime 过期时间
     * @return Mono<Integer> 发放后的积分余额
     */
    public Mono<Integer> grantExpiringCredits(Long userId, String sourceType, String sourceRef, int credits, OffsetDateTime expiresAt) {
        return creditRepository.createExpiringGrant(userId, sourceType, sourceRef, credits, expiresAt)
                .then(creditRepository.changeBalance(userId, credits))
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "积分账户不存在，无法发放积分")));
    }

    /**
     * 扣除积分。
     * <p>
     * 先在同一个事务内作废该用户已过期的批次，再按到期时间优先消耗未过期的批次剩余额度，最后扣减账户余额；
     * 余额不足时返回空信号，由调用方给出各自的业务提示。必须在事务内调用。
     *
     * @param userId Long 用户ID
     * @param credits int 扣减积分
     * @return Mono<Integer> 扣减后的积分余额，余额不足或账户不存在时为空
     */
    public Mono<Integer> consumeCredits(Long userId, int credits) {
        if (credits <= 0) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "扣减积分必须大于0"));
        }
        OffsetDateTime now = OffsetDateTime.now(CREDIT_TIME_ZONE);
        return creditRepository.listActiveGrantsForUpdate(userId).collectList()
                .flatMap(grants -> settleGrants(userId, grants, credits, now))
                .then(creditRepository.changeBalance(userId, -credits));
    }

    /**
     * 清理指定用户已过期的批次并写入积分过期流水。
     *
     * @param userId Long 用户ID
     * @return Mono<Integer> 本次作废的积分总额，无过期批次时为0
     */
    public Mono<Integer> expireExpiredGrants(Long userId) {
        return Mono.defer(() -> {
            OffsetDateTime now = OffsetDateTime.now(CREDIT_TIME_ZONE);
            return creditRepository.listActiveGrantsForUpdate(userId).collectList()
                    .flatMap(grants -> clearExpiredGrants(userId, grants, now));
        }).as(transactionalOperator::transactional);
    }

    /**
     * 兜底清理所有存在过期批次的用户，供定时任务调用。
     * <p>
     * 单个用户处理失败只记录日志并继续，不影响其余用户。
     *
     * @return Mono<Long> 本次成功处理的用户数
     */
    public Mono<Long> expireAllExpiredGrants() {
        OffsetDateTime now = OffsetDateTime.now(CREDIT_TIME_ZONE);
        return creditRepository.listExpiredGrantUserIds(now, EXPIRE_USER_LIMIT)
                .concatMap(userId -> expireExpiredGrants(userId)
                        .onErrorResume(error -> {
                            log.error("清理用户过期积分失败: userId={}", userId, error);
                            return Mono.just(0);
                        }))
                .filter(credits -> credits > 0)
                .count();
    }

    /**
     * 在已持有批次行锁的前提下完成过期清零与按到期顺序扣减。
     *
     * @param userId Long 用户ID
     * @param grants List<ExpiringGrant> 未耗尽的批次，按到期时间升序
     * @param credits int 本次需要从批次中扣减的积分
     * @param now OffsetDateTime 判定时刻
     * @return Mono<Void> 操作完成信号
     */
    private Mono<Void> settleGrants(Long userId, List<CreditRepository.ExpiringGrant> grants, int credits, OffsetDateTime now) {
        List<CreditRepository.ExpiringGrant> expiredGrants = grants.stream()
                .filter(grant -> !grant.expiresAt().isAfter(now))
                .toList();
        List<GrantDeduction> deductions = new ArrayList<>();
        int remainingCredits = credits;
        for (CreditRepository.ExpiringGrant grant : grants) {
            if (remainingCredits <= 0) {
                break;
            }
            if (!grant.expiresAt().isAfter(now)) {
                continue;
            }
            int deductAmount = Math.min(grant.remainingAmount(), remainingCredits);
            deductions.add(new GrantDeduction(grant.id(), deductAmount));
            remainingCredits -= deductAmount;
        }
        return Flux.fromIterable(expiredGrants)
                .concatMap(grant -> creditRepository.clearGrant(grant.id()))
                .then(Flux.fromIterable(deductions)
                        .concatMap(deduction -> creditRepository.consumeGrant(deduction.grantId(), deduction.amount()))
                        .then())
                .then(writeExpiredTransaction(userId, expiredGrants));
    }

    /**
     * 清零指定用户的过期批次。
     *
     * @param userId Long 用户ID
     * @param grants List<ExpiringGrant> 该用户未耗尽的全部批次
     * @param now OffsetDateTime 判定时刻
     * @return Mono<Integer> 本次作废的积分总额
     */
    private Mono<Integer> clearExpiredGrants(Long userId, List<CreditRepository.ExpiringGrant> grants, OffsetDateTime now) {
        List<CreditRepository.ExpiringGrant> expiredGrants = grants.stream()
                .filter(grant -> !grant.expiresAt().isAfter(now))
                .toList();
        if (expiredGrants.isEmpty()) {
            return Mono.just(0);
        }
        return Flux.fromIterable(expiredGrants)
                .concatMap(grant -> creditRepository.clearGrant(grant.id()))
                .then(writeExpiredTransaction(userId, expiredGrants))
                .thenReturn(expiredGrants.stream().mapToInt(CreditRepository.ExpiringGrant::remainingAmount).sum());
    }

    /**
     * 扣减账户余额并写入一条积分过期流水。
     *
     * @param userId Long 用户ID
     * @param expiredGrants List<ExpiringGrant> 本次清零的过期批次
     * @return Mono<Void> 操作完成信号
     */
    private Mono<Void> writeExpiredTransaction(Long userId, List<CreditRepository.ExpiringGrant> expiredGrants) {
        if (expiredGrants.isEmpty()) {
            return Mono.empty();
        }
        int expiredCredits = expiredGrants.stream().mapToInt(CreditRepository.ExpiringGrant::remainingAmount).sum();
        return creditRepository.changeBalance(userId, -expiredCredits)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "积分账户异常，无法作废过期积分")))
                .flatMap(balance -> creditRepository.createTransaction(userId, CreditService.TRANSACTION_CREDIT_EXPIRED, null, -expiredCredits, balance, "签到积分过期")
                        .then(Mono.fromRunnable(() -> log.info("积分过期作废: userId={}, expiredCredits={}, balanceAfter={}", userId, expiredCredits, balance))))
                .then();
    }

    /**
     * 单次批次扣减明细。
     *
     * @param grantId Long 批次ID
     * @param amount int 本次扣减额度
     */
    private record GrantDeduction(Long grantId, int amount) {
    }
}
