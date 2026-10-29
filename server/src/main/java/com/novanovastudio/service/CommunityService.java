package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.common.SystemMessage;
import com.novanovastudio.dto.CommunityDtos;
import com.novanovastudio.entity.PlatformCommunityConfigRecords;
import com.novanovastudio.repository.CommunityConfigRepository;
import com.novanovastudio.security.CurrentUser;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.TeamScope;
import java.net.URI;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Mono;

/**
 * 平台全局社群配置业务服务。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-29 15:30
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class CommunityService {

    /** 单份配置允许的社群数量上限 */
    private static final int MAX_CONFIGS = 20;

    /** 社群名称长度上限 */
    private static final int MAX_NAME_LENGTH = 60;

    /** 二维码图片地址长度上限 */
    private static final int MAX_IMAGE_URL_LENGTH = 2048;

    private final CommunityConfigRepository repository;
    private final CurrentUserProvider currentUserProvider;
    private final TransactionalOperator transactionalOperator;

    /**
     * 读取按排序值排列的公开社群配置。
     *
     * @return 社群名称、图片地址与排序值
     */
    public Mono<List<CommunityDtos.CommunityConfig>> listConfigs() {
        return repository.listOrdered()
                .map(record -> new CommunityDtos.CommunityConfig(record.getName(), record.getImageUrl(),
                        record.getSortOrder() == null ? 0 : record.getSortOrder()))
                .collectList();
    }

    /**
     * 平台管理员整批保存社群配置，提交顺序即展示顺序。
     *
     * @param request 整份社群配置
     * @return 保存完成信号
     */
    public Mono<Void> saveConfigs(CommunityDtos.SaveCommunityConfigsRequest request) {
        return requirePlatformAdministrator().then(Mono.defer(() -> {
            List<PlatformCommunityConfigRecords.CommunityConfigRecord> records = buildRecords(request);
            return transactionalOperator.transactional(repository.lockForReplace().then(repository.replaceAll(records)))
                    .doOnSuccess(ignored -> log.info("保存平台社群配置成功: count={}", records.size()));
        }));
    }

    /**
     * 限定平台管理员与平台空间，团队管理员不能编辑全站社群内容。
     *
     * @return 当前平台管理员
     */
    private Mono<CurrentUser> requirePlatformAdministrator() {
        return currentUserProvider.currentUser().flatMap(user -> TeamScope.current()
                .filter(scope -> scope.teamId() == 0 && "admin".equals(user.role()))
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.PERMISSION_DENIED,
                        SystemMessage.of("business.onlyPlatformAdministratorCanManageCommunity"))))
                .thenReturn(user));
    }

    /**
     * 校验并转换整份配置，排序值按提交顺序从零递增。
     *
     * @param request 保存请求
     * @return 待写入的配置记录
     */
    private List<PlatformCommunityConfigRecords.CommunityConfigRecord> buildRecords(CommunityDtos.SaveCommunityConfigsRequest request) {
        if (request == null || request.configs() == null) {
            // 缺字段的请求不能被当成「清空全部社群」，只有显式空数组才表示清空。
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.communityConfigsInvalid"));
        }
        List<CommunityDtos.CommunityConfigInput> inputs = request.configs();
        if (inputs.size() > MAX_CONFIGS) {
            throw new BusinessException(ErrorCode.PARAM_INVALID,
                    SystemMessage.of("business.communityConfigLimitReached", MAX_CONFIGS));
        }
        List<PlatformCommunityConfigRecords.CommunityConfigRecord> records = new ArrayList<>(inputs.size());
        Set<String> names = new HashSet<>();
        Set<String> imageUrls = new HashSet<>();
        for (int index = 0; index < inputs.size(); index++) {
            CommunityDtos.CommunityConfigInput input = inputs.get(index);
            String name = normalize(input == null ? null : input.name());
            if (name.isBlank()) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.communityNameIsRequired"));
            }
            if (name.length() > MAX_NAME_LENGTH) {
                throw new BusinessException(ErrorCode.PARAM_INVALID,
                        SystemMessage.of("business.communityNameTooLong", MAX_NAME_LENGTH));
            }
            String imageUrl = normalize(input == null ? null : input.imageUrl());
            validateImageUrl(imageUrl);
            if (!names.add(name.toLowerCase(Locale.ROOT)) || !imageUrls.add(imageUrl)) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.communityConfigDuplicated"));
            }
            PlatformCommunityConfigRecords.CommunityConfigRecord record = new PlatformCommunityConfigRecords.CommunityConfigRecord();
            record.setName(name);
            record.setImageUrl(imageUrl);
            record.setSortOrder(index);
            records.add(record);
        }
        return records;
    }

    private void validateImageUrl(String imageUrl) {
        if (imageUrl.isBlank() || imageUrl.length() > MAX_IMAGE_URL_LENGTH) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.communityImageUrlInvalid"));
        }
        try {
            URI uri = URI.create(imageUrl);
            boolean httpScheme = "http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme());
            if (!httpScheme || uri.getHost() == null) throw new IllegalArgumentException("unsupported image url");
        } catch (IllegalArgumentException exception) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.communityImageUrlInvalid"));
        }
    }

    private String normalize(String value) {
        return value == null ? "" : value.trim();
    }
}
