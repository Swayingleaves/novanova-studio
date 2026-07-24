package com.novanovastudio.agent;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.agent.dto.AgentEvent;
import com.novanovastudio.repository.PersistenceRepository;
import java.util.Map;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import reactor.core.publisher.Mono;

/**
 * Agent执行活动服务测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-24 23:49
 */
@ExtendWith(MockitoExtension.class)
class AgentActivityServiceTest {

    /** 生成记录仓储 */
    @Mock
    private PersistenceRepository repository;

    /** 待测试服务 */
    private AgentActivityService service;

    /**
     * 初始化测试服务。
     */
    @BeforeEach
    void setUp() {
        service = new AgentActivityService(repository);
    }

    /**
     * 后端Agent事件应转换为轮次可恢复的完整执行活动。
     */
    @Test
    void shouldBuildRoundActivitiesFromBackendEvents() {
        service.record(AgentEvent.planCreated("conversation-1", "plan-1", "生成图片", 1));
        service.record(AgentEvent.planTaskStatus("conversation-1", "plan-1", "round-1", "running", "正在执行"));
        service.record(AgentEvent.promptPrepared("conversation-1", "plan-1", "round-1", "OPTIMIZE"));
        service.record(AgentEvent.toolExecute("conversation-1", "round-1", "generate_image",
                Map.of("size", "3:4", "quality", "medium", "count", 1)));
        service.record(AgentEvent.progress("conversation-1", "round-1", "task-1", 100, "success"));

        JSONObject round = new JSONObject();
        round.put("id", "round-1");
        round.put("results", JSONArray.of(result("round-1", "success")));
        JSONArray activities = service.activitiesForRound("conversation-1", round);

        Assertions.assertEquals(4, activities.size());
        Assertions.assertEquals("plan-created", activities.getJSONObject(0).getString("type"));
        Assertions.assertEquals("success", activities.getJSONObject(1).getString("status"));
        Assertions.assertEquals("优化生成提示词", activities.getJSONObject(2).getString("title"));
        Assertions.assertEquals("success", activities.getJSONObject(3).getString("status"));
        Assertions.assertEquals("3:4 / 标准质量 / 1 个结果", activities.getJSONObject(3).getString("description"));
    }

    /**
     * 活动持久化应只更新当前用户的指定记录轮次。
     */
    @Test
    void shouldPersistActivitiesForSpecifiedRound() {
        service.record(AgentEvent.toolExecute("conversation-1", "round-1", "generate_video", Map.of("seconds", 5)));
        when(repository.saveGenerationRoundActivities(9L, "conversation-1", "round-1", anyString()))
                .thenReturn(Mono.just(1L));

        service.persistRoundActivities(9L, "conversation-1", "round-1").block();

        ArgumentCaptor<String> activitiesCaptor = ArgumentCaptor.forClass(String.class);
        verify(repository).saveGenerationRoundActivities(9L, "conversation-1", "round-1", activitiesCaptor.capture());
        JSONObject activity = JSON.parseArray(activitiesCaptor.getValue()).getJSONObject(0);
        Assertions.assertEquals("tool-round-1", activity.getString("id"));
        Assertions.assertEquals("5 秒", activity.getString("description"));
    }

    /**
     * 构建生成结果。
     *
     * @param id String 结果ID
     * @param status String 结果状态
     * @return JSONObject 生成结果
     */
    private JSONObject result(String id, String status) {
        JSONObject result = new JSONObject();
        result.put("id", id);
        result.put("status", status);
        return result;
    }
}
