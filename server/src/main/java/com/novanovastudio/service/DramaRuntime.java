package com.novanovastudio.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.entity.CreationAgentRequest;
import com.novanovastudio.repository.CreationAgentRequestRepository;
import com.novanovastudio.repository.DramaRepository;
import java.math.BigDecimal;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Mono;

/**
 * 短剧文本请求的扣费、退款和活动请求释放。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-14 00:40
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class DramaRuntime {

    /** 积分服务。 */
    private final CreditService creditService;

    /** 短剧仓储。 */
    private final DramaRepository dramaRepository;

    /** 主Agent请求仓储。 */
    private final CreationAgentRequestRepository requestRepository;

    /**
     * 按模型单价扣除本次文本请求，并把积分记到项目上。
     *
     * @param userId 用户ID
     * @param projectId 项目ID
     * @param requestId 请求ID，同时作为扣费号
     * @param credits 模型单价
     * @param modelConfigId 模型配置ID
     * @return 完成信号
     */
    public Mono<Void> charge(long userId, String projectId, String requestId, BigDecimal credits, String modelConfigId) {
        return creditService.chargeOperation(userId, requestId, credits, DramaStageRules.OPERATION, modelConfigId)
                .then(dramaRepository.addCredits(projectId, credits));
    }

    /**
     * 退回本次请求已扣积分，并在活动请求仍是它时清空。
     *
     * @param request 主Agent请求
     * @return 完成信号
     */
    public Mono<Void> release(CreationAgentRequest request) {
        if (request == null || !DramaStageRules.ENTRY.equals(request.getEntrySource())) {
            return Mono.empty();
        }
        JSONObject payload = payload(request.getRequestData());
        String projectId = payload.getString("projectId");
        BigDecimal credits = payload.getBigDecimal("chargedCredits") == null ? BigDecimal.ZERO : payload.getBigDecimal("chargedCredits");
        Mono<Void> refund = creditService.refundOperation(request.getUserId(), request.getId(), DramaStageRules.OPERATION)
                .then(requestRepository.markDramaRefunded(request.getId()))
                .flatMap(first -> Boolean.TRUE.equals(first) && StringUtils.hasText(projectId)
                        ? dramaRepository.addCredits(projectId, credits.negate()) : Mono.empty())
                .onErrorResume(exception -> {
                    log.error("短剧请求退款失败: requestId={}", request.getId(), exception);
                    return Mono.empty();
                });
        Mono<Void> clear = StringUtils.hasText(projectId) ? dramaRepository.clearActive(projectId, request.getId()) : Mono.empty();
        return refund.then(clear);
    }

    /**
     * 服务中断后按账本退款。没有扣费记录时直接结束。
     *
     * @param request 已中断请求
     * @return 完成信号
     */
    public Mono<Void> releaseInterrupted(CreationAgentRequest request) {
        return requestRepository.findById(request.getId()).defaultIfEmpty(request).flatMap(this::release);
    }

    /**
     * 把本次扣费金额写入请求快照，供退款时减回项目积分。
     *
     * @param requestData 原快照
     * @param modelConfigId 模型配置
     * @param credits 本次积分
     * @return 新快照
     */
    public String withCharge(String requestData, String modelConfigId, BigDecimal credits) {
        JSONObject payload = payload(requestData);
        payload.put("modelConfigId", modelConfigId);
        payload.put("chargedCredits", credits);
        return payload.toJSONString();
    }

    private JSONObject payload(String requestData) {
        JSONObject payload = StringUtils.hasText(requestData) ? JSON.parseObject(requestData) : null;
        return payload == null ? new JSONObject() : payload;
    }
}
