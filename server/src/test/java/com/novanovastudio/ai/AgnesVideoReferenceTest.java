package com.novanovastudio.ai;

import com.novanovastudio.ai.provider.AgnesProviderAdapter;
import com.novanovastudio.common.BusinessException;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * 验证 Agnes 视频参考图片与关键帧请求参数。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-10 18:00
 */
class AgnesVideoReferenceTest {

    /**
     * 无图、单图和两至三张关键帧图应生成对应请求参数。
     *
     * @throws ReflectiveOperationException 反射调用请求参数构建方法失败时抛出
     */
    @Test
    void shouldBuildAgnesVideoReferencePayloadByImageCount() throws ReflectiveOperationException {
        Map<String, Object> noImagePayload = applyReferenceImages(List.of());
        Map<String, Object> singleImagePayload = applyReferenceImages(List.of("https://example.com/one.png"));
        Map<String, Object> twoImagePayload = applyReferenceImages(List.of("https://example.com/first.png", "https://example.com/second.png"));
        Map<String, Object> threeImagePayload = applyReferenceImages(List.of("https://example.com/first.png", "https://example.com/second.png", "https://example.com/third.png"));

        Assertions.assertFalse(noImagePayload.containsKey("images"));
        Assertions.assertFalse(noImagePayload.containsKey("extra_body"));
        Assertions.assertEquals(List.of("https://example.com/one.png"), singleImagePayload.get("images"));
        Assertions.assertFalse(singleImagePayload.containsKey("extra_body"));
        Assertions.assertEquals(List.of("https://example.com/first.png", "https://example.com/second.png"), twoImagePayload.get("images"));
        Assertions.assertFalse(twoImagePayload.containsKey("extra_body"));
        Assertions.assertEquals(List.of("https://example.com/first.png", "https://example.com/second.png", "https://example.com/third.png"), threeImagePayload.get("images"));
        Assertions.assertFalse(threeImagePayload.containsKey("extra_body"));
    }

    /**
     * 超过三张参考图片应在调用渠道前被拒绝。
     *
     * @throws ReflectiveOperationException 反射调用请求参数构建方法失败时抛出
     */
    @Test
    void shouldRejectMoreThanThreeAgnesVideoReferenceImages() throws ReflectiveOperationException {
        InvocationTargetException exception = Assertions.assertThrows(InvocationTargetException.class,
                () -> applyReferenceImages(List.of("https://example.com/1.png", "https://example.com/2.png", "https://example.com/3.png", "https://example.com/4.png")));

        Assertions.assertInstanceOf(BusinessException.class, exception.getCause());
        Assertions.assertTrue(exception.getCause().getMessage().contains("最多支持3张参考图片"));
    }

    /**
     * 反射调用 Agnes 视频参考图片请求参数构建方法。
     *
     * @param referenceUrls List<String> 参考图片公网地址
     * @return Map<String, Object> 已写入参考图片参数的请求载荷
     * @throws ReflectiveOperationException 反射调用请求参数构建方法失败时抛出
     */
    private Map<String, Object> applyReferenceImages(List<String> referenceUrls) throws ReflectiveOperationException {
        Method method = AgnesProviderAdapter.class.getDeclaredMethod("applyAgnesVideoReferenceImages", Map.class, List.class);
        method.setAccessible(true);
        Map<String, Object> payload = new LinkedHashMap<>();
        method.invoke(null, payload, referenceUrls);
        return payload;
    }
}
