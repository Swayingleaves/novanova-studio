package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * 平台客户端下载链接配置服务测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-22 14:35:00
 */
class ClientDownloadSettingsServiceTest {

    /** 合法的 http/https 链接应去空白保留，空白应归一为 null，非法链接应拒绝。 */
    @Test
    void shouldNormalizeAndValidateDownloadUrls() {
        Assertions.assertNull(ClientDownloadSettingsService.normalizeDownloadUrl(null));
        Assertions.assertNull(ClientDownloadSettingsService.normalizeDownloadUrl("   "));
        Assertions.assertEquals("https://cdn.example.com/app-arm64.dmg",
                ClientDownloadSettingsService.normalizeDownloadUrl("  https://cdn.example.com/app-arm64.dmg  "));
        Assertions.assertThrows(BusinessException.class,
                () -> ClientDownloadSettingsService.normalizeDownloadUrl("ftp://cdn.example.com/app.dmg"));
        Assertions.assertThrows(BusinessException.class,
                () -> ClientDownloadSettingsService.normalizeDownloadUrl("not-a-url"));
        Assertions.assertThrows(BusinessException.class,
                () -> ClientDownloadSettingsService.normalizeDownloadUrl("https://example.com/" + "a".repeat(1024)));
    }
}
