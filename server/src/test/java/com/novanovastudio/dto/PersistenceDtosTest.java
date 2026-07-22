package com.novanovastudio.dto;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import jakarta.validation.Validation;
import jakarta.validation.Validator;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * 持久化数据传输对象校验测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-11 00:00
 */
class PersistenceDtosTest {

    private final Validator validator = Validation.buildDefaultValidatorFactory().getValidator();

    /**
     * 验证渠道名称允许保存为空字符串。
     */
    @Test
    void channelMutationRequestAllowsEmptyChannelName() {
        PersistenceDtos.ChannelMutationRequest request = new PersistenceDtos.ChannelMutationRequest(
                "channel-1", "", "https://example.com", "secret", "openai", List.of(), 0);

        assertTrue(validator.validate(request).isEmpty());
    }

    /**
     * 验证渠道名称仍不允许为 null，保持数据库非空约束。
     */
    @Test
    void channelMutationRequestRejectsNullChannelName() {
        PersistenceDtos.ChannelMutationRequest request = new PersistenceDtos.ChannelMutationRequest(
                "channel-1", null, "https://example.com", "secret", "openai", List.of(), 0);

        assertFalse(validator.validate(request).isEmpty());
    }
}
