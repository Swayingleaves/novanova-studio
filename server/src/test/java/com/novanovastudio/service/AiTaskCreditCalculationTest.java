package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.dto.AiTaskDtos;
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
                Map.of("seconds", "8"), List.of(), List.of(), "videoPage"), 5, "second");

        Assertions.assertEquals(40, credits);
    }

    /** 按秒视频任务不接受智能时长、空值和非整数。 */
    @Test
    void shouldRejectInvalidSecondUnitDuration() {
        for (Object seconds : Arrays.asList(null, -1, "4.5", "")) {
            Map<String, Object> parameters = seconds == null ? Map.of() : Map.of("seconds", seconds);
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
                new AiTaskDtos.CreateAiTaskRequest("video", "生成视频", "channel::model", Map.of("seconds", 2),
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
                    AiTaskDtos.AiChannelConfig.class, String.class, String.class, Integer.class, String.class, boolean.class, String.class);
            constructor.setAccessible(true);
            Object resolvedModel = constructor.newInstance(
                    new AiTaskDtos.AiChannelConfig("channel", "测试渠道", "https://example.com", "key", "openai", List.of("model")),
                    "model", "model-config", creditCost, creditUnit, true, "high");
            Method method = AiTaskService.class.getDeclaredMethod("calculateTaskCredits", AiTaskDtos.CreateAiTaskRequest.class, resolvedModelType);
            method.setAccessible(true);
            return (Integer) method.invoke(new AiTaskService(null, null, null, null, null, null, null, null, null, null, null), request, resolvedModel);
        } catch (InvocationTargetException exception) {
            if (exception.getCause() instanceof RuntimeException runtimeException) throw runtimeException;
            throw new IllegalStateException(exception.getCause());
        } catch (ReflectiveOperationException exception) {
            throw new IllegalStateException(exception);
        }
    }
}
