package com.novanovastudio.agent;

import com.novanovastudio.agent.dto.AgentChatRequest;
import com.novanovastudio.agent.dto.AgentChoice;
import com.novanovastudio.agent.dto.CreationPlan;
import com.novanovastudio.agent.dto.CreationTask;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.util.StringUtils;

/**
 * 画布删除/移除操作的二次确认拦截工具。
 * <p>
 * 无论模型计划删除单个节点、多个节点、全部节点还是移除连线，在未收到用户明确确认前，
 * 都统一转为对话框确认按钮（确认删除 / 取消），避免误删画布内容。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-24 16:22:00
 */
final class CanvasDeleteConfirmationSupport {

    /** 确认删除按钮提交值 */
    static final String CONFIRM_DELETE_VALUE = "确认删除";
    /** 取消删除按钮提交值 */
    static final String CANCEL_DELETE_VALUE = "取消删除";
    /** 对话框中展示的删除确认选项 */
    static final List<AgentChoice> DELETE_CONFIRMATION_CHOICES = List.of(
            new AgentChoice("确认删除", CONFIRM_DELETE_VALUE, false, null),
            new AgentChoice("取消", CANCEL_DELETE_VALUE, false, null));

    private static final Set<String> CONFIRM_REPLIES = Set.of(
            "确认删除", "确定删除", "确认移除", "确定移除", "确认清空", "确定清空",
            "确认", "确定", "是的", "好的", "confirm", "yes");
    private static final Set<String> CANCEL_REPLIES = Set.of(
            "取消删除", "取消移除", "取消", "不删了", "不要删除", "算了", "cancel", "no");

    private CanvasDeleteConfirmationSupport() {
    }

    /**
     * 对画布计划执行删除确认门禁。
     * <p>
     * 1. 若模型已主动发起删除确认但未附带按钮，自动补齐确认/取消按钮；
     * 2. 若计划包含任何删除/移除任务且本轮尚未经过用户确认，拦截执行并转为带确认按钮的澄清计划。
     *
     * @param plan CreationPlan 已通过基础校验的计划
     * @param request AgentChatRequest 当前用户请求
     * @param history List<Map<String, String>> 最近对话历史
     * @return CreationPlan 原计划或转成删除确认的澄清计划
     */
    static CreationPlan enforce(CreationPlan plan, AgentChatRequest request, List<Map<String, String>> history) {
        if (plan == null || request == null || !CreationEntrySource.CANVAS.equals(request.entrySource())) {
            return plan;
        }
        if (StringUtils.hasText(plan.clarificationQuestion())) {
            boolean hasChoices = plan.choices() != null && !plan.choices().isEmpty();
            if (!hasChoices && looksLikeDeleteConfirmationPrompt(plan.clarificationQuestion())) {
                return new CreationPlan(plan.planId(), plan.intent(), plan.entrySource(), plan.summary(),
                        plan.clarificationQuestion(), false, plan.creationSettings(), List.of(), DELETE_CONFIRMATION_CHOICES);
            }
            return plan;
        }
        if (!containsDeleteTask(plan.tasks())) {
            return plan;
        }
        if (isDeleteConfirmMessage(request.message(), history)) {
            return plan;
        }
        String question = buildConfirmationQuestion(plan.tasks(), request.canvasSnapshot());
        return new CreationPlan(plan.planId(), plan.intent(), plan.entrySource(), plan.summary(),
                question, false, plan.creationSettings(), List.of(), DELETE_CONFIRMATION_CHOICES);
    }

    /**
     * 判断任务列表是否包含画布删除或移除操作。
     *
     * @param tasks List<CreationTask> 计划任务列表
     * @return boolean 是否包含删除/移除任务
     */
    static boolean containsDeleteTask(List<CreationTask> tasks) {
        if (tasks == null || tasks.isEmpty()) {
            return false;
        }
        for (CreationTask task : tasks) {
            if (task == null) continue;
            if ("canvas_delete_nodes".equals(task.toolName())) {
                return true;
            }
            if ("canvas_apply_ops".equals(task.toolName()) && task.toolArguments() != null) {
                Object ops = task.toolArguments().get("ops");
                if (ops instanceof Collection<?> opList) {
                    for (Object item : opList) {
                        if (item instanceof Map<?, ?> opMap) {
                            Object type = opMap.get("type");
                            if ("delete_node".equals(type) || "delete_connections".equals(type)) {
                                return true;
                            }
                        }
                    }
                }
            }
        }
        return false;
    }

    /**
     * 判断用户本轮输入是否为对上一轮删除确认的“确认”。
     *
     * @param message String 用户当前输入
     * @param history List<Map<String, String>> 最近对话历史
     * @return boolean 是否已明确确认删除
     */
    static boolean isDeleteConfirmMessage(String message, List<Map<String, String>> history) {
        if (!StringUtils.hasText(message) || !previousAssistantAskedDeleteConfirmation(history)) {
            return false;
        }
        String normalized = normalizeReply(message);
        return CONFIRM_REPLIES.contains(normalized);
    }

    /**
     * 判断用户本轮输入是否为对上一轮删除确认的“取消”。
     *
     * @param message String 用户当前输入
     * @param history List<Map<String, String>> 最近对话历史
     * @return boolean 是否取消删除
     */
    static boolean isDeleteCancelMessage(String message, List<Map<String, String>> history) {
        if (!StringUtils.hasText(message) || !previousAssistantAskedDeleteConfirmation(history)) {
            return false;
        }
        String normalized = normalizeReply(message);
        return CANCEL_REPLIES.contains(normalized);
    }

    /**
     * 根据待删除目标与当前画布快照生成明确的中文确认提示。
     *
     * @param tasks List<CreationTask> 包含删除任务的计划列表
     * @param canvasSnapshot Map<String, Object> 当前画布快照
     * @return String 面向用户的删除确认文案
     */
    static String buildConfirmationQuestion(List<CreationTask> tasks, Map<String, Object> canvasSnapshot) {
        Map<String, String> titleById = readNodeTitles(canvasSnapshot);
        int totalNodeCount = titleById.size();
        Set<String> targetNodeIds = new LinkedHashSet<>();
        boolean deletesConnections = false;
        boolean deletesAllNodes = false;

        if (tasks != null) {
            for (CreationTask task : tasks) {
                if (task == null || task.toolArguments() == null) continue;
                if ("canvas_delete_nodes".equals(task.toolName())) {
                    collectStringIds(task.toolArguments().get("ids"), targetNodeIds);
                } else if ("canvas_apply_ops".equals(task.toolName()) && task.toolArguments().get("ops") instanceof Collection<?> ops) {
                    for (Object item : ops) {
                        if (!(item instanceof Map<?, ?> opMap)) continue;
                        Object type = opMap.get("type");
                        if ("delete_node".equals(type)) {
                            int before = targetNodeIds.size();
                            collectStringIds(opMap.get("ids"), targetNodeIds);
                            if (opMap.get("id") instanceof String id && StringUtils.hasText(id)) {
                                targetNodeIds.add(id.trim());
                            }
                            if (targetNodeIds.size() == before && opMap.get("nodeType") == null) {
                                deletesAllNodes = true;
                            }
                        } else if ("delete_connections".equals(type)) {
                            deletesConnections = true;
                        }
                    }
                }
            }
        }

        if (deletesAllNodes || (totalNodeCount > 0 && targetNodeIds.size() >= totalNodeCount)) {
            int count = targetNodeIds.isEmpty() ? totalNodeCount : targetNodeIds.size();
            return count > 0
                    ? "即将删除画布中的全部 " + count + " 个节点及相关连线，是否确认删除？"
                    : "即将删除画布中的全部节点及相关连线，是否确认删除？";
        }
        if (targetNodeIds.size() == 1) {
            String onlyId = targetNodeIds.iterator().next();
            String title = titleById.get(onlyId);
            return StringUtils.hasText(title)
                    ? "即将删除节点「" + title + "」及相关连线，是否确认删除？"
                    : "即将删除 1 个节点及相关连线，是否确认删除？";
        }
        if (targetNodeIds.size() > 1) {
            return "即将删除 " + targetNodeIds.size() + " 个节点及相关连线，是否确认删除？";
        }
        if (deletesConnections) {
            return "即将移除画布中的指定连线，是否确认移除？";
        }
        return "即将执行画布删除操作，是否确认继续？";
    }

    /**
     * 检查历史中最近一条助手消息是否为删除确认提示。
     *
     * @param history List<Map<String, String>> 最近对话历史
     * @return boolean 最近一条助手消息是否在询问删除确认
     */
    private static boolean previousAssistantAskedDeleteConfirmation(List<Map<String, String>> history) {
        if (history == null || history.isEmpty()) {
            return false;
        }
        for (int i = history.size() - 1; i >= 0; i--) {
            Map<String, String> message = history.get(i);
            if (message == null) continue;
            if ("assistant".equals(message.get("role"))) {
                return looksLikeDeleteConfirmationPrompt(message.get("text"));
            }
        }
        return false;
    }

    /**
     * 判断文案是否属于删除/移除操作的确认询问。
     *
     * @param text String 助手回复文本
     * @return boolean 是否为删除确认提示
     */
    private static boolean looksLikeDeleteConfirmationPrompt(String text) {
        if (!StringUtils.hasText(text)) {
            return false;
        }
        boolean mentionsDelete = text.contains("删除") || text.contains("移除") || text.contains("清空");
        boolean asksConfirmation = text.contains("确认") || text.contains("是否");
        return mentionsDelete && asksConfirmation;
    }

    /**
     * 规范化用户回复文本，去除首尾空白和常见标点。
     *
     * @param message String 原始消息
     * @return String 规范化后的小写文本
     */
    private static String normalizeReply(String message) {
        return message.trim()
                .replaceAll("[。！？.!?,，\\s]+$", "")
                .toLowerCase(Locale.ROOT);
    }

    /**
     * 从画布快照中读取节点 ID 到标题的映射。
     *
     * @param canvasSnapshot Map<String, Object> 画布快照
     * @return Map<String, String> 节点标题映射
     */
    private static Map<String, String> readNodeTitles(Map<String, Object> canvasSnapshot) {
        Map<String, String> titles = new LinkedHashMap<>();
        if (canvasSnapshot == null || !(canvasSnapshot.get("nodes") instanceof Collection<?> nodes)) {
            return titles;
        }
        for (Object item : nodes) {
            if (!(item instanceof Map<?, ?> nodeMap)) continue;
            Object idObj = nodeMap.get("id");
            if (!(idObj instanceof String id) || !StringUtils.hasText(id)) continue;
            Object titleObj = nodeMap.get("title");
            String title = titleObj instanceof String value ? value.trim() : "";
            titles.put(id.trim(), title);
        }
        return titles;
    }

    /**
     * 收集参数中的字符串 ID 集合。
     *
     * @param raw Object 原始 ID 集合对象
     * @param target Set<String> 目标集合
     */
    private static void collectStringIds(Object raw, Set<String> target) {
        if (!(raw instanceof Collection<?> items)) {
            return;
        }
        for (Object item : items) {
            if (item instanceof String id && StringUtils.hasText(id)) {
                target.add(id.trim());
            }
        }
    }
}
