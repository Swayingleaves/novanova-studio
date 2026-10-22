package com.novanovastudio.dto;

import com.alibaba.fastjson2.annotation.JSONField;
import com.novanovastudio.common.StrictIntegerReader;
import java.util.List;

/**
 * 自定义视频模型单个生成模式的输入与输出限制。
 *
 * @param minimumDurationSeconds Integer 最短生成时长，单位秒
 * @param maximumDurationSeconds Integer 最长生成时长，单位秒
 * @param minimumImageCount Integer 最少输入图片数量
 * @param maximumImageCount Integer 最多输入图片数量
 * @param supportedAspectRatios List 支持的宽高比，auto 表示自动比例
 * @param maximumVideoCount Integer 全能参考最多输入视频数量
 * @param maximumAudioCount Integer 全能参考最多输入音频数量
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-22 00:00
 */
public record VideoGenerationConstraints(
        @JSONField(deserializeUsing = StrictIntegerReader.class) Integer minimumDurationSeconds,
        @JSONField(deserializeUsing = StrictIntegerReader.class) Integer maximumDurationSeconds,
        @JSONField(deserializeUsing = StrictIntegerReader.class) Integer minimumImageCount,
        @JSONField(deserializeUsing = StrictIntegerReader.class) Integer maximumImageCount,
        List<String> supportedAspectRatios,
        @JSONField(deserializeUsing = StrictIntegerReader.class) Integer maximumVideoCount,
        @JSONField(deserializeUsing = StrictIntegerReader.class) Integer maximumAudioCount) {
}
