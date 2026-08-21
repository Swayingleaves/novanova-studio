package com.novanovastudio.ai;

import java.util.Set;

/**
 * 视频分档计费支持的分辨率常量。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-08-18 00:00
 */
public final class VideoResolution {

    /** 自动分辨率。 */
    public static final String AUTO = "auto";

    /** 480P 分辨率。 */
    public static final String RESOLUTION_480P = "480p";

    /** 720P 分辨率。 */
    public static final String RESOLUTION_720P = "720p";

    /** 768P 分辨率。 */
    public static final String RESOLUTION_768P = "768p";

    /** 1080P 分辨率。 */
    public static final String RESOLUTION_1080P = "1080p";

    /** 2K 分辨率。 */
    public static final String RESOLUTION_2K = "2k";

    /** 4K 分辨率。 */
    public static final String RESOLUTION_4K = "4k";

    /** 所有支持的视频分辨率。 */
    private static final Set<String> SUPPORTED_VALUES = Set.of(
            AUTO,
            RESOLUTION_480P,
            RESOLUTION_720P,
            RESOLUTION_768P,
            RESOLUTION_1080P,
            RESOLUTION_2K,
            RESOLUTION_4K
    );

    /**
     * 禁止实例化。
     */
    private VideoResolution() {
    }

    /**
     * 判断视频分辨率是否受支持。
     *
     * @param value String 视频分辨率
     * @return boolean 是否受支持
     */
    public static boolean isSupported(String value) {
        return value != null && SUPPORTED_VALUES.contains(value);
    }

    /**
     * 返回全部支持的视频分辨率。
     *
     * @return Set<String> 分辨率集合
     */
    public static Set<String> values() {
        return SUPPORTED_VALUES;
    }
}
