package com.novanovastudio.agent.workflow;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/** 视频技能工作流注册表。 */
@Component
public class VideoWorkflowRegistry {

    /** 技能系统提示词中的独立工作流标识行。 */
    private static final Pattern WORKFLOW_PATTERN = Pattern.compile("(?m)^\\s*workflow\\s*:\\s*([a-z0-9][a-z0-9-]*)\\s*$");
    /** 已注册工作流定义。 */
    private final Map<String, VideoWorkflowDefinition> definitions;

    /**
     * 创建工作流注册表。
     *
     * @param definitions List<VideoWorkflowDefinition> Spring收集到的工作流定义
     */
    public VideoWorkflowRegistry(List<VideoWorkflowDefinition> definitions) {
        this.definitions = definitions.stream().collect(java.util.stream.Collectors.toUnmodifiableMap(
                definition -> definition.workflowType().toLowerCase(Locale.ROOT), definition -> definition));
    }

    /**
     * 从技能系统提示词解析工作流类型。
     *
     * @param systemPrompt String 技能系统提示词
     * @return Optional<String> 工作流类型
     */
    public Optional<String> resolveWorkflowType(String systemPrompt) {
        if (systemPrompt == null || systemPrompt.isBlank()) return Optional.empty();
        Matcher matcher = WORKFLOW_PATTERN.matcher(systemPrompt);
        if (!matcher.find()) return Optional.empty();
        String workflowType = matcher.group(1).toLowerCase(Locale.ROOT);
        // 只有存在服务端定义的工作流才进入工作流编排；视频生成模式不是工作流类型。
        return definitions.containsKey(workflowType) ? Optional.of(workflowType) : Optional.empty();
    }

    /**
     * 判断工作流类型是否已注册。
     *
     * @param workflowType String 工作流类型
     * @return boolean 是否存在对应工作流定义
     */
    public boolean isRegistered(String workflowType) {
        return workflowType != null && definitions.containsKey(workflowType.toLowerCase(Locale.ROOT));
    }

    /**
     * 获取已注册的工作流定义，未知类型明确报错。
     *
     * @param workflowType String 工作流类型
     * @return VideoWorkflowDefinition 工作流定义
     */
    public VideoWorkflowDefinition require(String workflowType) {
        VideoWorkflowDefinition definition = definitions.get(workflowType == null ? "" : workflowType.toLowerCase(Locale.ROOT));
        if (definition == null) {
            throw new BusinessException(ErrorCode.BUSINESS_ERROR, "视频技能声明的工作流未注册：" + workflowType);
        }
        return definition;
    }
}
