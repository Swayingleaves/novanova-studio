package com.novanovastudio.ai;

import com.novanovastudio.ai.provider.AgnesProviderAdapter;
import java.lang.reflect.Method;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * 验证 Agnes 图片清晰度与实际像素尺寸的映射。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-18 21:30
 */
class AgnesImageResolutionTest {

    /**
     * 图片清晰度应映射为对应的长边像素，并按比例计算另一边。
     *
     * @throws ReflectiveOperationException 反射调用尺寸解析方法失败时抛出
     */
    @Test
    void shouldMapImageResolutionToLongSidePixels() throws ReflectiveOperationException {
        Assertions.assertEquals("1024x1024", resolveImageSize("1K", "1:1"));
        Assertions.assertEquals("1024x576", resolveImageSize("1K", "16:9"));
        Assertions.assertEquals("2048x1536", resolveImageSize("2K", "4:3"));
        Assertions.assertEquals("2304x4096", resolveImageSize("4K", "9:16"));
    }

    /**
     * 调用 Agnes 适配器内部的图片尺寸解析逻辑。
     *
     * @param resolution String 图片清晰度
     * @param ratio String 图片比例
     * @return String 解析后的像素尺寸
     * @throws ReflectiveOperationException 反射调用尺寸解析方法失败时抛出
     */
    private String resolveImageSize(String resolution, String ratio) throws ReflectiveOperationException {
        Method method = AgnesProviderAdapter.class.getDeclaredMethod("resolveImageSize", String.class, String.class);
        method.setAccessible(true);
        return (String) method.invoke(null, resolution, ratio);
    }
}
