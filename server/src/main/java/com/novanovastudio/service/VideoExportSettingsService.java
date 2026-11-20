package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.common.SystemMessage;
import com.novanovastudio.dto.VideoExportSettingsDtos;
import com.novanovastudio.repository.VideoExportSettingsRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.TeamScope;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

/**
 * 平台漫剧视觉分镜板导出视频开关配置业务服务。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-19 21:55:00
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class VideoExportSettingsService {

    /** 导出视频开关配置仓储。 */
    private final VideoExportSettingsRepository repository;

    /** 当前登录用户提供器。 */
    private final CurrentUserProvider currentUserProvider;

    /**
     * 公开读取当前导出视频开关配置；数据库未记录时默认返回开启状态。
     *
     * @return Mono<VideoExportSettings> 导出视频开关配置
     */
    public Mono<VideoExportSettingsDtos.VideoExportSettings> getSettings() {
        return repository.findSingleton()
                .map(record -> new VideoExportSettingsDtos.VideoExportSettings(
                        record.getEnabled() == null || record.getEnabled()))
                .defaultIfEmpty(new VideoExportSettingsDtos.VideoExportSettings(true));
    }

    /**
     * 校验漫剧视觉分镜板导出视频功能已开启；若后台已关闭则抛出业务异常拒绝执行。
     *
     * @return Mono<Void> 校验通过信号
     */
    public Mono<Void> requireVideoExportEnabled() {
        return getSettings()
                .filter(VideoExportSettingsDtos.VideoExportSettings::enabled)
                .switchIfEmpty(Mono.error(new BusinessException(
                        ErrorCode.BUSINESS_ERROR, SystemMessage.of("business.videoExportDisabled"))))
                .then();
    }

    /**
     * 平台管理员更新导出视频开关配置。
     *
     * @param request SaveVideoExportSettingsRequest 更新请求
     * @return Mono<VideoExportSettings> 保存后的配置
     */
    public Mono<VideoExportSettingsDtos.VideoExportSettings> saveSettings(
            VideoExportSettingsDtos.SaveVideoExportSettingsRequest request) {
        return requirePlatformAdministrator().then(Mono.defer(() -> {
            if (request == null || request.enabled() == null) {
                return Mono.error(new BusinessException(
                        ErrorCode.PARAM_INVALID, SystemMessage.of("business.videoExportSettingsEnabledRequired")));
            }
            // 更新唯一的平台配置行并记录操作日志。
            return repository.upsert(request.enabled())
                    .switchIfEmpty(Mono.error(new BusinessException(
                            ErrorCode.BUSINESS_ERROR, SystemMessage.of("business.videoExportSettingsMissing"))))
                    .doOnNext(record -> log.info("保存平台导出视频开关配置成功: enabled={}", record.getEnabled()))
                    .map(record -> new VideoExportSettingsDtos.VideoExportSettings(
                            record.getEnabled() != null && record.getEnabled()));
        }));
    }

    /**
     * 限定平台空间的全局管理员才能修改全站导出视频配置。
     *
     * @return Mono<Void> 权限校验通过信号
     */
    private Mono<Void> requirePlatformAdministrator() {
        return currentUserProvider.currentUser().flatMap(user -> TeamScope.current()
                .filter(scope -> scope.teamId() == 0 && "admin".equals(user.role()))
                .switchIfEmpty(Mono.error(new BusinessException(
                        ErrorCode.PERMISSION_DENIED,
                        SystemMessage.of("business.onlyPlatformAdministratorCanManageVideoExportSettings"))))
                .then());
    }
}
