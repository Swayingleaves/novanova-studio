package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.dto.VideoExportSettingsDtos;
import com.novanovastudio.entity.PlatformVideoExportSettingsRecords;
import com.novanovastudio.repository.VideoExportSettingsRepository;
import com.novanovastudio.security.CurrentUser;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.TeamScope;
import java.time.OffsetDateTime;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

/**
 * 平台漫剧视觉分镜板导出视频开关配置测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-19 22:00:00
 */
class VideoExportSettingsServiceTest {

    /** 导出视频开关配置仓储。 */
    private VideoExportSettingsRepository repository;

    /** 待测试业务服务。 */
    private VideoExportSettingsService service;

    /**
     * 初始化测试环境。
     */
    @BeforeEach
    void setUp() {
        repository = mock(VideoExportSettingsRepository.class);
        service = new VideoExportSettingsService(repository, new CurrentUserProvider());
    }

    /**
     * 数据库尚未存在配置记录时，默认返回开启状态。
     */
    @Test
    void shouldDefaultToEnabledWhenSingletonMissing() {
        when(repository.findSingleton()).thenReturn(Mono.empty());

        StepVerifier.create(service.getSettings())
                .assertNext(settings -> assertTrue(settings.enabled()))
                .verifyComplete();

        StepVerifier.create(service.requireVideoExportEnabled())
                .verifyComplete();
    }

    /**
     * 开关处于关闭状态时，导出视频功能校验应抛出业务异常。
     */
    @Test
    void shouldRejectWhenVideoExportDisabled() {
        PlatformVideoExportSettingsRecords.VideoExportSettingsRecord record =
                new PlatformVideoExportSettingsRecords.VideoExportSettingsRecord();
        record.setEnabled(false);
        when(repository.findSingleton()).thenReturn(Mono.just(record));

        StepVerifier.create(service.requireVideoExportEnabled())
                .expectErrorMatches(error -> error instanceof BusinessException business
                        && "business.videoExportDisabled".equals(business.getSystemMessage().key()))
                .verify();
    }

    /**
     * 平台管理员在平台空间可以保存导出视频开关配置。
     */
    @Test
    void shouldAllowPlatformAdministratorToSaveSettings() {
        PlatformVideoExportSettingsRecords.VideoExportSettingsRecord savedRecord =
                new PlatformVideoExportSettingsRecords.VideoExportSettingsRecord();
        savedRecord.setEnabled(false);
        savedRecord.setUpdatedAt(OffsetDateTime.parse("2026-11-19T14:00:00Z"));
        when(repository.upsert(false)).thenReturn(Mono.just(savedRecord));

        StepVerifier.create(asPlatformAdmin(service.saveSettings(
                        new VideoExportSettingsDtos.SaveVideoExportSettingsRequest(false))))
                .assertNext(settings -> assertFalse(settings.enabled()))
                .verifyComplete();

        verify(repository).upsert(false);
    }

    /**
     * 团队空间或普通用户不能修改平台导出视频开关配置。
     */
    @Test
    void shouldRejectNonPlatformAdministrator() {
        StepVerifier.create(service.saveSettings(
                        new VideoExportSettingsDtos.SaveVideoExportSettingsRequest(false))
                        .contextWrite(new TeamScope(1L, "administrator")::apply)
                        .contextWrite(context -> context.put(CurrentUserProvider.CURRENT_USER_CONTEXT_KEY,
                                new CurrentUser(1L, "admin@example.com", "admin", 1))))
                .expectErrorMatches(error -> error instanceof BusinessException business
                        && "business.onlyPlatformAdministratorCanManageVideoExportSettings"
                                .equals(business.getSystemMessage().key()))
                .verify();

        verify(repository, never()).upsert(false);
    }

    /**
     * 以平台空间管理员身份运行响应式流。
     *
     * @param source Mono<T> 待执行的响应式流
     * @param <T> 返回值类型
     * @return Mono<T> 绑定平台管理员上下文的流
     */
    private <T> Mono<T> asPlatformAdmin(Mono<T> source) {
        return source
                .contextWrite(TeamScope.PLATFORM::apply)
                .contextWrite(context -> context.put(CurrentUserProvider.CURRENT_USER_CONTEXT_KEY,
                        new CurrentUser(1L, "admin@example.com", "admin", 1)));
    }
}
