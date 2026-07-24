package com.novanovastudio.ai;

import com.novanovastudio.common.BusinessException;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * @title        AiHttpClientTest.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  AI远程媒体地址校验测试
 * @createTime   2026-07-15 10:00:00
 */
class AiHttpClientTest {

    /**
     * OpenAI兼容接口必须直接在配置的基础地址后拼接业务路径，不能主动增加版本路径。
     */
    @Test
    void shouldAppendPathToConfiguredAiBaseUrl() {
        Assertions.assertEquals("https://api.deepseek.com/chat/completions",
                AiHttpClient.buildAiUrl("https://api.deepseek.com", "/chat/completions"));
        Assertions.assertEquals("https://api.openai.com/v1/chat/completions",
                AiHttpClient.buildAiUrl("https://api.openai.com/v1/", "/chat/completions"));
    }

    /**
     * 应允许HTTP或HTTPS远程媒体地址。
     */
    @Test
    void shouldAllowHttpAndHttpsRemoteMediaUrls() {
        AiHttpClient client = new AiHttpClient();

        Assertions.assertDoesNotThrow(() -> client.validateRemoteMediaUrl("http://127.0.0.1/media.png").block());
        Assertions.assertDoesNotThrow(() -> client.validateRemoteMediaUrl("https://[::1]/media.png").block());
    }

    /**
     * 应拒绝非HTTP(S)远程媒体地址。
     */
    @Test
    void shouldRejectUnsupportedRemoteMediaProtocol() {
        AiHttpClient client = new AiHttpClient();

        BusinessException exception = Assertions.assertThrows(BusinessException.class,
                () -> client.validateRemoteMediaUrl("file:///tmp/media.png").block());

        Assertions.assertTrue(exception.getMessage().contains("HTTP或HTTPS"));
    }
}
