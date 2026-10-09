package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.agent.AgentScopeModelFactory;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.dto.StoryBibleDtos;
import com.novanovastudio.repository.CreditRepository;
import com.novanovastudio.repository.ScriptSourceRepository;
import com.novanovastudio.repository.StoryBibleRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.task.StoryBibleAnalysisQueue;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

/**
 * 故事知识库报价、启动、取消与条目保护测试。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-09-27 00:00
 */
@ExtendWith(MockitoExtension.class)
class StoryBibleServiceTest {
    /** 用户标识。 */
    private static final long USER_ID = 8L;
    /** 项目标识。 */
    private static final String PROJECT_ID = "project-1";
    /** 所选模型。 */
    private static final String MODEL = "channel-1::gpt";
    /** 原文正文：10个计费字符。 */
    private static final String TEXT = "林远 推开门\n师父在等。";

    /** 知识库仓储。 */
    @Mock private StoryBibleRepository repository;
    /** 原文仓储。 */
    @Mock private ScriptSourceRepository sourceRepository;
    /** 价格服务。 */
    @Mock private StoryBiblePricingService pricingService;
    /** 模型配置服务。 */
    @Mock private PersistenceService persistenceService;
    /** 模型解析。 */
    @Mock private AgentScopeModelFactory modelFactory;
    /** 积分服务。 */
    @Mock private CreditService creditService;
    /** 积分仓储。 */
    @Mock private CreditRepository creditRepository;
    /** 当前用户。 */
    @Mock private CurrentUserProvider currentUserProvider;
    /** 队列提供器。 */
    @Mock private ObjectProvider<StoryBibleAnalysisQueue> queueProvider;
    /** 分析队列。 */
    @Mock private StoryBibleAnalysisQueue queue;
    /** 被测服务。 */
    private StoryBibleService service;

    /**
     * 初始化被测服务，事务直接透传。
     */
    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        TransactionalOperator transactionalOperator = mock(TransactionalOperator.class);
        lenient().when(transactionalOperator.transactional(any(Mono.class))).thenAnswer(invocation -> invocation.getArgument(0));
        service = new StoryBibleService(repository, sourceRepository, pricingService, persistenceService, modelFactory,
                creditService, creditRepository, currentUserProvider, transactionalOperator, queueProvider);
        lenient().when(currentUserProvider.currentUserId()).thenReturn(Mono.just(USER_ID));
        lenient().when(queueProvider.getObject()).thenReturn(queue);
        lenient().when(queue.enqueue(anyString(), anyString())).thenReturn(Mono.empty());
        lenient().when(creditRepository.getCreditBalance(USER_ID)).thenReturn(Mono.just(90));
        lenient().when(repository.listGaps(anyString())).thenReturn(reactor.core.publisher.Flux.empty());
        lenient().when(creditService.getOperationRefundAmount(anyLong(), anyString(), anyString())).thenReturn(Mono.just(0));
    }

    /**
     * 结构未确认或确认后又修改时拒绝报价。
     */
    @Test
    void shouldRejectQuoteWhenStructureNotConfirmed() {
        when(sourceRepository.findByProject(USER_ID, PROJECT_ID)).thenReturn(Mono.just(document(3, 2L)));
        StepVerifier.create(service.quoteAnalysis(new StoryBibleDtos.QuoteRequest(PROJECT_ID, MODEL, List.of())))
                .expectErrorMatches(error -> error.getMessage().contains("确认当前结构"))
                .verify();
    }

    /**
     * 其他用户的项目查不到原文，视为不存在。
     */
    @Test
    void shouldRejectCrossUserAccess() {
        when(sourceRepository.findByProject(USER_ID, PROJECT_ID)).thenReturn(Mono.empty());
        StepVerifier.create(service.getAnalysisStatus(new StoryBibleDtos.JobRequest(PROJECT_ID, null)))
                .expectErrorMatches(error -> error instanceof BusinessException exception
                        && exception.getCode() == ErrorCode.RESOURCE_NOT_FOUND)
                .verify();
    }

    /**
     * 全书报价按非空白字符数命中档位。
     */
    @Test
    void shouldQuoteByBillableChars() {
        stubQuote(List.of(new StoryBibleDtos.PricingTier(1, 10, 20), new StoryBibleDtos.PricingTier(11, null, 50)));
        StepVerifier.create(service.quoteAnalysis(new StoryBibleDtos.QuoteRequest(PROJECT_ID, MODEL, null)))
                .assertNext(quote -> {
                    assertEquals(10, quote.billableChars());
                    assertEquals(20, quote.credits());
                    assertEquals(3, quote.sourceRevision());
                    assertEquals(4, quote.pricingRevision());
                })
                .verifyComplete();
    }

    /**
     * 管理员未填写经验证的容量时，分析不能按上下文窗口猜测输入字数。
     */
    @Test
    void shouldRejectQuickQuoteWithoutVerifiedCapacity() {
        stubQuote(List.of(new StoryBibleDtos.PricingTier(1, null, 20)));
        when(pricingService.find("config-1")).thenReturn(Mono.just(new StoryBibleRepository.Pricing(
                "config-1", List.of(new StoryBibleDtos.PricingTier(1, null, 20)), 4, null)));
        StepVerifier.create(service.quoteAnalysis(new StoryBibleDtos.QuoteRequest(PROJECT_ID, MODEL, null)))
                .expectErrorMatches(error -> error.getMessage().contains("未配置经验证的分析容量"))
                .verify();
    }

    /**
     * 没有覆盖当前字数的档位时禁止启动。
     */
    @Test
    void shouldRejectQuoteWithoutCoveringTier() {
        stubQuote(List.of(new StoryBibleDtos.PricingTier(1, 5, 20)));
        StepVerifier.create(service.quoteAnalysis(new StoryBibleDtos.QuoteRequest(PROJECT_ID, MODEL, null)))
                .expectErrorMatches(error -> error.getMessage().contains("没有覆盖10字"))
                .verify();
    }

    /**
     * 报价与提交不一致时要求重新报价，且不扣费。
     */
    @Test
    void shouldRequireRequoteWhenQuoteChanged() {
        stubQuote(List.of(new StoryBibleDtos.PricingTier(1, null, 20)));
        when(repository.findJobByRequest(USER_ID, "req-1")).thenReturn(Mono.empty());
        StepVerifier.create(service.startAnalysis(new StoryBibleDtos.StartRequest(PROJECT_ID, MODEL, null, "req-1", 20, 3, 3)))
                .expectErrorMatches(error -> error instanceof BusinessException exception
                        && exception.getCode() == ErrorCode.DATA_CONFLICT)
                .verify();
        verify(creditService, never()).chargeOperation(anyLong(), anyString(), anyInt(), anyString());
    }

    /**
     * 报价一致时创建任务、预扣积分并入队，返回最新余额。
     */
    @Test
    void shouldCreateJobAndChargeCredits() {
        stubQuote(List.of(new StoryBibleDtos.PricingTier(1, null, 20)));
        when(repository.findJobByRequest(USER_ID, "req-1")).thenReturn(Mono.empty());
        when(repository.insertJob(any())).thenReturn(Mono.empty());
        when(creditService.chargeOperation(eq(USER_ID), anyString(), eq(20), eq(StoryBibleService.OPERATION_NAME))).thenReturn(Mono.empty());
        when(repository.findJobById(anyString())).thenAnswer(invocation -> Mono.just(job(invocation.getArgument(0), "queued")));
        StepVerifier.create(service.startAnalysis(new StoryBibleDtos.StartRequest(PROJECT_ID, MODEL, null, "req-1", 20, 3, 4)))
                .assertNext(status -> {
                    assertEquals("queued", status.status());
                    assertEquals(90, status.creditBalance());
                })
                .verifyComplete();
        verify(queue).enqueue(eq("config-1"), anyString());
    }

    /**
     * 余额不足时扣费失败，任务不入队。
     */
    @Test
    void shouldNotEnqueueWhenCreditsInsufficient() {
        stubQuote(List.of(new StoryBibleDtos.PricingTier(1, null, 20)));
        when(repository.findJobByRequest(USER_ID, "req-1")).thenReturn(Mono.empty());
        when(repository.insertJob(any())).thenReturn(Mono.empty());
        when(creditService.chargeOperation(eq(USER_ID), anyString(), eq(20), anyString()))
                .thenReturn(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "积分不足")));
        StepVerifier.create(service.startAnalysis(new StoryBibleDtos.StartRequest(PROJECT_ID, MODEL, null, "req-1", 20, 3, 4)))
                .expectErrorMatches(error -> error.getMessage().contains("积分不足"))
                .verify();
        verify(queue, never()).enqueue(anyString(), anyString());
    }

    /**
     * 同一客户端请求标识重复提交直接返回已有任务，不重复扣费。
     */
    @Test
    void shouldReturnExistingJobForDuplicateRequest() {
        when(repository.findJobByRequest(USER_ID, "req-1")).thenReturn(Mono.just(job("job-1", "running")));
        StepVerifier.create(service.startAnalysis(new StoryBibleDtos.StartRequest(PROJECT_ID, MODEL, null, "req-1", 20, 3, 4)))
                .assertNext(status -> assertEquals("job-1", status.jobId()))
                .verifyComplete();
        verify(creditService, never()).chargeOperation(anyLong(), anyString(), anyInt(), anyString());
        verify(repository, never()).insertJob(any());
    }

    /**
     * 仅成功批次扣费，处理中与未开始批次退款，重复取消不能再次退款。
     */
    @Test
    void shouldRefundUnsuccessfulBatchesWhenCanceled() {
        when(sourceRepository.findByProject(USER_ID, PROJECT_ID)).thenReturn(Mono.just(document(3, 3L)));
        when(repository.findJob(PROJECT_ID, "job-1")).thenReturn(Mono.just(job("job-1", "running")));
        when(repository.transitJob(eq("job-1"), any(), eq("canceled"), anyString()))
                .thenReturn(Mono.just(true)).thenReturn(Mono.just(false));
        when(repository.findJobById("job-1")).thenReturn(Mono.just(job("job-1", "canceled")));
        when(repository.batchSettlement("job-1")).thenReturn(Mono.just(new StoryBibleRepository.BatchSettlement(2)));
        when(creditService.refundOperation(USER_ID, "job-1", StoryBibleService.OPERATION_NAME, 12)).thenReturn(Mono.empty());
        when(creditService.getOperationRefundAmount(USER_ID, "job-1", StoryBibleService.OPERATION_NAME)).thenReturn(Mono.just(12));
        StepVerifier.create(service.cancelAnalysis(new StoryBibleDtos.JobRequest(PROJECT_ID, "job-1")))
                .assertNext(status -> {
                    assertEquals("canceled", status.status());
                    assertEquals(12, status.refundedCredits());
                })
                .verifyComplete();
        StepVerifier.create(service.cancelAnalysis(new StoryBibleDtos.JobRequest(PROJECT_ID, "job-1")))
                .expectError(BusinessException.class)
                .verify();
        verify(creditService).refundOperation(USER_ID, "job-1", StoryBibleService.OPERATION_NAME, 12);
        verify(creditService, never()).refundOperation(USER_ID, "job-1", StoryBibleService.OPERATION_NAME);
    }

    /**
     * 尚未规划批次的排队任务取消后全额退款。
     */
    @Test
    void shouldFullyRefundQueuedJobWithoutBatches() {
        when(sourceRepository.findByProject(USER_ID, PROJECT_ID)).thenReturn(Mono.just(document(3, 3L)));
        when(repository.findJob(PROJECT_ID, "job-1")).thenReturn(Mono.just(job("job-1", "queued")));
        when(repository.transitJob(eq("job-1"), any(), eq("canceled"), anyString())).thenReturn(Mono.just(true));
        when(repository.batchSettlement("job-1")).thenReturn(Mono.just(new StoryBibleRepository.BatchSettlement(0)));
        when(creditService.refundOperation(USER_ID, "job-1", StoryBibleService.OPERATION_NAME, 20)).thenReturn(Mono.empty());
        when(repository.findJobById("job-1")).thenReturn(Mono.just(job("job-1", "canceled")));
        StepVerifier.create(service.cancelAnalysis(new StoryBibleDtos.JobRequest(PROJECT_ID, "job-1")))
                .assertNext(status -> assertEquals("canceled", status.status())).verifyComplete();
        verify(creditService).refundOperation(USER_ID, "job-1", StoryBibleService.OPERATION_NAME, 20);
    }

    /**
     * 按快照中的初始批数分摊积分，未完成批次全额参与退款比例。
     */
    @Test
    void shouldRefundByInitialBatchCount() {
        when(sourceRepository.findByProject(USER_ID, PROJECT_ID)).thenReturn(Mono.just(document(3, 3L)));
        when(repository.findJob(PROJECT_ID, "job-1")).thenReturn(Mono.just(job("job-1", "running")));
        when(repository.transitJob(eq("job-1"), any(), eq("canceled"), anyString())).thenReturn(Mono.just(true));
        when(repository.batchSettlement("job-1")).thenReturn(Mono.just(new StoryBibleRepository.BatchSettlement(1)));
        when(creditService.refundOperation(USER_ID, "job-1", StoryBibleService.OPERATION_NAME, 16)).thenReturn(Mono.empty());
        when(repository.findJobById("job-1")).thenReturn(Mono.just(job("job-1", "canceled")));
        StepVerifier.create(service.cancelAnalysis(new StoryBibleDtos.JobRequest(PROJECT_ID, "job-1")))
                .expectNextCount(1).verifyComplete();
        verify(creditService).refundOperation(USER_ID, "job-1", StoryBibleService.OPERATION_NAME, 16);
    }

    /**
     * 退款失败必须终止取消事务，不返回已取消的成功响应。
     */
    @Test
    void shouldFailCancellationWhenRefundFails() {
        when(sourceRepository.findByProject(USER_ID, PROJECT_ID)).thenReturn(Mono.just(document(3, 3L)));
        when(repository.findJob(PROJECT_ID, "job-1")).thenReturn(Mono.just(job("job-1", "running")));
        when(repository.transitJob(eq("job-1"), any(), eq("canceled"), anyString())).thenReturn(Mono.just(true));
        when(repository.batchSettlement("job-1")).thenReturn(Mono.just(new StoryBibleRepository.BatchSettlement(2)));
        when(creditService.refundOperation(USER_ID, "job-1", StoryBibleService.OPERATION_NAME, 12))
                .thenReturn(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "退款失败")));
        StepVerifier.create(service.cancelAnalysis(new StoryBibleDtos.JobRequest(PROJECT_ID, "job-1")))
                .expectErrorMatches(error -> error.getMessage().equals("退款失败")).verify();
        verify(repository, never()).findJobById("job-1");
    }

    /**
     * 续跑可重试任务不再扣费。
     */
    @Test
    void shouldRetryWithoutCharging() {
        when(sourceRepository.findByProject(USER_ID, PROJECT_ID)).thenReturn(Mono.just(document(3, 3L)));
        when(repository.findJob(PROJECT_ID, "job-1")).thenReturn(Mono.just(job("job-1", "retryable")));
        when(repository.transitJob("job-1", List.of("retryable"), "queued", "")).thenReturn(Mono.just(true));
        when(repository.findJobById("job-1")).thenReturn(Mono.just(job("job-1", "queued")));
        StepVerifier.create(service.retryAnalysis(new StoryBibleDtos.JobRequest(PROJECT_ID, "job-1")))
                .assertNext(status -> assertEquals("queued", status.status()))
                .verifyComplete();
        verify(creditService, never()).chargeOperation(anyLong(), anyString(), anyInt(), anyString());
        verify(queue).enqueue("config-1", "job-1");
    }

    /**
     * 条目修订号不一致时报冲突。
     */
    @Test
    void shouldReportConflictOnStaleRevision() {
        when(sourceRepository.findByProject(USER_ID, PROJECT_ID)).thenReturn(Mono.just(document(3, 3L)));
        when(repository.getItem(PROJECT_ID, "item-1")).thenReturn(Mono.just(item("item-1", null)));
        when(repository.updateStatus("item-1", 5, "confirmed")).thenReturn(Mono.just(false));
        StepVerifier.create(service.confirmItem(new StoryBibleDtos.ItemRequest(PROJECT_ID, "item-1", 5)))
                .expectErrorMatches(error -> error instanceof BusinessException exception
                        && exception.getCode() == ErrorCode.DATA_CONFLICT)
                .verify();
    }

    /** 空批次不允许确认。 */
    @Test
    void shouldRejectEmptyConfirmationBatch() {
        StepVerifier.create(service.confirmItems(new StoryBibleDtos.BatchConfirmRequest(PROJECT_ID, List.of())))
                .expectErrorMatches(error -> error instanceof BusinessException exception
                        && exception.getCode() == ErrorCode.PARAM_MISSING).verify();
        verify(repository, never()).findItemsForUpdate(anyString(), any());
    }

    /** 重复条目标识不允许确认。 */
    @Test
    void shouldRejectDuplicateConfirmationItems() {
        var request = new StoryBibleDtos.BatchItemRequest("item-1", 5);
        StepVerifier.create(service.confirmItems(new StoryBibleDtos.BatchConfirmRequest(PROJECT_ID, List.of(request, request))))
                .expectErrorMatches(error -> error instanceof BusinessException exception
                        && exception.getCode() == ErrorCode.PARAM_INVALID).verify();
        verify(repository, never()).findItemsForUpdate(anyString(), any());
    }

    /** 批量确认普通条目时更新状态并锁定条目。 */
    @Test
    void shouldConfirmOrdinaryItemsInBatch() {
        when(sourceRepository.findByProject(USER_ID, PROJECT_ID)).thenReturn(Mono.just(document(3, 3L)));
        when(repository.findItemsForUpdate(PROJECT_ID, List.of("item-1", "item-2")))
                .thenReturn(reactor.core.publisher.Flux.just(item("item-1", null), item("item-2", null)));
        when(repository.findItemsForUpdate(PROJECT_ID, List.of())).thenReturn(reactor.core.publisher.Flux.empty());
        when(repository.updateStatus("item-1", 5, "confirmed")).thenReturn(Mono.just(true));
        when(repository.updateStatus("item-2", 5, "confirmed")).thenReturn(Mono.just(true));
        StepVerifier.create(service.confirmItems(new StoryBibleDtos.BatchConfirmRequest(PROJECT_ID, List.of(
                        new StoryBibleDtos.BatchItemRequest("item-1", 5), new StoryBibleDtos.BatchItemRequest("item-2", 5)))))
                .assertNext(result -> {
                    assertEquals(List.of("item-1", "item-2"), result.confirmedItemIds());
                    assertEquals(2, result.confirmedCount());
                }).verifyComplete();
    }

    /** 任意条目修订号失效时整批拒绝，校验完成前不写入任何条目。 */
    @Test
    void shouldRejectBatchWithStaleRevision() {
        when(sourceRepository.findByProject(USER_ID, PROJECT_ID)).thenReturn(Mono.just(document(3, 3L)));
        when(repository.findItemsForUpdate(PROJECT_ID, List.of("item-1", "item-2")))
                .thenReturn(reactor.core.publisher.Flux.just(item("item-1", null), item("item-2", null)));
        when(repository.findItemsForUpdate(PROJECT_ID, List.of())).thenReturn(reactor.core.publisher.Flux.empty());
        StepVerifier.create(service.confirmItems(new StoryBibleDtos.BatchConfirmRequest(PROJECT_ID, List.of(
                        new StoryBibleDtos.BatchItemRequest("item-1", 5), new StoryBibleDtos.BatchItemRequest("item-2", 4)))))
                .expectErrorMatches(error -> error instanceof BusinessException exception
                        && exception.getCode() == ErrorCode.DATA_CONFLICT).verify();
        verify(repository, never()).updateStatus(anyString(), anyLong(), anyString());
    }

    /** 已确认或已拒绝的条目不能重复参与批量确认。 */
    @Test
    void shouldRejectBatchWithNonPendingItem() {
        when(sourceRepository.findByProject(USER_ID, PROJECT_ID)).thenReturn(Mono.just(document(3, 3L)));
        var confirmed = new StoryBibleRepository.Item("item-1", PROJECT_ID, "doc-1", "character", "林远", "",
                new JSONObject(), "ai", "confirmed", true, null, "林远", 0, "", "uncertain", null, 5);
        when(repository.findItemsForUpdate(PROJECT_ID, List.of("item-1")))
                .thenReturn(reactor.core.publisher.Flux.just(confirmed));
        when(repository.findItemsForUpdate(PROJECT_ID, List.of())).thenReturn(reactor.core.publisher.Flux.empty());
        StepVerifier.create(service.confirmItems(new StoryBibleDtos.BatchConfirmRequest(PROJECT_ID,
                        List.of(new StoryBibleDtos.BatchItemRequest("item-1", 5)))))
                .expectErrorMatches(error -> error instanceof BusinessException exception
                        && exception.getCode() == ErrorCode.DATA_CONFLICT).verify();
        verify(repository, never()).updateStatus(anyString(), anyLong(), anyString());
    }

    /** 批量确认建议时迁移别名和证据，再按修订号删除建议。 */
    @Test
    void shouldMergeSuggestionsInBatch() {
        when(sourceRepository.findByProject(USER_ID, PROJECT_ID)).thenReturn(Mono.just(document(3, 3L)));
        when(repository.findItemsForUpdate(PROJECT_ID, List.of("suggestion-1")))
                .thenReturn(reactor.core.publisher.Flux.just(item("suggestion-1", "item-1")));
        when(repository.findItemsForUpdate(PROJECT_ID, List.of("item-1")))
                .thenReturn(reactor.core.publisher.Flux.just(item("item-1", null)));
        when(repository.moveAliases("suggestion-1", "item-1", null)).thenReturn(Mono.empty());
        when(repository.moveEvidences("suggestion-1", "item-1", null, null)).thenReturn(Mono.empty());
        when(repository.deleteItemAt("suggestion-1", 5)).thenReturn(Mono.just(true));
        when(repository.refreshNarrativeOffsets(PROJECT_ID)).thenReturn(Mono.empty());
        StepVerifier.create(service.confirmItems(new StoryBibleDtos.BatchConfirmRequest(PROJECT_ID,
                        List.of(new StoryBibleDtos.BatchItemRequest("suggestion-1", 5)))))
                .assertNext(result -> {
                    assertEquals(List.of("item-1"), result.confirmedItemIds());
                    assertEquals(1, result.confirmedCount());
                }).verifyComplete();
        verify(repository).moveAliases("suggestion-1", "item-1", null);
        verify(repository).moveEvidences("suggestion-1", "item-1", null, null);
        verify(repository).deleteItemAt("suggestion-1", 5);
    }

    /** 建议目标不存在或不属于当前项目时整批拒绝。 */
    @Test
    void shouldRejectBatchWhenSuggestionTargetMissing() {
        when(sourceRepository.findByProject(USER_ID, PROJECT_ID)).thenReturn(Mono.just(document(3, 3L)));
        when(repository.findItemsForUpdate(PROJECT_ID, List.of("suggestion-1")))
                .thenReturn(reactor.core.publisher.Flux.just(item("suggestion-1", "item-1")));
        when(repository.findItemsForUpdate(PROJECT_ID, List.of("item-1"))).thenReturn(reactor.core.publisher.Flux.empty());
        StepVerifier.create(service.confirmItems(new StoryBibleDtos.BatchConfirmRequest(PROJECT_ID,
                        List.of(new StoryBibleDtos.BatchItemRequest("suggestion-1", 5)))))
                .expectErrorMatches(error -> error instanceof BusinessException exception
                        && exception.getCode() == ErrorCode.DATA_CONFLICT).verify();
        verify(repository, never()).moveAliases(anyString(), anyString(), any());
        verify(repository, never()).deleteItemAt(anyString(), anyLong());
    }

    /** 同批次混入其他项目的条目时不修改任何条目。 */
    @Test
    void shouldRejectBatchContainingAnotherProjectsItem() {
        when(sourceRepository.findByProject(USER_ID, PROJECT_ID)).thenReturn(Mono.just(document(3, 3L)));
        when(repository.findItemsForUpdate(PROJECT_ID, List.of("item-1", "foreign-item")))
                .thenReturn(reactor.core.publisher.Flux.just(item("item-1", null)));
        StepVerifier.create(service.confirmItems(new StoryBibleDtos.BatchConfirmRequest(PROJECT_ID, List.of(
                        new StoryBibleDtos.BatchItemRequest("item-1", 5),
                        new StoryBibleDtos.BatchItemRequest("foreign-item", 5)))))
                .expectErrorMatches(error -> error instanceof BusinessException exception
                        && exception.getCode() == ErrorCode.RESOURCE_NOT_FOUND).verify();
        verify(repository, never()).updateStatus(anyString(), anyLong(), anyString());
    }

    /**
     * 只能合并同类型人物或地点。
     */
    @Test
    void shouldRejectMergingDifferentTypes() {
        when(sourceRepository.findByProject(USER_ID, PROJECT_ID)).thenReturn(Mono.just(document(3, 3L)));
        StoryBibleRepository.Item location = new StoryBibleRepository.Item("item-2", PROJECT_ID, "doc-1", "location", "长安", "",
                new JSONObject(), "ai", "pending", false, null, "长安", 0, "", "uncertain", null, 0);
        when(repository.getItem(PROJECT_ID, "item-1")).thenReturn(Mono.just(item("item-1", null)));
        when(repository.getItem(PROJECT_ID, "item-2")).thenReturn(Mono.just(location));
        StepVerifier.create(service.mergeEntities(new StoryBibleDtos.MergeRequest(PROJECT_ID, "item-1", 0, "item-2", 0)))
                .expectErrorMatches(error -> error.getMessage().contains("同类型"))
                .verify();
        verify(repository, never()).updateItem(any(), any());
    }

    /**
     * 准备报价所需的桩。
     *
     * @param tiers List&lt;PricingTier&gt; 价格档位
     */
    private void stubQuote(List<StoryBibleDtos.PricingTier> tiers) {
        when(sourceRepository.findByProject(USER_ID, PROJECT_ID)).thenReturn(Mono.just(document(3, 3L)));
        when(modelFactory.resolveTextModel(MODEL)).thenReturn(Mono.just(
                new AgentScopeModelFactory.TextModelSelection(null, MODEL, "gpt", "openai", 0)));
        when(persistenceService.getPlatformModelConfigs()).thenReturn(Mono.just(List.of(new PersistenceDtos.ModelConfig(
                "config-1", "channel-1", "gpt", "text", List.of(), false, 0, 0, false, null))));
        when(sourceRepository.normalizedText("doc-1")).thenReturn(Mono.just(TEXT));
        lenient().when(pricingService.find("config-1")).thenReturn(Mono.just(new StoryBibleRepository.Pricing("config-1", tiers, 4, new StoryBibleDtos.QuickConfiguration(1_000_000, 100_000, 20_000, 3))));
        lenient().when(sourceRepository.listSections("doc-1")).thenReturn(reactor.core.publisher.Flux.just(
                new com.novanovastudio.dto.ScriptSourceDtos.Section("chapter-1", null, "chapter", "第一章", 0, TEXT.length(), 0, false)));
    }

    /**
     * 构造原文记录。
     *
     * @param revision long 当前修订号
     * @param confirmedRevision Long 已确认修订号
     * @return Document 原文记录
     */
    private ScriptSourceRepository.Document document(long revision, Long confirmedRevision) {
        return new ScriptSourceRepository.Document("doc-1", PROJECT_ID, USER_ID, "novel", "a.txt", "txt", "UTF-8",
                "storage", "key", "sha", revision, confirmedRevision, "completed", "");
    }

    /**
     * 构造分析任务。
     *
     * @param id String 任务标识
     * @param status String 状态
     * @return Job 任务
     */
    private StoryBibleRepository.Job job(String id, String status) {
        return new StoryBibleRepository.Job(id, PROJECT_ID, "doc-1", USER_ID, "req-1", MODEL, "config-1", List.of(),
                List.of(new int[]{0, TEXT.length()}), 10, 20, 4, 3, status, "extract", 0, 0, 1, "", null, null, 0, 5);
    }

    /**
     * 构造人物条目。
     *
     * @param id String 条目标识
     * @param suggestFor String 建议目标
     * @return Item 条目
     */
    private StoryBibleRepository.Item item(String id, String suggestFor) {
        return new StoryBibleRepository.Item(id, PROJECT_ID, "doc-1", "character", "林远", "", new JSONObject(), "ai",
                "pending", false, suggestFor, "林远", 0, "", "uncertain", null, 5);
    }
}
