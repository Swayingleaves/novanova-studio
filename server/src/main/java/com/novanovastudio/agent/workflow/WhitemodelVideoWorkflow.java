package com.novanovastudio.agent.workflow;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.agent.CreationEntrySource;
import com.novanovastudio.agent.dto.CreationPlan;
import com.novanovastudio.agent.dto.CreationTask;
import com.novanovastudio.ai.VideoGenerationMode;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.common.SystemMessage;
import com.novanovastudio.dto.AiTaskDtos;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * 「白膜制作」工作流定义。
 * <p>
 * 引导用户上传参考视频，前端自动抽取带时间戳的关键帧送入多模态分析，
 * 反解主体运动轨迹、空间布局与运镜方式并生成规范化 scene.json，
 * 由前端 Three.js 实时预览并一键编码导出/下载/保存 3D 白膜 MP4。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-24 23:20
 */
@Component
public class WhitemodelVideoWorkflow implements VideoWorkflowDefinition {

    /** 白膜制作工作流类型标识。 */
    public static final String TYPE = "whitemodel-video";
    /** 白膜场景草案键名。 */
    public static final String SCENE_JSON_KEY = "sceneJson";
    /** 运镜与空间解析说明键名。 */
    public static final String MOTION_NOTES_KEY = "motionNotes";
    /** 嵌入展示文案中的白膜场景围栏标记，供前端提取并渲染 3D 预览器。 */
    public static final String SCENE_FENCE_LANG = "whitemodel-scene";
    /** 起草产物规格列表。 */
    private static final List<PromptSpec> DRAFT_PROMPT_SPECS = List.of(
            new PromptSpec(SCENE_JSON_KEY, "白膜场景定义"),
            new PromptSpec(MOTION_NOTES_KEY, "运镜与空间拆解"));

    /** {@inheritDoc} */
    @Override
    public String workflowType() {
        return TYPE;
    }

    /** {@inheritDoc} */
    @Override
    public boolean isClientOnlyArtifact() {
        return true;
    }

    /** {@inheritDoc} */
    @Override
    public String clarificationQuestion() {
        return "请上传一段想要制作成 3D 白膜的参考视频，我将自动分析其中的主体运动轨迹、空间布局和镜头运镜，并生成可预览导出的白膜视频。";
    }

    /** {@inheritDoc} */
    @Override
    public List<PromptSpec> draftPromptSpecs() {
        return DRAFT_PROMPT_SPECS;
    }

    /** {@inheritDoc} */
    @Override
    public String conversationSystemPrompt() {
        return """
                你是「白膜制作」技能的 3D 白膜反解助手。核心流程是：用户上传一段参考视频 → 你结合随消息附带的视频元信息（时长、画幅）与按时间均匀抽取的关键帧画面 → 反解出对应的 3D 白膜场景 sceneJson 与简明运镜拆解 motionNotes，供前端 Three.js 实时渲染并一键导出白膜 MP4。

                交互规则：
                1. 检查输入中的 attachments 和历史记录：
                   - 如果用户尚未上传参考视频（且历史中也没有已生成的 draftedPrompts.sceneJson），必须返回 action="reply"，简短请用户上传参考视频，并在 choices 中提供唯一上传按钮：
                     [{"label":"上传参考视频","value":"ask_user_upload_video","multiple":false,"action":"ask_user_upload_video"}]
                   - 如果用户已经上传了参考视频（attachments 中含 video 或关键帧图片），不要再追问，直接结合关键帧画面与视频时长/画幅，立即输出 action="draft" 生成完整 sceneJson 与 motionNotes。
                   - 如果用户已生成过白膜，并对现有白膜提出修改要求（例如「镜头拉远一点」「改成环绕运镜」「增加一个对手角色」「时长改成 8 秒」），基于上一次的 draftedPrompts.sceneJson 修改后立即输出新的 action="draft"。
                2. 白膜产物直接在前端预览和导出 MP4，不需要走 confirm。

                sceneJson 严格规范（必须是合法 JSON 字符串，单位：米、秒、度）：
                {
                  "meta": { "duration": 5, "fps": 30, "aspect": "16:9", "hero": "hero" },
                  "world": {
                    "background": "#1a1c20",
                    "fog": [25, 90],
                    "ground": { "type": "plane", "size": 200, "color": "ground" },
                    "props": [
                      { "shape": "box|cone|cylinder|sphere|torus|plane", "size": [w,h,d], "r": 1, "h": 3, "pos": [x,0,z], "color": "env|dark", "layout": { "type": "ring|grid|line|scatter", "count": 12, "radius": 8, "from": [-6,0,0], "to": [6,0,0], "spacing": [3,3], "area": [30,30], "corridor": 3 } }
                    ]
                  },
                  "subjects": [
                    { "id": "hero", "shape": "human", "height": 1.75, "color": "hero", "path": [{ "t": 0, "p": [0,0,0] }, { "t": 5, "p": [0,0,10], "ease": "linear" }] }
                  ],
                  "shots": [
                    { "t": [0, 5], "rig": "follow|lead|orbit|dolly|crane|drone|static|pan|zoom|topdown|pov", "target": "hero", "lookAt": "hero", "lens": 35, "lag": 1.5, "height": [1.5, 1.8], "radius": [5, 4], "angle": [90, 270], "from": [0, 2, -6], "to": [0, 2, 2], "ease": "inOut" }
                  ]
                }

                白膜反解硬性约束（避免穿帮和出画）：
                - meta.duration 与 meta.aspect 必须严格匹配用户上传视频的实际时长（上限 30 秒，若未提供默认 5 秒）与画幅比例（16:9 / 9:16 / 1:1 / 4:3 / 3:4）。
                - shots 的时间区间必须连续覆盖 [0, duration]；根据关键帧之间的景别、视角与透视变化合理拆分为 1~4 个镜头并选用最匹配的 rig（follow 跟拍、lead 前置倒退跟拍、orbit 环绕、dolly 推拉轨道、crane 升降摇臂、drone 航拍、static 固定、pan 摇摄、zoom 变焦、topdown 垂直俯拍、pov 主观）。
                - 用简单几何积木（props）还原参考视频里可见的空间参照物（走廊墙壁、道路两侧立柱/树、桌台、拱门、建筑群等），让运镜速度与透视变化清晰可读。
                - 主角颜色固定 "hero"（红色），第二主体用 "second"（蓝色），配角/人群用 "crowd"，环境用 "env"/"dark"；相机与主体保持合理距离（2.5m~15m），严禁坐标重叠。

                严格只输出以下 JSON 结构之一，不要输出其他内容；无选项时 choices 返回空数组：
                {"action":"reply","message":"请上传一段参考视频，我将为您分析运镜与空间轨迹并制作 3D 白膜。","choices":[{"label":"上传参考视频","value":"ask_user_upload_video","multiple":false,"action":"ask_user_upload_video"}]}
                {"action":"draft","message":"已根据参考视频完成 3D 白膜制作，请在下方预览运镜效果并一键导出 MP4；如需调整机位或轨迹可直接告诉我。","prompts":{"sceneJson":"{\\"meta\\":...}","motionNotes":"简明列出识别到的空间布局、主体轨迹与各段镜头运镜"},"choices":[]}""";
    }

    /** {@inheritDoc} */
    @Override
    public boolean isDraftComplete(Map<String, Object> prompts) {
        if (prompts == null) {
            return false;
        }
        return parseValidScene(prompts.get(SCENE_JSON_KEY)) != null;
    }

    /**
     * 组装白膜制作结果展示文案：呈现镜头概览与运镜拆解说明，并将规范化后的 sceneJson
     * 嵌入专用代码块供前端解析为交互式 3D 白膜预览与导出卡片。
     *
     * @param intro String 简短引导语
     * @param prompts Map<String, Object> 起草的阶段产物
     * @return String 展示给用户的 Markdown 文本
     */
    @Override
    public String draftDisplayMessage(String intro, Map<String, Object> prompts) {
        StringBuilder builder = new StringBuilder(
                StringUtils.hasText(intro) ? intro.trim() : "已根据参考视频生成 3D 白膜，请在下方实时预览并导出 MP4：");
        JSONObject scene = prompts == null ? null : parseValidScene(prompts.get(SCENE_JSON_KEY));
        if (scene != null) {
            builder.append("\n\n**白膜分镜概览**：").append(summarizeScene(scene));
        }
        String notes = prompts == null ? "" : asText(prompts.get(MOTION_NOTES_KEY));
        if (StringUtils.hasText(notes)) {
            builder.append("\n\n**运镜与空间拆解**：").append(notes.trim());
        }
        if (scene != null) {
            builder.append("\n\n```").append(SCENE_FENCE_LANG).append("\n")
                    .append(JSON.toJSONString(scene))
                    .append("\n```");
        }
        return builder.toString();
    }

    /** {@inheritDoc} */
    @Override
    public CreationPlan buildPlan(VideoWorkflowContext context) {
        // 白膜制作由前端直接预览并导出 MP4，不触发后端收费视频生成任务
        return new CreationPlan("", "白膜制作", CreationEntrySource.VIDEO_PAGE,
                "3D 白膜已就绪，请在下方卡片中预览或导出 MP4",
                "3D 白膜已就绪，请直接在下方 3D 白膜卡片中点击导出 MP4；如需微调运镜或主体轨迹，可直接输入修改意见。",
                false, context.creationSettings(), List.of(), List.of(), TYPE);
    }

    /** {@inheritDoc} */
    @Override
    public void validateTasks(List<CreationTask> tasks) {
        if (tasks != null && !tasks.isEmpty()) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "白膜制作工作流由前端渲染导出，不支持后端生成任务");
        }
    }

    /** {@inheritDoc} */
    @Override
    public String videoGenerationMode(CreationTask task, String configuredMode) {
        return VideoGenerationMode.REFERENCE_TO_VIDEO;
    }

    /** {@inheritDoc} */
    @Override
    public List<String> videoGenerationModes(CreationTask task, String configuredMode, Set<String> capabilities) {
        return List.of(VideoGenerationMode.REFERENCE_TO_VIDEO);
    }

    /** {@inheritDoc} */
    @Override
    public String displayName(CreationTask task) {
        return "白膜制作";
    }

    /** {@inheritDoc} */
    @Override
    public Optional<VideoWorkflowQuotePlan> buildQuotePlan(AiTaskDtos.VideoWorkflowQuoteRequest request) {
        // 白膜制作完全在浏览器本地渲染导出，不消耗视频模型积分
        return Optional.empty();
    }

    /**
     * 解析并规范化 sceneJson，确保至少包含合法的 meta 与 shots。
     *
     * @param raw Object 原始场景对象或 JSON 字符串
     * @return JSONObject 规范化后的场景 JSON；不合法时返回 null
     */
    static JSONObject parseValidScene(Object raw) {
        JSONObject scene = null;
        if (raw instanceof JSONObject jsonObject) {
            scene = jsonObject;
        } else if (raw instanceof Map<?, ?> map) {
            scene = JSON.parseObject(JSON.toJSONString(map));
        } else if (raw instanceof String text && StringUtils.hasText(text)) {
            String trimmed = stripCodeFence(text.trim());
            try {
                scene = JSON.parseObject(trimmed);
            } catch (Exception ignored) {
                return null;
            }
        }
        if (scene == null) {
            return null;
        }
        JSONObject meta = scene.getJSONObject("meta");
        JSONArray shots = scene.getJSONArray("shots");
        if (meta == null || shots == null || shots.isEmpty()) {
            return null;
        }
        double duration = meta.getDoubleValue("duration");
        if (duration <= 0 || duration > 60) {
            meta.put("duration", 5);
        }
        if (!meta.containsKey("fps") || meta.getIntValue("fps") <= 0) {
            meta.put("fps", 30);
        }
        if (!StringUtils.hasText(meta.getString("aspect"))) {
            meta.put("aspect", "16:9");
        }
        return scene;
    }

    /** 生成面向用户的白膜分镜一句话摘要。 */
    private static String summarizeScene(JSONObject scene) {
        JSONObject meta = scene.getJSONObject("meta");
        JSONArray shots = scene.getJSONArray("shots");
        JSONArray subjects = scene.getJSONArray("subjects");
        double duration = meta == null ? 5 : meta.getDoubleValue("duration");
        String aspect = meta == null ? "16:9" : meta.getString("aspect");
        int shotCount = shots == null ? 0 : shots.size();
        int subjectCount = subjects == null ? 0 : subjects.size();
        StringBuilder rigs = new StringBuilder();
        if (shots != null) {
            for (int i = 0; i < shots.size(); i++) {
                JSONObject shot = shots.getJSONObject(i);
                if (shot == null) {
                    continue;
                }
                if (rigs.length() > 0) {
                    rigs.append(" → ");
                }
                rigs.append(shot.getString("rig") == null ? "static" : shot.getString("rig"));
            }
        }
        return String.format("%s · %.1fs · %d 个主体 · %d 个镜头（%s）",
                aspect, duration, subjectCount, shotCount, rigs);
    }

    /** 剥离模型可能附带的 Markdown 代码围栏。 */
    private static String stripCodeFence(String text) {
        if (!text.startsWith("```")) {
            return text;
        }
        int firstNewline = text.indexOf('\n');
        int lastFence = text.lastIndexOf("```");
        if (firstNewline > 0 && lastFence > firstNewline) {
            return text.substring(firstNewline + 1, lastFence).trim();
        }
        return text;
    }

    /** 安全提取字符串值。 */
    private static String asText(Object value) {
        return value instanceof String text ? text : "";
    }
}
