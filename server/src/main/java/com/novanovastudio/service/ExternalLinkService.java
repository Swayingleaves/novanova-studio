package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.common.SystemMessage;
import com.novanovastudio.dto.ExternalLinkDtos;
import com.novanovastudio.entity.PlatformExternalLinkConfigRecords;
import com.novanovastudio.repository.ExternalLinkConfigRepository;
import com.novanovastudio.security.CurrentUser;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.TeamScope;
import com.novanovastudio.storage.MediaAccessService;
import java.net.URI;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

/**
 * 右上角展示外链配置业务服务。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-13 14:20
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ExternalLinkService {

    /** 标题长度上限 */
    private static final int MAX_TITLE_LENGTH = 80;

    /** 目标链接长度上限 */
    private static final int MAX_URL_LENGTH = 2048;

    /** 说明文字长度上限 */
    private static final int MAX_DESCRIPTION_LENGTH = 1000;

    private final ExternalLinkConfigRepository repository;
    private final CurrentUserProvider currentUserProvider;
    /** 私有存储桶读地址签发。 */
    private final MediaAccessService mediaAccessService;

    /**
     * 读取展示外链配置，未配置时返回空。
     *
     * @return 标题、链接、说明与封面地址
     */
    public Mono<ExternalLinkDtos.ExternalLinkConfig> getConfig() {
        return repository.findSingleton()
                .flatMap(record -> mediaAccessService
                        .signUrl(record.getCoverUrl() == null ? "" : record.getCoverUrl(), MediaAccessService.Purpose.PREVIEW)
                        .map(coverUrl -> new ExternalLinkDtos.ExternalLinkConfig(record.getTitle(), record.getUrl(),
                                record.getDescription() == null ? "" : record.getDescription(), coverUrl)));
    }

    /**
     * 平台管理员保存展示外链配置，标题和链接同时为空表示移除入口。
     *
     * @param request 保存请求
     * @return 保存完成信号
     */
    public Mono<Void> saveConfig(ExternalLinkDtos.SaveExternalLinkConfigRequest request) {
        return requirePlatformAdministrator().then(Mono.defer(() -> {
            String title = normalize(request == null ? null : request.title());
            String url = normalize(request == null ? null : request.url());
            String description = normalize(request == null ? null : request.description());
            String coverUrl = normalize(request == null ? null : request.coverUrl());
            if (title.isEmpty() && url.isEmpty()) {
                return repository.deleteSingleton().doOnSuccess(ignored -> log.info("移除平台展示外链配置"));
            }
            if (title.isEmpty()) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.externalLinkTitleIsRequired"));
            }
            if (title.length() > MAX_TITLE_LENGTH) {
                throw new BusinessException(ErrorCode.PARAM_INVALID,
                        SystemMessage.of("business.externalLinkTitleTooLong", MAX_TITLE_LENGTH));
            }
            validateLink(url, "business.externalLinkUrlIsRequired", "business.externalLinkUrlInvalid");
            if (description.length() > MAX_DESCRIPTION_LENGTH) {
                throw new BusinessException(ErrorCode.PARAM_INVALID,
                        SystemMessage.of("business.externalLinkDescriptionTooLong", MAX_DESCRIPTION_LENGTH));
            }
            validateLink(coverUrl, "", "business.externalLinkCoverUrlInvalid");
            PlatformExternalLinkConfigRecords.ExternalLinkConfigRecord record = new PlatformExternalLinkConfigRecords.ExternalLinkConfigRecord();
            record.setTitle(title);
            record.setUrl(url);
            record.setDescription(description);
            record.setCoverUrl(coverUrl);
            return repository.upsert(record)
                    .doOnSuccess(ignored -> log.info("保存平台展示外链配置成功: title={}", title));
        }));
    }

    /**
     * 限定平台管理员与平台空间，团队管理员不能编辑全站展示外链。
     *
     * @return 当前平台管理员
     */
    private Mono<CurrentUser> requirePlatformAdministrator() {
        return currentUserProvider.currentUser().flatMap(user -> TeamScope.current()
                .filter(scope -> scope.teamId() == 0 && "admin".equals(user.role()))
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.PERMISSION_DENIED,
                        SystemMessage.of("business.onlyPlatformAdministratorCanManageExternalLink"))))
                .thenReturn(user));
    }

    private void validateLink(String value, String requiredKey, String invalidKey) {
        if (value.isEmpty() && !requiredKey.isEmpty()) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of(requiredKey));
        }
        if (value.isEmpty()) return;
        if (value.length() > MAX_URL_LENGTH || !isHttpUrl(value)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of(invalidKey));
        }
    }

    private boolean isHttpUrl(String value) {
        try {
            URI uri = URI.create(value);
            boolean httpScheme = "http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme());
            return httpScheme && uri.getHost() != null;
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    private String normalize(String value) {
        return value == null ? "" : value.trim();
    }
}
