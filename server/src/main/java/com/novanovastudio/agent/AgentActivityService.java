package com.novanovastudio.agent;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.agent.dto.AgentEvent;
import com.novanovastudio.repository.PersistenceRepository;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Mono;

/**
 * Agent执行活动状态与持久化服务。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-24 23:49
 */
@Service
@RequiredArgsConstructor
public class AgentActivityService {

    /** 会话对应的有序执行活动 */
    private final ConcurrentHashMap<String, LinkedHashMap<String, JSONObject>> activitiesBySessionId = new ConcurrentHashMap<>();

    /** 生成记录仓储 */
    private final PersistenceRepository repository;

    /**
     * 记录Agent事件对应的执行活动状态。
     *
     * @param event AgentEvent Agent事件
     */
    public void record(AgentEvent event) {
        if (event == null || !StringUtils.hasText(event.sessionId())) {
            return;
        }
        LinkedHashMap<String, JSONObject> activities = activitiesBySessionId.computeIfAbsent(
                event.sessionId(), ignored -> new LinkedHashMap<>());
        synchronized (activities) {
            switch (event.type()) {
                case "plan-created" -> recordPlanCreated(activities, event);
                case "plan-task-status" -> recordPlanTaskStatus(activities, event);
                case "prompt-prepared" -> recordPromptPrepared(activities, event);
                case "tool-execute" -> recordToolExecution(activities, event);
                case "progress" -> updateToolProgress(activities, event);
                case "tool-result" -> updateToolResult(activities, event);
                case "canceled" -> finishRunningActivities(activities, "canceled", "已停止生成");
                case "error" -> finishRunningActivities(activities, "failed", event.errorMessage());
                default -> {
                    // 非时间线事件无需进入活动状态。
                }
            }
        }
    }

    /**
     * 获取指定生成轮次应保存的执行活动。
     *
     * @param sessionId String Agent会话ID
     * @param round JSONObject 生成轮次
     * @return JSONArray 执行活动数组
     */
    public JSONArray activitiesForRound(String sessionId, JSONObject round) {
        if (!StringUtils.hasText(sessionId) || round == null) {
            return new JSONArray();
        }
        LinkedHashMap<String, JSONObject> activities = activitiesBySessionId.get(sessionId);
        if (activities == null) {
            return new JSONArray();
        }
        Set<String> roundIds = roundIds(round);
        String terminalStatus = terminalStatus(round);
        JSONArray result = new JSONArray();
        synchronized (activities) {
            for (JSONObject activity : activities.values()) {
                if (!isRelatedActivity(activity, roundIds)) {
                    continue;
                }
                JSONObject snapshot = JSON.parseObject(JSON.toJSONString(activity));
                if (StringUtils.hasText(terminalStatus) && "running".equals(snapshot.getString("status"))) {
                    snapshot.put("status", terminalStatus);
                    snapshot.put("progress", 100);
                }
                result.add(snapshot);
            }
        }
        return result;
    }

    /**
     * 原子保存指定轮次的最新执行活动。
     *
     * @param userId Long 当前用户ID
     * @param sessionId String Agent会话ID及生成记录ID
     * @param roundId String 生成轮次ID
     * @return Mono<Void> 保存结果
     */
    public Mono<Void> persistRoundActivities(Long userId, String sessionId, String roundId) {
        JSONObject round = new JSONObject();
        round.put("id", roundId);
        JSONArray activities = activitiesForRound(sessionId, round);
        if (activities.isEmpty()) {
            return Mono.empty();
        }
        return repository.saveGenerationRoundActivities(userId, sessionId, roundId, JSON.toJSONString(activities)).then();
    }

    /**
     * 清理已结束会话的内存活动状态。
     *
     * @param sessionId String Agent会话ID
     */
    public void clear(String sessionId) {
        if (StringUtils.hasText(sessionId)) {
            activitiesBySessionId.remove(sessionId);
        }
    }

    /**
     * 记录计划创建活动。
     *
     * @param activities LinkedHashMap<String, JSONObject> 当前活动
     * @param event AgentEvent 计划创建事件
     */
    private void recordPlanCreated(LinkedHashMap<String, JSONObject> activities, AgentEvent event) {
        String planId = resultText(event, "planId");
        String summary = resultText(event, "summary");
        Object taskCount = event.resultData() == null ? 0 : event.resultData().getOrDefault("taskCount", 0);
        putActivity(activities, "plan-" + planId, "plan-created", "创建创作计划",
                summary + "，共 " + taskCount + " 个任务", "success", null);
    }

    /**
     * 记录计划任务状态活动。
     *
     * @param activities LinkedHashMap<String, JSONObject> 当前活动
     * @param event AgentEvent 计划任务状态事件
     */
    private void recordPlanTaskStatus(LinkedHashMap<String, JSONObject> activities, AgentEvent event) {
        String planId = resultText(event, "planId");
        String taskId = resultText(event, "taskId");
        putActivity(activities, "task-" + planId + "-" + taskId, "plan-task-status", "执行创作任务",
                resultText(event, "message"), activityStatus(event.status()), null);
    }

    /**
     * 记录提示词准备活动。
     *
     * @param activities LinkedHashMap<String, JSONObject> 当前活动
     * @param event AgentEvent 提示词准备事件
     */
    private void recordPromptPrepared(LinkedHashMap<String, JSONObject> activities, AgentEvent event) {
        String planId = resultText(event, "planId");
        String taskId = resultText(event, "taskId");
        String strategy = resultText(event, "strategy");
        boolean optimized = "OPTIMIZE".equals(strategy);
        putActivity(activities, "prompt-" + planId + "-" + taskId, "prompt-prepared",
                optimized ? "优化生成提示词" : "准备生成提示词",
                optimized ? "已根据创作目标优化提示词" : "沿用原始提示词", "success", null);
    }

    /**
     * 记录工具开始执行活动。
     *
     * @param activities LinkedHashMap<String, JSONObject> 当前活动
     * @param event AgentEvent 工具执行事件
     */
    private void recordToolExecution(LinkedHashMap<String, JSONObject> activities, AgentEvent event) {
        putActivity(activities, "tool-" + event.callId(), "tool-execute", toolTitle(event.name()),
                toolDescription(event.arguments()), "running", event.progress());
    }

    /**
     * 更新工具执行进度。
     *
     * @param activities LinkedHashMap<String, JSONObject> 当前活动
     * @param event AgentEvent 进度事件
     */
    private void updateToolProgress(LinkedHashMap<String, JSONObject> activities, AgentEvent event) {
        JSONObject activity = activities.get("tool-" + event.callId());
        if (activity == null) {
            return;
        }
        activity.put("status", activityStatus(event.status()));
        if (event.progress() != null) {
            activity.put("progress", event.progress());
        }
    }

    /**
     * 更新工具执行结果。
     *
     * @param activities LinkedHashMap<String, JSONObject> 当前活动
     * @param event AgentEvent 工具结果事件
     */
    private void updateToolResult(LinkedHashMap<String, JSONObject> activities, AgentEvent event) {
        JSONObject activity = activities.get("tool-" + event.callId());
        if (activity == null) {
            return;
        }
        boolean canceled = event.resultData() != null && Boolean.TRUE.equals(event.resultData().get("canceled"));
        activity.put("status", canceled ? "canceled" : Boolean.TRUE.equals(event.resultOk()) ? "success" : "failed");
        if (Boolean.TRUE.equals(event.resultOk())) {
            activity.put("progress", 100);
        }
    }

    /**
     * 结束全部仍在执行的活动。
     *
     * @param activities LinkedHashMap<String, JSONObject> 当前活动
     * @param status String 终态
     * @param description String 状态说明
     */
    private void finishRunningActivities(LinkedHashMap<String, JSONObject> activities, String status, String description) {
        for (JSONObject activity : activities.values()) {
            if (!"running".equals(activity.getString("status"))) {
                continue;
            }
            activity.put("status", status);
            activity.put("progress", 100);
            if (StringUtils.hasText(description)) {
                activity.put("description", description);
            }
        }
    }

    /**
     * 新增或覆盖一条执行活动。
     *
     * @param activities LinkedHashMap<String, JSONObject> 当前活动
     * @param id String 活动ID
     * @param type String 活动类型
     * @param title String 标题
     * @param description String 说明
     * @param status String 状态
     * @param progress Integer 进度
     */
    private void putActivity(LinkedHashMap<String, JSONObject> activities, String id, String type, String title,
                             String description, String status, Integer progress) {
        JSONObject activity = new JSONObject();
        activity.put("id", id);
        activity.put("type", type);
        activity.put("title", title);
        if (StringUtils.hasText(description)) {
            activity.put("description", description);
        }
        activity.put("status", status);
        if (progress != null) {
            activity.put("progress", progress);
        }
        activities.put(id, activity);
    }

    /**
     * 读取事件结果字段文本。
     *
     * @param event AgentEvent Agent事件
     * @param field String 字段名
     * @return String 字段文本
     */
    private String resultText(AgentEvent event, String field) {
        Object value = event.resultData() == null ? null : event.resultData().get(field);
        return value == null ? "" : String.valueOf(value);
    }

    /**
     * 将任务状态转换为执行活动状态。
     *
     * @param status String 任务状态
     * @return String 执行活动状态
     */
    private String activityStatus(String status) {
        return switch (status == null ? "" : status) {
            case "success" -> "success";
            case "failed" -> "failed";
            case "canceled" -> "canceled";
            case "skipped", "noop" -> "skipped";
            default -> "running";
        };
    }

    /**
     * 获取工具活动标题。
     *
     * @param toolName String 工具名称
     * @return String 活动标题
     */
    private String toolTitle(String toolName) {
        return switch (toolName == null ? "" : toolName) {
            case "generate_image" -> "调用图片生成工具";
            case "edit_image" -> "调用图片编辑工具";
            case "generate_video" -> "调用视频生成工具";
            case "edit_video" -> "调用视频编辑工具";
            case "query_history" -> "查询历史创作";
            default -> "调用工具：" + toolName;
        };
    }

    /**
     * 获取工具生成参数说明。
     *
     * @param arguments Map<String, Object> 工具参数
     * @return String 参数说明
     */
    private String toolDescription(Map<String, Object> arguments) {
        if (arguments == null || arguments.isEmpty()) {
            return "";
        }
        List<String> descriptions = new java.util.ArrayList<>();
        addDescription(descriptions, arguments.get("size"), "");
        addDescription(descriptions, arguments.get("resolution"), "");
        Object quality = arguments.get("quality");
        if (quality != null) {
            descriptions.add(switch (String.valueOf(quality)) {
                case "low" -> "低质量";
                case "medium" -> "标准质量";
                case "high" -> "高质量";
                default -> String.valueOf(quality);
            });
        }
        addDescription(descriptions, arguments.get("seconds"), " 秒");
        addDescription(descriptions, arguments.get("count"), " 个结果");
        return String.join(" / ", descriptions);
    }

    /**
     * 添加非空参数说明。
     *
     * @param descriptions List<String> 说明列表
     * @param value Object 参数值
     * @param suffix String 单位后缀
     */
    private void addDescription(List<String> descriptions, Object value, String suffix) {
        if (value != null && StringUtils.hasText(String.valueOf(value))) {
            descriptions.add(value + suffix);
        }
    }

    /**
     * 收集轮次及其结果关联的稳定ID。
     *
     * @param round JSONObject 生成轮次
     * @return Set<String> 关联ID集合
     */
    private Set<String> roundIds(JSONObject round) {
        Set<String> ids = new LinkedHashSet<>();
        addRoundId(ids, round.getString("id"));
        JSONArray results = round.getJSONArray("results");
        if (results != null) {
            for (int index = 0; index < results.size(); index++) {
                JSONObject result = results.getJSONObject(index);
                if (result != null) {
                    addRoundId(ids, result.getString("id"));
                }
            }
        }
        JSONObject result = round.getJSONObject("result");
        if (result != null) {
            addRoundId(ids, result.getString("id"));
        }
        return ids;
    }

    /**
     * 添加非空轮次关联ID。
     *
     * @param ids Set<String> ID集合
     * @param id String 待添加ID
     */
    private void addRoundId(Set<String> ids, String id) {
        if (StringUtils.hasText(id)) {
            ids.add(id);
        }
    }

    /**
     * 判断活动是否属于指定轮次。
     *
     * @param activity JSONObject 执行活动
     * @param roundIds Set<String> 轮次关联ID
     * @return boolean 是否相关
     */
    private boolean isRelatedActivity(JSONObject activity, Set<String> roundIds) {
        if ("plan-created".equals(activity.getString("type"))) {
            return true;
        }
        String activityId = activity.getString("id");
        return roundIds.stream().anyMatch(roundId -> activityId.equals("tool-" + roundId)
                || activityId.endsWith("-" + roundId));
    }

    /**
     * 计算轮次整体终态，用于防止取消等特殊路径残留执行中活动。
     *
     * @param round JSONObject 生成轮次
     * @return String success、failed、canceled或空字符串
     */
    private String terminalStatus(JSONObject round) {
        List<String> statuses = new java.util.ArrayList<>();
        JSONArray results = round.getJSONArray("results");
        if (results != null) {
            for (int index = 0; index < results.size(); index++) {
                JSONObject result = results.getJSONObject(index);
                if (result != null) {
                    statuses.add(result.getString("status"));
                }
            }
        }
        JSONObject result = round.getJSONObject("result");
        if (result != null) {
            statuses.add(result.getString("status"));
        }
        if (statuses.isEmpty() || statuses.stream().anyMatch(status -> "pending".equals(status) || "running".equals(status))) {
            return "";
        }
        if (statuses.stream().anyMatch("success"::equals)) {
            return "success";
        }
        if (statuses.stream().anyMatch("failed"::equals)) {
            return "failed";
        }
        return statuses.stream().anyMatch("canceled"::equals) ? "canceled" : "";
    }
}
