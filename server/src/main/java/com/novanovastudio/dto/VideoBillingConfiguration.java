package com.novanovastudio.dto;

import java.util.Map;

/**
 * 视频模型的模式分辨率分档计费配置。
 *
 * @param billingUnit String 计费方式，generation 按次或 second 按秒
 * @param minimumDurationSeconds Integer 最短可生成时长秒数
 * @param modePrices Map<String, Map<String, Integer>> 模式到分辨率单价表
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-08-18 00:00
 */
public record VideoBillingConfiguration(
        String billingUnit,
        Integer minimumDurationSeconds,
        Map<String, Map<String, Integer>> modePrices
) {
}
