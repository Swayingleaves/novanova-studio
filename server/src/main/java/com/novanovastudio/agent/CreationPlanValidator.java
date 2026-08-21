package com.novanovastudio.agent;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.agent.dto.CreationPlan;
import com.novanovastudio.agent.dto.CreationSettings;
import com.novanovastudio.agent.dto.CreationTask;
import com.novanovastudio.agent.dto.AgentTool;
import com.novanovastudio.ai.VideoGenerationMode;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.GenerationStyleDtos;
import com.novanovastudio.service.GenerationStyleService;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * 主Agent计划的确定性校验器。模型只能提供候选计划，不能绕过页面能力和参数约束。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-23 00:00
 */
@Component
@RequiredArgsConstructor
public class CreationPlanValidator {

    /** Java固定注册的画布工具 */
    private final AgentToolRegistry toolRegistry;

    /**
     * 校验计划并返回使用请求硬约束替换后的计划。
     *
     * @param plan CreationPlan 主Agent计划
     * @param entrySource String 当前入口来源
     * @param settings CreationSettings 页面硬约束
     * @return CreationPlan 校验后的计划
     * @throws BusinessException 计划越权、格式错误或存在循环依赖时抛出
     */
    public CreationPlan validate(CreationPlan plan, String entrySource, CreationSettings settings) {
        if (plan == null) {
            throw invalid("主Agent未返回创作计划");
        }
        if (!CreationEntrySource.supported(entrySource) || !entrySource.equals(plan.entrySource())) {
            throw invalid("Agent计划入口来源与当前页面不一致");
        }
        if (settings != null) {
            boolean hasStyleIds = settings.generationStyleIds() != null && !settings.generationStyleIds().isEmpty();
            boolean hasStyleIdsByType = settings.generationStyleIdsByType() != null
                    && settings.generationStyleIdsByType().values().stream()
                    .anyMatch(ids -> ids != null && !ids.isEmpty());
            boolean hasStyleIdsByTypeField = settings.generationStyleIdsByType() != null;
            boolean hasStyleSnapshots = settings.generationStyleSnapshots() != null
                    && !settings.generationStyleSnapshots().isEmpty();
            if (hasStyleIds && hasStyleIdsByTypeField) {
                throw invalid("普通生成风格ID和按类型风格ID不能同时提交");
            }
            if ((hasStyleIds || hasStyleIdsByType) && hasStyleSnapshots) {
                throw invalid("生成风格ID和历史风格快照不能同时提交");
            }
            validateGenerationStyles(settings, hasStyleSnapshots);
        }
        List<CreationTask> tasks = plan.tasks() == null ? List.of() : plan.tasks();
        if (isGenerationPage(entrySource) && tasks.size() > 1) {
            return canvasGuidancePlan(plan, entrySource, settings);
        }
        if (CreationEntrySource.IMAGE_PAGE.equals(entrySource) && settings != null
                && settings.count() != null && settings.count() > 1) {
            return canvasGuidancePlan(plan, entrySource, settings);
        }
        if (Boolean.TRUE.equals(plan.canvasGuidance())) {
            if (!isGenerationPage(entrySource)) {
                throw invalid("只有图片或视频页面允许引导用户前往画布");
            }
            return canvasGuidancePlan(plan, entrySource, settings);
        }
        if (StringUtils.hasText(plan.clarificationQuestion())) {
            return new CreationPlan(plan.planId(), plan.intent(), entrySource, plan.summary(), plan.clarificationQuestion(), false, settings, List.of());
        }
        if (tasks.isEmpty()) {
            throw invalid("Agent计划任务数量不合法");
        }
        if (tasks.size() > 8) {
            throw invalid("Agent计划任务数量不合法");
        }
        Set<String> taskIds = new HashSet<>();
        List<String> missingCanvasArguments = new ArrayList<>();
        for (CreationTask task : tasks) {
            if (task == null || !StringUtils.hasText(task.taskId()) || !taskIds.add(task.taskId())) {
                throw invalid("Agent计划包含重复或空任务编号");
            }
            if (!allowedTaskType(entrySource, task.taskType())) {
                throw invalid("当前页面不允许执行该类型的生成任务");
            }
            if (!StringUtils.hasText(task.prompt()) && !StringUtils.hasText(task.sourcePromptId())) {
                throw invalid("Agent计划任务缺少提示词");
            }
            if (CreationEntrySource.CANVAS.equals(entrySource)) {
                missingCanvasArguments.addAll(validateCanvasTask(task));
            } else {
                validateGenerationPageTask(task);
            }
        }
        if (!missingCanvasArguments.isEmpty()) {
            String question = "请补充画布操作所需参数：" + String.join("、", missingCanvasArguments) + "。";
            return new CreationPlan(plan.planId(), plan.intent(), entrySource, plan.summary(), question, false, settings, List.of());
        }
        String missingQuestion = missingSettingsQuestion(entrySource, tasks, settings);
        if (StringUtils.hasText(missingQuestion)) {
            return new CreationPlan(plan.planId(), plan.intent(), entrySource, plan.summary(), missingQuestion, false, settings, List.of());
        }
        for (CreationTask task : tasks) {
            List<String> dependencies = task.dependsOn() == null ? List.of() : task.dependsOn();
            if (dependencies.stream().anyMatch(dependency -> !taskIds.contains(dependency) || dependency.equals(task.taskId()))) {
                throw invalid("Agent计划包含越权依赖");
            }
        }
        detectCycle(tasks);
        return new CreationPlan(plan.planId(), plan.intent(), entrySource, plan.summary(), "", false, settings, tasks);
    }

    /**
     * 校验计划设置中的风格数量、重复值和快照结构，防止画布分组绕过统一上限。
     *
     * @param settings CreationSettings 页面生成设置
     * @param hasStyleSnapshots boolean 是否包含历史风格快照
     * @throws BusinessException 风格参数越权或格式错误时抛出
     */
    private void validateGenerationStyles(CreationSettings settings, boolean hasStyleSnapshots) {
        if (settings.generationStyleIdsByType() != null) {
            Map<String, List<Long>> idsByType = settings.generationStyleIdsByType();
            if (idsByType.keySet().stream().anyMatch(type -> type == null || !Set.of("image", "video").contains(type))) {
                throw invalid("按类型风格只支持image或video");
            }
            List<Long> ids = idsByType.values().stream()
                    .filter(Objects::nonNull)
                    .flatMap(List::stream)
                    .toList();
            if (!ids.isEmpty()) validateStyleIds(ids);
        } else if (settings.generationStyleIds() != null && !settings.generationStyleIds().isEmpty()) {
            validateStyleIds(settings.generationStyleIds());
        }
        if (hasStyleSnapshots) {
            List<GenerationStyleDtos.GenerationStyleSnapshot> snapshots = settings.generationStyleSnapshots();
            if (snapshots.size() > GenerationStyleService.MAX_HISTORY_STYLE_SNAPSHOT_COUNT) {
                throw invalid("最多保留3个风格快照");
            }
            Set<Long> ids = new HashSet<>();
            for (var snapshot : snapshots) {
                if (snapshot == null || snapshot.id() == null || snapshot.id() <= 0
                        || !ids.add(snapshot.id())
                        || !StringUtils.hasText(snapshot.name())
                        || !StringUtils.hasText(snapshot.stylePrompt())
                        || snapshot.generationType() == null || !Set.of("image", "video").contains(snapshot.generationType())) {
                    throw invalid("风格快照格式不合法");
                }
            }
        }
    }

    /** 校验一组风格ID的数量、非空和重复约束。 */
    private void validateStyleIds(List<Long> ids) {
        if (ids.size() > GenerationStyleService.MAX_SELECTED_STYLE_COUNT) {
            throw invalid("最多选择1个风格");
        }
        if (ids.stream().anyMatch(Objects::isNull) || ids.stream().anyMatch(id -> id <= 0)) {
            throw invalid("风格ID不合法");
        }
        if (ids.stream().distinct().count() != ids.size()) {
            throw invalid("风格不能重复选择");
        }
    }

    /**
     * 创建批量生成引导计划，确保该分支不会进入计划持久化和任务执行流程。
     *
     * @param plan CreationPlan 主Agent候选计划
     * @param entrySource String 当前入口来源
     * @param settings CreationSettings 页面生成设置
     * @return CreationPlan 空任务的画布引导计划
     */
    private CreationPlan canvasGuidancePlan(CreationPlan plan, String entrySource, CreationSettings settings) {
        String message = CreationEntrySource.IMAGE_PAGE.equals(entrySource)
                ? "图片生成页面每次只能生成 1 张图片。需要批量生成多个画面时，请前往画布操作。"
                : "视频生成页面每次只能生成 1 个视频。需要批量生成多个视频时，请前往画布操作。";
        return new CreationPlan(plan.planId(), plan.intent(), entrySource, plan.summary(), message, true, settings, List.of());
    }

    /**
     * 判断入口是否为独立图片或视频生成页面。
     *
     * @param entrySource String 当前入口来源
     * @return boolean 是否为生成页面
     */
    private boolean isGenerationPage(String entrySource) {
        return CreationEntrySource.IMAGE_PAGE.equals(entrySource) || CreationEntrySource.VIDEO_PAGE.equals(entrySource);
    }

    /**
     * 检查任务所需的页面硬约束是否完整。
     *
     * @param entrySource String 当前入口来源
     * @param tasks List<CreationTask> 计划任务
     * @param settings CreationSettings 页面设置
     * @return String 缺失参数询问文本，完整时返回空字符串
     */
    private String missingSettingsQuestion(String entrySource, List<CreationTask> tasks, CreationSettings settings) {
        boolean hasImageTask = tasks.stream().anyMatch(task -> "image".equals(task.taskType()));
        boolean hasVideoTask = tasks.stream().anyMatch(this::isVideoGenerationTask);
        if ((hasImageTask || hasVideoTask) && (settings == null || !StringUtils.hasText(settings.model()))) {
            return "请选择生成模型后再继续。";
        }
        if (hasVideoTask && settings != null && settings.videoGenerationMode() != null
                && !settings.videoGenerationMode().isBlank()
                && !VideoGenerationMode.isSupported(settings.videoGenerationMode())) {
            throw invalid("视频生成模式不受支持");
        }
        if (CreationEntrySource.CANVAS.equals(entrySource)) {
            if (hasVideoTask && (settings == null || !StringUtils.hasText(settings.videoModel()))) {
                return "请选择视频生成模型后再继续。";
            }
            return "";
        }
        if (hasImageTask) {
            if (settings.count() != null && settings.count() < 1) {
                throw invalid("图片生成数量必须为1");
            }
            if (!StringUtils.hasText(settings.size()) || !StringUtils.hasText(settings.resolution())
                    || !StringUtils.hasText(settings.quality()) || settings.count() == null || settings.count() < 1) {
                return "请补充图片尺寸、清晰度、质量和生成数量后再继续。";
            }
        }
        if (hasVideoTask) {
            if (!StringUtils.hasText(settings.size()) || !StringUtils.hasText(settings.resolution())
                    || !StringUtils.hasText(settings.quality()) || !StringUtils.hasText(settings.seconds())
                    || settings.watermark() == null) {
                return "请补充视频尺寸、分辨率、质量、时长和水印设置后再继续。";
            }
        }
        return "";
    }

    /**
     * 判断任务是否会实际创建视频生成任务。
     *
     * @param task CreationTask 待校验任务
     * @return boolean 是否为视频生成任务
     */
    private boolean isVideoGenerationTask(CreationTask task) {
        if (task == null) return false;
        if ("video".equals(task.taskType()) || "canvas_generate_video".equals(task.toolName())) return true;
        Object mode = task.toolArguments() == null ? null : task.toolArguments().get("mode");
        return "video".equals(mode);
    }

    /**
     * 判断入口是否允许指定任务类型。
     *
     * @param entrySource String 入口来源
     * @param taskType String 任务类型
     * @return boolean 是否允许
     */
    private boolean allowedTaskType(String entrySource, String taskType) {
        return switch (entrySource) {
            case CreationEntrySource.IMAGE_PAGE -> "image".equals(taskType);
            case CreationEntrySource.VIDEO_PAGE -> "video".equals(taskType);
            case CreationEntrySource.CANVAS -> Set.of("image", "video", "canvas").contains(taskType);
            default -> false;
        };
    }

    /**
     * 校验独立图片或视频页面任务，确保模型不能注入画布工具。
     *
     * @param task CreationTask 计划任务
     * @throws BusinessException 任务动作或工具字段越权时抛出
     */
    private void validateGenerationPageTask(CreationTask task) {
        if (!("generate".equals(task.action()) || "edit".equals(task.action()))) {
            throw invalid("Agent计划包含不支持的生成任务动作");
        }
        if (StringUtils.hasText(task.toolName()) || (task.toolArguments() != null && !task.toolArguments().isEmpty())) {
            throw invalid("图片或视频页面不允许调用画布工具");
        }
    }

    /**
     * 校验画布任务的固定工具权限、任务类型和参数Schema。
     *
     * @param task CreationTask 画布计划任务
     * @return List<String> 缺少的必填参数名称
     * @throws BusinessException 工具越权或参数格式不合法时抛出
     */
    private List<String> validateCanvasTask(CreationTask task) {
        if (!StringUtils.hasText(task.toolName())) {
            throw invalid("画布任务缺少Java注册工具名");
        }
        AgentTool tool = toolRegistry.allTools().stream()
                .filter(candidate -> task.toolName().equals(candidate.name()))
                .findFirst()
                .orElseThrow(() -> invalid("画布任务试图调用未注册工具"));
        if (!tool.frontend()) {
            throw invalid("主Agent不能重复调用画布只读工具");
        }
        Map<String, Object> arguments = task.toolArguments() == null ? Map.of() : task.toolArguments();
        if ("canvas_apply_ops".equals(task.toolName()) && containsGenerationOperation(arguments.get("ops"))) {
            throw invalid("canvas_apply_ops不能执行生成，请使用专用生成工具");
        }
        List<String> missing = new ArrayList<>(missingRequiredArguments(tool.parameters(), arguments));
        if ("canvas_create_generation_flow".equals(task.toolName())
                && "image".equals(arguments.get("mode"))
                && Boolean.TRUE.equals(arguments.get("autoRun"))
                && !StringUtils.hasText(String.valueOf(arguments.getOrDefault("size", "")))) {
            missing.add("size");
        }
        validateSchemaValue("toolArguments", arguments, tool.parameters(), true);
        if (!missing.isEmpty()) {
            return missing;
        }
        String generationType = canvasGenerationType(task.toolName(), task.toolArguments());
        if (StringUtils.hasText(generationType)) {
            if (!generationType.equals(task.taskType()) || !"generate".equals(task.action())) {
                throw invalid("画布生成工具与固定子Agent类型不匹配");
            }
        } else if (!("canvas".equals(task.taskType()) && "tool".equals(task.action()))) {
            throw invalid("普通画布工具必须使用canvas任务类型和tool动作");
        }
        return List.of();
    }

    /**
     * 判断批量画布操作中是否夹带生成操作。
     *
     * @param operations Object 画布操作列表
     * @return boolean 是否包含run_generation
     */
    private boolean containsGenerationOperation(Object operations) {
        if (!(operations instanceof List<?> values)) return false;
        return values.stream().anyMatch(value -> {
            if (value instanceof Map<?, ?> operation) return "run_generation".equals(operation.get("type"));
            JSONObject operation = value == null ? null : JSON.parseObject(JSON.toJSONString(value));
            return operation != null && "run_generation".equals(operation.getString("type"));
        });
    }

    /**
     * 判断画布工具是否需要固定图片或视频子Agent。
     *
     * @param toolName String 画布工具名
     * @param arguments Map<String, Object> 工具参数
     * @return String image、video或空字符串
     */
    private String canvasGenerationType(String toolName, Map<String, Object> arguments) {
        return switch (toolName) {
            case "canvas_generate_image" -> "image";
            case "canvas_generate_video" -> "video";
            case "canvas_create_generation_flow" -> {
                Object mode = arguments == null ? null : arguments.get("mode");
                yield "image".equals(mode) || "video".equals(mode) ? String.valueOf(mode) : "";
            }
            default -> "";
        };
    }

    /**
     * 收集工具Schema声明但模型未提供的必填参数。
     *
     * @param schema JSONObject 工具参数Schema
     * @param arguments Map<String, Object> 工具参数
     * @return List<String> 缺少参数名称
     */
    private List<String> missingRequiredArguments(JSONObject schema, Map<String, Object> arguments) {
        JSONArray required = schema == null ? null : schema.getJSONArray("required");
        if (required == null || required.isEmpty()) {
            return List.of();
        }
        return required.stream().map(String::valueOf)
                .filter(name -> !arguments.containsKey(name) || arguments.get(name) == null
                        || arguments.get(name) instanceof String text && !StringUtils.hasText(text))
                .toList();
    }

    /**
     * 按Java注册的JSON Schema递归校验工具参数。
     *
     * @param path String 当前参数路径
     * @param value Object 参数值
     * @param schema JSONObject 参数Schema
     * @param ignoreMissingRequired boolean 是否将缺少必填参数留给主Agent补参流程
     * @throws BusinessException 参数类型、枚举、范围或额外字段不合法时抛出
     */
    private void validateSchemaValue(String path, Object value, JSONObject schema, boolean ignoreMissingRequired) {
        if (schema == null || schema.isEmpty()) {
            return;
        }
        String type = schema.getString("type");
        if ("object".equals(type)) {
            if (!(value instanceof Map<?, ?> objectValue)) {
                throw invalid(path + "必须是对象");
            }
            JSONObject properties = schema.getJSONObject("properties");
            if (Boolean.FALSE.equals(schema.getBoolean("additionalProperties")) && properties != null) {
                for (Object key : objectValue.keySet()) {
                    if (!properties.containsKey(String.valueOf(key))) {
                        throw invalid(path + "包含未注册参数: " + key);
                    }
                }
            }
            JSONArray required = schema.getJSONArray("required");
            if (!ignoreMissingRequired && required != null) {
                for (Object requiredName : required) {
                    Object requiredValue = objectValue.get(String.valueOf(requiredName));
                    if (!objectValue.containsKey(String.valueOf(requiredName)) || requiredValue == null
                            || requiredValue instanceof String text && !StringUtils.hasText(text)) {
                        throw invalid(path + "缺少必填参数: " + requiredName);
                    }
                }
            }
            if (properties != null) {
                for (Map.Entry<?, ?> entry : objectValue.entrySet()) {
                    JSONObject propertySchema = properties.getJSONObject(String.valueOf(entry.getKey()));
                    if (propertySchema != null && entry.getValue() != null) {
                        validateSchemaValue(path + "." + entry.getKey(), entry.getValue(), propertySchema, false);
                    }
                }
            }
        } else if ("array".equals(type)) {
            if (!(value instanceof List<?> values)) {
                throw invalid(path + "必须是数组");
            }
            JSONObject itemSchema = schema.getJSONObject("items");
            for (int index = 0; itemSchema != null && index < values.size(); index++) {
                validateSchemaValue(path + "[" + index + "]", values.get(index), itemSchema, false);
            }
        } else if ("string".equals(type) && !(value instanceof String)) {
            throw invalid(path + "必须是字符串");
        } else if ("boolean".equals(type) && !(value instanceof Boolean)) {
            throw invalid(path + "必须是布尔值");
        } else if ("number".equals(type) && !(value instanceof Number)) {
            throw invalid(path + "必须是数字");
        } else if ("integer".equals(type) && !isInteger(value)) {
            throw invalid(path + "必须是整数");
        }
        validateEnumAndRange(path, value, schema);
    }

    /**
     * 校验Schema中的枚举和数值范围。
     *
     * @param path String 当前参数路径
     * @param value Object 参数值
     * @param schema JSONObject 参数Schema
     * @throws BusinessException 参数不在枚举或数值范围内时抛出
     */
    private void validateEnumAndRange(String path, Object value, JSONObject schema) {
        JSONArray allowedValues = schema.getJSONArray("enum");
        if (allowedValues != null && !allowedValues.contains(value)) {
            throw invalid(path + "不在允许值范围内");
        }
        if (!(value instanceof Number number)) {
            return;
        }
        BigDecimal actual = new BigDecimal(number.toString());
        BigDecimal minimum = schema.getBigDecimal("minimum");
        BigDecimal maximum = schema.getBigDecimal("maximum");
        if (minimum != null && actual.compareTo(minimum) < 0) {
            throw invalid(path + "小于允许的最小值");
        }
        if (maximum != null && actual.compareTo(maximum) > 0) {
            throw invalid(path + "大于允许的最大值");
        }
    }

    /**
     * 判断参数是否为没有小数部分的整数。
     *
     * @param value Object 参数值
     * @return boolean 是否为整数
     */
    private boolean isInteger(Object value) {
        if (!(value instanceof Number number)) {
            return false;
        }
        return new BigDecimal(number.toString()).stripTrailingZeros().scale() <= 0;
    }

    /**
     * 使用深度优先遍历拒绝循环依赖。
     *
     * @param tasks List<CreationTask> 计划任务
     * @throws BusinessException 检测到循环依赖时抛出
     */
    private void detectCycle(List<CreationTask> tasks) {
        Map<String, CreationTask> taskMap = tasks.stream().collect(java.util.stream.Collectors.toMap(CreationTask::taskId, task -> task));
        Set<String> visiting = new HashSet<>();
        Set<String> visited = new HashSet<>();
        for (CreationTask task : tasks) {
            visit(task.taskId(), taskMap, visiting, visited);
        }
    }

    /**
     * 递归检查单个任务的依赖链。
     *
     * @param taskId String 当前任务编号
     * @param taskMap Map<String, CreationTask> 任务索引
     * @param visiting Set<String> 当前递归路径
     * @param visited Set<String> 已完成节点
     * @throws BusinessException 检测到循环依赖时抛出
     */
    private void visit(String taskId, Map<String, CreationTask> taskMap, Set<String> visiting, Set<String> visited) {
        if (visited.contains(taskId)) {
            return;
        }
        if (!visiting.add(taskId)) {
            throw invalid("Agent计划存在循环依赖");
        }
        for (String dependency : taskMap.get(taskId).dependsOn() == null ? List.<String>of() : taskMap.get(taskId).dependsOn()) {
            visit(dependency, taskMap, visiting, visited);
        }
        visiting.remove(taskId);
        visited.add(taskId);
    }

    /**
     * 创建统一的计划参数异常。
     *
     * @param message String 异常消息
     * @return BusinessException 业务异常
     */
    private BusinessException invalid(String message) {
        return new BusinessException(ErrorCode.PARAM_INVALID, message);
    }
}
