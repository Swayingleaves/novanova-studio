package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.NovelAdaptationDtos;
import com.novanovastudio.dto.ScriptDtos;
import com.novanovastudio.repository.NovelAdaptationJobRepository;
import com.novanovastudio.repository.NovelAdaptationRepository;
import com.novanovastudio.repository.StoryBibleRepository;
import com.novanovastudio.task.NovelAdaptationQueue;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 小说改编失败续跑的费用、幂等与正式内容保护回归测试。
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-10-01 12:00
 */
@ExtendWith(MockitoExtension.class)
class NovelAdaptationRetryTest {
    /** 剧本项目服务。 */
    @Mock private ScriptService scriptService;
    /** 任务仓储。 */
    @Mock private NovelAdaptationJobRepository jobRepository;
    /** 草稿检查点仓储。 */
    @Mock private NovelAdaptationRepository novelAdaptationRepository;
    /** 知识库仓储。 */
    @Mock private StoryBibleRepository storyBibleRepository;
    /** 积分服务。 */
    @Mock private CreditService creditService;
    /** 响应式事务操作器。 */
    @Mock private TransactionalOperator transactionalOperator;
    /** 队列延迟入口。 */
    @Mock private ObjectProvider<NovelAdaptationQueue> queueProvider;
    /** 改编队列。 */
    @Mock private NovelAdaptationQueue queue;
    /** 被测服务，其余未使用依赖保持为空。 */
    @InjectMocks private NovelAdaptationService service;
    /** 正式内容快照。 */
    private ScriptDtos.ProjectSnapshot snapshot;
    /** 已保存正文的生成前目标内容。 */
    private final JSONObject source = JSONObject.of("episode", JSONObject.of("id", "first"), "scenes", List.of());
    /** 原任务已选事实。 */
    private final List<NovelAdaptationDtos.Fact> facts = List.of(new NovelAdaptationDtos.Fact("fact-a", 1, "character", "人物甲", "", "", List.of()));

    /** 初始化已完成第一集草稿、第二集尚未生成的失败场景。 */
    @BeforeEach
    void setUp() {
        ScriptDtos.ProjectOverview overview = new ScriptDtos.ProjectOverview("项目", "comicDrama", "", "", "", 60, 2, "", "", "", "", "");
        ScriptDtos.ProjectDetail project = new ScriptDtos.ProjectDetail("project-a", overview, List.of(), List.of(), List.of(),
                List.of(), new ScriptDtos.WorldSetting("", "", "", ""), List.of(), List.of(),
                List.of(episode("first"), episode("second")), "writing", 60, false, 24, null, null);
        snapshot = new ScriptDtos.ProjectSnapshot(project, List.of());
        when(scriptService.getProject("project-a")).thenReturn(Mono.just(project));
        lenient().when(scriptService.getSnapshotForUser(1L, "project-a", 24)).thenReturn(Mono.just(snapshot));
        lenient().when(scriptService.targetSnapshot(snapshot, "episode", "first")).thenReturn(source);
        lenient().when(storyBibleRepository.listConfirmedItemTypes("project-a"))
                .thenReturn(Flux.just(new StoryBibleRepository.ItemTypeRef("fact-a", "character", 3)));
        lenient().when(novelAdaptationRepository.listCheckpoints("job-a"))
                .thenReturn(Flux.just(new NovelAdaptationRepository.DraftCheckpoint("episode", "first", "pending", 24, source, facts)));
        lenient().when(novelAdaptationRepository.requireCurrentFacts("project-a", facts)).thenReturn(Mono.empty());
    }

    /** 验证费用只包含缺失第二集，不包含已有第一集草稿。 */
    @Test
    void shouldQuoteOnlyMissingCalls() {
        when(jobRepository.find("job-a")).thenReturn(Mono.just(job("failed", 0)));
        NovelAdaptationDtos.RetryQuote quote = service.quoteRetryPipeline(new NovelAdaptationDtos.JobRequest("project-a", "job-a")).block();
        assertEquals(1, quote.completedCalls());
        assertEquals(1, quote.remainingCalls());
        assertEquals(0, java.math.BigDecimal.valueOf(10).compareTo(quote.credits()));
        verifyNoInteractions(creditService, queue);
    }

    /** 验证独立预扣费用并重新排队，保留任务与成功草稿。 */
    @Test
    void shouldChargeRemainingBudgetWithIndependentAttemptIdentifier() {
        NovelAdaptationJobRepository.Job failed = job("failed", 0);
        when(jobRepository.find("job-a")).thenReturn(Mono.just(failed), Mono.just(job("queued", 1)));
        when(jobRepository.retry(failed, 1, 1, java.math.BigDecimal.valueOf(20).setScale(6))).thenReturn(Mono.just(true));
        when(transactionalOperator.transactional(org.mockito.ArgumentMatchers.<Mono<Void>>any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(creditService.chargeOperation(1L, "job-a:retry:1", java.math.BigDecimal.valueOf(10).setScale(6), NovelAdaptationService.OPERATION_NAME, "model-config")).thenReturn(Mono.empty());
        when(queueProvider.getObject()).thenReturn(queue);
        when(queue.enqueue("model-config", "job-a")).thenReturn(Mono.empty());
        when(novelAdaptationRepository.listJobDrafts("job-a")).thenReturn(Flux.empty());

        NovelAdaptationDtos.JobView result = service.retryPipeline(request(10)).block();

        assertEquals("queued", result.status());
        verify(creditService).chargeOperation(1L, "job-a:retry:1", java.math.BigDecimal.valueOf(10).setScale(6), NovelAdaptationService.OPERATION_NAME, "model-config");
        verify(queue).enqueue("model-config", "job-a");
        verify(novelAdaptationRepository, never()).deletePendingAdaptationDrafts(any());
    }

    /** 验证已成功续跑的重复确认不会再次扣费或排队。 */
    @Test
    void shouldReturnAlreadyRetriedJobWithoutChargingAgain() {
        when(jobRepository.find("job-a")).thenReturn(Mono.just(job("queued", 1)));
        when(novelAdaptationRepository.listJobDrafts("job-a")).thenReturn(Flux.empty());

        assertEquals("queued", service.retryPipeline(request(10)).block().status());

        verifyNoInteractions(creditService, queue);
    }

    /** 验证用户确认费用与重新报价不一致时不扣费。 */
    @Test
    void shouldRejectChangedQuoteBeforeCharging() {
        when(jobRepository.find("job-a")).thenReturn(Mono.just(job("failed", 0)));
        BusinessException exception = assertThrows(BusinessException.class, () -> service.retryPipeline(request(0)).block());
        assertEquals(ErrorCode.DATA_CONFLICT, exception.getCode());
        verifyNoInteractions(creditService, queue);
    }

    /** 验证正式目标变化后不能把旧草稿作为完成检查点继续。 */
    @Test
    void shouldRejectModifiedFormalTarget() {
        when(jobRepository.find("job-a")).thenReturn(Mono.just(job("failed", 0)));
        when(scriptService.targetSnapshot(snapshot, "episode", "first")).thenReturn(JSONObject.of("changed", true));
        BusinessException exception = assertThrows(BusinessException.class,
                () -> service.quoteRetryPipeline(new NovelAdaptationDtos.JobRequest("project-a", "job-a")).block());
        assertEquals(ErrorCode.DATA_CONFLICT, exception.getCode());
        verifyNoInteractions(creditService, queue);
    }

    /**
     * 构建固定每次10积分的失败或续跑任务。
     * @param status String 任务状态
     * @param retryCount int 续跑次数
     * @return Job 任务计费快照
     */
    private NovelAdaptationJobRepository.Job job(String status, int retryCount) {
        return new NovelAdaptationJobRepository.Job("job-a", "project-a", 1, "request-a", "channel::model", "model-config",
                JSONObject.of("episodeCount", 2), List.of("fact-a"), "drafts", "episode", status, 2, 1, 2, 1, java.math.BigDecimal.valueOf(20), "失败", null, retryCount);
    }

    /**
     * 创建用户确认的恢复请求。
     * @param credits int 用户确认预扣积分
     * @return RetryJobRequest 恢复请求
     */
    private NovelAdaptationDtos.RetryJobRequest request(int credits) {
        return new NovelAdaptationDtos.RetryJobRequest("project-a", "job-a", 24, 1, java.math.BigDecimal.valueOf(credits), 0);
    }

    /**
     * 创建测试分集摘要。
     * @param id String 分集标识
     * @return EpisodeSummary 分集摘要
     */
    private ScriptDtos.EpisodeSummary episode(String id) {
        return new ScriptDtos.EpisodeSummary(id, 1, "测试分集", "", "", "", "", "", 60, "planning", 0);
    }
}
