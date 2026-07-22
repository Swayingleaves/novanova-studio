package com.novanovastudio.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.dto.PromptLibraryDtos;
import com.novanovastudio.entity.PromptLibraryRecords;
import com.novanovastudio.repository.PromptLibraryRepository;
import com.novanovastudio.security.CurrentUserProvider;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * @title        PromptLibraryServiceTest.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  提示词库服务测试
 * @createTime   2026-06-29 22:00:00
 */
@ExtendWith(MockitoExtension.class)
class PromptLibraryServiceTest {

    /** 提示词库仓储 */
    @Mock
    private PromptLibraryRepository repository;

    /** 当前用户提供器 */
    @Mock
    private CurrentUserProvider currentUserProvider;

    /** 提示词库服务 */
    private PromptLibraryService service;

    /**
     * 初始化测试对象。
     */
    @BeforeEach
    void setUp() {
        service = new PromptLibraryService(repository, currentUserProvider);
    }

    /**
     * 创建提示词时应拒绝空标题。
     */
    @Test
    void shouldRejectBlankCreatePromptTitle() {
        PromptLibraryDtos.CreatePromptRequest request = new PromptLibraryDtos.CreatePromptRequest("", "正文", "图片", List.of("风格"), "", "", "", 1, 1000);

        BusinessException exception = Assertions.assertThrows(BusinessException.class, () -> service.createPrompt(request).block());
        Assertions.assertTrue(exception.getMessage().contains("标题不能为空"));
    }

    /**
     * 用户侧列表只返回启用提示词。
     */
    @Test
    void shouldListEnabledPromptsForUserSide() {
        when(repository.listPrompts(any())).thenReturn(Flux.just(enabledRecord()));
        when(repository.countPrompts(any())).thenReturn(Mono.just(1L));
        when(repository.listCategories(anyBoolean())).thenReturn(Flux.just("图片"));
        when(repository.listTags(anyBoolean())).thenReturn(Flux.just("风格"));

        PromptLibraryDtos.PromptListResponse response = service.listUserPrompts(new PromptLibraryDtos.PromptListRequest("", List.of(), "", null, 1, 20)).block();
        Assertions.assertNotNull(response);
        Assertions.assertEquals(1, response.items().size());
        Assertions.assertEquals(1L, response.total());
        Assertions.assertEquals(List.of("风格"), response.tags());
        Assertions.assertEquals(List.of("图片"), response.categories());
    }

    /**
     * 创建提示词时应写入当前管理员用户。
     */
    @Test
    void shouldCreatePromptWithCurrentAdminUser() {
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(7L));
        when(repository.createPrompt(any())).thenReturn(Mono.just(11L));

        PromptLibraryDtos.CreatePromptRequest request = new PromptLibraryDtos.CreatePromptRequest("标题", "正文", "图片", List.of("风格"), "", "", "", 1, 10);

        service.createPrompt(request).block();
        verify(repository).createPrompt(argThat(record -> record.getCreatedBy().equals(7L) && record.getStatus().equals(1)));
    }

    /**
     * 构造启用提示词记录。
     *
     * @return PromptRecord 提示词记录
     */
    private PromptLibraryRecords.PromptRecord enabledRecord() {
        PromptLibraryRecords.PromptRecord record = new PromptLibraryRecords.PromptRecord();
        record.setId(1L);
        record.setTitle("标题");
        record.setPromptContent("正文");
        record.setCoverUrl("");
        record.setPreviewContent("");
        record.setCategory("图片");
        record.setTags(List.of("风格"));
        record.setSourceUrl("");
        record.setStatus(1);
        record.setSortOrder(10);
        record.setCreatedAt(OffsetDateTime.now());
        record.setUpdatedAt(OffsetDateTime.now());
        return record;
    }
}
