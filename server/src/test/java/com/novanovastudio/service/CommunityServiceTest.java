package com.novanovastudio.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.CommunityDtos;
import com.novanovastudio.entity.PlatformCommunityConfigRecords;
import com.novanovastudio.repository.CommunityConfigRepository;
import com.novanovastudio.security.CurrentUser;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.TeamScope;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

/**
 * 平台社群配置服务测试。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-29 15:30
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class CommunityServiceTest {

    @Mock
    private CommunityConfigRepository repository;

    @Mock
    private CurrentUserProvider currentUserProvider;

    @Mock
    private TransactionalOperator transactionalOperator;

    private CommunityService service;

    @BeforeEach
    void setUp() {
        when(currentUserProvider.currentUser()).thenReturn(Mono.just(new CurrentUser(42L, "admin@admin.com", "admin", 1)));
        when(transactionalOperator.transactional(org.mockito.ArgumentMatchers.<Mono<Void>>any()))
                .thenAnswer(invocation -> invocation.getArgument(0));
        when(repository.lockForReplace()).thenReturn(Mono.empty());
        when(repository.replaceAll(anyList())).thenReturn(Mono.empty());
        service = new CommunityService(repository, currentUserProvider, transactionalOperator);
    }

    /** 公开列表只输出名称、图片地址与排序值。 */
    @Test
    void shouldReturnNameImageUrlAndSortOrderForPublicList() {
        PlatformCommunityConfigRecords.CommunityConfigRecord record = new PlatformCommunityConfigRecords.CommunityConfigRecord();
        record.setName("官方群");
        record.setImageUrl("https://cdn.example.com/a.png");
        record.setSortOrder(1);
        when(repository.listOrdered()).thenReturn(Flux.just(record));

        StepVerifier.create(service.listConfigs())
                .assertNext(items -> {
                    assertThat(items).hasSize(1);
                    assertThat(items.get(0).name()).isEqualTo("官方群");
                    assertThat(items.get(0).imageUrl()).isEqualTo("https://cdn.example.com/a.png");
                    assertThat(items.get(0).sortOrder()).isEqualTo(1);
                })
                .verifyComplete();
    }

    /** 保存按提交顺序重算排序值，并写入整份配置。 */
    @Test
    void shouldPersistSubmittedOrderWhenSavingConfigs() {
        service.saveConfigs(new CommunityDtos.SaveCommunityConfigsRequest(List.of(
                new CommunityDtos.CommunityConfigInput(" 官方群 ", "https://cdn.example.com/a.png"),
                new CommunityDtos.CommunityConfigInput("创作者群", "https://cdn.example.com/b.png"))))
                .contextWrite(TeamScope.PLATFORM::apply).block();

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<PlatformCommunityConfigRecords.CommunityConfigRecord>> captor = ArgumentCaptor.forClass(List.class);
        verify(repository).replaceAll(captor.capture());
        assertThat(captor.getValue()).extracting(PlatformCommunityConfigRecords.CommunityConfigRecord::getName)
                .containsExactly("官方群", "创作者群");
        assertThat(captor.getValue()).extracting(PlatformCommunityConfigRecords.CommunityConfigRecord::getSortOrder)
                .containsExactly(0, 1);
    }

    /** 显式空数组表示清空全部社群。 */
    @Test
    void shouldClearAllConfigsWhenSavingEmptyList() {
        service.saveConfigs(new CommunityDtos.SaveCommunityConfigsRequest(List.of()))
                .contextWrite(TeamScope.PLATFORM::apply).block();

        verify(repository).replaceAll(List.of());
    }

    /** 团队作用域即使由团队管理员发起也不能写入平台社群配置。 */
    @Test
    void shouldRejectTeamScopedWrite() {
        assertThatThrownBy(() -> service.saveConfigs(new CommunityDtos.SaveCommunityConfigsRequest(List.of()))
                .contextWrite(new TeamScope(9, "administrator")::apply).block())
                .isInstanceOf(BusinessException.class)
                .satisfies(error -> assertThat(((BusinessException) error).getCode()).isEqualTo(ErrorCode.PERMISSION_DENIED));
        verify(repository, never()).replaceAll(anyList());
    }

    /** 空名称、非法图片地址和重复配置都在写入前被拒绝。 */
    @Test
    void shouldRejectInvalidConfigsBeforeWriting() {
        assertRejected(new CommunityDtos.CommunityConfigInput("  ", "https://cdn.example.com/a.png"));
        assertRejected(new CommunityDtos.CommunityConfigInput("官方群", "ftp://cdn.example.com/a.png"));
        assertRejected(new CommunityDtos.CommunityConfigInput("官方群", "https://cdn.example.com/a.png"),
                new CommunityDtos.CommunityConfigInput(" 官方群 ", "https://cdn.example.com/b.png"));
        assertRejected(new CommunityDtos.CommunityConfigInput("官方群", "https://cdn.example.com/a.png"),
                new CommunityDtos.CommunityConfigInput("创作者群", "https://cdn.example.com/a.png"));
        verify(repository, never()).replaceAll(anyList());
    }

    /** 缺少配置数组的请求不能被当成清空全部社群。 */
    @Test
    void shouldRejectMissingConfigsPayload() {
        assertThatThrownBy(() -> service.saveConfigs(new CommunityDtos.SaveCommunityConfigsRequest(null))
                .contextWrite(TeamScope.PLATFORM::apply).block())
                .isInstanceOf(BusinessException.class);
        verify(repository, never()).replaceAll(anyList());
    }

    private void assertRejected(CommunityDtos.CommunityConfigInput... inputs) {
        assertThatThrownBy(() -> service.saveConfigs(new CommunityDtos.SaveCommunityConfigsRequest(List.of(inputs)))
                .contextWrite(TeamScope.PLATFORM::apply).block())
                .isInstanceOf(BusinessException.class)
                .satisfies(error -> assertThat(((BusinessException) error).getCode()).isEqualTo(ErrorCode.PARAM_INVALID));
    }
}
