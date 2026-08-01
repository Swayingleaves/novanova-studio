package com.novanovastudio.service;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.dto.GenerationStyleDtos;
import com.novanovastudio.entity.GenerationStyleRecords;
import com.novanovastudio.repository.GenerationStyleRepository;
import java.util.List;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import reactor.core.publisher.Flux;

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

    /** 普通生成应按用户选择顺序解析启用风格。 */
    @Test
    void shouldResolveEnabledStylesInSelectionOrder() {
        when(repository.findEnabledByIds("image", List.of(2L, 1L)))
                .thenReturn(Flux.just(style(1L, "电影感", "cinematic"), style(2L, "水彩", "watercolor")));

        List<GenerationStyleDtos.GenerationStyleSnapshot> result = service
                .resolveStyles("image", List.of(2L, 1L), List.of()).block();

        Assertions.assertNotNull(result);
        Assertions.assertEquals(List.of(2L, 1L), result.stream().map(GenerationStyleDtos.GenerationStyleSnapshot::id).toList());
        Assertions.assertEquals(List.of("水彩", "电影感"), result.stream().map(GenerationStyleDtos.GenerationStyleSnapshot::name).toList());
        verify(repository).findEnabledByIds("image", List.of(2L, 1L));
    }

    /** 重复风格和超过三个风格都必须拒绝。 */
    @Test
    void shouldRejectDuplicateOrTooManyStyleIds() {
        Assertions.assertThrows(BusinessException.class,
                () -> service.resolveStyles("image", List.of(1L, 1L), List.of()).block());
        Assertions.assertThrows(BusinessException.class,
                () -> service.resolveStyles("image", List.of(1L, 2L, 3L, 4L), List.of()).block());
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
                new GenerationStyleDtos.GenerationStyleSnapshot(1L, "电影感", "image", "cinematic"));

        List<GenerationStyleDtos.GenerationStyleSnapshot> result = service
                .resolveStyles("image", List.of(), snapshots).block();

        Assertions.assertNotNull(result);
        Assertions.assertEquals(List.of(2L, 1L), result.stream().map(GenerationStyleDtos.GenerationStyleSnapshot::id).toList());
        Assertions.assertThrows(BusinessException.class,
                () -> service.resolveStyles("image", List.of(3L), snapshots).block());
        Assertions.assertThrows(BusinessException.class,
                () -> service.resolveStyles("video", List.of(), snapshots).block());
    }

    /** 管理端创建和状态更新应拒绝非法类型或状态。 */
    @Test
    void shouldRejectInvalidManagementValues() {
        Assertions.assertThrows(BusinessException.class,
                () -> service.createStyle(new GenerationStyleDtos.CreateStyleRequest("canvas", "名称", "提示词", 1, 1)).block());
        Assertions.assertThrows(BusinessException.class,
                () -> service.updateStyleStatus(new GenerationStyleDtos.UpdateStyleStatusRequest(1L, 2)).block());
        verifyNoInteractions(repository);
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
