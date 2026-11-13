package com.novanovastudio.agent;

import com.novanovastudio.agent.dto.AgentChoice;
import com.novanovastudio.agent.dto.CreationPlan;
import com.novanovastudio.agent.dto.CreationSettings;
import com.novanovastudio.agent.workflow.FirstLastFrameVideoWorkflow;
import com.novanovastudio.agent.workflow.VideoWorkflowRegistry;
import com.novanovastudio.common.BusinessException;
import java.util.List;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * 技能 workflowId 确认测试。
 */
class SkillWorkflowConfirmationTest {

    /**
     * 模型回传的标识与技能一致、但不是已注册工作流时，澄清选项继续返回。
     */
    @Test
    void shouldKeepClarificationWhenWorkflowIdMatchesSkill() {
        VideoWorkflowRegistry registry = new VideoWorkflowRegistry(List.of());
        CreationPlan plan = fightPlan("fight_storyboard_skill", null);
        CreationPlan confirmed = SkillWorkflowConfirmation.confirm(plan, "fight_storyboard_skill", registry);
        CreationPlanValidator validator = new CreationPlanValidator(new AgentToolRegistry());
        validator.setVideoWorkflowRegistry(registry);

        CreationPlan result = validator.validate(confirmed, CreationEntrySource.VIDEO_PAGE, videoSettings());

        Assertions.assertEquals("fight_storyboard_skill", confirmed.workflowId());
        Assertions.assertNull(confirmed.workflowType());
        Assertions.assertEquals("这段打斗按哪种战斗类型来定？", result.clarificationQuestion());
        Assertions.assertEquals("玄幻仙侠", result.choices().getFirst().value());
        Assertions.assertTrue(result.tasks().isEmpty());
    }

    /**
     * 计划里直接填写 workflowId 时同样确认，大小写不敏感。
     */
    @Test
    void shouldConfirmExplicitWorkflowIdIgnoringCase() {
        CreationPlan plan = fightPlan(null, "Fight_Storyboard_Skill");

        CreationPlan result = SkillWorkflowConfirmation.confirm(plan, "fight_storyboard_skill", new VideoWorkflowRegistry(List.of()));

        Assertions.assertEquals("fight_storyboard_skill", result.workflowId());
        Assertions.assertNull(result.workflowType());
    }

    /**
     * 标识命中已注册工作流时，服务端才写入 workflowType。
     */
    @Test
    void shouldMarkRegisteredWorkflowWhenIdMatches() {
        VideoWorkflowRegistry registry = new VideoWorkflowRegistry(List.of(new FirstLastFrameVideoWorkflow()));
        CreationPlan plan = fightPlan(FirstLastFrameVideoWorkflow.TYPE, null);

        CreationPlan result = SkillWorkflowConfirmation.confirm(plan, "First-Last-Frame", registry);

        Assertions.assertEquals(FirstLastFrameVideoWorkflow.TYPE, result.workflowId());
        Assertions.assertEquals(FirstLastFrameVideoWorkflow.TYPE, result.workflowType());
    }

    /**
     * 回传的标识和技能声明不一致时拒绝，不能换成别的工作流。
     */
    @Test
    void shouldRejectDifferentWorkflowId() {
        CreationPlan plan = fightPlan("other-workflow", null);

        Assertions.assertThrows(BusinessException.class,
                () -> SkillWorkflowConfirmation.confirm(plan, "fight_storyboard_skill", new VideoWorkflowRegistry(List.of())));
    }

    /**
     * 技能还没有 workflowId 时，不能接受模型自己写的工作流类型。
     */
    @Test
    void shouldRejectDeclaredWorkflowWhenSkillIdIsMissing() {
        CreationPlan plan = fightPlan("fight_storyboard_skill", null);

        Assertions.assertThrows(BusinessException.class,
                () -> SkillWorkflowConfirmation.confirm(plan, "", new VideoWorkflowRegistry(List.of())));
    }

    private CreationPlan fightPlan(String workflowType, String workflowId) {
        return new CreationPlan("fight-storyboard-step2", "打斗分镜技能-收集战斗类型",
                CreationEntrySource.VIDEO_PAGE, "已收到点子", "这段打斗按哪种战斗类型来定？", false, null,
                List.of(), List.of(new AgentChoice("玄幻仙侠", "玄幻仙侠", false, null)), workflowType, workflowId);
    }

    private CreationSettings videoSettings() {
        return new CreationSettings("video-model", "16:9", "720p", "medium", null, "5", false);
    }
}
