package com.novanovastudio.task;

import com.novanovastudio.service.CreditPurchaseService;
import java.util.concurrent.atomic.AtomicBoolean;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 微信支付后台查单及超时关单，独立于浏览器轮询运行。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-05 14:00
 */
@Component
@ConditionalOnProperty(prefix = "novanova.wechat", name = "enabled", havingValue = "true")
@RequiredArgsConstructor
@Slf4j
public class CreditPaymentReconciliationScheduler {
    /** 积分购买服务。 */
    private final CreditPurchaseService purchaseService;
    /** 防止同一实例的扫描重叠。 */
    private final AtomicBoolean reconciling = new AtomicBoolean();

    /** 每三十秒核对待支付订单；跨实例通过已有 Redis 节流和数据库结算锁协作。 */
    @Scheduled(fixedDelay = 30000, initialDelay = 30000)
    public void reconcile() {
        if (!reconciling.compareAndSet(false, true)) return;
        purchaseService.reconcileWechatOrders().doFinally(signal -> reconciling.set(false))
                .subscribe(ignored -> { }, error -> log.error("微信支付订单后台核对失败", error));
    }
}
