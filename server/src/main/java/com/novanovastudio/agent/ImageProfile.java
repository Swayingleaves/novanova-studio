package com.novanovastudio.agent;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.agent.dto.AgentTool;
import com.novanovastudio.ai.AiTaskSources;
import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.service.AiTaskService;
import com.novanovastudio.service.PersistenceService;
import com.novanovastudio.service.PromptTemplateType;
import com.novanovastudio.service.SystemPromptTemplateService;
import java.util.List;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Component;

/**
 * 图片生成 Agent Loop Profile。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-07 14:00
 */
@Component
public class ImageProfile extends AbstractTaskProfile {

    /** 系统提示词模板服务 */
    private final SystemPromptTemplateService systemPromptTemplateService;

    /**
     * 创建图片生成 Profile。
     *
     * @param aiTaskService AiTaskService AI任务服务
     * @param persistenceService PersistenceService 生成记录持久化服务
     * @param systemPromptTemplateService SystemPromptTemplateService 系统提示词模板服务
     * @param executionRegistry AgentExecutionRegistry Agent 会话执行登记
     * @param properties NovanovaProperties 服务配置
     */
    public ImageProfile(@Lazy AiTaskService aiTaskService, PersistenceService persistenceService,
                        SystemPromptTemplateService systemPromptTemplateService, AgentExecutionRegistry executionRegistry,
                        NovanovaProperties properties) {
        super(aiTaskService, persistenceService, executionRegistry, properties);
        this.systemPromptTemplateService = systemPromptTemplateService;
    }

    /**
     * 返回该 Profile 的名称标识，用于路由匹配。
     *
     * @return Profile 名称 "generation"
     */
    @Override public String name() { return "generation"; }
    /**
     * 返回该 Profile 支持的任务类型。
     *
     * @return 任务类型常量 {@link AiTaskTypes#IMAGE}
     */
    @Override protected String taskType() { return AiTaskTypes.IMAGE; }

    /**
     * 返回图片创作页的积分来源。
     *
     * @return String 图片创作页来源
     */
    @Override protected String generationSource() { return AiTaskSources.IMAGE_PAGE; }

    /**
     * 返回图片生成助手的系统提示词，定义 Agent 的行为规则和职责。
     *
     * @return 系统提示词字符串
     */
    @Override protected String systemPrompt() { return systemPromptTemplateService.get(PromptTemplateType.AGENT_IMAGE); }

    /**
     * 返回图片生成相关的可用工具列表，包括生成图片、编辑图片和查询历史。
     *
     * @return 工具列表，包含 generate_image、edit_image、query_history
     */
    @Override public List<AgentTool> tools() {
        return List.of(
            new AgentTool("generate_image",
                "根据文字描述生成图片。prompt 必须使用用户本轮输入框原文，不得扩写或改写；size 为图片尺寸，resolution 为图片清晰度，model 为生图模型名，均从用户设置中获取。",
                JSON.parseObject("{\"type\":\"object\",\"properties\":{\"prompt\":{\"type\":\"string\"},\"size\":{\"type\":\"string\"},\"resolution\":{\"type\":\"string\",\"enum\":[\"1K\",\"2K\",\"4K\"]},\"quality\":{\"type\":\"string\",\"enum\":[\"low\",\"medium\",\"high\"]},\"model\":{\"type\":\"string\"},\"count\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":10,\"default\":1}},\"required\":[\"prompt\",\"size\",\"resolution\",\"model\"],\"additionalProperties\":false}"),
                false),
            new AgentTool("edit_image",
                "基于已有图片进行编辑或生成变体。prompt 必须使用用户本轮输入框原文，不得扩写或改写；resolution 必须使用用户设置中的图片清晰度；未传参考图时服务端自动使用最近一张历史图片。",
                JSON.parseObject("{\"type\":\"object\",\"properties\":{\"prompt\":{\"type\":\"string\"},\"size\":{\"type\":\"string\"},\"resolution\":{\"type\":\"string\",\"enum\":[\"1K\",\"2K\",\"4K\"]},\"quality\":{\"type\":\"string\",\"enum\":[\"low\",\"medium\",\"high\"]},\"model\":{\"type\":\"string\"}},\"required\":[\"prompt\",\"resolution\"],\"additionalProperties\":false}"),
                false),
            new AgentTool("query_history",
                "查询当前用户最近的生成任务记录。",
                JSON.parseObject("{\"type\":\"object\",\"properties\":{\"count\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":20,\"default\":5}},\"additionalProperties\":false}"),
                false)
        );
    }
}
