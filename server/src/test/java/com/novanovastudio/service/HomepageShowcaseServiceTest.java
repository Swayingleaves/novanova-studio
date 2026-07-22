package com.novanovastudio.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.dto.HomepageShowcaseDtos;
import com.novanovastudio.entity.HomepageShowcaseRecords;
import com.novanovastudio.repository.HomepageShowcaseRepository;
import com.novanovastudio.security.CurrentUserProvider;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 首页展示内容服务测试。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-07-18 12:00:00
 */
@ExtendWith(MockitoExtension.class)
class HomepageShowcaseServiceTest {

    @Mock
    private HomepageShowcaseRepository repository;

    @Mock
    private CurrentUserProvider currentUserProvider;

    @InjectMocks
    private HomepageShowcaseService service;

    /**
     * 验证创建内容时持久化分类和创作者信息。
     */
    @Test
    void shouldPersistCategoryAndCreatorNameWhenCreatingShowcase() {
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(7L));
        when(repository.create(any())).thenReturn(Mono.just(1L));

        service.create(createRequest("视觉海报", "林夏")).block();

        ArgumentCaptor<HomepageShowcaseRecords.ShowcaseRecord> recordCaptor = ArgumentCaptor.forClass(HomepageShowcaseRecords.ShowcaseRecord.class);
        verify(repository).create(recordCaptor.capture());
        assertThat(recordCaptor.getValue().getCategory()).isEqualTo("视觉海报");
        assertThat(recordCaptor.getValue().getCreatorName()).isEqualTo("林夏");
    }

    /**
     * 验证公开列表返回分类和创作者信息。
     */
    @Test
    void shouldExposeCategoryAndCreatorNameInPublicList() {
        HomepageShowcaseRecords.ShowcaseRecord record = new HomepageShowcaseRecords.ShowcaseRecord();
        record.setId(1L);
        record.setTitle("雾城回声");
        record.setDescription("视觉海报");
        record.setCategory("视觉海报");
        record.setCreatorName("林夏");
        record.setMediaType("image");
        record.setMediaUrl("/homepage/fantastic-show/fantastic-show-01.jpg");
        record.setThumbnailUrl("");
        record.setTargetType("image");
        record.setTargetPath("/image");
        record.setPromptContent("雾中城市视觉海报");
        record.setSortOrder(10);
        record.setStatus(1);
        when(repository.listPublic(24)).thenReturn(Flux.just(record));

        HomepageShowcaseDtos.ShowcaseListResponse response = service.listPublic(24).block();

        assertThat(response.items()).singleElement().satisfies(item -> {
            assertThat(item.category()).isEqualTo("视觉海报");
            assertThat(item.creatorName()).isEqualTo("林夏");
        });
    }

    /**
     * 验证分类和创作者为必填字段。
     */
    @Test
    void shouldRejectBlankCategoryOrCreatorName() {
        assertThatThrownBy(() -> service.create(createRequest("", "林夏"))).isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> service.create(createRequest("视觉海报", ""))).isInstanceOf(BusinessException.class);
    }

    /**
     * 创建用于测试的首页展示请求。
     *
     * @param category String 作品分类
     * @param creatorName String 创作者名称
     * @return CreateShowcaseRequest 首页展示创建请求
     */
    private HomepageShowcaseDtos.CreateShowcaseRequest createRequest(String category, String creatorName) {
        return new HomepageShowcaseDtos.CreateShowcaseRequest("雾城回声", "浓雾城市视觉海报", category, creatorName,
                "image", "/homepage/fantastic-show/fantastic-show-01.jpg", "", "image", "/image",
                "雾中未来都市视觉海报", 10, 1);
    }
}
