package com.novanovastudio.service;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.CreditAmounts;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.repository.TeamRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.TeamScope;
import java.math.BigDecimal;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

/**
 * 平台通用钱包与当前团队钱包的独立读取和手动发放。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-18 10:00
 */
@Service
@RequiredArgsConstructor
public class TeamWalletService {
    /** 当前登录身份。 */
    private final CurrentUserProvider currentUserProvider;
    /** 参数化钱包查询。 */
    private final TeamRepository repository;
    /** 复用原有事务与积分流水。 */
    private final CreditService creditService;
    /** 通知成员重新读取两个钱包，避免混用金额。 */
    private final com.novanovastudio.task.AiTaskEventPublisher eventPublisher;

    /**
     * 只读取本人的两个钱包，团队管理员不能借此查询成员平台余额。
     * @return 字符串金额与钱包作用域
     */
    public Mono<JSONObject> getWalletBalances() {
        return currentUserProvider.currentUserId().flatMap(userId -> TeamScope.current().flatMap(scope ->
                repository.query("SELECT team_id, credit_balance::TEXT credit_balance, frozen FROM user_credit_accounts WHERE user_id = :userId AND team_id IN (0, :teamId)",
                        Map.of("userId", userId, "teamId", scope.teamId())).collectList()
                        .map(wallets -> {
                            JSONObject result = new JSONObject();
                            result.put("platformBalance", "0"); result.put("teamBalance", "0"); result.put("teamId", scope.teamId());
                            for (JSONObject wallet : wallets) result.put(wallet.getLongValue("teamId") == 0 ? "platformBalance" : "teamBalance", wallet.getString("creditBalance"));
                            return result;
                        }).contextWrite(context -> context.put(TeamScope.SYSTEM_KEY, true))));
    }

    /**
     * 手动发放本团队积分，目标必须是当前团队尚未移除的成员。
     * @param userId 目标成员
     * @param amount 精确积分变动
     * @param reason 调整原因
     * @return 调整后的余额
     */
    public Mono<JSONObject> adjustMemberCredits(long userId, BigDecimal amount, String reason) {
        BigDecimal validated = CreditAmounts.of(amount);
        if (reason == null || reason.isBlank()) return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "请填写积分调整原因"));
        return TeamScope.requireAdministrator().flatMap(scope -> repository.findMembership(scope.teamId(), userId)
                .filter(member -> !"removed".equals(member.getString("memberStatus")))
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "当前团队成员不存在")))
                .then(currentUserProvider.currentUserId()).flatMap(operator -> creditService.adjustUserCredits(userId, operator, validated, reason)
                        .flatMap(balance -> eventPublisher.publish(userId, new com.novanovastudio.dto.AiTaskDtos.AiTaskEvent("wallet-change", null)).thenReturn(balance))
                        .map(balance -> { JSONObject result = new JSONObject(); result.put("teamBalance", CreditAmounts.text(balance.creditBalance())); return result; })
                        .contextWrite(context -> context.put(TeamScope.WALLET_KEY, scope.teamId()))));
    }
}
