package com.novanovastudio.dto;

import jakarta.validation.constraints.NotNull;

/**
 * 平台漫剧视觉分镜板导出视频开关配置请求与响应数据传输对象。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-19 21:55:00
 */
public final class VideoExportSettingsDtos {

    private VideoExportSettingsDtos() {
    }

    /**
     * 导出视频开关配置响应。
     *
     * @param enabled 是否开启导出视频功能
     */
    public record VideoExportSettings(boolean enabled) {
    }

    /**
     * 保存导出视频开关配置请求。
     *
     * @param enabled 是否开启导出视频功能
     */
    public record SaveVideoExportSettingsRequest(
            @NotNull(message = "business.videoExportSettingsEnabledRequired")
            Boolean enabled) {
    }
}
