package com.novanovastudio.agent;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.agent.dto.AgentChatRequest;
import com.novanovastudio.agent.dto.AgentTool;
import com.novanovastudio.agent.dto.AgentToolResult.ToolResult;
import com.novanovastudio.ai.AiTaskSources;
import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.service.AiTaskService;
import com.novanovastudio.service.PersistenceService;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Function;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import reactor.core.publisher.Mono;

/**
 * 图片和视频任务 Profile 共享执行流程测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-10 00:00
 */
@ExtendWith(MockitoExtension.class)
class AbstractTaskProfileTest {

    /** AI任务服务 */
    @Mock
    private AiTaskService aiTaskService;

    /** 生成记录持久化服务 */
    @Mock
    private PersistenceService persistenceService;

    /** 执行注册表 */
    @Mock
    private AgentExecutionRegistry executionRegistry;

    /** 测试用事件发射器 */
    private AgentEventEmitter eventEmitter;

    /** 已保存的轮次快照 */
    private List<JSONObject> savedRounds;

    /** 已保存的会话标题 */
    private List<String> savedTitles;

    /** 响应式操作实际执行顺序 */
    private List<String> executionOrder;

    /** 待测试 Profile */
    private TestTaskProfile profile;

    /**
     * 初始化测试 Profile 和持久化捕获器。
     */
    @BeforeEach
    void setUp() {
        eventEmitter = mock(AgentEventEmitter.class);
        savedRounds = new ArrayList<>();
        savedTitles = new ArrayList<>();
        executionOrder = new ArrayList<>();
        profile = new TestTaskProfile(aiTaskService, persistenceService, executionRegistry);
    }

    /**
     * 创建任务后应在首次查询前保存 pending，并仅在状态或进度变化时更新同一轮次。
     */
    @Test
    @SuppressWarnings("unchecked")
    void shouldSavePendingAndForwardImageResolutionBeforeFirstPoll() {
        AtomicReference<AiTaskDtos.CreateAiTaskRequest> taskRequestRef = new AtomicReference<>();
        when(persistenceService.saveOrUpdateGenerationRound(anyLong(), anyString(), anyString(), anyString(), any(JSONObject.class)))
                .thenAnswer(invocation -> Mono.defer(() -> {
                    JSONObject round = invocation.getArgument(4);
                    savedTitles.add(invocation.getArgument(3));
                    savedRounds.add(JSON.parseObject(JSON.toJSONString(round)));
                    JSONObject result = round.getJSONArray("results").getJSONObject(0);
                    executionOrder.add("save:" + result.getString("status") + ":" + result.getIntValue("progress"));
                    return Mono.empty();
                }));
        AiTaskDtos.AiGenerationTaskResponse created = response("pending", 0, new JSONObject());
        when(aiTaskService.createTaskForUser(anyLong(), any(AiTaskDtos.CreateAiTaskRequest.class), any(Function.class)))
                .thenAnswer(invocation -> {
                    taskRequestRef.set(invocation.getArgument(1));
                    Function<AiTaskDtos.AiGenerationTaskResponse, Mono<Void>> beforeEnqueue = invocation.getArgument(2);
                    return beforeEnqueue.apply(created).thenReturn(created);
                });
        when(aiTaskService.getTaskForUser(7L, "task-1")).thenReturn(
                polledResponse("pending", 0, new JSONObject()),
                polledResponse("running", 0, new JSONObject()),
                polledResponse("running", 35, new JSONObject()),
                polledResponse("running", 35, new JSONObject()),
                polledResponse("success", 100, successfulResultData()));

        Mono<ToolResult> execution = profile.executeTool(7L, "generate_image",
                Map.of("prompt", "优化后的海报提示词", "size", "1:1", "resolution", "4K", "quality", "high", "model", "model-1"),
                "生成一张海报", List.of(), eventEmitter, "session-1", "call-1");

        ToolResult result = execution.block(Duration.ofSeconds(10));

        Assertions.assertNotNull(result);
        Assertions.assertTrue(result.ok());
        Assertions.assertNotNull(taskRequestRef.get());
        Assertions.assertEquals("优化后的海报提示词", taskRequestRef.get().prompt());
        Assertions.assertEquals("4K", taskRequestRef.get().parameters().get("resolution"));

        Assertions.assertEquals("save:pending:0", executionOrder.getFirst());
        Assertions.assertEquals("getTask", executionOrder.get(1));
        Assertions.assertEquals(4, savedRounds.size());
        assertPendingRound(savedRounds.get(0), 0);
        assertPendingRound(savedRounds.get(1), 0);
        assertPendingRound(savedRounds.get(2), 35);
        Assertions.assertEquals("success", savedRounds.get(3).getJSONArray("results")
                .getJSONObject(0).getString("status"));
        savedRounds.forEach(round -> {
            Assertions.assertEquals("生成一张海报", round.getString("prompt"));
            Assertions.assertEquals("优化后的海报提示词", round.getString("generationPrompt"));
        });
        Assertions.assertTrue(savedTitles.stream().allMatch("生成一张海报"::equals));
    }

    /**
     * 上传图片附件应按存储键写入任务引用和待处理生成记录。
     */
    @Test
    @SuppressWarnings("unchecked")
    void shouldUseUploadedAttachmentStorageKeyAsTaskReference() {
        when(persistenceService.getMediaInfoForUser(7L, "image:cat-dog"))
                .thenReturn(Mono.just(new PersistenceDtos.UploadedMediaResponse(
                        "image:cat-dog", "https://storage.example.com/cat-dog.png", 1024L,
                        "image/png", 100, 100, null, null)));
        when(persistenceService.saveOrUpdateGenerationRound(anyLong(), anyString(), anyString(), anyString(), any(JSONObject.class)))
                .thenAnswer(invocation -> {
                    savedRounds.add(JSON.parseObject(JSON.toJSONString(invocation.getArgument(4))));
                    return Mono.empty();
                });
        AtomicReference<AiTaskDtos.CreateAiTaskRequest> taskRequestRef = new AtomicReference<>();
        AiTaskDtos.AiGenerationTaskResponse created = response("success", 100, successfulResultData());
        when(aiTaskService.createTaskForUser(anyLong(), any(AiTaskDtos.CreateAiTaskRequest.class), any(Function.class)))
                .thenAnswer(invocation -> {
                    taskRequestRef.set(invocation.getArgument(1));
                    Function<AiTaskDtos.AiGenerationTaskResponse, Mono<Void>> beforeEnqueue = invocation.getArgument(2);
                    return beforeEnqueue.apply(created).thenReturn(created);
                });
        when(aiTaskService.getTaskForUser(7L, "task-1"))
                .thenReturn(Mono.just(response("success", 100, successfulResultData())));

        ToolResult result = profile.executeTool(7L, "generate_image",
                        Map.of("prompt", "使用上传图片生成海报", "model", "model-1"),
                        "使用上传图片生成海报",
                        List.of(new AgentChatRequest.Attachment("https://untrusted.example.com/cat-dog.png", "image/png", "猫狗.png", "image:cat-dog")),
                        eventEmitter, "session-1", "call-1")
                .block(Duration.ofSeconds(10));

        Assertions.assertNotNull(result);
        Assertions.assertTrue(result.ok());
        Assertions.assertNotNull(taskRequestRef.get());
        Assertions.assertEquals("image:cat-dog", taskRequestRef.get().references().getFirst().storageKey());
        Assertions.assertEquals("https://storage.example.com/cat-dog.png", taskRequestRef.get().references().getFirst().url());
        Assertions.assertEquals("image:cat-dog", savedRounds.getFirst().getJSONArray("references").getJSONObject(0).getString("storageKey"));
    }

    /**
     * 图生视频能力缺失时不得创建任务。
     */
    @Test
    void shouldRejectUploadedImageWhenVideoModelLacksImageToVideoCapability() {
        TestVideoProfile videoProfile = new TestVideoProfile(aiTaskService, persistenceService, executionRegistry);
        when(persistenceService.getMediaInfoForUser(7L, "image:cat-dog"))
                .thenReturn(Mono.just(new PersistenceDtos.UploadedMediaResponse(
                        "image:cat-dog", "https://storage.example.com/cat-dog.png", 1024L,
                        "image/png", 100, 100, null, null)));
        when(aiTaskService.modelCapabilities(7L, "video-model")).thenReturn(Mono.just(Set.of()));

        ToolResult result = videoProfile.executeTool(7L, "generate_video",
                        Map.of("prompt", "让小猫和小狗玩耍", "model", "video-model"),
                        "让小猫和小狗玩耍",
                        List.of(new AgentChatRequest.Attachment("https://untrusted.example.com/cat-dog.png", "image/png", "猫狗.png", "image:cat-dog")),
                        eventEmitter, "session-1", "call-1")
                .block(Duration.ofSeconds(10));

        Assertions.assertNotNull(result);
        Assertions.assertFalse(result.ok());
        Assertions.assertEquals("当前模型未配置图生视频能力，请切换支持图生视频的模型", result.message());
        verify(aiTaskService, never()).createTaskForUser(anyLong(), any(AiTaskDtos.CreateAiTaskRequest.class), any(Function.class));
    }

    /**
     * 创建任务前停止时，也应保留用户原始输入和实际生成提示词。
     */
    @Test
    void shouldKeepOriginalAndGenerationPromptsWhenCanceledBeforeTaskCreation() {
        when(executionRegistry.isCancelRequested("session-1")).thenReturn(true);
        when(persistenceService.saveOrUpdateGenerationRound(anyLong(), anyString(), anyString(), anyString(), any(JSONObject.class)))
                .thenAnswer(invocation -> {
                    savedTitles.add(invocation.getArgument(3));
                    savedRounds.add(JSON.parseObject(JSON.toJSONString(invocation.getArgument(4))));
                    return Mono.empty();
                });

        ToolResult result = profile.executeTool(7L, "generate_image",
                        Map.of("prompt", "优化后的小狗提示词", "model", "model-1"),
                        "生成一只小狗", List.of(), eventEmitter, "session-1", "call-1")
                .block(Duration.ofSeconds(10));

        Assertions.assertNotNull(result);
        Assertions.assertFalse(result.ok());
        Assertions.assertEquals("生成一只小狗", savedRounds.getFirst().getString("prompt"));
        Assertions.assertEquals("优化后的小狗提示词", savedRounds.getFirst().getString("generationPrompt"));
        Assertions.assertEquals("生成一只小狗", savedTitles.getFirst());
        Assertions.assertEquals("canceled", savedRounds.getFirst().getJSONArray("results")
                .getJSONObject(0).getString("status"));
        verify(aiTaskService, never()).createTaskForUser(anyLong(), any(AiTaskDtos.CreateAiTaskRequest.class), any(Function.class));
    }

    /**
     * 轮询耗尽仍未进入终态时，应返回包含任务ID的超时失败结果。
     */
    @Test
    void shouldReturnTimeoutWithTaskIdWhenPollingEndsWithoutTerminalState() {
        ToolResult result = profile.buildResult("task-1", response("running", 80, new JSONObject()));

        Assertions.assertFalse(result.ok());
        Assertions.assertEquals("生成超时，请重试", result.message());
        Assertions.assertNotNull(result.data());
        Assertions.assertEquals("task-1", result.data().get("taskId"));
    }

    /**
     * 构建带查询顺序记录的任务响应 Mono。
     *
     * @param status String 服务端任务状态
     * @param progress int 任务进度
     * @param resultData JSONObject 任务结果
     * @return Mono<AiGenerationTaskResponse> 延迟任务响应
     */
    private Mono<AiTaskDtos.AiGenerationTaskResponse> polledResponse(String status, int progress, JSONObject resultData) {
        return Mono.defer(() -> {
            executionOrder.add("getTask");
            return Mono.just(response(status, progress, resultData));
        });
    }

    /**
     * 构建任务响应。
     *
     * @param status String 任务状态
     * @param progress int 任务进度
     * @param resultData JSONObject 任务结果
     * @return AiGenerationTaskResponse 任务响应
     */
    private AiTaskDtos.AiGenerationTaskResponse response(String status, int progress, JSONObject resultData) {
        return new AiTaskDtos.AiGenerationTaskResponse("task-1", AiTaskTypes.IMAGE, "model-1", "图片渠道",
                status, progress, new JSONObject(), resultData, "", "", "", "", "");
    }

    /**
     * 构建包含媒体的成功任务结果。
     *
     * @return JSONObject 成功结果
     */
    private JSONObject successfulResultData() {
        return JSON.parseObject("{\"items\":[{\"url\":\"https://example.com/image.png\"}]}");
    }

    /**
     * 断言页面可恢复的 pending 轮次契约。
     *
     * @param round JSONObject 轮次数据
     * @param progress int 预期进度
     */
    private void assertPendingRound(JSONObject round, int progress) {
        JSONObject result = round.getJSONArray("results").getJSONObject(0);
        Assertions.assertEquals("call-1", round.getString("id"));
        Assertions.assertEquals("task-1", round.getString("taskId"));
        Assertions.assertEquals("call-1", result.getString("id"));
        Assertions.assertEquals("task-1", result.getString("taskId"));
        Assertions.assertEquals("pending", result.getString("status"));
        Assertions.assertEquals(progress, result.getIntValue("progress"));
    }

    /**
     * 用于验证抽象生成流程的最小图片 Profile。
     */
    private static class TestTaskProfile extends AbstractTaskProfile {

        /**
         * 创建测试 Profile。
         *
         * @param aiTaskService AiTaskService AI任务服务
         * @param persistenceService PersistenceService 生成记录持久化服务
         * @param executionRegistry AgentExecutionRegistry 执行注册表
         */
        private TestTaskProfile(AiTaskService aiTaskService, PersistenceService persistenceService,
                                AgentExecutionRegistry executionRegistry) {
            super(aiTaskService, persistenceService, executionRegistry);
        }

        /**
         * 返回测试 Profile 名称。
         *
         * @return String Profile 名称
         */
        @Override
        public String name() {
            return "generation";
        }

        /**
         * 返回图片任务类型。
         *
         * @return String 图片任务类型
         */
        @Override
        protected String taskType() {
            return AiTaskTypes.IMAGE;
        }

        /**
         * 返回图片创作页来源。
         *
         * @return String 图片创作页来源
         */
        @Override
        protected String generationSource() {
            return AiTaskSources.IMAGE_PAGE;
        }

        /**
         * 返回测试系统提示词。
         *
         * @return String 系统提示词
         */
        @Override
        protected String systemPrompt() {
            return "测试图片生成";
        }

        /**
         * 返回空工具定义列表。
         *
         * @return List<AgentTool> 空工具列表
         */
        @Override
        public List<AgentTool> tools() {
            return List.of();
        }
    }

    /**
     * 用于验证视频附件能力校验的最小视频 Profile。
     */
    private static final class TestVideoProfile extends TestTaskProfile {

        /**
         * 创建测试视频 Profile。
         *
         * @param aiTaskService AiTaskService AI任务服务
         * @param persistenceService PersistenceService 生成记录持久化服务
         * @param executionRegistry AgentExecutionRegistry 执行注册表
         */
        private TestVideoProfile(AiTaskService aiTaskService, PersistenceService persistenceService,
                                 AgentExecutionRegistry executionRegistry) {
            super(aiTaskService, persistenceService, executionRegistry);
        }

        /**
         * 返回视频 Profile 名称。
         *
         * @return String Profile 名称
         */
        @Override
        public String name() {
            return "video";
        }

        /**
         * 返回视频任务类型。
         *
         * @return String 视频任务类型
         */
        @Override
        protected String taskType() {
            return AiTaskTypes.VIDEO;
        }

        /**
         * 返回视频创作页来源。
         *
         * @return String 视频创作页来源
         */
        @Override
        protected String generationSource() {
            return AiTaskSources.VIDEO_PAGE;
        }
    }
}
