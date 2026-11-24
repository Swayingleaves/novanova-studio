package com.novanovastudio.agent;

import com.novanovastudio.agent.dto.AgentChatRequest;
import com.novanovastudio.agent.dto.CreationPlan;
import com.novanovastudio.agent.dto.CreationTask;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 画布删除/移除二次确认门禁单元测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-24 16:23:00
 */
class CanvasDeleteConfirmationSupportTest {

    @Test
    void deletesAllNodesRequireConfirmationWithButtons() {
        Map<String, Object> snapshot = Map.of("nodes", List.of(
                Map.of("id", "n1", "title", "图片节点 1"),
                Map.of("id", "n2", "title", "视频节点 1"),
                Map.of("id", "n3", "title", "文本节点 1")));
        CreationPlan plan = deletePlan(List.of("n1", "n2", "n3"));
        AgentChatRequest request = canvasRequest("删除画布当中所有的节点", snapshot);

        CreationPlan gated = CanvasDeleteConfirmationSupport.enforce(plan, request, List.of());

        assertTrue(gated.tasks().isEmpty());
        assertTrue(gated.clarificationQuestion().contains("全部 3 个节点"));
        assertEquals(2, gated.choices().size());
        assertEquals("确认删除", gated.choices().get(0).label());
        assertEquals("取消", gated.choices().get(1).label());
    }

    @Test
    void deletesSingleNodeRequiresConfirmationWithTitle() {
        Map<String, Object> snapshot = Map.of("nodes", List.of(
                Map.of("id", "n1", "title", "主角设定图"),
                Map.of("id", "n2", "title", "背景图")));
        CreationPlan plan = deletePlan(List.of("n1"));
        AgentChatRequest request = canvasRequest("删掉主角设定图", snapshot);

        CreationPlan gated = CanvasDeleteConfirmationSupport.enforce(plan, request, List.of());

        assertTrue(gated.tasks().isEmpty());
        assertTrue(gated.clarificationQuestion().contains("主角设定图"));
        assertEquals(2, gated.choices().size());
    }

    @Test
    void deletesConnectionsViaApplyOpsRequiresConfirmation() {
        CreationTask task = new CreationTask("t1", "canvas", "tool", "移除连线", null, List.of(),
                "canvas_apply_ops", Map.of("ops", List.of(Map.of("type", "delete_connections", "all", true))));
        CreationPlan plan = new CreationPlan("p1", "canvas", CreationEntrySource.CANVAS, "移除连线", "", false, null, List.of(task), List.of());
        AgentChatRequest request = canvasRequest("移除所有连线", Map.of());

        CreationPlan gated = CanvasDeleteConfirmationSupport.enforce(plan, request, List.of());

        assertTrue(gated.tasks().isEmpty());
        assertTrue(gated.clarificationQuestion().contains("连线"));
        assertEquals(2, gated.choices().size());
    }

    @Test
    void confirmedDeletePassesThrough() {
        Map<String, Object> snapshot = Map.of("nodes", List.of(Map.of("id", "n1", "title", "文本节点 1")));
        CreationPlan plan = deletePlan(List.of("n1"));
        AgentChatRequest request = canvasRequest("确认删除", snapshot);
        List<Map<String, String>> history = List.of(
                Map.of("role", "user", "text", "删除文本节点 1"),
                Map.of("role", "assistant", "text", "即将删除节点「文本节点 1」及相关连线，是否确认删除？"));

        CreationPlan gated = CanvasDeleteConfirmationSupport.enforce(plan, request, history);

        assertEquals(1, gated.tasks().size());
        assertEquals("", gated.clarificationQuestion());
    }

    @Test
    void cancelMessageDetectedAfterDeletePrompt() {
        List<Map<String, String>> history = List.of(
                Map.of("role", "assistant", "text", "即将删除画布中的全部 3 个节点及相关连线，是否确认删除？"));

        assertTrue(CanvasDeleteConfirmationSupport.isDeleteCancelMessage("取消删除", history));
        assertTrue(CanvasDeleteConfirmationSupport.isDeleteCancelMessage("取消", history));
        assertFalse(CanvasDeleteConfirmationSupport.isDeleteCancelMessage("取消", List.of()));
    }

    @Test
    void modelDeleteClarificationWithoutChoicesGetsDefaultButtons() {
        CreationPlan plan = new CreationPlan("p1", "canvas", CreationEntrySource.CANVAS, "删除节点",
                "确认要删除画布中的全部节点吗？", false, null, List.of(), List.of());
        AgentChatRequest request = canvasRequest("清空画布", Map.of());

        CreationPlan gated = CanvasDeleteConfirmationSupport.enforce(plan, request, List.of());

        assertEquals(2, gated.choices().size());
        assertEquals("确认删除", gated.choices().get(0).value());
        assertEquals("取消删除", gated.choices().get(1).value());
    }

    @Test
    void nonDeleteCanvasTaskPassesThroughWithoutConfirmation() {
        CreationTask task = new CreationTask("t1", "canvas", "tool", "创建文本节点", null, List.of(),
                "canvas_create_text_node", Map.of("text", "你好"));
        CreationPlan plan = new CreationPlan("p1", "canvas", CreationEntrySource.CANVAS, "创建节点", "", false, null, List.of(task), List.of());
        AgentChatRequest request = canvasRequest("创建一个文本节点", Map.of());

        CreationPlan gated = CanvasDeleteConfirmationSupport.enforce(plan, request, List.of());

        assertEquals(1, gated.tasks().size());
        assertEquals("", gated.clarificationQuestion());
    }

    private static CreationPlan deletePlan(List<String> ids) {
        CreationTask task = new CreationTask("t1", "canvas", "tool", "删除节点", null, List.of(),
                "canvas_delete_nodes", Map.of("ids", ids));
        return new CreationPlan("p1", "canvas", CreationEntrySource.CANVAS, "删除节点", "", false, null, List.of(task), List.of());
    }

    private static AgentChatRequest canvasRequest(String message, Map<String, Object> snapshot) {
        return new AgentChatRequest("s1", CreationEntrySource.CANVAS, message, snapshot, List.of(), List.of(), List.of(), null, null);
    }
}
