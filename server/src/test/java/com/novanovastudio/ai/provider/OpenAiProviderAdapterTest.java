package com.novanovastudio.ai.provider;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.ai.AiHttpClient;
import com.novanovastudio.ai.AiMediaSupport;
import com.novanovastudio.ai.AiTaskExecutionContext;
import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.entity.AiGenerationTask;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;

/**
 * OpenAI兼容文本请求测试。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-07-24 00:00
 */
class OpenAiProviderAdapterTest {

    /**
     * 文本任务应使用Chat Completions端点，并按思考开关发送正确参数。
     */
    @Test
    void shouldSendThinkingConfigurationToChatCompletions() {
        AiHttpClient aiHttpClient = mock(AiHttpClient.class);
        OpenAiProviderAdapter adapter = new OpenAiProviderAdapter(aiHttpClient, mock(AiMediaSupport.class));
        List<JSONObject> payloads = new ArrayList<>();
        when(aiHttpClient.sendJsonRequest(any(AiTaskDtos.AiChannelConfig.class), eq("POST"), eq("/chat/completions"), any()))
                .thenAnswer(invocation -> {
                    payloads.add(JSON.parseObject(JSON.toJSONString(invocation.getArgument(3))));
                    return Mono.just(JSON.parseObject("{\"choices\":[{\"message\":{\"content\":\"完成\"}}]}"));
                });

        adapter.execute(textContext(true, "max")).block();
        adapter.execute(textContext(false, "max")).block();

        Assertions.assertEquals(2, payloads.size());
        Assertions.assertEquals("enabled", payloads.get(0).getJSONObject("thinking").getString("type"));
        Assertions.assertEquals("max", payloads.get(0).getString("reasoning_effort"));
        Assertions.assertEquals("disabled", payloads.get(1).getJSONObject("thinking").getString("type"));
        Assertions.assertFalse(payloads.get(1).containsKey("reasoning_effort"));
        Assertions.assertEquals("user", payloads.get(0).getJSONArray("messages").getJSONObject(1).getString("role"));
    }

    /**
     * 构建文本任务上下文。
     *
     * @param thinkingEnabled boolean 是否开启思考模式
     * @param reasoningEffort String 思考强度
     * @return AiTaskExecutionContext 文本任务上下文
     */
    private AiTaskExecutionContext textContext(boolean thinkingEnabled, String reasoningEffort) {
        AiGenerationTask task = new AiGenerationTask();
        task.setTaskType(AiTaskTypes.TEXT);
        task.setUserId(1L);
        return new AiTaskExecutionContext(task,
                new AiTaskDtos.AiChannelConfig("channel-1", "DeepSeek", "https://api.deepseek.com", "test-key", "openai", List.of("deepseek-chat")),
                "deepseek-chat", thinkingEnabled, reasoningEffort,
                new AiTaskDtos.CreateAiTaskRequest(AiTaskTypes.TEXT, "请优化提示词", "deepseek-chat", Map.of("systemPrompt", "你是提示词专家"), List.of(), List.of(), "prompt-optimization"),
                () -> Mono.just(false), progress -> Mono.empty(), delta -> Mono.empty());
    }
}
