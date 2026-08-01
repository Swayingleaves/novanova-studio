package com.novanovastudio.task;

import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.logging.MappedDiagnosticContext;
import com.novanovastudio.service.AiTaskService;
import jakarta.annotation.PreDestroy;
import java.lang.management.ManagementFactory;
import java.net.InetAddress;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicBoolean;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * @title        AiTaskConsumer.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  AI任务Redis Stream消费者
 * @createTime   2026-06-29 11:08:00
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class AiTaskConsumer {

    /** AI任务队列 */
    private final AiTaskQueue taskQueue;

    /** Redis任务锁 */
    private final RedisTaskLock taskLock;

    /** AI任务服务 */
    private final AiTaskService aiTaskService;

    /** 服务配置 */
    private final NovanovaProperties properties;

    /** 是否运行中 */
    private final AtomicBoolean running = new AtomicBoolean(false);

    /** 虚拟线程执行器 */
    private ExecutorService executorService;

    /** 消费订阅 */
    private Disposable consumeDisposable;

    /** 待认领消息订阅 */
    private Disposable claimDisposable;

    /**
     * 构造消费者名称。
     *
     * @param host String 主机名
     * @param pid long 进程ID
     * @param suffix String 随机后缀
     * @return String 消费者名称
     */
    public static String buildConsumerName(String host, long pid, String suffix) {
        return host + "-" + pid + "-" + suffix;
    }

    /**
     * 应用启动后启动消费者。
     */
    @EventListener(ApplicationReadyEvent.class)
    public void start() {
        if (!running.compareAndSet(false, true)) {
            return;
        }
        executorService = Executors.newVirtualThreadPerTaskExecutor();
        String consumerName = buildConsumerName(hostName(), ProcessHandle.current().pid(), UUID.randomUUID().toString());
        Semaphore semaphore = new Semaphore(Math.max(1, properties.getAi().getTask().getConsumerConcurrency()));
        taskQueue.ensureConsumerGroup()
                .then(Mono.fromRunnable(() -> {
                    log.info("启动AI任务消费者: consumerName={}", consumerName);
                    consumeDisposable = Flux.defer(() -> taskQueue.readNewMessages(consumerName))
                            .onErrorResume(exception -> {
                                log.error("读取AI任务队列失败", exception);
                                return Flux.empty();
                            })
                            .delaySubscription(Duration.ofSeconds(1))
                            .repeat(running::get)
                            .subscribe(message -> submitMessage(consumerName, semaphore, message));
                    claimDisposable = Flux.interval(Duration.ofSeconds(properties.getAi().getTask().getPendingClaimIdleSeconds()))
                            .flatMap(ignored -> taskQueue.claimIdleMessages(consumerName)
                                    .onErrorResume(exception -> {
                                        log.error("重新认领AI任务队列消息失败", exception);
                                        return Flux.empty();
                                    }))
                            .subscribe(message -> submitMessage(consumerName, semaphore, message));
                }))
                .subscribeOn(Schedulers.boundedElastic())
                .subscribe(
                        ignored -> {
                        },
                        exception -> log.error("启动AI任务消费者失败", exception)
                );
    }

    /**
     * 停止消费者。
     */
    @PreDestroy
    public void stop() {
        running.set(false);
        if (consumeDisposable != null) {
            consumeDisposable.dispose();
        }
        if (claimDisposable != null) {
            claimDisposable.dispose();
        }
        if (executorService != null) {
            executorService.close();
        }
    }

    /**
     * 提交队列消息。
     *
     * @param consumerName String 消费者名称
     * @param semaphore Semaphore 并发信号量
     * @param message AiTaskQueueMessage 队列消息
     */
    private void submitMessage(String consumerName, Semaphore semaphore, AiTaskQueueMessage message) {
        executorService.submit(() -> {
            boolean acquired = false;
            try (MappedDiagnosticContext.Scope ignored = MappedDiagnosticContext.open(
                    Map.of(MappedDiagnosticContext.TASK_ID, message.taskId()))) {
                semaphore.acquire();
                acquired = true;
                handleMessage(consumerName, message)
                        .contextWrite(context -> MappedDiagnosticContext.put(
                                context, MappedDiagnosticContext.TASK_ID, message.taskId()))
                        .block();
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                log.error("AI任务消费者线程被中断: taskId={}", message.taskId(), exception);
            } catch (Exception exception) {
                log.error("处理AI任务队列消息失败: taskId={}, recordId={}", message.taskId(), message.recordId(), exception);
            } finally {
                if (acquired) {
                    semaphore.release();
                }
            }
        });
    }

    /**
     * 处理队列消息。
     *
     * @param consumerName String 消费者名称
     * @param message AiTaskQueueMessage 队列消息
     * @return Mono<Void> 处理结果
     */
    private Mono<Void> handleMessage(String consumerName, AiTaskQueueMessage message) {
        String lockValue = taskLock.newLockValue(consumerName);
        return taskLock.tryLock(message.taskId(), lockValue)
                .flatMap(locked -> {
                    if (!Boolean.TRUE.equals(locked)) {
                        log.info("跳过AI任务队列消息: taskId={}, reason={}", message.taskId(), "未获取到锁");
                        return taskQueue.acknowledge(message);
                    }
                    Disposable renewDisposable = Flux.interval(Duration.ofSeconds(properties.getAi().getTask().getLockRenewSeconds()))
                            .flatMap(ignored -> taskLock.renew(message.taskId(), lockValue))
                            .contextWrite(context -> MappedDiagnosticContext.put(
                                    context, MappedDiagnosticContext.TASK_ID, message.taskId()))
                            .subscribe(renewed -> {
                                if (!Boolean.TRUE.equals(renewed)) {
                                    log.info("AI任务锁续期未生效: taskId={}", message.taskId());
                                }
                            });
                    return aiTaskService.executeQueuedTask(message.taskId())
                            .then(taskQueue.acknowledge(message))
                            .doFinally(signal -> {
                                renewDisposable.dispose();
                                taskLock.release(message.taskId(), lockValue)
                                        .contextWrite(context -> MappedDiagnosticContext.put(
                                                context, MappedDiagnosticContext.TASK_ID, message.taskId()))
                                        .subscribe(
                                                ignored -> {
                                                },
                                                exception -> log.error("释放AI任务锁失败: taskId={}", message.taskId(), exception)
                                        );
                            });
                });
    }

    /**
     * 获取主机名。
     *
     * @return String 主机名
     */
    private String hostName() {
        try {
            return InetAddress.getLocalHost().getHostName();
        } catch (Exception exception) {
            return ManagementFactory.getRuntimeMXBean().getName().replace('@', '-');
        }
    }
}
