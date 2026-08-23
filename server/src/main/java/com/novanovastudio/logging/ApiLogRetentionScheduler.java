package com.novanovastudio.logging;

import com.novanovastudio.service.ApiAccessLogService;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * @title        ApiLogRetentionScheduler.java
 * @description  接口访问日志保留期清理（仅保留近 30 天）
 * @createTime   2026-08-23
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class ApiLogRetentionScheduler {

    /** 接口访问日志服务 */
    private final ApiAccessLogService apiAccessLogService;

    /**
     * 每日 03:00 清理 30 天前的接口访问日志。
     */
    @Scheduled(cron = "0 0 3 * * *")
    public void purgeOldLogs() {
        Instant cutoff = Instant.now().minus(30, ChronoUnit.DAYS);
        apiAccessLogService.deleteOld(cutoff)
                .subscribeOn(Schedulers.boundedElastic())
                .subscribe(
                        deleted -> log.info("清理接口访问日志完成, 早于={}, 删除={} 条", cutoff, deleted),
                        err -> log.error("清理接口访问日志失败", err)
                );
    }
}
