package com.novanovastudio.task;

import com.novanovastudio.service.StorageBillingService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 历史存储欠费重试、实际对象及过期上传租约清理。
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
    /** 永久容量与上传租约清理。 */
    private final com.novanovastudio.service.StorageCapacityService capacityService;
    /** 避免同实例重复执行对象清理与欠费维护。 */
    private final java.util.concurrent.atomic.AtomicBoolean maintaining = new java.util.concurrent.atomic.AtomicBoolean();
    /** 每分钟重试已有欠费支付与对象删除，停止生成任何新月费账单。 */
    @Scheduled(fixedDelay = 60000)
    public void maintain() {
        if (!maintaining.compareAndSet(false, true)) return;
        service.settleUnpaidBills().then(service.deletePendingObjects()).then(capacityService.cleanupReservations())
                .doFinally(signal -> maintaining.set(false)).subscribe(ignored -> { }, error -> log.error("存储欠费和删除维护失败", error));
    }
}
