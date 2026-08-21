/**
 * @title        AgentToolRegistry.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  Agent 工具注册表，管理工具定义和执行策略
 * @createTime   2026-06-27 10:00:00
 */
package com.novanovastudio.agent;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.agent.dto.AgentTool;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * Agent 工具注册表，统一管理画布读操作、画布写操作和内容生成工具定义，
 * 区分后端执行工具和需要 SSE 转发到前端执行的工具。
 */
@Component
public class AgentToolRegistry {

    /** 工具名 → 工具定义，按注册顺序保留 */
    private final Map<String, AgentTool> tools = new LinkedHashMap<>();

    /** 前端工具名集合（需要 SSE 转发到前端执行） */
    private final Set<String> frontendTools = new HashSet<>();

    public AgentToolRegistry() {
        registerReadTools();
        registerFrontendTools();
        registerGenerationTools();
    }

    /**
     * 获取所有工具定义（用于 AI API 的 tools 参数）
     *
     * @return List<JSONObject> 工具定义列表
     */
    public List<JSONObject> toFunctionTools() {
        List<JSONObject> result = new ArrayList<>();
        for (AgentTool tool : tools.values()) {
            JSONObject func = new JSONObject();
            func.put("type", "function");
            JSONObject funcObj = new JSONObject();
            funcObj.put("name", tool.name());
            funcObj.put("description", tool.description());
            funcObj.put("parameters", tool.parameters());
            func.put("function", funcObj);
            result.add(func);
        }
        return result;
    }

    /**
     * 获取所有工具定义（Anthropic Messages API 格式）
     * <p>
     * Anthropic工具定义格式为 {name, description, input_schema}，
     * 与OpenAI的 {type:"function", function:{name,description,parameters}} 不同。
     *
     * @return List<JSONObject> Anthropic工具定义列表
     */
    public List<JSONObject> toAnthropicTools() {
        List<JSONObject> result = new ArrayList<>();
        for (AgentTool tool : tools.values()) {
            JSONObject t = new JSONObject();
            t.put("name", tool.name());
            t.put("description", tool.description());
            t.put("input_schema", tool.parameters());
            result.add(t);
        }
        return result;
    }

    /**
     * 判断工具是否需要前端执行
     *
     * @param toolName String 工具名
     * @return boolean 是否前端工具
     */
    public boolean isFrontend(String toolName) {
        return frontendTools.contains(toolName);
    }

    /**
     * 获取所有已注册工具
     *
     * @return List<AgentTool> 工具列表
     */
    public List<AgentTool> allTools() {
        return new ArrayList<>(tools.values());
    }

    // ===== 读操作工具（后端直接读快照） =====

    private void registerReadTools() {
        register(new AgentTool("canvas_get_state",
            "读取当前网页画布的节点、连线、选区和视口。",
            JSONObject.parseObject("{\"type\":\"object\",\"properties\":{},\"additionalProperties\":false}"),
            false));
        register(new AgentTool("canvas_get_selection",
            "读取当前网页画布选中的节点。",
            JSONObject.parseObject("{\"type\":\"object\",\"properties\":{},\"additionalProperties\":false}"),
            false));
        register(new AgentTool("canvas_export_snapshot",
            "导出当前画布快照，用于理解布局。",
            JSONObject.parseObject("{\"type\":\"object\",\"properties\":{},\"additionalProperties\":false}"),
            false));
    }

    // ===== 前端工具（画布操作，SSE 转发到前端执行） =====

    private void registerFrontendTools() {
        register(new AgentTool("canvas_create_node",
            "创建任意类型节点：text、image、video。",
            JSONObject.parseObject("{\"type\":\"object\",\"properties\":{\"nodeType\":{\"type\":\"string\",\"enum\":[\"text\",\"image\",\"video\"]},\"title\":{\"type\":\"string\"},\"x\":{\"type\":\"number\"},\"y\":{\"type\":\"number\"},\"width\":{\"type\":\"number\"},\"height\":{\"type\":\"number\"},\"metadata\":{\"type\":\"object\",\"additionalProperties\":true}},\"additionalProperties\":false}"),
            true));
        register(new AgentTool("canvas_create_text_node",
            "在当前画布创建单个文本节点。",
            JSONObject.parseObject("{\"type\":\"object\",\"properties\":{\"text\":{\"type\":\"string\"},\"x\":{\"type\":\"number\"},\"y\":{\"type\":\"number\"},\"title\":{\"type\":\"string\"},\"width\":{\"type\":\"number\"},\"height\":{\"type\":\"number\"}},\"additionalProperties\":false}"),
            true));
        register(new AgentTool("canvas_create_text_nodes",
            "批量创建文本节点，适合生成标题、段落、脚本等内容块。",
            JSONObject.parseObject("{\"type\":\"object\",\"properties\":{\"items\":{\"type\":\"array\",\"items\":{\"type\":\"object\",\"properties\":{\"text\":{\"type\":\"string\"},\"title\":{\"type\":\"string\"},\"width\":{\"type\":\"number\"},\"height\":{\"type\":\"number\"}}}},\"x\":{\"type\":\"number\"},\"y\":{\"type\":\"number\"},\"gap\":{\"type\":\"number\"},\"direction\":{\"type\":\"string\",\"enum\":[\"row\",\"column\"]}},\"additionalProperties\":false}"),
            true));
        register(new AgentTool("canvas_create_image_prompt_flow",
            "创建提示词文本节点并自动连线。",
            JSONObject.parseObject("{\"type\":\"object\",\"properties\":{\"prompt\":{\"type\":\"string\"},\"x\":{\"type\":\"number\"},\"y\":{\"type\":\"number\"},\"autoRun\":{\"type\":\"boolean\"}},\"additionalProperties\":false}"),
            true));
        register(new AgentTool("canvas_create_generation_flow",
            "创建文本、图片或视频生成配置节点；autoRun为true时立即开始生成。",
            JSONObject.parseObject("{\"type\":\"object\",\"properties\":{\"prompt\":{\"type\":\"string\"},\"mode\":{\"type\":\"string\",\"enum\":[\"text\",\"image\",\"video\"]},\"title\":{\"type\":\"string\"},\"x\":{\"type\":\"number\"},\"y\":{\"type\":\"number\"},\"size\":{\"type\":\"string\"},\"quality\":{\"type\":\"string\"},\"imageResolution\":{\"type\":\"string\"},\"count\":{\"type\":\"number\"},\"seconds\":{\"type\":\"string\"},\"vquality\":{\"type\":\"string\"},\"model\":{\"type\":\"string\",\"description\":\"必须严格使用用户设置 [视频模型=X] 中的 X 值，不得自行选择\"},\"videoGenerationMode\":{\"type\":\"string\",\"enum\":[\"text-to-video\",\"image-to-video\",\"reference-to-video\"],\"description\":\"必须严格使用用户设置中的视频生成模式\"},\"watermark\":{\"type\":\"boolean\",\"description\":\"必须严格使用用户设置中的水印设置\"},\"autoRun\":{\"type\":\"boolean\"}},\"required\":[\"prompt\",\"mode\"],\"additionalProperties\":false}"),
            true));
        register(new AgentTool("canvas_update_node",
            "更新节点基础字段或 metadata。",
            JSONObject.parseObject("{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"string\"},\"patch\":{\"type\":\"object\",\"additionalProperties\":true},\"metadata\":{\"type\":\"object\",\"additionalProperties\":true}},\"required\":[\"id\"],\"additionalProperties\":false}"),
            true));
        register(new AgentTool("canvas_update_node_text",
            "更新文本节点内容和标题。",
            JSONObject.parseObject("{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"string\"},\"text\":{\"type\":\"string\"},\"title\":{\"type\":\"string\"}},\"required\":[\"id\",\"text\"],\"additionalProperties\":false}"),
            true));
        register(new AgentTool("canvas_move_nodes",
            "移动一个或多个节点，支持绝对坐标或 dx/dy 偏移。",
            JSONObject.parseObject("{\"type\":\"object\",\"properties\":{\"items\":{\"type\":\"array\",\"items\":{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"string\"},\"x\":{\"type\":\"number\"},\"y\":{\"type\":\"number\"},\"dx\":{\"type\":\"number\"},\"dy\":{\"type\":\"number\"}}}}},\"additionalProperties\":false}"),
            true));
        register(new AgentTool("canvas_resize_node",
            "调整节点尺寸。",
            JSONObject.parseObject("{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"string\"},\"width\":{\"type\":\"number\"},\"height\":{\"type\":\"number\"},\"freeResize\":{\"type\":\"boolean\"}},\"required\":[\"id\"],\"additionalProperties\":false}"),
            true));
        register(new AgentTool("canvas_delete_nodes",
            "删除指定节点及相关连线。",
            JSONObject.parseObject("{\"type\":\"object\",\"properties\":{\"ids\":{\"type\":\"array\",\"items\":{\"type\":\"string\"}}},\"additionalProperties\":false}"),
            true));
        register(new AgentTool("canvas_connect_nodes",
            "批量连接节点。",
            JSONObject.parseObject("{\"type\":\"object\",\"properties\":{\"connections\":{\"type\":\"array\",\"items\":{\"type\":\"object\",\"properties\":{\"fromNodeId\":{\"type\":\"string\"},\"toNodeId\":{\"type\":\"string\"}}}}},\"additionalProperties\":false}"),
            true));
        register(new AgentTool("canvas_select_nodes",
            "设置当前选中节点。",
            JSONObject.parseObject("{\"type\":\"object\",\"properties\":{\"ids\":{\"type\":\"array\",\"items\":{\"type\":\"string\"}}},\"additionalProperties\":false}"),
            true));
        register(new AgentTool("canvas_set_viewport",
            "调整画布视口。",
            JSONObject.parseObject("{\"type\":\"object\",\"properties\":{\"viewport\":{\"type\":\"object\",\"properties\":{\"x\":{\"type\":\"number\"},\"y\":{\"type\":\"number\"},\"k\":{\"type\":\"number\"}},\"required\":[\"x\",\"y\",\"k\"],\"additionalProperties\":false}},\"additionalProperties\":false}"),
            true));
        register(new AgentTool("canvas_apply_ops",
            "批量操作画布。ops 只支持 add_node、update_node、delete_node、delete_connections、connect_nodes、set_viewport、select_nodes；生成必须调用专用生成工具。",
            JSONObject.parseObject("{\"type\":\"object\",\"properties\":{\"ops\":{\"type\":\"array\",\"items\":{\"type\":\"object\",\"additionalProperties\":true}}},\"additionalProperties\":false}"),
            true));
    }

    // ===== 画布生成工具（前端创建节点并复用画布生成流程） =====

    /**
     * 注册由画布前端执行的内容生成工具。
     */
    private void registerGenerationTools() {
        register(new AgentTool("canvas_generate_text",
            "在画布创建文本生成配置节点并立即生成；工具在真实生成终态后返回结果。",
            JSONObject.parseObject("{\"type\":\"object\",\"properties\":{\"prompt\":{\"type\":\"string\"},\"title\":{\"type\":\"string\"},\"x\":{\"type\":\"number\"},\"y\":{\"type\":\"number\"}},\"required\":[\"prompt\"],\"additionalProperties\":false}"),
            true));
        register(new AgentTool("canvas_generate_image",
            "在画布创建图片生成配置节点并立即生成；工具在真实生成终态后返回结果。size为必填图片尺寸，支持1:1、16:9、9:16、4:3、3:4或1024x1024这类像素尺寸；用户未提供时必须先询问用户，不要猜测默认值。",
            JSONObject.parseObject("{\"type\":\"object\",\"properties\":{\"prompt\":{\"type\":\"string\"},\"title\":{\"type\":\"string\"},\"x\":{\"type\":\"number\"},\"y\":{\"type\":\"number\"},\"size\":{\"type\":\"string\",\"description\":\"图片尺寸，支持1:1、16:9、9:16、4:3、3:4或1024x1024这类像素尺寸\"},\"quality\":{\"type\":\"string\"},\"imageResolution\":{\"type\":\"string\"},\"count\":{\"type\":\"number\"}},\"required\":[\"prompt\",\"size\"],\"additionalProperties\":false}"),
            true));
        register(new AgentTool("canvas_generate_video",
            "在画布创建视频生成配置节点并立即生成；工具在真实生成终态后返回结果。model、videoGenerationMode 等参数必须严格使用用户设置，不得自行选择。",
            JSONObject.parseObject("{\"type\":\"object\",\"properties\":{\"prompt\":{\"type\":\"string\"},\"title\":{\"type\":\"string\"},\"x\":{\"type\":\"number\"},\"y\":{\"type\":\"number\"},\"size\":{\"type\":\"string\",\"description\":\"从用户设置的 [尺寸=X] 中提取\"},\"seconds\":{\"type\":\"string\",\"description\":\"从用户设置的 [时长=X] 中提取 X，仅数字不含单位\"},\"vquality\":{\"type\":\"string\",\"description\":\"从用户设置的 [分辨率=X] 中提取\"},\"quality\":{\"type\":\"string\",\"enum\":[\"low\",\"medium\",\"high\"],\"description\":\"视频质量等级，根据分辨率自动判断：≤480→low，720→medium，≥1080→high\"},\"model\":{\"type\":\"string\",\"description\":\"必须严格使用用户设置 [视频模型=X] 中的 X 值，不得自行选择\"},\"videoGenerationMode\":{\"type\":\"string\",\"enum\":[\"text-to-video\",\"image-to-video\",\"reference-to-video\"],\"description\":\"必须严格使用用户设置中的视频生成模式\"},\"watermark\":{\"type\":\"boolean\",\"description\":\"必须严格使用用户设置中的水印设置\"}},\"required\":[\"prompt\"],\"additionalProperties\":false}"),
            true));
        register(new AgentTool("canvas_run_generation",
            "触发指定画布配置节点生成；工具在真实生成终态后返回结果。",
            JSONObject.parseObject("{\"type\":\"object\",\"properties\":{\"nodeId\":{\"type\":\"string\"},\"mode\":{\"type\":\"string\",\"enum\":[\"text\",\"image\",\"video\"]},\"prompt\":{\"type\":\"string\"},\"model\":{\"type\":\"string\",\"description\":\"必须严格使用用户设置 [视频模型=X] 中的 X 值，不得自行选择\"},\"size\":{\"type\":\"string\",\"description\":\"从用户设置的 [尺寸=X] 中提取\"},\"seconds\":{\"type\":\"string\",\"description\":\"从用户设置的 [时长=X] 中提取 X，仅数字不含单位\"},\"vquality\":{\"type\":\"string\",\"description\":\"从用户设置的 [分辨率=X] 中提取\"},\"videoGenerationMode\":{\"type\":\"string\",\"enum\":[\"text-to-video\",\"image-to-video\",\"reference-to-video\"],\"description\":\"必须严格使用用户设置中的视频生成模式\"},\"watermark\":{\"type\":\"boolean\",\"description\":\"必须严格使用用户设置中的水印设置\"}},\"required\":[\"nodeId\",\"mode\"],\"additionalProperties\":false}"),
            true));
    }

    /**
     * 注册工具到注册表，前端工具同时加入前端工具集合
     *
     * @param tool AgentTool 工具定义
     */
    private void register(AgentTool tool) {
        tools.put(tool.name(), tool);
        if (tool.frontend()) {
            frontendTools.add(tool.name());
        }
    }
}
