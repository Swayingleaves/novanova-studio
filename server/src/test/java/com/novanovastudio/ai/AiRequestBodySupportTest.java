package com.novanovastudio.ai;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * AI请求体参数工具测试。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-08-17 00:00
 */
class AiRequestBodySupportTest {

    /** 自定义参数应覆盖同名系统参数并保留其他系统参数。 */
    @Test
    void shouldMergeCustomBodyParametersAfterSystemParameters() {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", "system-model");
        payload.put("prompt", "系统提示词");
        JSONObject customBodyParameters = JSON.parseObject("{\"model\":\"custom-model\",\"like\":true}");

        Map<String, Object> merged = AiRequestBodySupport.mergeCustomBodyParameters(payload, customBodyParameters);

        Assertions.assertEquals("custom-model", merged.get("model"));
        Assertions.assertEquals("系统提示词", merged.get("prompt"));
        Assertions.assertEquals(true, merged.get("like"));
        Assertions.assertEquals("system-model", payload.get("model"));
    }

    /** 空自定义参数不应修改系统请求体。 */
    @Test
    void shouldKeepPayloadWhenCustomBodyParametersAreEmpty() {
        Map<String, Object> payload = Map.of("model", "system-model");

        Map<String, Object> merged = AiRequestBodySupport.mergeCustomBodyParameters(payload, new JSONObject());

        Assertions.assertEquals(payload, merged);
    }
}
