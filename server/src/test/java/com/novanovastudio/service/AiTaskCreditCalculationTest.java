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
                (List<VideoWorkflowDefinition.VideoWorkflowQuoteStage>) method.invoke(new AiTaskService(com.novanovastudio.TeamTestSupport.taskScope(), null, null, null, null, null, null, null, null, null, null, null, null), plan, "image");

        Assertions.assertEquals(List.of("first_frame"), imageStages.stream().map(VideoWorkflowDefinition.VideoWorkflowQuoteStage::role).toList());
    }

    /** 按次图片任务应按生成数量计费。 */
    @Test
    void shouldChargeGenerationUnitByImageCount() {
        java.math.BigDecimal credits = calculate(new AiTaskDtos.CreateAiTaskRequest("image", "生成图片", "channel::model",
                Map.of("count", 3), List.of(), List.of(), "imagePage"), 7, "generation");

        Assertions.assertEquals(0, java.math.BigDecimal.valueOf(21).compareTo(credits));
    }

    /** 按秒视频任务应按单位积分和视频时长计费。 */
    @Test
    void shouldChargeSecondUnitByVideoDuration() {
        java.math.BigDecimal credits = calculate(new AiTaskDtos.CreateAiTaskRequest("video", "生成视频", "channel::model",
                Map.of("seconds", "8", "resolution", "720p"), List.of(), List.of(), "videoPage"), 5, "second");

        Assertions.assertEquals(0, java.math.BigDecimal.valueOf(40).compareTo(credits));
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

    /** 六位小数升级后，超过旧整数上限的合法金额仍应精确计算。 */
    @Test
    void shouldSupportAmountsBeyondIntegerRange() {
        var credits = calculate(new AiTaskDtos.CreateAiTaskRequest("video", "生成视频", "channel::model",
                Map.of("seconds", 2, "resolution", "720p"), List.of(), List.of(), "videoPage"), Integer.MAX_VALUE, "second");
        Assertions.assertEquals(0, new java.math.BigDecimal("4294967294").compareTo(credits));
    }

    /** 非视频模型不允许按秒计费。 */
    @Test
    void shouldRejectSecondUnitForNonVideoTask() {
        BusinessException exception = Assertions.assertThrows(BusinessException.class, () -> calculate(
                new AiTaskDtos.CreateAiTaskRequest("image", "生成图片", "channel::model", Map.of(), List.of(), List.of(), "imagePage"),
                5, "second"));

        Assertions.assertTrue(exception.getMessage().contains("只有视频模型"));
    }

    /** 配置分辨率价目表后，图片任务按所选清晰度和数量计费。 */
    @Test
    void shouldChargeImageByResolutionPrice() {
        var configuration = new com.novanovastudio.dto.ImageBillingConfiguration(Map.of(
                "1K", java.math.BigDecimal.ONE,
                "2K", java.math.BigDecimal.valueOf(4),
                "4K", java.math.BigDecimal.valueOf(9)));
        var credits = calculate(new AiTaskDtos.CreateAiTaskRequest("image", "生成图片", "channel::model",
                Map.of("count", 2, "resolution", "4K"), List.of(), List.of(), "imagePage"), 7, "generation", configuration);

        Assertions.assertEquals(0, java.math.BigDecimal.valueOf(18).compareTo(credits));
    }

    /** 配置了价目表但缺少所选清晰度时必须报错，不能静默回退模型单价。 */
    @Test
    void shouldRejectMissingImageResolutionPrice() {
        var configuration = new com.novanovastudio.dto.ImageBillingConfiguration(Map.of("1K", java.math.BigDecimal.ONE));

        BusinessException exception = Assertions.assertThrows(BusinessException.class, () -> calculate(
                new AiTaskDtos.CreateAiTaskRequest("image", "生成图片", "channel::model",
                        Map.of("resolution", "4K"), List.of(), List.of(), "imagePage"), 7, "generation", configuration));

        Assertions.assertTrue(exception.getMessage().contains("4K"));
    }

    /** 未配置价目表时沿用模型单价，保证历史模型行为不变。 */
    @Test
    void shouldFallbackToModelUnitPriceWithoutImagePricing() {
        var credits = calculate(new AiTaskDtos.CreateAiTaskRequest("image", "生成图片", "channel::model",
                Map.of("count", 2, "resolution", "4K"), List.of(), List.of(), "imagePage"), 7, "generation", null);

        Assertions.assertEquals(0, java.math.BigDecimal.valueOf(14).compareTo(credits));
    }

    /**
     * 未配置图片分辨率价目表时的计算入口。
     *
     * @param request CreateAiTaskRequest 任务请求
     * @param creditCost int 模型积分单价
     * @param creditUnit String 计费单位
     * @return int 应扣积分
     */
    private java.math.BigDecimal calculate(AiTaskDtos.CreateAiTaskRequest request, int creditCost, String creditUnit) {
        return calculate(request, creditCost, creditUnit, null);
    }

    /**
     * 通过服务真实私有计算方法执行测试，避免复制计费公式造成测试失真。
     *
     * @param request CreateAiTaskRequest 任务请求
     * @param creditCost int 模型积分单价
     * @param creditUnit String 计费单位
     * @param imageBillingConfiguration ImageBillingConfiguration 图片分辨率价目表，可为null
     * @return int 应扣积分
     */
    private java.math.BigDecimal calculate(AiTaskDtos.CreateAiTaskRequest request, int creditCost, String creditUnit,
                                           com.novanovastudio.dto.ImageBillingConfiguration imageBillingConfiguration) {
        try {
            Class<?> resolvedModelType = Class.forName("com.novanovastudio.service.AiTaskService$ResolvedModel");
            Constructor<?> constructor = resolvedModelType.getDeclaredConstructor(
                    AiTaskDtos.AiChannelConfig.class, String.class, String.class, java.math.BigDecimal.class, String.class,
                    List.class, VideoBillingConfiguration.class, boolean.class, String.class, com.alibaba.fastjson2.JSONObject.class,
                    boolean.class, Map.class, boolean.class, Map.class, com.novanovastudio.dto.ImageBillingConfiguration.class);
            constructor.setAccessible(true);
            boolean video = "video".equals(request.taskType());
            VideoBillingConfiguration videoBillingConfiguration = video
                    ? new VideoBillingConfiguration(creditUnit, 1,
                    Map.of(VideoGenerationMode.TEXT_TO_VIDEO, Map.of("720p", java.math.BigDecimal.valueOf(creditCost))))
                    : null;
            Object resolvedModel = constructor.newInstance(
                    new AiTaskDtos.AiChannelConfig("channel", "测试渠道", "https://example.com", "key", "openai", List.of("model")),
                    "model", "model-config", java.math.BigDecimal.valueOf(creditCost), creditUnit,
                    video ? List.of(VideoGenerationMode.TEXT_TO_VIDEO) : List.of(), videoBillingConfiguration, true, "high",
                    new com.alibaba.fastjson2.JSONObject(),
                    false, Map.of(), false, null, imageBillingConfiguration);
            Method method = AiTaskService.class.getDeclaredMethod("calculateTaskCredits", AiTaskDtos.CreateAiTaskRequest.class, resolvedModelType);
            method.setAccessible(true);
            return (java.math.BigDecimal) method.invoke(new AiTaskService(com.novanovastudio.TeamTestSupport.taskScope(), null, null, null, null, null, null, null, null, null, null, null, null), request, resolvedModel);
        } catch (InvocationTargetException exception) {
            if (exception.getCause() instanceof RuntimeException runtimeException) throw runtimeException;
            throw new IllegalStateException(exception.getCause());
        } catch (ReflectiveOperationException exception) {
            throw new IllegalStateException(exception);
        }
    }
}
