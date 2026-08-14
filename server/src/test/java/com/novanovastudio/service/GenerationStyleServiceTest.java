package com.novanovastudio.service;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.dto.GenerationStyleDtos;
import com.novanovastudio.entity.GenerationStyleRecords;
import com.novanovastudio.repository.GenerationStyleRepository;
import java.util.List;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 生成风格解析与校验测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-31 00:00
 */
@ExtendWith(MockitoExtension.class)
class GenerationStyleServiceTest {

    /** 风格仓储。 */
    @Mock
    private GenerationStyleRepository repository;

    /** 风格服务。 */
    private GenerationStyleService service;

    /** 初始化服务。 */
    @BeforeEach
    void setUp() {
        service = new GenerationStyleService(repository);
    }

    /** 普通生成应解析用户选择的启用风格。 */
    @Test
    void shouldResolveSingleEnabledStyle() {
        when(repository.findEnabledByIds("image", List.of(2L)))
                .thenReturn(Flux.just(style(2L, "水彩", "watercolor")));

        List<GenerationStyleDtos.GenerationStyleSnapshot> result = service
                .resolveStyles("image", List.of(2L), List.of()).block();

        Assertions.assertNotNull(result);
        Assertions.assertEquals(List.of(2L), result.stream().map(GenerationStyleDtos.GenerationStyleSnapshot::id).toList());
        Assertions.assertEquals(List.of("水彩"), result.stream().map(GenerationStyleDtos.GenerationStyleSnapshot::name).toList());
        verify(repository).findEnabledByIds("image", List.of(2L));
    }

    /** 重复风格和超过一个风格都必须拒绝。 */
    @Test
    void shouldRejectDuplicateOrTooManyStyleIds() {
        Assertions.assertThrows(BusinessException.class,
                () -> service.resolveStyles("image", List.of(1L, 1L), List.of()).block());
        BusinessException exception = Assertions.assertThrows(BusinessException.class,
                () -> service.resolveStyles("image", List.of(1L, 2L), List.of()).block());
        Assertions.assertTrue(exception.getMessage().contains("最多选择1个风格"));
        verifyNoInteractions(repository);
    }

    /** 不可用或类型不匹配的风格ID必须返回明确错误。 */
    @Test
    void shouldRejectMissingOrMismatchedStyleIds() {
        when(repository.findEnabledByIds("video", List.of(1L)))
                .thenReturn(Flux.just(style(1L, "电影感", "cinematic")));

        BusinessException exception = Assertions.assertThrows(BusinessException.class,
                () -> service.resolveStyles("video", List.of(1L), List.of()).block());

        Assertions.assertTrue(exception.getMessage().contains("不可用或类型不匹配"));
    }

    /** 历史快照应允许停用后的原始提示词并保持顺序，同时禁止混用ID。 */
    @Test
    void shouldValidateHistorySnapshotsAndMutualExclusion() {
        List<GenerationStyleDtos.GenerationStyleSnapshot> snapshots = List.of(
                new GenerationStyleDtos.GenerationStyleSnapshot(2L, "水彩", "image", "watercolor"),
                new GenerationStyleDtos.GenerationStyleSnapshot(1L, "电影感", "image", "cinematic"),
                new GenerationStyleDtos.GenerationStyleSnapshot(3L, "素描", "image", "sketch"));

        List<GenerationStyleDtos.GenerationStyleSnapshot> result = service
                .resolveStyles("image", List.of(), snapshots).block();

        Assertions.assertNotNull(result);
        Assertions.assertEquals(List.of(2L, 1L, 3L), result.stream().map(GenerationStyleDtos.GenerationStyleSnapshot::id).toList());
        Assertions.assertThrows(BusinessException.class,
                () -> service.resolveStyles("image", List.of(), List.of(
                        new GenerationStyleDtos.GenerationStyleSnapshot(1L, "风格一", "image", "prompt-1"),
                        new GenerationStyleDtos.GenerationStyleSnapshot(2L, "风格二", "image", "prompt-2"),
                        new GenerationStyleDtos.GenerationStyleSnapshot(3L, "风格三", "image", "prompt-3"),
                        new GenerationStyleDtos.GenerationStyleSnapshot(4L, "风格四", "image", "prompt-4"))).block());
        Assertions.assertThrows(BusinessException.class,
                () -> service.resolveStyles("image", List.of(3L), snapshots).block());
        Assertions.assertThrows(BusinessException.class,
                () -> service.resolveStyles("video", List.of(), snapshots).block());
    }

    /** 管理端创建和状态更新应拒绝非法类型或状态。 */
    @Test
    void shouldRejectInvalidManagementValues() {
        Assertions.assertThrows(BusinessException.class,
                () -> service.createStyle(new GenerationStyleDtos.CreateStyleRequest("canvas", "名称", "提示词", "https://example.com/cover.png", "人像", 1, 1)).block());
        Assertions.assertThrows(BusinessException.class,
                () -> service.createStyle(new GenerationStyleDtos.CreateStyleRequest("image", "名称", "提示词", "", "", 1, 1)).block());
        Assertions.assertThrows(BusinessException.class,
                () -> service.updateStyleStatus(new GenerationStyleDtos.UpdateStyleStatusRequest(1L, 2)).block());
        verifyNoInteractions(repository);
    }

    /** 创建和更新必须保存封面与分类。 */
    @Test
    void shouldPersistCoverAndCategoryWhenManagingStyles() {
        when(repository.createStyle(any())).thenReturn(Mono.just(11L));
        when(repository.updateStyle(any())).thenReturn(Mono.just(1L));

        service.createStyle(new GenerationStyleDtos.CreateStyleRequest("image", "电影感", "cinematic", "https://example.com/cinematic.png", "电影", 1, 8)).block();
        service.updateStyle(new GenerationStyleDtos.UpdateStyleRequest(11L, "video", "胶片", "film", "https://example.com/film.png", "叙事", 0, 9)).block();

        ArgumentCaptor<GenerationStyleRecords.StyleRecord> captor = ArgumentCaptor.forClass(GenerationStyleRecords.StyleRecord.class);
        verify(repository).createStyle(captor.capture());
        GenerationStyleRecords.StyleRecord created = captor.getValue();
        Assertions.assertEquals("https://example.com/cinematic.png", created.getCoverUrl());
        Assertions.assertEquals("电影", created.getCategory());
        verify(repository).updateStyle(captor.capture());
        GenerationStyleRecords.StyleRecord updated = captor.getValue();
        Assertions.assertEquals(11L, updated.getId());
        Assertions.assertEquals("https://example.com/film.png", updated.getCoverUrl());
        Assertions.assertEquals("叙事", updated.getCategory());
    }

    /** 用户列表应包含封面和分类，风格解析不依赖这两个视觉字段。 */
    @Test
    void shouldMapCoverAndCategoryForUserStyles() {
        GenerationStyleRecords.StyleRecord record = style(7L, "水彩", "watercolor");
        record.setCoverUrl("https://example.com/watercolor.png");
        record.setCategory("艺术");
        when(repository.listStyles(any(), eq(true))).thenReturn(Flux.just(record));

        GenerationStyleDtos.StyleOptionListResponse response = service.listUserStyles("image").block();

        Assertions.assertNotNull(response);
        Assertions.assertEquals("https://example.com/watercolor.png", response.styles().getFirst().coverUrl());
        Assertions.assertEquals("艺术", response.styles().getFirst().category());
        verify(repository).listStyles(any(), eq(true));
    }

    /** 构造启用风格记录。 */
    private GenerationStyleRecords.StyleRecord style(Long id, String name, String prompt) {
        GenerationStyleRecords.StyleRecord record = new GenerationStyleRecords.StyleRecord();
        record.setId(id);
        record.setGenerationType("image");
        record.setName(name);
        record.setStylePrompt(prompt);
        record.setStatus(GenerationStyleRecords.STATUS_ENABLED);
        record.setSortOrder(1);
        return record;
    }
}
