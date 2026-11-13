package com.novanovastudio.agent;

import com.novanovastudio.agent.dto.AgentChoice;
import com.novanovastudio.agent.dto.CreationPlan;
import java.util.List;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/** 用户动作标识收敛测试。 */
class SkillPromptActionsTest {

    @Test
    void shouldTurnModelConfigTokenInQuestionIntoChoice() {
        CreationPlan plan = plan("请先 @ask_user_model_config ，再继续。", List.of());

        CreationPlan result = SkillPromptActions.normalize(plan);

        Assertions.assertEquals("请先 ，再继续。", result.clarificationQuestion());
        Assertions.assertEquals(SkillPromptActions.ASK_USER_MODEL_CONFIG, result.choices().getFirst().action());
        Assertions.assertEquals("设置模型", result.choices().getFirst().label());
    }

    @Test
    void shouldRewriteConfirmChoiceAndHideToken() {
        CreationPlan plan = plan("是否继续？", List.of(new AgentChoice("@ask_user_confirm", "@ask_user_confirm", false, null)));

        CreationPlan result = SkillPromptActions.normalize(plan);

        Assertions.assertEquals("是否继续？", result.clarificationQuestion());
        Assertions.assertEquals("确认", result.choices().getFirst().label());
        Assertions.assertEquals("确认", result.choices().getFirst().value());
        Assertions.assertEquals(SkillPromptActions.ASK_USER_CONFIRM, result.choices().getFirst().action());
    }

    @Test
    void shouldTurnPlainReplyTokenIntoChoice() {
        SkillPromptActions.NormalizedReply reply = SkillPromptActions.normalizeReply("请先 @ask_user_confirm 后再继续。");

        Assertions.assertEquals("请先 后再继续。", reply.text());
        Assertions.assertEquals(SkillPromptActions.ASK_USER_CONFIRM, reply.choices().getFirst().action());
        Assertions.assertEquals("确认", reply.choices().getFirst().value());
    }

    @Test
    void shouldTurnUploadTokensIntoChoices() {
        CreationPlan plan = plan("请 @ask_user_upload_image ，或 @ask_user_upload_video 。", List.of());

        CreationPlan result = SkillPromptActions.normalize(plan);

        Assertions.assertEquals("请 ，或 。", result.clarificationQuestion());
        Assertions.assertEquals("上传图片", result.choices().get(0).label());
        Assertions.assertEquals(SkillPromptActions.ASK_USER_UPLOAD_IMAGE, result.choices().get(0).action());
        Assertions.assertEquals("上传视频", result.choices().get(1).label());
        Assertions.assertEquals(SkillPromptActions.ASK_USER_UPLOAD_VIDEO, result.choices().get(1).action());
    }

    @Test
    void shouldKeepPlanWithoutSkillTokens() {
        CreationPlan plan = plan("选择风格", List.of(new AgentChoice("极简", "极简", false, null)));

        Assertions.assertSame(plan, SkillPromptActions.normalize(plan));
    }

    private CreationPlan plan(String question, List<AgentChoice> choices) {
        return new CreationPlan("plan", "技能", "videoPage", "摘要", question, false, null, List.of(), choices);
    }
}