package com.novanovastudio.agent.dto;

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
        Boolean watermark
) {
}
