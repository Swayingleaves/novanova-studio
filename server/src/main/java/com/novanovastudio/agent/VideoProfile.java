package com.novanovastudio.agent;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.agent.dto.AgentTool;
import com.novanovastudio.ai.AiTaskSources;
import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.service.AiTaskService;
import com.novanovastudio.service.PersistenceService;
import com.novanovastudio.service.PromptTemplateType;
import com.novanovastudio.service.SystemPromptTemplateService;
import java.util.List;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Component;

/**
 * 视频生成 Agent Loop Profile。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-07 14:00
 */
@Component
public class VideoProfile extends AbstractTaskProfile {

    /** 系统提示词模板服务 */
    private final SystemPromptTemplateService systemPromptTemplateService;

    /**
     * 创建视频生成 Profile。
     *
     * @param aiTaskService AiTaskService AI任务服务
     * @param persistenceService PersistenceService 生成记录持久化服务
     * @param systemPromptTemplateService SystemPromptTemplateService 系统提示词模板服务
     * @param executionRegistry AgentExecutionRegistry Agent 会话执行登记
     */
    public VideoProfile(@Lazy AiTaskService aiTaskService, PersistenceService persistenceService,
                        SystemPromptTemplateService systemPromptTemplateService, AgentExecutionRegistry executionRegistry) {
        super(aiTaskService, persistenceService, executionRegistry);
        this.systemPromptTemplateService = systemPromptTemplateService;
    }

    /**
     * 返回该 Profile 的名称标识，用于路由匹配。
     *
     * @return Profile 名称 "video"
     */
    @Override public String name() { return "video"; }
    /**
     * 返回该 Profile 支持的任务类型。
     *
     * @return 任务类型常量 {@link AiTaskTypes#VIDEO}
     */
    @Override protected String taskType() { return AiTaskTypes.VIDEO; }

    /**
     * 返回视频创作页的积分来源。
     *
     * @return String 视频创作页来源
     */
    @Override protected String generationSource() { return AiTaskSources.VIDEO_PAGE; }

    /**
     * 返回视频生成助手的系统提示词，定义 Agent 的行为规则和职责。
     *
     * @return 系统提示词字符串
     */
    @Override protected String systemPrompt() { return systemPromptTemplateService.get(PromptTemplateType.AGENT_VIDEO); }

    /**
     * 返回视频生成相关的可用工具列表，包括生成视频、编辑视频和查询历史。
     *
     * @return 工具列表，包含 generate_video、edit_video、query_history
     */
    @Override public List<AgentTool> tools() {
        return List.of(
            new AgentTool("generate_video",
                "根据文字描述生成视频。prompt 为用户输入的描述，所有参数（seconds、size、resolution、quality、model、watermark）均必须严格从用户设置中提取，不得自行修改。",
                JSON.parseObject("{\"type\":\"object\",\"properties\":{\"prompt\":{\"type\":\"string\"},\"seconds\":{\"type\":\"string\",\"description\":\"从用户设置的 [时长=X] 中提取 X，仅数字不含单位\"},\"size\":{\"type\":\"string\",\"description\":\"从用户设置的 [尺寸=X] 中提取\"},\"resolution\":{\"type\":\"string\",\"description\":\"从用户设置的 [分辨率=X] 中提取\"},\"quality\":{\"type\":\"string\",\"enum\":[\"low\",\"medium\",\"high\"],\"description\":\"视频质量等级，根据分辨率自动判断：≤480→low，720→medium，≥1080→high\"},\"model\":{\"type\":\"string\",\"description\":\"必须严格使用用户设置 [视频模型=X] 中的 X 值，不得自行选择\"},\"watermark\":{\"type\":\"boolean\",\"default\":false}},\"required\":[\"prompt\",\"model\"],\"additionalProperties\":false}"),
                false),
            new AgentTool("edit_video",
                "基于参考素材生成视频。reference_urls 为参考素材 URL；服务端在模型不支持视频参考编辑时会自动降级为按 prompt 重新生成。所有参数（model、size、resolution、seconds、quality、watermark）均必须严格从用户设置中提取，不得自行修改。",
                JSON.parseObject("{\"type\":\"object\",\"properties\":{\"prompt\":{\"type\":\"string\"},\"reference_urls\":{\"type\":\"array\",\"items\":{\"type\":\"string\"}},\"seconds\":{\"type\":\"string\",\"description\":\"从用户设置的 [时长=X] 中提取 X，仅数字不含单位\"},\"size\":{\"type\":\"string\",\"description\":\"从用户设置的 [尺寸=X] 中提取\"},\"resolution\":{\"type\":\"string\",\"description\":\"从用户设置的 [分辨率=X] 中提取\"},\"quality\":{\"type\":\"string\",\"enum\":[\"low\",\"medium\",\"high\"],\"description\":\"视频质量等级，根据分辨率自动判断：≤480→low，720→medium，≥1080→high\"},\"model\":{\"type\":\"string\",\"description\":\"必须严格使用用户设置 [视频模型=X] 中的 X 值，不得自行选择\"},\"watermark\":{\"type\":\"boolean\",\"default\":false}},\"required\":[\"prompt\",\"model\"],\"additionalProperties\":false}"),
                false),
            new AgentTool("query_history",
                "查询当前用户最近的生成任务记录。",
                JSON.parseObject("{\"type\":\"object\",\"properties\":{\"count\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":20,\"default\":5}},\"additionalProperties\":false}"),
                false)
        );
    }
}
