package com.novanovastudio.agent;

import com.novanovastudio.ai.AiTaskSources;
import java.util.Set;

/**
 * Agent 对话入口来源及其页面能力边界。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-23 00:00
 */
public final class CreationEntrySource {

    /** 图片创作页 */
    public static final String IMAGE_PAGE = AiTaskSources.IMAGE_PAGE;
    /** 视频创作页 */
    public static final String VIDEO_PAGE = AiTaskSources.VIDEO_PAGE;
    /** 无限画布 */
    public static final String CANVAS = AiTaskSources.CANVAS;

    /** 统一主Agent支持的入口来源 */
    private static final Set<String> SUPPORTED_SOURCES = Set.of(IMAGE_PAGE, VIDEO_PAGE, CANVAS);

    private CreationEntrySource() {
    }

    /**
     * 判断入口来源是否受支持。
     *
     * @param value String 入口来源
     * @return boolean 是否受支持
     */
    public static boolean supported(String value) {
        return value != null && SUPPORTED_SOURCES.contains(value);
    }
}
