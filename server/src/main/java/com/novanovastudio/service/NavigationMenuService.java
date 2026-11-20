package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.common.SystemMessage;
import com.novanovastudio.dto.NavigationMenuDtos;
import com.novanovastudio.entity.PlatformNavigationMenuConfigRecords;
import com.novanovastudio.repository.NavigationMenuConfigRepository;
import com.novanovastudio.security.CurrentUser;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.TeamScope;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Mono;

/**
 * 平台全局左侧导航菜单配置业务服务。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-18 10:55:00
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class NavigationMenuService {

    /** 可配置左侧导航菜单默认顺序，需与前端主导航定义保持一致。 */
    public static final List<String> DEFAULT_MENU_KEYS = List.of(
            "drama", "image", "video", "canvas", "script",
            "comic-drama", "assets", "prompts", "skill-market"
    );

    /** 允许配置的导航菜单标识集合。 */
    private static final Set<String> ALLOWED_MENU_KEYS = Set.copyOf(DEFAULT_MENU_KEYS);

    /** 导航菜单配置仓储。 */
    private final NavigationMenuConfigRepository repository;

    /** 当前登录用户提供者。 */
    private final CurrentUserProvider currentUserProvider;

    /** 响应式事务操作器。 */
    private final TransactionalOperator transactionalOperator;

    /**
     * 读取按排序值排列的平台导航菜单配置；数据库缺失的内置菜单按默认顺序以开启状态追加。
     *
     * @return 完整有序的导航菜单配置列表
     */
    public Mono<List<NavigationMenuDtos.NavigationMenuConfig>> listConfigs() {
        return repository.listOrdered()
                .collectList()
                .map(this::mergeWithDefaults);
    }

    /**
     * 平台管理员整批保存导航菜单配置，提交顺序即展示顺序。
     *
     * @param request 整份导航菜单配置保存请求
     * @return 保存完成信号
     */
    public Mono<Void> saveConfigs(NavigationMenuDtos.SaveNavigationMenuConfigsRequest request) {
        return requirePlatformAdministrator().then(Mono.defer(() -> {
            // 先校验全量菜单清单与重复项，再加咨询锁整表重建。
            List<PlatformNavigationMenuConfigRecords.NavigationMenuConfigRecord> records = buildRecords(request);
            return transactionalOperator.transactional(repository.lockForReplace().then(repository.replaceAll(records)))
                    .doOnSuccess(ignored -> log.info("保存平台导航菜单配置成功: count={}", records.size()));
        }));
    }

    /**
     * 将数据库已存配置与内置默认菜单合并，保证前端始终得到完整的有序列表。
     *
     * @param records 数据库按 sort_order 查出的配置记录
     * @return 合并并重新编号后的菜单配置列表
     */
    private List<NavigationMenuDtos.NavigationMenuConfig> mergeWithDefaults(
            List<PlatformNavigationMenuConfigRecords.NavigationMenuConfigRecord> records) {
        List<NavigationMenuDtos.NavigationMenuConfig> merged = new ArrayList<>(DEFAULT_MENU_KEYS.size());
        Set<String> seenKeys = new HashSet<>();
        for (PlatformNavigationMenuConfigRecords.NavigationMenuConfigRecord record : records) {
            String menuKey = normalize(record.getMenuKey());
            if (!ALLOWED_MENU_KEYS.contains(menuKey) || !seenKeys.add(menuKey)) {
                continue;
            }
            boolean enabled = record.getEnabled() == null || record.getEnabled();
            merged.add(new NavigationMenuDtos.NavigationMenuConfig(menuKey, enabled, merged.size()));
        }
        // 新增的内置菜单尚未落库时，按默认顺序以启用状态补齐到末尾。
        for (String defaultKey : DEFAULT_MENU_KEYS) {
            if (seenKeys.add(defaultKey)) {
                merged.add(new NavigationMenuDtos.NavigationMenuConfig(defaultKey, true, merged.size()));
            }
        }
        return merged;
    }

    /**
     * 限定仅平台空间的全局管理员可修改菜单配置，团队管理员无权编辑全站菜单。
     *
     * @return 当前平台管理员
     */
    private Mono<CurrentUser> requirePlatformAdministrator() {
        return currentUserProvider.currentUser().flatMap(user -> TeamScope.current()
                .filter(scope -> scope.teamId() == 0 && "admin".equals(user.role()))
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.PERMISSION_DENIED,
                        SystemMessage.of("business.onlyPlatformAdministratorCanManageNavigationMenus"))))
                .thenReturn(user));
    }

    /**
     * 校验并转换整份导航菜单配置，排序值按提交顺序从零递增。
     *
     * @param request 保存请求
     * @return 待写入的配置记录列表
     */
    private List<PlatformNavigationMenuConfigRecords.NavigationMenuConfigRecord> buildRecords(
            NavigationMenuDtos.SaveNavigationMenuConfigsRequest request) {
        if (request == null || request.configs() == null) {
            throw new BusinessException(ErrorCode.PARAM_INVALID,
                    SystemMessage.of("business.navigationMenuConfigsInvalid"));
        }
        List<NavigationMenuDtos.NavigationMenuConfigInput> inputs = request.configs();
        List<PlatformNavigationMenuConfigRecords.NavigationMenuConfigRecord> records = new ArrayList<>(inputs.size());
        Set<String> seenKeys = new HashSet<>();
        for (int index = 0; index < inputs.size(); index++) {
            NavigationMenuDtos.NavigationMenuConfigInput input = inputs.get(index);
            if (input == null || input.enabled() == null) {
                throw new BusinessException(ErrorCode.PARAM_INVALID,
                        SystemMessage.of("business.navigationMenuConfigsInvalid"));
            }
            String menuKey = normalize(input.menuKey());
            if (!ALLOWED_MENU_KEYS.contains(menuKey)) {
                throw new BusinessException(ErrorCode.PARAM_INVALID,
                        SystemMessage.of("business.navigationMenuKeyInvalid"));
            }
            if (!seenKeys.add(menuKey)) {
                throw new BusinessException(ErrorCode.PARAM_INVALID,
                        SystemMessage.of("business.navigationMenuConfigDuplicated"));
            }
            PlatformNavigationMenuConfigRecords.NavigationMenuConfigRecord record =
                    new PlatformNavigationMenuConfigRecords.NavigationMenuConfigRecord();
            record.setMenuKey(menuKey);
            record.setEnabled(input.enabled());
            record.setSortOrder(index);
            records.add(record);
        }
        // 要求一次提交包含全部可配置菜单项，避免遗漏导致部分菜单排序失效。
        if (records.size() != DEFAULT_MENU_KEYS.size()) {
            throw new BusinessException(ErrorCode.PARAM_INVALID,
                    SystemMessage.of("business.navigationMenuConfigsIncomplete"));
        }
        return records;
    }

    /**
     * 规范化字符串参数，去除首尾空白并将空值转为空串。
     *
     * @param value 原始字符串
     * @return 规范化后的字符串
     */
    private String normalize(String value) {
        return value == null ? "" : value.trim();
    }
}
