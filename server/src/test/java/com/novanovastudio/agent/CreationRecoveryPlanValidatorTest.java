package com.novanovastudio.agent;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import com.novanovastudio.agent.dto.CreationPlan;
import com.novanovastudio.agent.dto.CreationRecoveryPlan;
import com.novanovastudio.agent.dto.CreationTask;
import com.novanovastudio.agent.dto.RecoveryNodeFailure;
import com.novanovastudio.agent.dto.RecoveryTaskContext;
import com.novanovastudio.agent.dto.RecoveryTaskDecision;
import com.novanovastudio.ai.AiErrorDetails;
import com.novanovastudio.common.BusinessException;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * 主Agent恢复计划权限边界测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-01 00:00
 */
class CreationRecoveryPlanValidatorTest {

    /** 恢复计划校验器 */
    private final CreationRecoveryPlanValidator validator = new CreationRecoveryPlanValidator(
            new CreationPlanValidator(new AgentToolRegistry()));

    /**
     * 内容策略错误允许改写实际提示词并完整复用失败节点。
     */
    @Test
    void shouldAllowPromptAdjustment() {
        RecoveryTaskContext context = context(error("prompt_policy_violation", "prompt", true),
                Set.of("quality"), List.of("node-2"), List.of("ADJUST_AND_RETRY", "ASK_USER", "STOP"), 0);
        CreationRecoveryPlan candidate = plan(new RecoveryTaskDecision("task-1", List.of("node-2"),
                "ADJUST_AND_RETRY", "安全且保留原意的新提示词", Map.of(), "调整提示词后重试"));

        CreationRecoveryPlan result = validator.validate(candidate, creationPlan(), List.of(context));

        Assertions.assertEquals("安全且保留原意的新提示词", result.decisions().getFirst().adjustedPrompt());
    }

    /**
     * 画布文本生成使用canvas任务类型时，替换计划仍必须将新提示词写入工具参数。
     */
    @Test
    void shouldValidateAdjustedCanvasTextPrompt() {
        CreationPlanValidator planValidator = mock(CreationPlanValidator.class);
        CreationRecoveryPlanValidator localValidator = new CreationRecoveryPlanValidator(planValidator);
        AiErrorDetails error = error("prompt_policy_violation", "prompt", true);
        RecoveryTaskContext context = new RecoveryTaskContext("task-1", "canvas", "tool",
                "canvas_generate_text", "原始提示词", Map.of("prompt", "原始提示词"),
                Map.of("prompt", "Agent生成"), Set.of(), List.of("node-2"), List.of(),
                List.of(new RecoveryNodeFailure("node-2", error)), error,
                List.of("ADJUST_AND_RETRY", "STOP"), 0);
        CreationTask task = new CreationTask("task-1", "canvas", "tool", "原始提示词", List.of(),
                "canvas_generate_text", Map.of("prompt", "原始提示词"));
        CreationPlan originalPlan = new CreationPlan("plan-1", "生成文本", CreationEntrySource.CANVAS,
                "生成一段文本", "", false, null, List.of(task));
        CreationRecoveryPlan candidate = plan(new RecoveryTaskDecision("task-1", List.of("node-2"),
                "ADJUST_AND_RETRY", "调整后的文本提示词", Map.of(), "调整提示词"));

        localValidator.validate(candidate, originalPlan, List.of(context));

        ArgumentCaptor<CreationPlan> planCaptor = ArgumentCaptor.forClass(CreationPlan.class);
        verify(planValidator).validate(planCaptor.capture(), eq(CreationEntrySource.CANVAS), isNull());
        Assertions.assertEquals("调整后的文本提示词",
                planCaptor.getValue().tasks().getFirst().toolArguments().get("prompt"));
    }

    /**
     * 供应商明确指出的Agent参数允许通过原工具Schema后调整。
     */
    @Test
    void shouldAllowExplicitAgentParameterAdjustment() {
        RecoveryTaskContext context = context(error("invalid_parameter", "quality", true),
                Set.of("quality"), List.of("node-2"), List.of("ADJUST_AND_RETRY", "ASK_USER", "STOP"), 0);
        CreationRecoveryPlan candidate = plan(new RecoveryTaskDecision("task-1", List.of("node-2"),
                "ADJUST_AND_RETRY", "", Map.of("quality", "medium"), "调整不支持的质量参数"));

        CreationRecoveryPlan result = validator.validate(candidate, creationPlan(), List.of(context));

        Assertions.assertEquals("medium", result.decisions().getFirst().adjustedToolArguments().get("quality"));
    }

    /**
     * 提交阶段未受理的服务异常允许原样重试。
     */
    @Test
    void shouldAllowUnchangedRetryForUnacceptedProviderFailure() {
        RecoveryTaskContext context = context(error("provider_unavailable", null, true), Set.of(),
                List.of("node-2"), List.of("RETRY_UNCHANGED", "ASK_USER", "STOP"), 0);
        CreationRecoveryPlan candidate = plan(new RecoveryTaskDecision("task-1", List.of("node-2"),
                "RETRY_UNCHANGED", "", Map.of(), "供应商未受理请求"));

        CreationRecoveryPlan result = validator.validate(candidate, creationPlan(), List.of(context));

        Assertions.assertEquals("RETRY_UNCHANGED", result.decisions().getFirst().action());
    }

    /**
     * 模型、数量和参考媒体等非授权字段必须拒绝修改。
     */
    @Test
    void shouldRejectImmutableArguments() {
        for (String field : List.of("model", "count", "references")) {
            RecoveryTaskContext context = context(error("invalid_parameter", field, true), Set.of("quality"),
                    List.of("node-2"), List.of("ADJUST_AND_RETRY", "ASK_USER", "STOP"), 0);
            CreationRecoveryPlan candidate = plan(new RecoveryTaskDecision("task-1", List.of("node-2"),
                    "ADJUST_AND_RETRY", "", Map.of(field, "changed"), "尝试修改固定字段"));

            Assertions.assertThrows(BusinessException.class,
                    () -> validator.validate(candidate, creationPlan(), List.of(context)));
        }
    }

    /**
     * 批量恢复不得漏掉失败节点、包含成功节点或再次恢复。
     */
    @Test
    void shouldRejectNodeExpansionAndSecondRecovery() {
        RecoveryTaskContext context = context(error("prompt_policy_violation", "prompt", true), Set.of(),
                List.of("node-2", "node-3"), List.of("ADJUST_AND_RETRY", "ASK_USER", "STOP"), 0);
        CreationRecoveryPlan missingNode = plan(new RecoveryTaskDecision("task-1", List.of("node-2"),
                "ADJUST_AND_RETRY", "新提示词", Map.of(), "遗漏节点"));
        RecoveryTaskContext secondAttempt = context(error("prompt_policy_violation", "prompt", true), Set.of(),
                List.of("node-2"), List.of("STOP"), 1);

        Assertions.assertThrows(BusinessException.class,
                () -> validator.validate(missingNode, creationPlan(), List.of(context)));
        Assertions.assertThrows(BusinessException.class,
                () -> validator.validate(plan(new RecoveryTaskDecision("task-1", List.of("node-2"),
                        "STOP", "", Map.of(), "停止")), creationPlan(), List.of(secondAttempt)));
    }

    /**
     * 画布生成缺少失败节点编号时不得通过重试创建重复节点。
     */
    @Test
    void shouldRejectCanvasRetryWithoutFailedNode() {
        RecoveryTaskContext context = context(error("prompt_policy_violation", "prompt", true), Set.of(),
                List.of(), List.of("ADJUST_AND_RETRY", "STOP"), 0);
        CreationRecoveryPlan candidate = plan(new RecoveryTaskDecision("task-1", List.of(),
                "ADJUST_AND_RETRY", "新提示词", Map.of(), "调整提示词"));

        Assertions.assertThrows(BusinessException.class,
                () -> validator.validate(candidate, creationPlan(), List.of(context)));
    }

    /**
     * 恢复计划不能增加未知任务或遗漏本层失败任务。
     */
    @Test
    void shouldRejectUnknownRecoveryTask() {
        RecoveryTaskContext context = context(error("unknown", null, false), Set.of(),
                List.of("node-2"), List.of("STOP"), 0);
        CreationRecoveryPlan candidate = plan(new RecoveryTaskDecision("task-new", List.of("node-2"),
                "STOP", "", Map.of(), "停止"));

        Assertions.assertThrows(BusinessException.class,
                () -> validator.validate(candidate, creationPlan(), List.of(context)));
    }

    /**
     * 已有画布节点的用户提示词不得自动改写。
     */
    @Test
    void shouldRejectExistingNodePromptAdjustment() {
        RecoveryTaskContext base = context(error("prompt_policy_violation", "prompt", true), Set.of(),
                List.of("node-2"), List.of("ADJUST_AND_RETRY", "ASK_USER", "STOP"), 0);
        RecoveryTaskContext context = new RecoveryTaskContext(base.taskId(), base.taskType(), base.action(),
                "canvas_run_generation", base.actualPrompt(), base.toolArguments(),
                Map.of("prompt", "用户硬约束"), base.agentGeneratedArguments(), base.failedNodeIds(),
                base.successfulNodeIds(), base.nodeFailures(), base.error(), base.allowedActions(), 0);
        CreationRecoveryPlan candidate = plan(new RecoveryTaskDecision("task-1", List.of("node-2"),
                "ADJUST_AND_RETRY", "试图改写用户提示词", Map.of(), "自动调整"));

        Assertions.assertThrows(BusinessException.class,
                () -> validator.validate(candidate, creationPlan(), List.of(context)));
    }

    /**
     * 原样重试必须同时满足提交阶段、明确未受理以及429或5xx状态码。
     */
    @Test
    void shouldRejectUnconfirmedOrNonSubmissionUnchangedRetry() {
        List<AiErrorDetails> errors = List.of(
                new AiErrorDetails("provider", "provider_unavailable", "submission", 503,
                        null, null, null, "供应商异常", null, true),
                new AiErrorDetails("provider", "provider_unavailable", "polling", 503,
                        null, null, null, "供应商异常", false, true),
                new AiErrorDetails("provider", "provider_unavailable", "submission", 400,
                        null, null, null, "供应商异常", false, true));
        CreationRecoveryPlan candidate = plan(new RecoveryTaskDecision("task-1", List.of("node-2"),
                "RETRY_UNCHANGED", "", Map.of(), "尝试原样重试"));

        for (AiErrorDetails error : errors) {
            RecoveryTaskContext context = context(error, Set.of(), List.of("node-2"),
                    List.of("RETRY_UNCHANGED", "STOP"), 0);
            Assertions.assertThrows(BusinessException.class,
                    () -> validator.validate(candidate, creationPlan(), List.of(context)));
        }
    }

    /**
     * 参数调整必须产生真实变化，禁止以相同值消耗唯一一次恢复机会。
     */
    @Test
    void shouldRejectUnchangedParameterPatch() {
        RecoveryTaskContext context = context(error("invalid_parameter", "quality", true),
                Set.of("quality"), List.of("node-2"), List.of("ADJUST_AND_RETRY", "STOP"), 0);
        CreationRecoveryPlan candidate = plan(new RecoveryTaskDecision("task-1", List.of("node-2"),
                "ADJUST_AND_RETRY", "", Map.of("quality", "high"), "参数未实际变化"));

        Assertions.assertThrows(BusinessException.class,
                () -> validator.validate(candidate, creationPlan(), List.of(context)));
    }

    /**
     * 构造画布恢复上下文。
     *
     * @param error AiErrorDetails 错误详情
     * @param agentArguments Set<String> Agent生成参数
     * @param failedNodeIds List<String> 失败节点
     * @param allowedActions List<String> 允许动作
     * @param recoveryAttempt int 恢复次数
     * @return RecoveryTaskContext 恢复上下文
     */
    private RecoveryTaskContext context(AiErrorDetails error, Set<String> agentArguments,
                                        List<String> failedNodeIds, List<String> allowedActions,
                                        int recoveryAttempt) {
        List<RecoveryNodeFailure> failures = failedNodeIds.stream()
                .map(nodeId -> new RecoveryNodeFailure(nodeId, error)).toList();
        return new RecoveryTaskContext("task-1", "image", "generate", "canvas_generate_image",
                "原始提示词", Map.of("prompt", "原始提示词", "size", "1:1", "quality", "high"),
                Map.of("prompt", "Agent生成", "size", "Agent生成", "quality", "Agent生成"),
                agentArguments, failedNodeIds, List.of("node-1"), failures, error, allowedActions, recoveryAttempt);
    }

    /**
     * 构造结构化错误。
     *
     * @param category String 错误类别
     * @param parameter String 错误参数
     * @param safeToRetry boolean 是否允许重试
     * @return AiErrorDetails 错误详情
     */
    private AiErrorDetails error(String category, String parameter, boolean safeToRetry) {
        int httpStatus = "rate_limited".equals(category) ? 429
                : "provider_unavailable".equals(category) ? 503 : 400;
        return new AiErrorDetails("provider", category, "submission", httpStatus, category,
                "invalid_request_error", parameter, "供应商错误", false, safeToRetry);
    }

    /**
     * 构造候选恢复计划。
     *
     * @param decision RecoveryTaskDecision 恢复决策
     * @return CreationRecoveryPlan 恢复计划
     */
    private CreationRecoveryPlan plan(RecoveryTaskDecision decision) {
        return new CreationRecoveryPlan("正在诊断并恢复", List.of(decision));
    }

    /**
     * 构造原始画布计划。
     *
     * @return CreationPlan 原始计划
     */
    private CreationPlan creationPlan() {
        CreationTask task = new CreationTask("task-1", "image", "generate", "原始提示词", List.of(),
                "canvas_generate_image", Map.of("prompt", "原始提示词", "size", "1:1", "quality", "high"));
        return new CreationPlan("plan-1", "生成图片", CreationEntrySource.CANVAS,
                "生成一张图片", "", false, null, List.of(task));
    }
}
