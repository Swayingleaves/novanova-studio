package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.VideoBillingConfiguration;
import com.novanovastudio.ai.VideoGenerationMode;
import com.novanovastudio.agent.workflow.VideoWorkflowDefinition;
import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * AI任务积分计算测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-03 00:00
 */
class AiTaskCreditCalculationTest {

    /** 图片阶段报价不得包含会因视频分辨率价格缺失而失败的视频阶段。 */
    @Test
    @SuppressWarnings("unchecked")
    void shouldFilterWorkflowQuoteByStage() throws Exception {
        VideoWorkflowDefinition.VideoWorkflowQuotePlan plan = new VideoWorkflowDefinition.VideoWorkflowQuotePlan(List.of(
                new VideoWorkflowDefinition.VideoWorkflowQuoteStage("first_frame", "生成首帧", "image", "image", 1,
                        Map.of(), List.of(), List.of(), List.of()),
                new VideoWorkflowDefinition.VideoWorkflowQuoteStage("video", "合成视频", "video", "video", 1,
                        Map.of("resolution", "768p"), List.of(), List.of("reference-to-video"), List.of())));
        Method method = AiTaskService.class.getDeclaredMethod("quoteStages", VideoWorkflowDefinition.VideoWorkflowQuotePlan.class, String.class);
        method.setAccessible(true);

        List<VideoWorkflowDefinition.VideoWorkflowQuoteStage> imageStages =
                (List<VideoWorkflowDefinition.VideoWorkflowQuoteStage>) method.invoke(new AiTaskService(null, null, null, null, null, null, null, null, null, null, null, null), plan, "image");

        Assertions.assertEquals(List.of("first_frame"), imageStages.stream().map(VideoWorkflowDefinition.VideoWorkflowQuoteStage::role).toList());
    }

    /** 按次图片任务应按生成数量计费。 */
    @Test
    void shouldChargeGenerationUnitByImageCount() {
        int credits = calculate(new AiTaskDtos.CreateAiTaskRequest("image", "生成图片", "channel::model",
                Map.of("count", 3), List.of(), List.of(), "imagePage"), 7, "generation");

        Assertions.assertEquals(21, credits);
    }

    /** 按秒视频任务应按单位积分和视频时长计费。 */
    @Test
    void shouldChargeSecondUnitByVideoDuration() {
        int credits = calculate(new AiTaskDtos.CreateAiTaskRequest("video", "生成视频", "channel::model",
                Map.of("seconds", "8", "resolution", "720p"), List.of(), List.of(), "videoPage"), 5, "second");

        Assertions.assertEquals(40, credits);
    }

    /** 按秒视频任务不接受智能时长、空值和非整数。 */
    @Test
    void shouldRejectInvalidSecondUnitDuration() {
        for (Object seconds : Arrays.asList(null, -1, "4.5", "")) {
            Map<String, Object> parameters = new java.util.HashMap<>(seconds == null ? Map.of() : Map.of("seconds", seconds));
            parameters.put("resolution", "720p");
            BusinessException exception = Assertions.assertThrows(BusinessException.class, () -> calculate(
                    new AiTaskDtos.CreateAiTaskRequest("video", "生成视频", "channel::model", parameters,
                            List.of(), List.of(), "videoPage"), 5, "second"));
            Assertions.assertTrue(exception.getMessage().contains("正整数时长"));
        }
    }

    /** 按秒计费的整数乘法溢出时应拒绝创建任务。 */
    @Test
    void shouldRejectCreditOverflow() {
        BusinessException exception = Assertions.assertThrows(BusinessException.class, () -> calculate(
                new AiTaskDtos.CreateAiTaskRequest("video", "生成视频", "channel::model", Map.of("seconds", 2, "resolution", "720p"),
                        List.of(), List.of(), "videoPage"), Integer.MAX_VALUE, "second"));

        Assertions.assertTrue(exception.getMessage().contains("超出范围"));
    }

    /** 非视频模型不允许按秒计费。 */
    @Test
    void shouldRejectSecondUnitForNonVideoTask() {
        BusinessException exception = Assertions.assertThrows(BusinessException.class, () -> calculate(
                new AiTaskDtos.CreateAiTaskRequest("image", "生成图片", "channel::model", Map.of(), List.of(), List.of(), "imagePage"),
                5, "second"));

        Assertions.assertTrue(exception.getMessage().contains("只有视频模型"));
    }

    /**
     * 通过服务真实私有计算方法执行测试，避免复制计费公式造成测试失真。
     *
     * @param request CreateAiTaskRequest 任务请求
     * @param creditCost int 模型积分单价
     * @param creditUnit String 计费单位
     * @return int 应扣积分
     */
    private int calculate(AiTaskDtos.CreateAiTaskRequest request, int creditCost, String creditUnit) {
        try {
            Class<?> resolvedModelType = Class.forName("com.novanovastudio.service.AiTaskService$ResolvedModel");
            Constructor<?> constructor = resolvedModelType.getDeclaredConstructor(
                    AiTaskDtos.AiChannelConfig.class, String.class, String.class, Integer.class, String.class,
                    List.class, VideoBillingConfiguration.class, boolean.class, String.class, com.alibaba.fastjson2.JSONObject.class);
            constructor.setAccessible(true);
            boolean video = "video".equals(request.taskType());
            VideoBillingConfiguration videoBillingConfiguration = video
                    ? new VideoBillingConfiguration(creditUnit, 1,
                    Map.of(VideoGenerationMode.TEXT_TO_VIDEO, Map.of("720p", creditCost)))
                    : null;
            Object resolvedModel = constructor.newInstance(
                    new AiTaskDtos.AiChannelConfig("channel", "测试渠道", "https://example.com", "key", "openai", List.of("model")),
                    "model", "model-config", creditCost, creditUnit,
                    video ? List.of(VideoGenerationMode.TEXT_TO_VIDEO) : List.of(), videoBillingConfiguration, true, "high",
                    new com.alibaba.fastjson2.JSONObject());
            Method method = AiTaskService.class.getDeclaredMethod("calculateTaskCredits", AiTaskDtos.CreateAiTaskRequest.class, resolvedModelType);
            method.setAccessible(true);
            return (Integer) method.invoke(new AiTaskService(null, null, null, null, null, null, null, null, null, null, null, null), request, resolvedModel);
        } catch (InvocationTargetException exception) {
            if (exception.getCause() instanceof RuntimeException runtimeException) throw runtimeException;
            throw new IllegalStateException(exception.getCause());
        } catch (ReflectiveOperationException exception) {
            throw new IllegalStateException(exception);
        }
    }
}
