package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.common.SystemMessage;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.TimeoutDtos;
import com.novanovastudio.repository.TimeoutSettingsRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.TeamScope;
import java.time.OffsetDateTime;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

/**
 * 读取并应用平台超时设置。各实例定期从数据库刷新，保存后当前实例立即生效。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-10 01:50
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class TimeoutSettingsService {

    /** 超时设置仓储。 */
    private final TimeoutSettingsRepository repository;

    /** 运行时配置，保存当前生效的超时快照。 */
    private final NovanovaProperties properties;

    /** 当前用户。 */
    private final CurrentUserProvider currentUserProvider;

    /** 已应用到本进程的设置更新时间，避免较旧的刷新覆盖较新的保存。 */
    private OffsetDateTime appliedAt;

    /**
     * 应用启动后立即加载超时设置。
     */
    @EventListener(ApplicationReadyEvent.class)
    public void loadOnStartup() {
        refresh().subscribe();
    }

    /**
     * 定期刷新，让其他实例看到管理后台的修改。
     *
     * @return Mono<Void> 刷新完成
     */
    @Scheduled(fixedDelay = 5000, initialDelay = 5000)
    public Mono<Void> refresh() {
        return repository.find()
                .doOnNext(row -> apply(row.settings(), row.updatedAt()))
                .switchIfEmpty(Mono.defer(() -> {
                    log.error("平台超时设置不存在");
                    return Mono.empty();
                }))
                .then()
                .onErrorResume(error -> {
                    log.error("读取超时设置失败", error);
                    return Mono.empty();
                });
    }

    /**
     * 查询当前超时设置。
     *
     * @return Mono<TimeoutSettings> 超时设置
     */
    public Mono<TimeoutDtos.TimeoutSettings> getSettings() {
        return requirePlatformAdministrator().then(repository.find().map(TimeoutSettingsRepository.TimeoutSettingsRow::settings)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, SystemMessage.of("business.timeoutSettingsMissing")))));
    }

    /**
     * 保存超时设置并立即应用到当前进程。
     *
     * @param request TimeoutSettings 超时设置
     * @return Mono<TimeoutSettings> 保存后的设置
     */
    public Mono<TimeoutDtos.TimeoutSettings> updateSettings(TimeoutDtos.TimeoutSettings request) {
        return requirePlatformAdministrator().then(repository.update(request))
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, SystemMessage.of("business.timeoutSettingsMissing"))))
                .doOnNext(row -> {
                    apply(row.settings(), row.updatedAt());
                    log.info("保存超时设置成功: aiRequestBody={}s, storyboard={}s, script={}s, storyBible={}s, taskWait={}s, videoWait={}s, composition={}s, cos={}ms",
                            row.settings().aiRequestBodyTimeoutSeconds(), row.settings().storyboardAgentTimeoutSeconds(),
                            row.settings().scriptAgentTimeoutSeconds(), row.settings().storyBibleAgentTimeoutSeconds(),
                            row.settings().taskWaitTimeoutSeconds(), row.settings().videoTaskWaitTimeoutSeconds(),
                            row.settings().videoCompositionExecutionTimeoutSeconds(), row.settings().tencentCosSocketTimeoutMilliseconds());
                })
                .map(TimeoutSettingsRepository.TimeoutSettingsRow::settings);
    }

    /**
     * 限定平台管理员在平台空间修改全站超时。
     *
     * @return Mono<Void> 校验通过
     */
    private Mono<Void> requirePlatformAdministrator() {
        return currentUserProvider.currentUser().flatMap(user -> TeamScope.current()
                .filter(scope -> scope.teamId() == 0 && "admin".equals(user.role()))
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.PERMISSION_DENIED,
                        SystemMessage.of("business.onlyPlatformAdministratorCanManageTimeoutSettings"))))
                .then());
    }

    /**
     * 把数据库中的设置写入运行时快照。
     *
     * @param settings TimeoutSettings 超时设置
     * @param updatedAt OffsetDateTime 更新时间
     */
    private void apply(TimeoutDtos.TimeoutSettings settings, OffsetDateTime updatedAt) {
        synchronized (this) {
            if (appliedAt != null && updatedAt != null && updatedAt.isBefore(appliedAt)) {
                return;
            }
            NovanovaProperties.RuntimeTimeouts next = new NovanovaProperties.RuntimeTimeouts(
                    settings.aiRequestBodyTimeoutSeconds(), settings.storyboardAgentTimeoutSeconds(),
                    settings.scriptAgentTimeoutSeconds(), settings.storyBibleAgentTimeoutSeconds(),
                    settings.taskWaitTimeoutSeconds(), settings.videoTaskWaitTimeoutSeconds(),
                    settings.videoCompositionExecutionTimeoutSeconds(), settings.tencentCosSocketTimeoutMilliseconds());
            NovanovaProperties.RuntimeTimeouts previous = properties.timeoutSettings();
            properties.replaceTimeoutSettings(next);
            if (updatedAt != null) {
                appliedAt = updatedAt;
            }
            if (!next.equals(previous)) {
                log.info("已应用超时设置: aiRequestBody={}s, storyboard={}s, script={}s, storyBible={}s, taskWait={}s, videoWait={}s, composition={}s, cos={}ms",
                        next.aiRequestBodyTimeoutSeconds(), next.storyboardAgentTimeoutSeconds(), next.scriptAgentTimeoutSeconds(),
                        next.storyBibleAgentTimeoutSeconds(), next.taskWaitTimeoutSeconds(), next.videoTaskWaitTimeoutSeconds(),
                        next.videoCompositionExecutionTimeoutSeconds(), next.tencentCosSocketTimeoutMilliseconds());
            }
        }
    }
}
