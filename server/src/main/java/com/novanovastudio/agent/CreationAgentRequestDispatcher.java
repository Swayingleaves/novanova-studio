package com.novanovastudio.agent;

import com.novanovastudio.agent.dto.AgentEvent;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.entity.CreationAgentRequest;
import com.novanovastudio.repository.AgentPlanRepository;
import com.novanovastudio.repository.CreationAgentRequestRepository;
import com.novanovastudio.service.AiTaskService;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 统一主Agent请求分区FIFO调度器。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-13 00:00
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class CreationAgentRequestDispatcher {

    /** Redis主Agent请求队列 */
    private final CreationAgentRequestQueue requestQueue;

    /** 主Agent请求仓储 */
    private final CreationAgentRequestRepository requestRepository;

    /** 主Agent编排器提供器，延迟获取以避免循环依赖 */
    private final ObjectProvider<CreationAgentOrchestrator> orchestratorProvider;

    /** 创作计划仓储 */
    private final AgentPlanRepository planRepository;

    /** 底层AI任务服务 */
    private final AiTaskService aiTaskService;

    /** Agent事件发射器 */
    private final AgentEventEmitter eventEmitter;

    /** 服务配置 */
    private final NovanovaProperties properties;

    /** 虚拟线程执行器 */
    private ExecutorService executorService;

    /** 请求恢复订阅 */
    private Disposable recoveryDisposable;

    /**
     * 初始化虚拟线程执行器。
     */
    @PostConstruct
    public void start() {
        executorService = Executors.newVirtualThreadPerTaskExecutor();
    }

    /**
     * 关闭虚拟线程执行器。
     */
    @PreDestroy
    public void stop() {
        if (recoveryDisposable != null) {
            recoveryDisposable.dispose();
        }
        if (executorService != null) {
            executorService.close();
        }
    }

    /**
     * 将请求写入Redis FIFO队列并尝试领取当前分区的等待项。
     *
     * @param request CreationAgentRequest 已持久化请求
     * @return Mono<Void> 入队和调度完成信号
     */
    public Mono<Void> enqueue(CreationAgentRequest request) {
        return requestQueue.enqueue(request.getUserId(), request.getEntrySource(), request.getId())
                .then(dispatchAvailable(request.getUserId(), request.getEntrySource()));
    }

    /**
     * 服务启动时恢复等待请求，并中断失去活动租约的运行请求。
     */
    @EventListener(ApplicationReadyEvent.class)
    @Order(Ordered.HIGHEST_PRECEDENCE)
    public void recoverOnStartup() {
        try {
            recoverRequests().block();
        } catch (Exception exception) {
            log.error("启动时恢复主Agent请求失败", exception);
        }
        if (recoveryDisposable != null) {
            recoveryDisposable.dispose();
        }
        recoveryDisposable = Flux.interval(leaseRenewalInterval())
                .concatMap(ignored -> recoverRequests().onErrorResume(exception -> {
                    log.error("恢复主Agent请求失败", exception);
                    return Mono.empty();
                }))
                .subscribe();
    }

    /**
     * 执行主Agent请求恢复流程。
     *
     * @return Mono<Void> 恢复完成信号
     */
    public Mono<Void> recoverRequests() {
        return requestQueue.listExpiredActiveRequests()
                .concatMap(this::recoverExpiredActiveRequest)
                .thenMany(requestQueue.listActiveRequests()
                        .concatMap(this::recoverCanceledActiveRequest))
                .thenMany(requestRepository.listRunningRequests()
                        .concatMap(this::interruptIfLeaseExpired))
                .thenMany(requestRepository.listQueuedRequests()
                        .concatMap(request -> {
                            eventEmitter.emit(request.getUserId(), AgentEvent.queueStatus(request.getSessionId(),
                                    request.getId(), "queued", "排队中"));
                            return enqueue(request);
                        }))
                .then();
    }

    /**
     * 立即收敛已取消但仍占用活动名额的请求，避免服务重启后等待完整租约周期。
     *
     * @param activeRequest CreationAgentRequestQueue.ActiveRequest 当前活动请求
     * @return Mono<Void> 收敛完成信号
     */
    private Mono<Void> recoverCanceledActiveRequest(CreationAgentRequestQueue.ActiveRequest activeRequest) {
        return requestRepository.findById(activeRequest.requestId())
                .filter(request -> "canceled".equals(request.getStatus()))
                .flatMap(request -> requestQueue.claimCanceledActiveRecovery(activeRequest.userId(),
                                activeRequest.entrySource(), activeRequest.requestId())
                        .flatMap(recoveryClaim -> recoverWithClaim(recoveryClaim, "主Agent请求已取消")
                                .then(dispatchAvailable(activeRequest.userId(), activeRequest.entrySource()))
                                .onErrorResume(exception -> requestQueue.releaseRecoveryClaim(recoveryClaim)
                                        .then(Mono.error(exception)))))
                .then();
    }

    /**
     * 收敛一个已领取恢复权的遗留过期活动租约。
     * <p>
     * 运行中的请求先中断并取消已创建任务；已终态请求仅释放租约；尚未写入运行态的
     * 已领取请求恢复到队头，保证不会被同分区后续请求越过。恢复权确保只有一个实例
     * 可以执行这段收尾并放行同分区下一项。
     *
     * @param expiredRequest CreationAgentRequestQueue.ExpiredActiveRequest 过期租约
     * @return Mono<Void> 收敛完成信号
     */
    private Mono<Void> recoverExpiredActiveRequest(CreationAgentRequestQueue.ExpiredActiveRequest expiredRequest) {
        CreationAgentRequestQueue.RecoveryClaim recoveryClaim = expiredRequest.recoveryClaim();
        return recoverWithClaim(recoveryClaim, "主Agent请求活动租约已失效，已中断")
                .then(dispatchAvailable(expiredRequest.userId(), expiredRequest.entrySource()))
                .onErrorResume(exception -> requestQueue.releaseRecoveryClaim(recoveryClaim)
                        .then(Mono.error(exception)));
    }

    /**
     * 领取当前分区全部可运行的请求并提交到虚拟线程。
     *
     * @param userId Long 用户ID
     * @param entrySource String 入口来源
     * @return Mono<Void> 调度完成信号
     */
    Mono<Void> dispatchAvailable(Long userId, String entrySource) {
        return requestQueue.claimAvailable(userId, entrySource)
                .doOnNext(requestId -> submit(userId, entrySource, requestId))
                .then();
    }

    /**
     * 将已领取请求提交到执行线程。
     *
     * @param userId Long 用户ID
     * @param entrySource String 入口来源
     * @param requestId String 请求ID
     */
    private void submit(Long userId, String entrySource, String requestId) {
        try {
            executorService.submit(() -> executeClaimedRequest(userId, entrySource, requestId));
        } catch (RuntimeException exception) {
            log.error("提交主Agent请求执行失败: userId={}, entrySource={}, requestId={}", userId, entrySource, requestId, exception);
            // 请求尚未开始执行，必须回到队头，避免同分区后续请求越过它。
            requestQueue.requeueExpiredClaim(userId, entrySource, requestId)
                    .then(Mono.defer(() -> executorService != null && !executorService.isShutdown()
                            ? dispatchAvailable(userId, entrySource)
                            : Mono.empty()))
                    .subscribe(
                            ignored -> log.info("提交失败的主Agent请求已恢复排队: requestId={}", requestId),
                            requeueException -> log.error("恢复主Agent请求队列失败: requestId={}", requestId, requeueException)
                    );
        }
    }

    /**
     * 执行已领取请求，并在结束后释放分区名额、补位下一项。
     *
     * @param userId Long 用户ID
     * @param entrySource String 入口来源
     * @param requestId String 请求ID
     */
    private void executeClaimedRequest(Long userId, String entrySource, String requestId) {
        Disposable renewDisposable = null;
        Disposable cancellationDisposable = null;
        Disposable executionDisposable = null;
        try {
            renewDisposable = Flux.interval(leaseRenewalInterval())
                    .concatMap(ignored -> requestQueue.renewActiveRequest(userId, entrySource, requestId)
                            .flatMap(renewed -> Boolean.TRUE.equals(renewed) ? Mono.empty()
                                    : interruptLostLeaseRequest(userId, entrySource, requestId))
                            .onErrorResume(exception -> {
                                log.error("续约主Agent请求失败: requestId={}", requestId, exception);
                                return Mono.empty();
                            }))
                .subscribe();
            cancellationDisposable = Flux.interval(Duration.ZERO, Duration.ofSeconds(1))
                    .concatMap(ignored -> requestQueue.isCancelRequested(requestId)
                            .filter(Boolean::booleanValue)
                            .flatMap(cancelRequested -> orchestratorProvider.getObject().stopClaimedExecution(requestId)))
                    .subscribe(ignored -> {
                    }, exception -> log.error("检查主Agent请求取消状态失败: requestId={}", requestId, exception));
            CountDownLatch completion = new CountDownLatch(1);
            AtomicReference<Throwable> executionFailure = new AtomicReference<>();
            executionDisposable = orchestratorProvider.getObject().executeClaimedRequest(requestId)
                    .doFinally(signal -> completion.countDown())
                    .subscribe(ignored -> {
                    }, executionFailure::set);
            completion.await();
            if (executionFailure.get() != null) {
                throw new IllegalStateException("主Agent请求执行异常", executionFailure.get());
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            log.info("主Agent请求执行线程已中断: requestId={}", requestId);
            interruptLostLeaseRequest(userId, entrySource, requestId).block();
        } catch (Exception exception) {
            log.error("执行主Agent请求失败: requestId={}", requestId, exception);
            finishUnexpectedFailure(requestId, exception).block();
        } finally {
            if (executionDisposable != null && !executionDisposable.isDisposed()) {
                executionDisposable.dispose();
            }
            if (cancellationDisposable != null) {
                cancellationDisposable.dispose();
            }
            if (renewDisposable != null) {
                renewDisposable.dispose();
            }
            releaseAndDispatch(userId, entrySource, requestId);
        }
    }

    /**
     * 释放分区名额并领取后续请求。
     *
     * @param userId Long 用户ID
     * @param entrySource String 入口来源
     * @param requestId String 请求ID
     */
    private void releaseAndDispatch(Long userId, String entrySource, String requestId) {
        requestQueue.releaseActiveRequest(userId, entrySource, requestId)
                .then(dispatchAvailable(userId, entrySource))
                .subscribe(
                        ignored -> {
                        },
                        exception -> log.error("主Agent请求释放名额后补位失败: requestId={}", requestId, exception)
                );
    }

    /**
     * 中断失去Redis活动租约的请求，防止旧实例继续执行。
     *
     * @param requestId String 主Agent请求ID
     * @return Mono<Void> 中断收尾完成信号
     */
    private Mono<Void> interruptLostLeaseRequest(Long userId, String entrySource, String requestId) {
        String message = "主Agent请求活动租约已失效，已中断";
        log.warn("主Agent请求活动租约续期未生效: requestId={}", requestId);
        return requestQueue.claimMissingLeaseRecovery(userId, entrySource, requestId)
                .flatMap(recoveryClaim -> recoverWithClaim(recoveryClaim, message)
                        .then(dispatchAvailable(userId, entrySource))
                        .onErrorResume(exception -> requestQueue.releaseRecoveryClaim(recoveryClaim)
                                .then(Mono.error(exception))));
    }

    /**
     * 收敛调度线程未被编排器处理的异常，避免请求停留在running状态直至下次服务恢复。
     *
     * @param requestId String 主Agent请求ID
     * @param exception Exception 原始异常
     * @return Mono<Void> 收尾完成信号
     */
    private Mono<Void> finishUnexpectedFailure(String requestId, Exception exception) {
        return requestRepository.findById(requestId)
                .filter(request -> "running".equals(request.getStatus()))
                .flatMap(request -> {
                    String message = "主Agent请求执行异常";
                    Mono<Void> failPlan = request.getPlanId() == null || request.getPlanId().isBlank()
                            ? Mono.empty()
                            : planRepository.updatePlanStatus(request.getPlanId(), "failed", message)
                                    .onErrorResume(planException -> {
                                        log.error("收尾主Agent异常请求时更新计划失败: requestId={}, planId={}",
                                                requestId, request.getPlanId(), planException);
                                        return Mono.empty();
                                    });
                    return requestRepository.finishRunning(requestId, "failed", message)
                            .flatMap(finished -> Boolean.TRUE.equals(finished)
                                    ? failPlan.then(Mono.fromRunnable(() -> eventEmitter.emit(request.getUserId(),
                                            AgentEvent.error(request.getSessionId(), message).withRequestId(requestId))))
                                    : Mono.<Void>empty());
                })
                .onErrorResume(finishException -> {
                    log.error("收尾主Agent异常请求失败: requestId={}", requestId, finishException);
                    return Mono.empty();
                });
    }

    /**
     * 对没有有效活动租约的运行请求领取恢复权后进行中断收尾。
     *
     * @param request CreationAgentRequest 运行中请求
     * @return Mono<Void> 处理完成信号
     */
    private Mono<Void> interruptIfLeaseExpired(CreationAgentRequest request) {
        return requestQueue.hasActiveRequest(request.getUserId(), request.getEntrySource(), request.getId())
                .filter(active -> !active)
                .flatMap(ignored -> requestQueue.claimMissingLeaseRecovery(request.getUserId(), request.getEntrySource(), request.getId())
                        .flatMap(recoveryClaim -> requestQueue.hasActiveRequest(request.getUserId(), request.getEntrySource(), request.getId())
                                .flatMap(active -> Boolean.TRUE.equals(active)
                                        ? requestQueue.releaseRecoveryClaim(recoveryClaim)
                                        : recoverWithClaim(recoveryClaim, "服务重启导致请求已中断")
                                                .then(dispatchAvailable(request.getUserId(), request.getEntrySource())))
                                .onErrorResume(exception -> requestQueue.releaseRecoveryClaim(recoveryClaim)
                                        .then(Mono.error(exception)))))
                .then();
    }

    /**
     * 使用已领取的恢复权收敛当前请求，并在最终收尾前保持分区活动名额。
     *
     * @param recoveryClaim CreationAgentRequestQueue.RecoveryClaim 当前实例持有的恢复权
     * @param message String 中断说明
     * @return Mono<Void> 收敛完成信号
     */
    private Mono<Void> recoverWithClaim(CreationAgentRequestQueue.RecoveryClaim recoveryClaim, String message) {
        return requestQueue.renewRecoveryClaim(recoveryClaim)
                .flatMap(renewed -> Boolean.TRUE.equals(renewed)
                        ? recoverWithRenewedClaim(recoveryClaim, message)
                        : Mono.error(new IllegalStateException("主Agent请求恢复权已失效: " + recoveryClaim.requestId())));
    }

    /**
     * 在恢复收尾期间持续续约当前恢复权；失去恢复权时取消本次收尾，交给新的持有者继续处理。
     *
     * @param recoveryClaim CreationAgentRequestQueue.RecoveryClaim 当前实例持有的恢复权
     * @param message String 中断说明
     * @return Mono<Void> 收敛完成信号
     */
    private Mono<Void> recoverWithRenewedClaim(CreationAgentRequestQueue.RecoveryClaim recoveryClaim, String message) {
        Mono<Void> recovery = recoverClaim(recoveryClaim, message);
        Mono<Void> lostRecoveryClaim = Flux.interval(leaseRenewalInterval())
                .concatMap(ignored -> requestQueue.renewRecoveryClaim(recoveryClaim))
                .filter(renewed -> !Boolean.TRUE.equals(renewed))
                .next()
                .flatMap(ignored -> Mono.error(new IllegalStateException(
                        "主Agent请求恢复权续约失败: " + recoveryClaim.requestId())))
                .then();
        return Mono.firstWithSignal(recovery, lostRecoveryClaim);
    }

    /**
     * 使用已确认有效的恢复权收敛当前请求。
     *
     * @param recoveryClaim CreationAgentRequestQueue.RecoveryClaim 当前实例持有的恢复权
     * @param message String 中断说明
     * @return Mono<Void> 收敛完成信号
     */
    private Mono<Void> recoverClaim(CreationAgentRequestQueue.RecoveryClaim recoveryClaim, String message) {
        return requestRepository.findById(recoveryClaim.requestId())
                .map(request -> switch (request.getStatus()) {
                    case "running", "interrupted" -> interruptExpiredRunningRequest(request, message, recoveryClaim);
                    case "queued" -> requestQueue.requeueRecoveredClaim(recoveryClaim);
                    case "canceled" -> finishCanceledRequest(request, recoveryClaim);
                    default -> requestQueue.releaseRecoveredActiveRequest(recoveryClaim);
                })
                .switchIfEmpty(Mono.just(requestQueue.releaseRecoveredActiveRequest(recoveryClaim)))
                .flatMap(recovery -> recovery);
    }

    /**
     * 将失租的运行请求标记为中断，完成计划与底层任务收尾后再释放分区名额。
     *
     * @param request CreationAgentRequest 运行中请求
     * @param message String 中断说明
     * @return Mono<Void> 中断收尾完成信号
     */
    private Mono<Void> interruptExpiredRunningRequest(CreationAgentRequest request, String message,
                                                       CreationAgentRequestQueue.RecoveryClaim recoveryClaim) {
        return requestRepository.interruptRunningIfRunning(request.getId(), message)
                .then(requestRepository.findById(request.getId()))
                .flatMap(current -> completeRecoveredRunningRequest(current, message))
                .switchIfEmpty(Mono.just(false))
                .flatMap(recovered -> Boolean.TRUE.equals(recovered)
                        ? requestQueue.releaseRecoveredActiveRequest(recoveryClaim)
                        : requestQueue.releaseRecoveryClaim(recoveryClaim));
    }

    /**
     * 根据当前持久化状态继续完成已领取恢复权的运行请求。
     *
     * @param request CreationAgentRequest 当前请求记录
     * @param message String 中断说明
     * @return Mono<Boolean> true表示可安全释放分区名额
     */
    private Mono<Boolean> completeRecoveredRunningRequest(CreationAgentRequest request, String message) {
        return switch (request.getStatus()) {
            case "interrupted" -> {
                String interruptedMessage = StringUtils.hasText(request.getErrorMessage()) ? request.getErrorMessage() : message;
                yield requestQueue.markCancelRequested(request.getId())
                        .then(stopLocalClaimedExecution(request.getId()))
                        .then(interruptRequest(request, interruptedMessage))
                        .thenReturn(true);
            }
            case "canceled" -> requestQueue.markCancelRequested(request.getId())
                    .then(stopLocalClaimedExecution(request.getId()))
                    .then(cancelPersistedRequest(request))
                    .thenReturn(true);
            case "success", "failed" -> Mono.just(true);
            default -> Mono.just(false);
        };
    }

    /**
     * 完成已取消请求的任务和计划收尾，确保恢复实例释放分区前底层任务不会再执行。
     *
     * @param request CreationAgentRequest 已取消请求
     * @param recoveryClaim CreationAgentRequestQueue.RecoveryClaim 当前实例持有的恢复权
     * @return Mono<Void> 收尾和释放完成信号
     */
    private Mono<Void> finishCanceledRequest(CreationAgentRequest request,
                                             CreationAgentRequestQueue.RecoveryClaim recoveryClaim) {
        return requestQueue.markCancelRequested(request.getId())
                .then(stopLocalClaimedExecution(request.getId()))
                .then(cancelPersistedRequest(request))
                .then(requestQueue.releaseRecoveredActiveRequest(recoveryClaim));
    }

    /**
     * 取消已持久化的底层任务及其关联计划。
     *
     * @param request CreationAgentRequest 已取消请求
     * @return Mono<Void> 收尾完成信号
     */
    private Mono<Void> cancelPersistedRequest(CreationAgentRequest request) {
        Mono<Void> cancelPlan = request.getPlanId() == null || request.getPlanId().isBlank()
                ? Mono.empty()
                : planRepository.cancelPlan(request.getPlanId());
        return Flux.fromIterable(requestRepository.taskIds(request))
                .concatMap(taskId -> aiTaskService.cancelTaskForUser(request.getUserId(), taskId)
                        .onErrorResume(exception -> {
                            log.error("恢复取消主Agent请求时取消底层任务失败: requestId={}, taskId={}", request.getId(), taskId, exception);
                            return Mono.empty();
                        }))
                .then(cancelPlan);
    }

    /**
     * 停止当前实例仍在执行的 Agent Loop；其他实例不持有本地执行上下文时直接跳过。
     *
     * @param requestId String 主Agent请求ID
     * @return Mono<Void> 停止完成信号
     */
    private Mono<Void> stopLocalClaimedExecution(String requestId) {
        return orchestratorProvider.getObject().stopClaimedExecution(requestId)
                .onErrorResume(exception -> {
                    log.error("中断主Agent请求时停止本机执行失败: requestId={}", requestId, exception);
                    return Mono.empty();
                });
    }

    /**
     * 将计划和已创建底层任务写为中断终态，避免服务启动后重放生成。
     *
     * @param request CreationAgentRequest 已中断请求
     * @return Mono<Void> 收尾完成信号
     */
    private Mono<Void> interruptRequest(CreationAgentRequest request, String message) {
        Mono<Void> failPlan = request.getPlanId() == null || request.getPlanId().isBlank()
                ? Mono.empty()
                : planRepository.markInterruptedPlanFailed(request.getPlanId(), message);
        return Flux.fromIterable(requestRepository.taskIds(request))
                .concatMap(taskId -> aiTaskService.cancelTaskForUser(request.getUserId(), taskId)
                        .onErrorResume(exception -> {
                            log.error("中断主Agent请求时取消底层任务失败: requestId={}, taskId={}", request.getId(), taskId, exception);
                            return Mono.empty();
                        }))
                .then(failPlan)
                .doOnSuccess(ignored -> eventEmitter.emit(request.getUserId(), AgentEvent.error(request.getSessionId(),
                        message).withRequestId(request.getId())));
    }

    /**
     * 读取活动和恢复租约的安全续期间隔，保证不会晚于租约半程。
     *
     * @return Duration 续期间隔
     */
    private Duration leaseRenewalInterval() {
        long lockTtlMilliseconds = Duration.ofSeconds(Math.max(1, properties.getAi().getTask().getLockTtlSeconds())).toMillis();
        long configuredRenewalMilliseconds = Duration.ofSeconds(
                Math.max(1, properties.getAi().getTask().getLockRenewSeconds())).toMillis();
        return Duration.ofMillis(Math.max(100, Math.min(configuredRenewalMilliseconds, lockTtlMilliseconds / 2)));
    }
}
