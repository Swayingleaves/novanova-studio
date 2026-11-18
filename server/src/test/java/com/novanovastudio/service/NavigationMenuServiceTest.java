package com.novanovastudio.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.NavigationMenuDtos;
import com.novanovastudio.entity.PlatformNavigationMenuConfigRecords;
import com.novanovastudio.repository.NavigationMenuConfigRepository;
import com.novanovastudio.security.CurrentUser;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.TeamScope;
import java.util.ArrayList;
import java.util.Collections;
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
 * 平台导航菜单配置服务测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-18 10:55:00
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class NavigationMenuServiceTest {

    /** 导航菜单配置仓储模拟对象。 */
    @Mock
    private NavigationMenuConfigRepository repository;

    /** 当前用户提供者模拟对象。 */
    @Mock
    private CurrentUserProvider currentUserProvider;

    /** 响应式事务操作器模拟对象。 */
    @Mock
    private TransactionalOperator transactionalOperator;

    /** 被测导航菜单配置服务。 */
    private NavigationMenuService service;

    /**
     * 初始化通用模拟行为。
     */
    @BeforeEach
    void setUp() {
        when(currentUserProvider.currentUser()).thenReturn(Mono.just(new CurrentUser(42L, "admin@admin.com", "admin", 1)));
        when(transactionalOperator.transactional(org.mockito.ArgumentMatchers.<Mono<Void>>any()))
                .thenAnswer(invocation -> invocation.getArgument(0));
        when(repository.lockForReplace()).thenReturn(Mono.empty());
        when(repository.replaceAll(anyList())).thenReturn(Mono.empty());
        service = new NavigationMenuService(repository, currentUserProvider, transactionalOperator);
    }

    /** 数据库为空时按默认顺序返回全部开启的菜单项。 */
    @Test
    void shouldReturnAllDefaultEnabledMenusWhenTableIsEmpty() {
        when(repository.listOrdered()).thenReturn(Flux.empty());

        StepVerifier.create(service.listConfigs())
                .assertNext(items -> {
                    assertThat(items).extracting(NavigationMenuDtos.NavigationMenuConfig::menuKey)
                            .containsExactlyElementsOf(NavigationMenuService.DEFAULT_MENU_KEYS);
                    assertThat(items).allMatch(NavigationMenuDtos.NavigationMenuConfig::enabled);
                    assertThat(items).extracting(NavigationMenuDtos.NavigationMenuConfig::sortOrder)
                            .containsExactly(0, 1, 2, 3, 4, 5, 6, 7, 8);
                })
                .verifyComplete();
    }

    /** 数据库已有部分重排和隐藏记录时保留其顺序与开关，并将缺失的默认菜单追加在末尾。 */
    @Test
    void shouldMergeSavedOrderAndAppendMissingDefaults() {
        PlatformNavigationMenuConfigRecords.NavigationMenuConfigRecord assets = record("assets", false, 0);
        PlatformNavigationMenuConfigRecords.NavigationMenuConfigRecord image = record("image", true, 1);
        PlatformNavigationMenuConfigRecords.NavigationMenuConfigRecord unknown = record("unknown-legacy", true, 2);
        when(repository.listOrdered()).thenReturn(Flux.just(assets, image, unknown));

        StepVerifier.create(service.listConfigs())
                .assertNext(items -> {
                    assertThat(items).extracting(NavigationMenuDtos.NavigationMenuConfig::menuKey)
                            .containsExactly("assets", "image", "drama", "video", "canvas", "script", "comic-drama",
                                    "prompts", "skill-market");
                    assertThat(items.get(0).enabled()).isFalse();
                    assertThat(items.get(1).enabled()).isTrue();
                    assertThat(items.get(2).enabled()).isTrue();
                    assertThat(items).extracting(NavigationMenuDtos.NavigationMenuConfig::sortOrder)
                            .containsExactly(0, 1, 2, 3, 4, 5, 6, 7, 8);
                })
                .verifyComplete();
    }

    /** 平台管理员保存配置时按提交顺序重算排序值并保留开关状态。 */
    @Test
    void shouldPersistSubmittedOrderAndEnabledFlagsWhenSavingConfigs() {
        List<String> reordered = new ArrayList<>(NavigationMenuService.DEFAULT_MENU_KEYS);
        Collections.reverse(reordered);
        List<NavigationMenuDtos.NavigationMenuConfigInput> inputs = reordered.stream()
                .map(key -> new NavigationMenuDtos.NavigationMenuConfigInput(" " + key + " ", !"prompts".equals(key)))
                .toList();

        service.saveConfigs(new NavigationMenuDtos.SaveNavigationMenuConfigsRequest(inputs))
                .contextWrite(TeamScope.PLATFORM::apply)
                .block();

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<PlatformNavigationMenuConfigRecords.NavigationMenuConfigRecord>> captor =
                ArgumentCaptor.forClass(List.class);
        verify(repository).replaceAll(captor.capture());
        List<PlatformNavigationMenuConfigRecords.NavigationMenuConfigRecord> saved = captor.getValue();
        assertThat(saved).extracting(PlatformNavigationMenuConfigRecords.NavigationMenuConfigRecord::getMenuKey)
                .containsExactlyElementsOf(reordered);
        assertThat(saved).extracting(PlatformNavigationMenuConfigRecords.NavigationMenuConfigRecord::getSortOrder)
                .containsExactly(0, 1, 2, 3, 4, 5, 6, 7, 8);
        assertThat(saved.stream().filter(item -> "prompts".equals(item.getMenuKey())).findFirst())
                .isPresent()
                .get()
                .extracting(PlatformNavigationMenuConfigRecords.NavigationMenuConfigRecord::getEnabled)
                .isEqualTo(false);
    }

    /** 团队空间作用域即使由团队管理员发起也禁止修改平台导航菜单配置。 */
    @Test
    void shouldRejectTeamScopedWrite() {
        List<NavigationMenuDtos.NavigationMenuConfigInput> inputs = NavigationMenuService.DEFAULT_MENU_KEYS.stream()
                .map(key -> new NavigationMenuDtos.NavigationMenuConfigInput(key, true))
                .toList();

        assertThatThrownBy(() -> service.saveConfigs(new NavigationMenuDtos.SaveNavigationMenuConfigsRequest(inputs))
                .contextWrite(new TeamScope(9, "administrator")::apply)
                .block())
                .isInstanceOf(BusinessException.class)
                .satisfies(error -> assertThat(((BusinessException) error).getCode()).isEqualTo(ErrorCode.PERMISSION_DENIED));
        verify(repository, never()).replaceAll(anyList());
    }

    /** 非法负载、未知标识、重复标识、缺少开启状态与漏传菜单项都在写库前被拒绝。 */
    @Test
    void shouldRejectInvalidPayloadsBeforeWriting() {
        assertThatThrownBy(() -> service.saveConfigs(null)
                .contextWrite(TeamScope.PLATFORM::apply)
                .block())
                .isInstanceOf(BusinessException.class)
                .satisfies(error -> assertThat(((BusinessException) error).getCode()).isEqualTo(ErrorCode.PARAM_INVALID));

        assertThatThrownBy(() -> service.saveConfigs(new NavigationMenuDtos.SaveNavigationMenuConfigsRequest(null))
                .contextWrite(TeamScope.PLATFORM::apply)
                .block())
                .isInstanceOf(BusinessException.class)
                .satisfies(error -> assertThat(((BusinessException) error).getCode()).isEqualTo(ErrorCode.PARAM_INVALID));

        List<NavigationMenuDtos.NavigationMenuConfigInput> withUnknown = NavigationMenuService.DEFAULT_MENU_KEYS.stream()
                .map(key -> new NavigationMenuDtos.NavigationMenuConfigInput(
                        "drama".equals(key) ? "unknown" : key, true))
                .toList();
        assertRejected(withUnknown);

        List<NavigationMenuDtos.NavigationMenuConfigInput> withDuplicate = NavigationMenuService.DEFAULT_MENU_KEYS.stream()
                .map(key -> new NavigationMenuDtos.NavigationMenuConfigInput(
                        "image".equals(key) ? "drama" : key, true))
                .toList();
        assertRejected(withDuplicate);

        List<NavigationMenuDtos.NavigationMenuConfigInput> withNullEnabled = NavigationMenuService.DEFAULT_MENU_KEYS.stream()
                .map(key -> new NavigationMenuDtos.NavigationMenuConfigInput(
                        key, "drama".equals(key) ? null : true))
                .toList();
        assertRejected(withNullEnabled);

        List<NavigationMenuDtos.NavigationMenuConfigInput> incomplete = NavigationMenuService.DEFAULT_MENU_KEYS.stream()
                .limit(NavigationMenuService.DEFAULT_MENU_KEYS.size() - 1)
                .map(key -> new NavigationMenuDtos.NavigationMenuConfigInput(key, true))
                .toList();
        assertRejected(incomplete);

        verify(repository, never()).replaceAll(anyList());
    }

    /**
     * 断言指定输入会被参数校验拒绝。
     *
     * @param inputs 待校验的输入列表
     */
    private void assertRejected(List<NavigationMenuDtos.NavigationMenuConfigInput> inputs) {
        assertThatThrownBy(() -> service.saveConfigs(new NavigationMenuDtos.SaveNavigationMenuConfigsRequest(inputs))
                .contextWrite(TeamScope.PLATFORM::apply)
                .block())
                .isInstanceOf(BusinessException.class)
                .satisfies(error -> assertThat(((BusinessException) error).getCode()).isEqualTo(ErrorCode.PARAM_INVALID));
    }

    /**
     * 构造测试用的导航菜单持久化记录。
     *
     * @param menuKey 菜单标识
     * @param enabled 是否启用
     * @param sortOrder 排序值
     * @return 构造好的持久化记录
     */
    private PlatformNavigationMenuConfigRecords.NavigationMenuConfigRecord record(
            String menuKey, boolean enabled, int sortOrder) {
        PlatformNavigationMenuConfigRecords.NavigationMenuConfigRecord record =
                new PlatformNavigationMenuConfigRecords.NavigationMenuConfigRecord();
        record.setMenuKey(menuKey);
        record.setEnabled(enabled);
        record.setSortOrder(sortOrder);
        return record;
    }
}
