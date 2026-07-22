package com.novanovastudio.agent;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * @title        AgentToolRegistryTest.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  Agent工具注册表测试
 * @createTime   2026-06-28 23:55:00
 */
class AgentToolRegistryTest {

    /**
     * 测试图片生成工具必须要求模型传入图片尺寸。
     *
     * @return void 无返回值
     */
    @Test
    void shouldRequireImageSizeBeforeGenerationToolCall() {
        // 图片供应商要求尺寸必填，工具契约必须提前约束模型补齐参数。
        AgentToolRegistry registry = new AgentToolRegistry();
        JSONObject imageTool = findAnthropicTool(registry, "canvas_generate_image");
        JSONObject inputSchema = imageTool.getJSONObject("input_schema");
        JSONArray required = inputSchema.getJSONArray("required");

        Assertions.assertNotNull(required);
        Assertions.assertTrue(required.contains("prompt"));
        Assertions.assertTrue(required.contains("size"));
    }

    /**
     * 查找Anthropic格式工具定义。
     *
     * @param registry AgentToolRegistry 工具注册表
     * @param toolName String 工具名称
     * @return JSONObject 工具定义
     */
    private JSONObject findAnthropicTool(AgentToolRegistry registry, String toolName) {
        return registry.toAnthropicTools().stream()
            .filter(tool -> toolName.equals(tool.getString("name")))
            .findFirst()
            .orElseThrow(() -> new AssertionError("未找到工具: " + toolName));
    }
}
