package com.novanovastudio.ai;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.AiTaskDtos;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * @title        AiProviderAdapterRegistry.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  AI渠道适配器注册表
 * @createTime   2026-06-24 20:35:00
 */
@Component
@Slf4j
public class AiProviderAdapterRegistry {

    /** 默认调用格式 */
    private static final String DEFAULT_API_FORMAT = "openai";

    /** 适配器映射 */
    private final Map<String, AiProviderAdapter> adapters = new LinkedHashMap<>();

    /**
     * 创建AI渠道适配器注册表
     *
     * @param providerAdapters List<AiProviderAdapter> Spring注入的适配器列表
     */
    public AiProviderAdapterRegistry(List<AiProviderAdapter> providerAdapters) {
        // 启动时注册所有适配器，后续新增渠道只需要增加新的策略类。
        for (AiProviderAdapter adapter : providerAdapters) {
            String apiFormat = normalizeApiFormat(adapter.apiFormat());
            adapters.put(apiFormat, adapter);
            log.info("注册AI渠道适配器: apiFormat={}", apiFormat);
        }
    }

    /**
     * 查询匹配渠道和任务类型的适配器
     *
     * @param channel AiChannelConfig 渠道配置
     * @param taskType String 任务类型
     * @return AiProviderAdapter 匹配的适配器
     */
    public AiProviderAdapter resolve(AiTaskDtos.AiChannelConfig channel, String taskType) {
        String apiFormat = normalizeApiFormat(channel.apiFormat());
        AiProviderAdapter adapter = adapters.get(apiFormat);
        if (adapter == null) {
            throw new BusinessException(ErrorCode.BUSINESS_ERROR, "服务端任务系统暂不支持" + apiFormat + "调用格式");
        }
        if (!adapter.supports(taskType)) {
            throw new BusinessException(ErrorCode.BUSINESS_ERROR, apiFormat + "调用格式暂不支持" + taskType + "任务");
        }
        return adapter;
    }

    /**
     * 判断渠道是否支持指定任务类型
     *
     * @param channel AiChannelConfig 渠道配置
     * @param taskType String 任务类型
     * @return boolean 是否支持
     */
    public boolean supports(AiTaskDtos.AiChannelConfig channel, String taskType) {
        String apiFormat = normalizeApiFormat(channel.apiFormat());
        AiProviderAdapter adapter = adapters.get(apiFormat);
        return adapter != null && (!StringUtils.hasText(taskType) || adapter.supports(taskType));
    }

    /**
     * 规范化调用格式
     *
     * @param apiFormat String 原始调用格式
     * @return String 规范化调用格式
     */
    public String normalizeApiFormat(String apiFormat) {
        return StringUtils.hasText(apiFormat) ? apiFormat.trim().toLowerCase() : DEFAULT_API_FORMAT;
    }
}
