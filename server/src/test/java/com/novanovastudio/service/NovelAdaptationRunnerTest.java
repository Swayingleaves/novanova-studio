package com.novanovastudio.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.dto.NovelAdaptationDtos;
import com.novanovastudio.dto.ScriptDtos;
import com.novanovastudio.repository.NovelAdaptationJobRepository;
import com.novanovastudio.repository.NovelAdaptationRepository;
import com.novanovastudio.repository.StoryBibleRepository;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 小说改编执行器跳过成功产物和按实际草稿结算的回归测试。
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-10-01 12:00
 */
@ExtendWith(MockitoExtension.class)
class NovelAdaptationRunnerTest {
    /** 任务仓储。 */
    @Mock private NovelAdaptationJobRepository jobRepository;
    /** 知识库仓储。 */
    @Mock private StoryBibleRepository storyBibleRepository;
    /** 草稿检查点仓储。 */
    @Mock private NovelAdaptationRepository novelAdaptationRepository;
    /** 改编服务。 */
    @Mock private NovelAdaptationService novelAdaptationService;
    /** 剧本服务。 */
    @Mock private ScriptService scriptService;
    /** 积分服务。 */
    @Mock private CreditService creditService;
    /** 响应式事务操作器。 */
    @Mock private TransactionalOperator transactionalOperator;
    /** 明确在平台空间执行既有任务。 */
    private final TeamTaskScopeService teamTaskScopeService = com.novanovastudio.TeamTestSupport.taskScope();
    /** 被测执行器。 */
    @InjectMocks private NovelAdaptationRunner runner;

    /** 验证第一集草稿已保存时仅调用第二集生成，并按真实产物恢复进度。 */
    @Test
    void shouldGenerateOnlyMissingEpisode() {
        ScriptDtos.ProjectOverview overview = new ScriptDtos.ProjectOverview("项目", "comicDrama", "", "", "", 60, 2, "", "", "", "", "");
        ScriptDtos.ProjectDetail project = new ScriptDtos.ProjectDetail("project-a", overview, List.of(), List.of(), List.of(),
                List.of(), new ScriptDtos.WorldSetting("", "", "", ""), List.of(), List.of(),
                List.of(episode("first"), episode("second")), "writing", 60, false, 24, null, null);
        when(jobRepository.claim("job-a", NovelAdaptationRunner.LEASE_SECONDS)).thenReturn(Mono.just(true));
        when(jobRepository.find("job-a")).thenReturn(Mono.just(job("running", 0)));
        when(storyBibleRepository.listConfirmedItemTypes("project-a"))
                .thenReturn(Flux.just(new StoryBibleRepository.ItemTypeRef("fact-a", "character", 3)));
        when(scriptService.getProject("project-a")).thenReturn(Mono.just(project));
        when(scriptService.getSnapshotForUser(1L, "project-a", 24))
                .thenReturn(Mono.just(new ScriptDtos.ProjectSnapshot(project, List.of())));
        when(novelAdaptationRepository.listCheckpoints("job-a")).thenReturn(Flux.just(checkpoint()));
        when(novelAdaptationService.validateCheckpoints(any(), any(), any(), any())).thenReturn(Mono.empty());
        when(jobRepository.status("job-a")).thenReturn(Mono.just("running"));
        when(novelAdaptationService.generateStageDraft(eq("job-a"), any())).thenReturn(Mono.empty());
        when(jobRepository.updateProgress("job-a", "drafts", "episode", 2, 2)).thenReturn(Mono.empty());
        when(jobRepository.await("job-a", "drafts", "episode", 2)).thenReturn(Mono.just(true));

        runner.process("job-a").block();

        ArgumentCaptor<NovelAdaptationDtos.GenerateRequest> request = ArgumentCaptor.forClass(NovelAdaptationDtos.GenerateRequest.class);
        verify(novelAdaptationService).generateStageDraft(eq("job-a"), request.capture());
        org.junit.jupiter.api.Assertions.assertEquals("second", request.getValue().episodeId());
        org.junit.jupiter.api.Assertions.assertEquals(24, request.getValue().expectedRevision());
        verify(jobRepository).await("job-a", "drafts", "episode", 2);
        verify(creditService, never()).refundOperation(any(), any(), any(), org.mockito.ArgumentMatchers.any(java.math.BigDecimal.class));
    }

    /** 验证保存后进度尚未更新就失败时，仍只退未完成部分并使用本次续跑的计费标识。 */
    @Test
    void shouldSettlePersistedDraftWhenProgressIsStale() {
        when(jobRepository.claim("job-a", NovelAdaptationRunner.LEASE_SECONDS)).thenReturn(Mono.just(true));
        when(jobRepository.find("job-a")).thenReturn(Mono.error(new IllegalStateException("模拟执行中断")),
                Mono.just(job("running", 0)), Mono.just(job("failed", 1)));
        when(novelAdaptationRepository.listCheckpoints("job-a")).thenReturn(Flux.just(checkpoint()));
        when(jobRepository.finish("job-a", "failed", "模拟执行中断", 1)).thenReturn(Mono.just(true));
        when(creditService.refundOperation(1L, "job-a:retry:1", NovelAdaptationService.OPERATION_NAME, java.math.BigDecimal.valueOf(10).setScale(6))).thenReturn(Mono.empty());
        when(transactionalOperator.transactional(org.mockito.ArgumentMatchers.<Mono<Void>>any()))
                .thenAnswer(invocation -> invocation.getArgument(0));

        runner.process("job-a").block();

        verify(jobRepository).finish("job-a", "failed", "模拟执行中断", 1);
        verify(creditService).refundOperation(1L, "job-a:retry:1", NovelAdaptationService.OPERATION_NAME, java.math.BigDecimal.valueOf(10).setScale(6));
        verify(transactionalOperator).transactional(org.mockito.ArgumentMatchers.<Mono<Void>>any());
    }

    /**
     * 创建固定单价和滞后进度的续跑任务。
     * @param status String 任务状态
     * @param settledCalls int 已结算数量
     * @return Job 测试任务
     */
    private NovelAdaptationJobRepository.Job job(String status, int settledCalls) {
        return new NovelAdaptationJobRepository.Job("job-a", "project-a", 1, "request-a", "channel::model", "model-config",
                JSONObject.of("episodeCount", 2), List.of("fact-a"), "drafts", "episode", status, 2, 0, 2, settledCalls, java.math.BigDecimal.valueOf(20), "", null, 1);
    }

    /**
     * 创建已保存第一集草稿的成功检查点。
     * @return DraftCheckpoint 草稿记录
     */
    private NovelAdaptationRepository.DraftCheckpoint checkpoint() {
        return new NovelAdaptationRepository.DraftCheckpoint("episode", "first", "pending", 24, new JSONObject(),
                List.of(new NovelAdaptationDtos.Fact("fact-a", 1, "character", "人物甲", "", "", List.of())));
    }

    /**
     * 创建正式分集摘要。
     * @param id String 分集标识
     * @return EpisodeSummary 测试分集
     */
    private ScriptDtos.EpisodeSummary episode(String id) {
        return new ScriptDtos.EpisodeSummary(id, 1, "测试分集", "", "", "", "", "", 60, "planning", 0);
    }
}
