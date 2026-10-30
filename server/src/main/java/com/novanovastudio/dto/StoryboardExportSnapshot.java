package com.novanovastudio.dto;

import java.util.List;

/**
 * 分镜导出时冻结的媒体和绝对时间轴数据。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-24 00:00
 */
public record StoryboardExportSnapshot(String projectId, String episodeId, String aspectRatio,
                                       List<Shot> shots, List<Text> texts, List<Audio> audioTracks) {

    /** 镜头在项目时间轴上的位置与媒体。 */
    public record Shot(String id, String storageKey, long startMs, long durationMs, boolean selected) {
    }

    /** 文字在项目时间轴上的位置与外观。 */
    public record Text(String id, String content, long startMs, long endMs, int trackNumber,
                       double positionX, double positionY, int fontSize, String fontFamily, String color,
                       String alignment, String backgroundColor) {
    }

    /** 音频在项目时间轴上的位置与源文件裁剪范围。 */
    public record Audio(String id, String storageKey, long startMs, long trimStartMs, long trimEndMs) {
    }
}
