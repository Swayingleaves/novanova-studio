package com.novanovastudio.service;

import com.novanovastudio.ai.AiTaskPollingSupport;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.RuntimeConfigDtos;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * 服务端运行时配置服务。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-13 12:00:00
 */
@Service
@RequiredArgsConstructor
public class RuntimeConfigService {

    /** 服务配置。 */
    private final NovanovaProperties properties;

    /**
     * 获取用户端任务状态轮询配置。
     *
     * @return RuntimeConfigDtos.RuntimeConfigResponse 运行时配置
     * @throws IllegalStateException 轮询间隔配置无效时抛出
     */
    public RuntimeConfigDtos.RuntimeConfigResponse getRuntimeConfig() {
        return new RuntimeConfigDtos.RuntimeConfigResponse(AiTaskPollingSupport.pollingIntervalSeconds(properties));
    }
}
