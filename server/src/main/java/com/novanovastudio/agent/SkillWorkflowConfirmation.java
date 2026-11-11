package com.novanovastudio.agent;

import com.novanovastudio.agent.dto.CreationPlan;
import com.novanovastudio.agent.workflow.VideoWorkflowRegistry;
import com.novanovastudio.ai.VideoGenerationMode;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.common.SystemMessage;
import java.util.Locale;
import org.springframework.util.StringUtils;

/**
 * 用技能声明的 workflowId 确认主 Agent 计划。
 * <p>
 * 模型必须回传同一个标识。标识命中已注册工作流时才写入 workflowType；
 * 未注册的技能标识仍然有效，按技能自己的澄清或生成计划继续，不能改成别的工作流。
 */
public final class SkillWorkflowConfirmation {

    private SkillWorkflowConfirmation() {
    }

    /**
     * 确认计划属于当前技能的工作流。
     *
     * @param plan CreationPlan 模型返回的计划
     * @param skillWorkflowId String 技能声明的工作流标识，未配置时为空
     * @param registry VideoWorkflowRegistry 已注册视频工作流
     * @return CreationPlan 已确认的计划
     */
    public static CreationPlan confirm(CreationPlan plan, String skillWorkflowId, VideoWorkflowRegistry registry) {
        if (plan == null) {
            return null;
        }
        String expected = canonical(skillWorkflowId);
        if (!StringUtils.hasText(expected)) {
            if (hasDeclaredWorkflow(plan)) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.skillWorkflowIdIsRequired"));
            }
            return plan;
        }
        String declared = canonical(plan.workflowId());
        if (!StringUtils.hasText(declared)) {
            String echoedType = VideoGenerationMode.isSupported(plan.workflowType()) ? "" : canonical(plan.workflowType());
            if (expected.equals(echoedType)) {
                declared = expected;
            }
        }
        if (!expected.equals(declared)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.skillWorkflowIdDoesNotMatch", expected));
        }
        boolean registered = registry != null && registry.isRegistered(expected);
        return new CreationPlan(plan.planId(), plan.intent(), plan.entrySource(), plan.summary(),
                plan.clarificationQuestion(), plan.canvasGuidance(), plan.creationSettings(),
                plan.tasks(), plan.choices(), registered ? expected : null, expected);
    }

    /** 计划是否声明了工作流。生成模式不算工作流标识。 */
    private static boolean hasDeclaredWorkflow(CreationPlan plan) {
        if (StringUtils.hasText(plan.workflowId())) {
            return true;
        }
        return StringUtils.hasText(plan.workflowType()) && !VideoGenerationMode.isSupported(plan.workflowType());
    }

    /** 忽略大小写和首尾空白。 */
    private static String canonical(String value) {
        return StringUtils.hasText(value) ? value.trim().toLowerCase(Locale.ROOT) : "";
    }
}
