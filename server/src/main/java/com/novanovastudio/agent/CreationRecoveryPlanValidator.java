package com.novanovastudio.agent;

import com.novanovastudio.agent.dto.CreationPlan;
import com.novanovastudio.agent.dto.CreationRecoveryPlan;
import com.novanovastudio.agent.dto.CreationTask;
import com.novanovastudio.agent.dto.RecoveryTaskContext;
import com.novanovastudio.agent.dto.RecoveryTaskDecision;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * 主Agent恢复计划的确定性权限校验器。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-01 00:00
 */
@Component
@RequiredArgsConstructor
public class CreationRecoveryPlanValidator {

    /** 允许的恢复动作 */
    private static final Set<String> ACTIONS = Set.of(
            "ADJUST_AND_RETRY", "RETRY_UNCHANGED", "ASK_USER", "STOP");

    /** 允许原样重试的错误类别 */
    private static final Set<String> UNCHANGED_RETRY_CATEGORIES = Set.of(
            "rate_limited", "provider_unavailable");

    /** 重试时必须携带失败节点编号的画布生成工具 */
    private static final Set<String> CANVAS_GENERATION_TOOLS = Set.of(
            "canvas_generate_text", "canvas_generate_image", "canvas_generate_video",
            "canvas_create_generation_flow", "canvas_run_generation");

    /** 原计划校验器 */
    private final CreationPlanValidator planValidator;

    /**
     * 校验并规范化主Agent恢复计划。
     *
     * @param candidate CreationRecoveryPlan 主Agent候选恢复计划
     * @param plan CreationPlan 已通过校验的原计划
     * @param contexts List<RecoveryTaskContext> 本层失败任务上下文
     * @return CreationRecoveryPlan 可安全执行的恢复计划
     * @throws BusinessException 恢复计划越权或格式错误时抛出
     */
    public CreationRecoveryPlan validate(CreationRecoveryPlan candidate, CreationPlan plan,
                                         List<RecoveryTaskContext> contexts) {
        if (candidate == null || !StringUtils.hasText(candidate.message())
                || candidate.decisions() == null || contexts == null || contexts.isEmpty()) {
            throw invalid("主Agent未返回完整恢复计划");
        }
        Map<String, RecoveryTaskContext> contextByTaskId = new LinkedHashMap<>();
        for (RecoveryTaskContext context : contexts) {
            if (context == null || !StringUtils.hasText(context.taskId()) || context.recoveryAttempt() != 0) {
                throw invalid("恢复任务上下文不合法");
            }
            contextByTaskId.put(context.taskId(), context);
        }
        Map<String, RecoveryTaskDecision> decisionByTaskId = new HashMap<>();
        for (RecoveryTaskDecision decision : candidate.decisions()) {
            if (decision == null || !contextByTaskId.containsKey(decision.taskId())
                    || decisionByTaskId.putIfAbsent(decision.taskId(), decision) != null) {
                throw invalid("恢复计划包含未知或重复任务");
            }
        }
        if (!decisionByTaskId.keySet().equals(contextByTaskId.keySet())) {
            throw invalid("恢复计划必须覆盖本层全部失败任务");
        }

        List<RecoveryTaskDecision> normalized = new ArrayList<>();
        for (RecoveryTaskContext context : contexts) {
            normalized.add(validateDecision(plan, context, decisionByTaskId.get(context.taskId())));
        }
        return new CreationRecoveryPlan(candidate.message().trim(), List.copyOf(normalized));
    }

    /**
     * 校验单个任务的恢复决策。
     *
     * @param plan CreationPlan 原计划
     * @param context RecoveryTaskContext 失败上下文
     * @param decision RecoveryTaskDecision 候选决策
     * @return RecoveryTaskDecision 规范化决策
     */
    private RecoveryTaskDecision validateDecision(CreationPlan plan, RecoveryTaskContext context,
                                                   RecoveryTaskDecision decision) {
        String action = decision.action() == null ? "" : decision.action().trim();
        if (!ACTIONS.contains(action)) throw invalid("恢复动作不受支持");
        if (context.allowedActions() == null || !context.allowedActions().contains(action)) {
            throw invalid("恢复动作超出服务端允许范围");
        }
        List<String> nodeIds = validateNodeIds(context, decision.nodeIds());
        Map<String, Object> argumentPatch = decision.adjustedToolArguments() == null
                ? Map.of() : new LinkedHashMap<>(decision.adjustedToolArguments());
        String adjustedPrompt = decision.adjustedPrompt() == null ? "" : decision.adjustedPrompt().trim();

        if ("ASK_USER".equals(action) || "STOP".equals(action)) {
            if (StringUtils.hasText(adjustedPrompt) || !argumentPatch.isEmpty()) {
                throw invalid("停止或询问用户时不能携带调整参数");
            }
            return new RecoveryTaskDecision(context.taskId(), nodeIds, action, "", Map.of(),
                    requiredReason(decision.reason()));
        }
        if (context.error() == null || !Boolean.TRUE.equals(context.error().safeToRetry())) {
            throw invalid("当前错误不允许创建新的重试任务");
        }
        if (CreationEntrySource.CANVAS.equals(plan.entrySource())
                && CANVAS_GENERATION_TOOLS.contains(context.toolName()) && nodeIds.isEmpty()) {
            throw invalid("画布生成重试缺少可复用的失败节点");
        }
        if ("RETRY_UNCHANGED".equals(action)) {
            if (!canRetryUnchanged(context.error())
                    || StringUtils.hasText(adjustedPrompt) || !argumentPatch.isEmpty()) {
                throw invalid("当前错误不允许原样重试");
            }
            return new RecoveryTaskDecision(context.taskId(), nodeIds, action, "", Map.of(),
                    requiredReason(decision.reason()));
        }

        boolean promptChanged = StringUtils.hasText(adjustedPrompt)
                && !adjustedPrompt.equals(context.actualPrompt());
        boolean promptError = "prompt_policy_violation".equals(context.error().category())
                || ("invalid_parameter".equals(context.error().category())
                && "prompt".equals(context.error().parameter()));
        if (promptChanged && (!promptError || "用户硬约束".equals(
                context.argumentSources() == null ? null : context.argumentSources().get("prompt")))) {
            throw invalid("当前错误不允许自动修改提示词");
        }
        validateArgumentPatch(context, argumentPatch);
        if (!promptChanged && argumentPatch.isEmpty()) throw invalid("调整重试必须修改提示词或允许参数");
        if ("prompt_policy_violation".equals(context.error().category()) && !promptChanged) {
            throw invalid("提示词内容策略错误必须修改提示词");
        }
        validateReplacementPlan(plan, context, promptChanged ? adjustedPrompt : context.actualPrompt(), argumentPatch);
        return new RecoveryTaskDecision(context.taskId(), nodeIds, action,
                promptChanged ? adjustedPrompt : "", Map.copyOf(argumentPatch), requiredReason(decision.reason()));
    }

    /**
     * 校验恢复目标节点仅包含首次失败节点。
     *
     * @param context RecoveryTaskContext 失败上下文
     * @param candidateNodeIds List<String> 候选节点编号
     * @return List<String> 规范化节点编号
     */
    private List<String> validateNodeIds(RecoveryTaskContext context, List<String> candidateNodeIds) {
        List<String> failedNodeIds = context.failedNodeIds() == null ? List.of() : context.failedNodeIds();
        if (failedNodeIds.isEmpty()) {
            if (candidateNodeIds != null && !candidateNodeIds.isEmpty()) throw invalid("非画布任务不能指定恢复节点");
            return List.of();
        }
        if (candidateNodeIds == null || candidateNodeIds.isEmpty()) {
            throw invalid("恢复计划必须明确列出全部失败节点");
        }
        List<String> nodeIds = candidateNodeIds;
        Set<String> unique = new HashSet<>(nodeIds);
        if (unique.size() != nodeIds.size() || !unique.equals(new HashSet<>(failedNodeIds))) {
            throw invalid("恢复节点必须完整覆盖首次失败节点");
        }
        if (context.successfulNodeIds() != null
                && context.successfulNodeIds().stream().anyMatch(unique::contains)) {
            throw invalid("已成功节点不能再次生成");
        }
        return List.copyOf(nodeIds);
    }

    /**
     * 校验工具参数补丁只能修改供应商明确指出的Agent生成参数。
     *
     * @param context RecoveryTaskContext 失败上下文
     * @param argumentPatch Map<String, Object> 参数补丁
     */
    private void validateArgumentPatch(RecoveryTaskContext context, Map<String, Object> argumentPatch) {
        if (argumentPatch.isEmpty()) return;
        if (!"invalid_parameter".equals(context.error().category())
                || !StringUtils.hasText(context.error().parameter())) {
            throw invalid("供应商未明确指出可调整参数");
        }
        for (Map.Entry<String, Object> entry : argumentPatch.entrySet()) {
            if (!entry.getKey().equals(context.error().parameter())
                    || context.agentGeneratedArguments() == null
                    || !context.agentGeneratedArguments().contains(entry.getKey())
                    || entry.getValue() == null
                    || Objects.equals(context.toolArguments().get(entry.getKey()), entry.getValue())) {
                throw invalid("恢复计划试图修改用户硬约束或未确认参数");
            }
        }
    }

    /**
     * 判断供应商错误是否满足原样重试的全部确定性条件。
     *
     * @param error com.novanovastudio.ai.AiErrorDetails 结构化错误
     * @return boolean 是否允许原样重试
     */
    private boolean canRetryUnchanged(com.novanovastudio.ai.AiErrorDetails error) {
        if (error == null || !UNCHANGED_RETRY_CATEGORIES.contains(error.category())
                || !"submission".equals(error.stage()) || !Boolean.FALSE.equals(error.requestAccepted())
                || error.httpStatus() == null) {
            return false;
        }
        return ("rate_limited".equals(error.category()) && error.httpStatus() == 429)
                || ("provider_unavailable".equals(error.category()) && error.httpStatus() >= 500);
    }

    /**
     * 复用原计划校验器验证调整后的画布工具Schema和固定任务边界。
     *
     * @param plan CreationPlan 原计划
     * @param context RecoveryTaskContext 失败上下文
     * @param prompt String 调整后的提示词
     * @param argumentPatch Map<String, Object> 参数补丁
     */
    private void validateReplacementPlan(CreationPlan plan, RecoveryTaskContext context, String prompt,
                                         Map<String, Object> argumentPatch) {
        List<CreationTask> tasks = plan.tasks().stream().map(task -> {
            if (!task.taskId().equals(context.taskId())) return task;
            Map<String, Object> arguments = new LinkedHashMap<>(task.toolArguments() == null ? Map.of() : task.toolArguments());
            arguments.putAll(argumentPatch);
            if (CreationEntrySource.CANVAS.equals(plan.entrySource()) && arguments.containsKey("prompt")) {
                arguments.put("prompt", prompt);
            }
            return new CreationTask(task.taskId(), task.taskType(), task.action(), prompt, task.dependsOn(),
                    task.toolName(), arguments);
        }).toList();
        planValidator.validate(new CreationPlan(plan.planId(), plan.intent(), plan.entrySource(), plan.summary(), "",
                false, plan.creationSettings(), tasks), plan.entrySource(), plan.creationSettings());
    }

    /**
     * 校验恢复原因不能为空。
     *
     * @param reason String 恢复原因
     * @return String 非空原因
     */
    private String requiredReason(String reason) {
        if (!StringUtils.hasText(reason)) throw invalid("恢复决策缺少原因");
        return reason.trim();
    }

    /**
     * 创建参数无效业务异常。
     *
     * @param message String 错误说明
     * @return BusinessException 参数异常
     */
    private BusinessException invalid(String message) {
        return new BusinessException(ErrorCode.PARAM_INVALID, message);
    }
}
