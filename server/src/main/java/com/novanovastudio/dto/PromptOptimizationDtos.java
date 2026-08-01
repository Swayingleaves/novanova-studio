package com.novanovastudio.dto;

import jakarta.validation.constraints.NotBlank;
import java.util.List;

/**
 * AI 提示词优化接口数据结构。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-17 00:00
 */
public final class PromptOptimizationDtos {

    /**
     * 禁止实例化工具类。
     */
    private PromptOptimizationDtos() {
    }

    /**
     * 提示词优化请求。
     *
     * @param generationType 生成类型，支持 image、video
     * @param prompt 用户原始提示词
     * @param generationStyleIds 用户选择的风格ID
     */
    public record OptimizePromptRequest(
            @NotBlank(message = "生成类型不能为空") String generationType,
            @NotBlank(message = "提示词不能为空") String prompt,
            List<Long> generationStyleIds) {

        /**
         * 保留无风格的旧版构造方式。
         *
         * @param generationType 生成类型
         * @param prompt 用户原始提示词
         */
        public OptimizePromptRequest(String generationType, String prompt) {
            this(generationType, prompt, null);
        }
    }
}
