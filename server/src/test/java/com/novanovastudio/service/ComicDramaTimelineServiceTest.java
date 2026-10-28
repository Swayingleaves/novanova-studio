package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.ComicDramaDtos;
import com.novanovastudio.repository.ComicDramaRepository;
import com.novanovastudio.security.CurrentUserProvider;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 分镜时间轴文字保存边界测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-23 20:00
 */
class ComicDramaTimelineServiceTest {

    /** 漫剧仓储。 */
    private ComicDramaRepository repository;

    /** 当前用户。 */
    private CurrentUserProvider currentUserProvider;

    /** 响应式事务操作器。 */
    private TransactionalOperator transactionalOperator;

    /** 被测服务。 */
    private ComicDramaService service;

    /**
     * 初始化被测服务与独立依赖。
     */
    @BeforeEach
    void setUp() {
        repository = mock(ComicDramaRepository.class);
        currentUserProvider = mock(CurrentUserProvider.class);
        transactionalOperator = mock(TransactionalOperator.class);
        service = new ComicDramaService(currentUserProvider, repository, mock(ScriptService.class),
                mock(StoryboardAgentService.class), mock(ComicDramaFinalPromptPricingService.class), mock(AiTaskService.class), mock(PersistenceService.class),
                transactionalOperator, new NovanovaProperties());
    }

    /**
     * 保存文字片段时应校验项目修订、写入片段并推进项目修订。
     */
    @Test
    void shouldSaveTimelineTextWithProjectRevision() {
        ComicDramaDtos.TimelineText text = timelineText(1000, 2500);
        ComicDramaRepository.ProjectRecord project = new ComicDramaRepository.ProjectRecord(
                "project-one", 7L, "测试项目", "draft", 3L, 1, OffsetDateTime.now(), OffsetDateTime.now());
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(7L));
        when(repository.getProject(7L, "project-one")).thenReturn(Mono.just(project));
        when(repository.hasTimelineTextOverlap("project-one", text)).thenReturn(Mono.just(false));
        when(repository.saveTimelineText("project-one", text)).thenReturn(Mono.just(0L));
        when(repository.advanceRevision(7L, "project-one", 3L)).thenReturn(Mono.just(4L));
        when(repository.listTimelineTexts("project-one")).thenReturn(Flux.just(text));
        when(transactionalOperator.transactional(any(Mono.class))).thenAnswer(invocation -> invocation.getArgument(0));

        ComicDramaDtos.TimelineText saved = service.saveTimelineText(
                new ComicDramaDtos.SaveTimelineTextRequest("project-one", 3L, text)).block();

        assertEquals(text, saved);
        verify(repository).saveTimelineText("project-one", text);
        verify(repository).advanceRevision(7L, "project-one", 3L);
    }

    /**
     * 结束时间不晚于起点时，不应访问数据库。
     */
    @Test
    void shouldRejectInvalidTimelineTextTimeBeforeDatabaseAccess() {
        ComicDramaDtos.TimelineText text = timelineText(2500, 2500);

        assertThrows(BusinessException.class, () -> service.saveTimelineText(
                new ComicDramaDtos.SaveTimelineTextRequest("project-one", 3L, text)).block());
        verifyNoInteractions(repository);
    }

    /**
     * 同一轨道存在时间重叠时拒绝保存。
     */
    @Test
    void shouldRejectOverlappingTimelineText() {
        ComicDramaDtos.TimelineText text = timelineText(1000, 2500);
        ComicDramaRepository.ProjectRecord project = new ComicDramaRepository.ProjectRecord(
                "project-one", 7L, "测试项目", "draft", 3L, 1, OffsetDateTime.now(), OffsetDateTime.now());
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(7L));
        when(repository.getProject(7L, "project-one")).thenReturn(Mono.just(project));
        when(repository.hasTimelineTextOverlap("project-one", text)).thenReturn(Mono.just(true));
        // 重叠命中会在写入前短路，这里仍需把写入与修订推进都给成非空返回，
        // 否则一旦短路失效就会先撞未 mock 的 NPE，把预期的业务异常掩盖掉。
        when(repository.saveTimelineText("project-one", text)).thenReturn(Mono.just(0L));
        when(repository.advanceRevision(7L, "project-one", 3L)).thenReturn(Mono.just(4L));
        when(repository.listTimelineTexts("project-one")).thenReturn(Flux.just(text));
        when(transactionalOperator.transactional(any(Mono.class))).thenAnswer(invocation -> invocation.getArgument(0));

        assertThrows(BusinessException.class, () -> service.saveTimelineText(
                new ComicDramaDtos.SaveTimelineTextRequest("project-one", 3L, text)).block());
        verify(repository).hasTimelineTextOverlap("project-one", text);
    }

    /**
     * 在已存在轨道之后保存新轨道片段时，先扩展轨道数量。
     */
    @Test
    void shouldAddSecondTextTrackWhenSavingItsFirstClip() {
        ComicDramaDtos.TimelineText firstTrackText = timelineText(1000, 2500);
        ComicDramaDtos.TimelineText text = new ComicDramaDtos.TimelineText(firstTrackText.id(), firstTrackText.content(),
                firstTrackText.startMs(), firstTrackText.endMs(), 1, firstTrackText.positionX(),
                firstTrackText.positionY(), firstTrackText.fontSize(), firstTrackText.fontFamily(), firstTrackText.color(),
                firstTrackText.alignment(), firstTrackText.backgroundColor(), 0L, null, null);
        ComicDramaRepository.ProjectRecord project = new ComicDramaRepository.ProjectRecord(
                "project-one", 7L, "测试项目", "draft", 3L, 1, OffsetDateTime.now(), OffsetDateTime.now());
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(7L));
        when(repository.getProject(7L, "project-one")).thenReturn(Mono.just(project));
        when(repository.hasTimelineTextOverlap("project-one", text)).thenReturn(Mono.just(false));
        when(repository.setTextTrackCount("project-one", 2)).thenReturn(Mono.empty());
        when(repository.saveTimelineText("project-one", text)).thenReturn(Mono.just(0L));
        when(repository.advanceRevision(7L, "project-one", 3L)).thenReturn(Mono.just(4L));
        when(repository.listTimelineTexts("project-one")).thenReturn(Flux.just(text));
        when(transactionalOperator.transactional(any(Mono.class))).thenAnswer(invocation -> invocation.getArgument(0));

        assertEquals(text, service.saveTimelineText(
                new ComicDramaDtos.SaveTimelineTextRequest("project-one", 3L, text)).block());
        verify(repository).setTextTrackCount("project-one", 2);
    }

    /**
     * 同轨换位应在一次事务中保存所有受影响片段，并只推进一次项目修订号。
     */
    @Test
    void shouldReorderTimelineTextsTogether() {
        ComicDramaDtos.TimelineText first = timelineText(0, 1000);
        ComicDramaDtos.TimelineText second = new ComicDramaDtos.TimelineText("text-two", "第二段", 1500, 3500,
                0, first.positionX(), first.positionY(), first.fontSize(), first.fontFamily(), first.color(), first.alignment(),
                first.backgroundColor(), 0L, null, null);
        ComicDramaDtos.TimelineText movedSecond = new ComicDramaDtos.TimelineText(second.id(), second.content(), 0, 2000,
                0, second.positionX(), second.positionY(), second.fontSize(), second.fontFamily(), second.color(), second.alignment(),
                second.backgroundColor(), 0L, null, null);
        ComicDramaDtos.TimelineText movedFirst = new ComicDramaDtos.TimelineText(first.id(), first.content(), 2500, 3500,
                0, first.positionX(), first.positionY(), first.fontSize(), first.fontFamily(), first.color(), first.alignment(),
                first.backgroundColor(), 0L, null, null);
        ComicDramaRepository.ProjectRecord project = new ComicDramaRepository.ProjectRecord(
                "project-one", 7L, "测试项目", "draft", 3L, 1, OffsetDateTime.now(), OffsetDateTime.now());
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(7L));
        when(repository.getProject(7L, "project-one")).thenReturn(Mono.just(project));
        when(repository.listTimelineTexts("project-one")).thenReturn(Flux.just(first, second), Flux.just(movedSecond, movedFirst));
        when(repository.saveTimelineText("project-one", movedSecond)).thenReturn(Mono.just(1L));
        when(repository.saveTimelineText("project-one", movedFirst)).thenReturn(Mono.just(1L));
        when(repository.advanceRevision(7L, "project-one", 3L)).thenReturn(Mono.just(4L));
        when(transactionalOperator.transactional(any(Mono.class))).thenAnswer(invocation -> invocation.getArgument(0));

        List<ComicDramaDtos.TimelineText> saved = service.reorderTimelineTexts(
                new ComicDramaDtos.ReorderTimelineTextsRequest("project-one", 3L, List.of(movedSecond, movedFirst))).block();

        assertEquals(List.of(movedSecond, movedFirst), saved);
        verify(repository).saveTimelineText("project-one", movedSecond);
        verify(repository).saveTimelineText("project-one", movedFirst);
        verify(repository).advanceRevision(7L, "project-one", 3L);
    }

    /**
     * 批量结果仍有时间重叠时，保存前应拒绝整组修改。
     */
    @Test
    void shouldRejectOverlappingTimelineTextReorder() {
        ComicDramaDtos.TimelineText first = timelineText(0, 1000);
        ComicDramaDtos.TimelineText second = new ComicDramaDtos.TimelineText("text-two", "第二段", 1500, 2500,
                0, first.positionX(), first.positionY(), first.fontSize(), first.fontFamily(), first.color(), first.alignment(),
                first.backgroundColor(), 0L, null, null);
        ComicDramaDtos.TimelineText overlapping = new ComicDramaDtos.TimelineText(second.id(), second.content(), 500, 1500,
                0, second.positionX(), second.positionY(), second.fontSize(), second.fontFamily(), second.color(), second.alignment(),
                second.backgroundColor(), 0L, null, null);
        ComicDramaRepository.ProjectRecord project = new ComicDramaRepository.ProjectRecord(
                "project-one", 7L, "测试项目", "draft", 3L, 1, OffsetDateTime.now(), OffsetDateTime.now());
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(7L));
        when(repository.getProject(7L, "project-one")).thenReturn(Mono.just(project));
        when(repository.listTimelineTexts("project-one")).thenReturn(Flux.just(first, second));
        when(transactionalOperator.transactional(any(Mono.class))).thenAnswer(invocation -> invocation.getArgument(0));

        assertThrows(BusinessException.class, () -> service.reorderTimelineTexts(
                new ComicDramaDtos.ReorderTimelineTextsRequest("project-one", 3L, List.of(overlapping))).block());
        verify(repository, org.mockito.Mockito.never()).saveTimelineText(any(), any());
    }

    /**
     * 未列入字体目录的标识必须在访问数据库之前被拒绝。
     */
    @Test
    void shouldRejectUnsupportedTimelineFont() {
        ComicDramaDtos.TimelineText original = timelineText(0, 1000);
        ComicDramaDtos.TimelineText invalid = new ComicDramaDtos.TimelineText(original.id(), original.content(),
                original.startMs(), original.endMs(), original.trackNumber(), original.positionX(),
                original.positionY(), original.fontSize(), "unknownFont", original.color(), original.alignment(),
                original.backgroundColor(), original.revision(), null, null);

        assertThrows(BusinessException.class, () -> service.saveTimelineText(
                new ComicDramaDtos.SaveTimelineTextRequest("project-one", 3L, invalid)));
        verify(repository, org.mockito.Mockito.never()).saveTimelineText(any(), any());
    }

    /**
     * 构建具备完整展示字段的测试文字。
     *
     * @param startMs 起点毫秒
     * @param endMs 终点毫秒
     * @return 测试文字片段
     */
    private ComicDramaDtos.TimelineText timelineText(long startMs, long endMs) {
        return new ComicDramaDtos.TimelineText("text-one", "片头文字", startMs, endMs,
                0, new BigDecimal("0.5"), new BigDecimal("0.8"), 36, "notoSansSc", "#ffffff", "center", null,
                0L, null, null);
    }
}
