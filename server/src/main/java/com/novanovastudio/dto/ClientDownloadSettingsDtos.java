package com.novanovastudio.dto;

/**
 * 平台客户端下载链接配置接口数据结构。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-22 14:35:00
 */
public final class ClientDownloadSettingsDtos {

    private ClientDownloadSettingsDtos() {
    }

    /**
     * 平台客户端下载链接配置响应。
     *
     * @param macIntelUrl String Mac 英特尔芯片客户端下载链接，未配置时为 null
     * @param macAppleSiliconUrl String Mac M 系列芯片客户端下载链接，未配置时为 null
     * @param windowsUrl String Windows 客户端下载链接，未配置时为 null
     */
    public record ClientDownloadSettings(
            String macIntelUrl,
            String macAppleSiliconUrl,
            String windowsUrl
    ) {
    }

    /**
     * 保存平台客户端下载链接配置请求。
     *
     * @param macIntelUrl String Mac 英特尔芯片客户端下载链接，可为空
     * @param macAppleSiliconUrl String Mac M 系列芯片客户端下载链接，可为空
     * @param windowsUrl String Windows 客户端下载链接，可为空
     */
    public record SaveClientDownloadSettingsRequest(
            String macIntelUrl,
            String macAppleSiliconUrl,
            String windowsUrl
    ) {
    }
}
