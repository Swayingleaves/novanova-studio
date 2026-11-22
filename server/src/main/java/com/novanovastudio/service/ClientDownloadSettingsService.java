package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.common.SystemMessage;
import com.novanovastudio.dto.ClientDownloadSettingsDtos;
import com.novanovastudio.repository.ClientDownloadSettingsRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.TeamScope;
import java.net.URI;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

/**
 * 平台客户端下载链接配置业务服务。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-22 14:35:00
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ClientDownloadSettingsService {

    /** 下载链接最大长度。 */
    private static final int MAX_URL_LENGTH = 1024;

    /** 客户端下载链接配置仓储。 */
    private final ClientDownloadSettingsRepository repository;

    /** 当前登录用户提供器。 */
    private final CurrentUserProvider currentUserProvider;

    /**
     * 公开读取当前客户端下载链接配置；数据库未记录时返回空链接配置。
     *
     * @return Mono<ClientDownloadSettings> 客户端下载链接配置
     */
    public Mono<ClientDownloadSettingsDtos.ClientDownloadSettings> getSettings() {
        return repository.findSingleton()
                .map(record -> new ClientDownloadSettingsDtos.ClientDownloadSettings(
                        record.getMacIntelUrl(), record.getMacAppleSiliconUrl(), record.getWindowsUrl()))
                .defaultIfEmpty(new ClientDownloadSettingsDtos.ClientDownloadSettings(null, null, null));
    }

    /**
     * 平台管理员更新客户端下载链接配置。
     *
     * @param request SaveClientDownloadSettingsRequest 更新请求
     * @return Mono<ClientDownloadSettings> 保存后的配置
     */
    public Mono<ClientDownloadSettingsDtos.ClientDownloadSettings> saveSettings(
            ClientDownloadSettingsDtos.SaveClientDownloadSettingsRequest request) {
        return requirePlatformAdministrator().then(Mono.defer(() -> {
            String macIntelUrl = normalizeDownloadUrl(request == null ? null : request.macIntelUrl());
            String macAppleSiliconUrl = normalizeDownloadUrl(request == null ? null : request.macAppleSiliconUrl());
            String windowsUrl = normalizeDownloadUrl(request == null ? null : request.windowsUrl());
            return repository.upsert(macIntelUrl, macAppleSiliconUrl, windowsUrl)
                    .doOnNext(record -> log.info("保存平台客户端下载链接配置成功: hasMacIntel={}, hasMacAppleSilicon={}, hasWindows={}",
                            record.getMacIntelUrl() != null, record.getMacAppleSiliconUrl() != null, record.getWindowsUrl() != null))
                    .map(record -> new ClientDownloadSettingsDtos.ClientDownloadSettings(
                            record.getMacIntelUrl(), record.getMacAppleSiliconUrl(), record.getWindowsUrl()));
        }));
    }

    /**
     * 规范化并校验下载链接，空白返回 null，非空必须为合法的 http/https 链接。
     *
     * @param rawUrl String 原始链接
     * @return String 规范化后的链接，可为 null
     */
    static String normalizeDownloadUrl(String rawUrl) {
        if (rawUrl == null || rawUrl.isBlank()) {
            return null;
        }
        String trimmed = rawUrl.trim();
        if (trimmed.length() > MAX_URL_LENGTH) {
            throw new BusinessException(ErrorCode.PARAM_INVALID,
                    SystemMessage.of("business.clientDownloadUrlTooLong"));
        }
        try {
            URI uri = URI.create(trimmed);
            String scheme = uri.getScheme();
            if ((!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme))
                    || uri.getHost() == null || uri.getHost().isBlank()) {
                throw new BusinessException(ErrorCode.PARAM_INVALID,
                        SystemMessage.of("business.clientDownloadUrlInvalid"));
            }
            return trimmed;
        } catch (IllegalArgumentException exception) {
            throw new BusinessException(ErrorCode.PARAM_INVALID,
                    SystemMessage.of("business.clientDownloadUrlInvalid"));
        }
    }

    /**
     * 限定平台空间的全局管理员才能修改客户端下载链接配置。
     *
     * @return Mono<Void> 权限校验通过信号
     */
    private Mono<Void> requirePlatformAdministrator() {
        return currentUserProvider.currentUser().flatMap(user -> TeamScope.current()
                .filter(scope -> scope.teamId() == 0 && "admin".equals(user.role()))
                .switchIfEmpty(Mono.error(new BusinessException(
                        ErrorCode.PERMISSION_DENIED,
                        SystemMessage.of("business.onlyPlatformAdministratorCanManageClientDownloadSettings"))))
                .then());
    }
}
