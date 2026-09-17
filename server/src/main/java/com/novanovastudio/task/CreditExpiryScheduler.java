package com.novanovastudio.task;

import com.novanovastudio.service.CreditGrantService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import reactor.core.scheduler.Schedulers;

/**
 * @title        CreditExpiryScheduler.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  过期积分兜底清理（每小时执行一次）
 * @createTime   2026-09-17 12:20:00
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class CreditExpiryScheduler {

    /** 会过期的积分发放批次服务 */
    private final CreditGrantService creditGrantService;

    /**
     * 每小时第5分钟作废已到期的积分批次并写入过期流水。
     * <p>
     * 签到积分按签到时刻后24小时过期，不对齐午夜，因此用小时级兜底；
     * 扣费路径本身也会做惰性过期，保证展示余额与可用额度最终一致。
     */
    @Scheduled(cron = "0 5 * * * *")
    public void purgeExpiredCredits() {
        creditGrantService.expireAllExpiredGrants()
                .subscribeOn(Schedulers.boundedElastic())
                .subscribe(
                        expiredUsers -> log.info("清理过期积分完成, 涉及用户={} 人", expiredUsers),
                        error -> log.error("清理过期积分失败", error)
                );
    }
}
