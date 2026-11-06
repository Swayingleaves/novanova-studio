package com.novanovastudio.task;

import com.novanovastudio.service.SharedWorkCopyService;
import com.novanovastudio.service.SharedWorkService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 持续回收失败、撤回及进程中断的作品副本，不影响已复制的独立个人画布。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-06 10:00
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class SharedWorkCleanupTask {
    /** 投稿清理。 */
    private final SharedWorkService works;
    /** 复制过程清理。 */
    private final SharedWorkCopyService copies;

    /** 定期登记需要回收的对象，实际删除失败继续由存储队列重试。 */
    @Scheduled(fixedDelay = 60000, initialDelay = 60000)
    public reactor.core.publisher.Mono<Void> cleanup() { return reactor.core.publisher.Mono.defer(() -> works.cleanup().then(copies.cleanup())).doOnError(error -> log.error("清理作品副本任务失败", error)); }
}
