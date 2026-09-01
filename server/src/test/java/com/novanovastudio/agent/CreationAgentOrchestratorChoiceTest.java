package com.novanovastudio.agent;

import com.novanovastudio.agent.dto.AgentChoice;
import java.util.List;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * 工作流助手非结构化回复选项解析测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-01 00:00
 */
class CreationAgentOrchestratorChoiceTest {

    /** 当前模型回复承诺提供其他运镜但没有列出列表时，仍应生成可点击候选项。 */
    @Test
    void shouldCompleteCameraChoicesWhenReplyOmitsList() {
        String reply = "结合牛群抬头望天的动作，推荐「缓慢上摇」：镜头从低头吃草的牛群缓缓上摇至蓝天。"
                + "也可以看看下面的其他运镜选项：";

        List<AgentChoice> choices = CreationAgentOrchestrator.extractWorkflowChoices(reply);

        Assertions.assertEquals(5, choices.size());
        Assertions.assertEquals("缓慢上摇", choices.getFirst().value());
        Assertions.assertTrue(choices.stream().anyMatch(choice -> "平稳横移".equals(choice.value())));
    }

    /** 明确列出候选项时，应按原顺序转换为按钮，且不生成额外候选项。 */
    @Test
    void shouldParseInlineChoicesInOrder() {
        List<AgentChoice> choices = CreationAgentOrchestrator.extractWorkflowChoices(
                "请选择运镜方式，选项：缓慢推进、平稳横移、轻微环绕。");

        Assertions.assertEquals(List.of("缓慢推进", "平稳横移", "轻微环绕"),
                choices.stream().map(AgentChoice::value).toList());
    }

    /** 仅推荐一个方案且没有表达其他选项时，不应凭空渲染按钮。 */
    @Test
    void shouldNotInventChoicesForSingleRecommendation() {
        Assertions.assertTrue(CreationAgentOrchestrator.extractWorkflowChoices(
                "推荐缓慢推进镜头，画面会更稳定。" ).isEmpty());
    }
}
