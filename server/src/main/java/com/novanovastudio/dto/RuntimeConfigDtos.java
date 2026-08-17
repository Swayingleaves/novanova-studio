package com.novanovastudio.dto;

/**
 * 服务端运行时配置DTO。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-13 12:00:00
 */
public final class RuntimeConfigDtos {

    /**
     * 禁止实例化。
     */
    private RuntimeConfigDtos() {
    }

    /**
     * 用户端需要读取的运行时配置。
     *
     * @param aiTaskPollingIntervalSeconds AI异步任务状态轮询间隔秒数
     */
    public record RuntimeConfigResponse(int aiTaskPollingIntervalSeconds) {
    }
}
