package com.novanovastudio.agent.dto;

import java.util.List;
import java.util.Map;

/**
 * 主Agent规划的单个创作任务。
 *
 * @param taskId String 计划内唯一任务编号
 * @param taskType String 任务类型：image、video或canvas
 * @param action String 操作类型：generate、edit或tool
 * @param prompt String 该任务对应的用户原始提示词
 * @param sourcePromptId String 主Agent选择的服务端用户原文引用
 * @param dependsOn List<String> 前置任务编号
 * @param toolName String 画布入口使用的Java注册工具名
 * @param toolArguments Map<String, Object> 画布工具参数
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-23 00:00
 */
public record CreationTask(
        String taskId,
        String taskType,
        String action,
        String prompt,
        String sourcePromptId,
        List<String> dependsOn,
        String toolName,
        Map<String, Object> toolArguments
) {

    /**
     * 使用已经解析的用户原始提示词构造任务。
     *
     * @param taskId String 计划内唯一任务编号
     * @param taskType String 任务类型
     * @param action String 操作类型
     * @param prompt String 用户原始提示词
     * @param dependsOn List<String> 前置任务编号
     * @param toolName String 画布入口使用的Java注册工具名
     * @param toolArguments Map<String, Object> 画布工具参数
     */
    public CreationTask(String taskId, String taskType, String action, String prompt,
                        List<String> dependsOn, String toolName, Map<String, Object> toolArguments) {
        this(taskId, taskType, action, prompt, null, dependsOn, toolName, toolArguments);
    }
}
