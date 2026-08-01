package com.novanovastudio.agent.dto;

import com.novanovastudio.dto.GenerationStyleDtos;
import java.util.List;

/**
 * 页面提交的结构化生成设置，所有非空值均作为Agent不可修改的硬约束。
 *
 * @param model String 模型编码
 * @param size String 画面尺寸或比例
 * @param resolution String 清晰度或分辨率
 * @param quality String 质量等级
 * @param count Integer 生成数量
 * @param seconds String 视频时长秒数
 * @param watermark Boolean 是否添加水印
 * @param generationStyleIds List<Long> 普通生成提交的风格ID
 * @param generationStyleSnapshots List<GenerationStyleSnapshot> 历史重生成使用的风格快照
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-23 00:00
 */
public record CreationSettings(
        String model,
        String size,
        String resolution,
        String quality,
        Integer count,
        String seconds,
        Boolean watermark,
        List<Long> generationStyleIds,
        List<GenerationStyleDtos.GenerationStyleSnapshot> generationStyleSnapshots
) {

    /**
     * 保留旧版七参数构造方式，画布和既有调用方无需感知风格字段。
     *
     * @param model String 模型编码
     * @param size String 画面尺寸或比例
     * @param resolution String 清晰度或分辨率
     * @param quality String 质量等级
     * @param count Integer 生成数量
     * @param seconds String 视频时长秒数
     * @param watermark Boolean 是否添加水印
     */
    public CreationSettings(String model, String size, String resolution, String quality, Integer count,
                            String seconds, Boolean watermark) {
        this(model, size, resolution, quality, count, seconds, watermark, null, null);
    }
}
