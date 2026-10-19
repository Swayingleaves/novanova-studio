package com.novanovastudio.task;

import com.novanovastudio.service.StorageBillingService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 存储自然月补结、欠费重试和实际对象清理。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-18 10:00
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class StorageBillingScheduler {
    /** 存储计费服务。 */
    private final StorageBillingService service;
    /** 避免同实例重复执行补结。 */
    private final java.util.concurrent.atomic.AtomicBoolean running = new java.util.concurrent.atomic.AtomicBoolean();
    /** 避免同实例重复执行对象清理与欠费维护。 */
    private final java.util.concurrent.atomic.AtomicBoolean maintaining = new java.util.concurrent.atomic.AtomicBoolean();
    /**
     * 每天十分钟执行补结，月首恰好在00:10结算；停机跨月后自动补齐。
     */
    @Scheduled(cron = "0 10 0 * * *", zone = "Asia/Shanghai")
    @org.springframework.context.event.EventListener(org.springframework.boot.context.event.ApplicationReadyEvent.class)
    public void settle() {
        if (!running.compareAndSet(false, true)) return;
        service.settleMonthlyBills().doFinally(signal -> running.set(false)).subscribe(count -> log.info("存储月度补结完成：newBills={}", count), error -> log.error("存储月度补结失败", error));
    }
    /** 每分钟重试欠费支付与对象删除。 */
    @Scheduled(fixedDelay = 60000)
    public void maintain() {
        if (!maintaining.compareAndSet(false, true)) return;
        service.settleUnpaidBills().then(service.deletePendingObjects()).doFinally(signal -> maintaining.set(false)).subscribe(ignored -> { }, error -> log.error("存储欠费和删除维护失败", error));
    }
}
