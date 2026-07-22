package com.novanovastudio.ai;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * @title        AiJsonUtilsTest.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  AI JSON工具测试
 * @createTime   2026-06-24 22:36:00
 */
class AiJsonUtilsTest {

    /**
     * 测试统一响应包装中data为数组时可正确读取。
     *
     * @return void 无返回值
     */
    @Test
    void shouldReadEnvelopeArrayPayload() {
        // 图片接口常见返回结构是data数组，必须保留数组内容。
        JSONObject response = new JSONObject();
        JSONArray data = new JSONArray();
        data.add(JSONObject.of("url", "https://example.com/a.png"));
        response.put("code", 0);
        response.put("data", data);

        Assertions.assertEquals(1, AiJsonUtils.responseArrayPayload(response, "data").size());
    }

    /**
     * 测试统一响应包装中data为对象时可读取嵌套数组。
     *
     * @return void 无返回值
     */
    @Test
    void shouldReadNestedArrayPayload() {
        // 部分代理会把数组放在data.data里，也需要正常读取。
        JSONObject response = new JSONObject();
        JSONObject dataObject = new JSONObject();
        JSONArray data = new JSONArray();
        data.add(JSONObject.of("b64_json", "abc"));
        dataObject.put("data", data);
        response.put("code", 0);
        response.put("data", dataObject);

        Assertions.assertEquals(1, AiJsonUtils.responseArrayPayload(response, "data").size());
    }

    /**
     * 测试日志响应会省略Base64图片内容，并保留原始响应。
     *
     * @return void 无返回值
     */
    @Test
    void shouldOmitBase64ImageContentFromLogResponse() {
        JSONObject response = new JSONObject();
        response.put("data", new JSONArray());
        response.getJSONArray("data").add(JSONObject.of("b64_json", "abc", "revised_prompt", "测试图片"));

        JSONObject logResponse = AiJsonUtils.formatResponseForLog(response);

        Assertions.assertEquals("Base64内容已省略，字符数=3", logResponse.getJSONArray("data").getJSONObject(0).getString("b64_json"));
        Assertions.assertEquals("abc", response.getJSONArray("data").getJSONObject(0).getString("b64_json"));
    }
}
