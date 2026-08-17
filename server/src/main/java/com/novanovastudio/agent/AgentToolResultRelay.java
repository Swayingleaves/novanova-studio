/**
 * @title        AgentToolResultRelay.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  跨实例转发画布前端工具执行结果
 * @createTime   2026-08-13 00:00:00
 */
package com.novanovastudio.agent;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.agent.dto.AgentToolResult;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.data.redis.listener.PatternTopic;
import org.springframework.data.redis.listener.ReactiveRedisMessageListenerContainer;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Mono;

/**
 * 画布前端工具结果 Redis Pub/Sub 中继。
 * <p>
 * 浏览器可能连接到非主Agent领取实例，因此结果先按用户广播；持有本地会话执行登记的实例再唤醒对应等待器。
 */
@Component
@Slf4j
public class AgentToolResultRelay {

    /** 工具结果 Redis 通道前缀 */
    private static final String RESULT_CHANNEL_PREFIX = "novanova:creation-agent:tool-result:";

    /** Redis 字符串模板 */
    private final ReactiveStringRedisTemplate redisTemplate;

    /** Redis 响应式消息监听容器 */
    private final ReactiveRedisMessageListenerContainer listenerContainer;

    /** Agent 任务编排器提供器，延迟获取以避免初始化循环 */
    private final ObjectProvider<AgentTaskOrchestrator> orchestratorProvider;

    /**
     * 创建工具结果中继。
     *
     * @param redisTemplate ReactiveStringRedisTemplate Redis字符串模板
     * @param listenerContainer ReactiveRedisMessageListenerContainer Redis消息监听容器
     * @param orchestratorProvider ObjectProvider<AgentTaskOrchestrator> Agent任务编排器提供器
     */
    public AgentToolResultRelay(ReactiveStringRedisTemplate redisTemplate,
                                ReactiveRedisMessageListenerContainer listenerContainer,
                                ObjectProvider<AgentTaskOrchestrator> orchestratorProvider) {
        this.redisTemplate = redisTemplate;
        this.listenerContainer = listenerContainer;
        this.orchestratorProvider = orchestratorProvider;
    }

    /**
     * 订阅所有用户的工具结果通道。
     */
    @PostConstruct
    public void subscribeToolResults() {
        listenerContainer.receive(new PatternTopic(RESULT_CHANNEL_PREFIX + "*"))
                .flatMap(message -> {
                    Long userId = parseChannelUserId(message.getChannel());
                    if (userId == null) {
                        return Mono.empty();
                    }
                    try {
                        forward(userId, JSON.parseObject(message.getMessage(), AgentToolResult.class));
                    } catch (Exception exception) {
                        log.error("解析画布工具结果Redis消息失败: channel={}", message.getChannel(), exception);
                    }
                    return Mono.empty();
                })
                .onErrorContinue((throwable, ignored) -> log.error("订阅画布工具结果Redis消息失败", throwable))
                .subscribe();
    }

    /**
     * 发布浏览器回传的画布工具结果。
     *
     * @param userId Long 当前用户ID
     * @param result AgentToolResult 工具执行结果
     * @return Mono<Void> 发布完成信号
     */
    public Mono<Void> publish(Long userId, AgentToolResult result) {
        return redisTemplate.convertAndSend(resultChannel(userId), JSON.toJSONString(result))
                .doOnError(exception -> log.error("发布画布工具结果Redis消息失败: userId={}, sessionId={}, callId={}",
                        userId, result == null ? null : result.sessionId(), result == null ? null : result.callId(), exception))
                .then();
    }

    /**
     * 校验并转发一条跨实例画布工具结果。
     *
     * @param userId Long 当前用户ID
     * @param result AgentToolResult 前端工具执行结果
     */
    void forward(Long userId, AgentToolResult result) {
        if (result == null || !StringUtils.hasText(result.sessionId()) || !StringUtils.hasText(result.requestId())
                || !StringUtils.hasText(result.callId()) || result.result() == null) {
            log.warn("忽略无效画布工具结果消息: userId={}", userId);
            return;
        }
        orchestratorProvider.getObject().submitToolResult(userId, result);
    }

    /**
     * 构造指定用户的工具结果通道。
     *
     * @param userId Long 用户ID
     * @return String Redis通道名
     */
    static String resultChannel(Long userId) {
        return RESULT_CHANNEL_PREFIX + userId;
    }

    /**
     * 从 Redis 通道解析用户ID。
     *
     * @param channel String Redis通道名
     * @return Long 用户ID，无法解析时返回null
     */
    private Long parseChannelUserId(String channel) {
        try {
            int index = channel.lastIndexOf(':');
            return index < 0 ? null : Long.parseLong(channel.substring(index + 1));
        } catch (Exception exception) {
            return null;
        }
    }
}
