package com.novanovastudio.ai;

import java.util.Set;

/**
 * 视频生成模式常量。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-08-18 00:00
 */
public final class VideoGenerationMode {

    /** 文生视频模式。 */
    public static final String TEXT_TO_VIDEO = "text-to-video";

    /** 图生视频模式。 */
    public static final String IMAGE_TO_VIDEO = "image-to-video";

    /** 全能参考视频模式。 */
    public static final String REFERENCE_TO_VIDEO = "reference-to-video";

    /** 首尾帧原生视频模式。 */
    public static final String FIRST_LAST_FRAME_TO_VIDEO = "first-last-frame-to-video";

    /** 所有支持的视频生成模式。 */
    private static final Set<String> SUPPORTED_VALUES = Set.of(
            TEXT_TO_VIDEO,
            IMAGE_TO_VIDEO,
            REFERENCE_TO_VIDEO,
            FIRST_LAST_FRAME_TO_VIDEO
    );

    /**
     * 禁止实例化。
     */
    private VideoGenerationMode() {
    }

    /**
     * 判断视频生成模式是否受支持。
     *
     * @param value String 视频生成模式
     * @return boolean 是否受支持
     */
    public static boolean isSupported(String value) {
        return value != null && SUPPORTED_VALUES.contains(value);
    }

    /**
     * 返回未缺失的视频生成模式，缺失时使用文生视频默认值。
     *
     * @param value String 视频生成模式
     * @return String 规范化后的视频生成模式
     */
    public static String defaultIfBlank(String value) {
        return value == null || value.isBlank() ? TEXT_TO_VIDEO : value.trim();
    }

    /**
     * 返回全部支持的视频生成模式。
     *
     * @return Set<String> 模式集合
     */
    public static Set<String> values() {
        return SUPPORTED_VALUES;
    }
}
