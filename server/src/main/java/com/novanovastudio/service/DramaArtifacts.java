package com.novanovastudio.service;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.DramaDtos;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.util.StringUtils;

/**
 * 把导演Agent的结构化结果整理成可保存的阶段产物，并分配持久化标识。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-14 00:40
 */
public final class DramaArtifacts {

    private static final Pattern CHARACTER = Pattern.compile("^c[1-9]\\d{0,2}$");
    private static final Pattern LOCATION = Pattern.compile("^l[1-9]\\d{0,2}$");
    private static final Pattern SCENE = Pattern.compile("^sc[1-9]\\d{0,2}$");
    private static final Pattern SHOT = Pattern.compile("^sh[1-9]\\d{0,2}$");

    /** 图片和视频共用的画幅比例。短剧默认竖屏。 */
    public static final List<String> ASPECTS = List.of("9:16", "16:9", "1:1", "3:4", "4:3", "21:9");

    private static final java.util.Map<String, String> VIDEO_PIXELS = java.util.Map.of(
            "9:16", "720x1280", "16:9", "1280x720", "1:1", "720x720", "3:4", "720x960", "4:3", "960x720", "21:9", "1680x720");

    private DramaArtifacts() {
    }

    /**
     * 校验并补齐指定阶段的产物。
     *
     * @param stage 目标阶段
     * @param raw 导演结果
     * @param previous 同一阶段的上一版，用于沿用短序号对应的持久化标识
     * @param cast 已有角色与场景，用于校验引用
     * @param storyboard 已有分镜，用于校验镜头引用
     * @param fallbackDuration 项目上的目标时长
     * @return 可落库的产物
     * @throws BusinessException 缺少内容或短序号不合法时抛出
     */
    public static JSONObject normalize(String stage, JSONObject raw, JSONObject previous, JSONObject cast,
                                       JSONObject storyboard, int fallbackDuration) {
        return normalize(stage, raw, previous, cast, storyboard, fallbackDuration, "9:16");
    }

    /**
     * 校验并补齐指定阶段的产物，制作方案的画幅以项目上的比例为准。
     *
     * @param aspectRatio 项目画幅比例
     * @return 可落库的产物
     */
    public static JSONObject normalize(String stage, JSONObject raw, JSONObject previous, JSONObject cast,
                                       JSONObject storyboard, int fallbackDuration, String aspectRatio) {
        return normalize(stage, raw, previous, cast, storyboard, fallbackDuration, aspectRatio, "");
    }

    /**
     * 校验并补齐指定阶段的产物。分镜时长默认收在 10 到 15 秒，除非用户这句话要求缩短。
     *
     * @param userMessage 用户原话，可为空
     * @return 可落库的产物
     */
    public static JSONObject normalize(String stage, JSONObject raw, JSONObject previous, JSONObject cast,
                                       JSONObject storyboard, int fallbackDuration, String aspectRatio, String userMessage) {
        JSONObject source = raw == null ? new JSONObject() : raw;
        return switch (stage) {
            case "plan" -> plan(source.getJSONObject("plan"), fallbackDuration, aspectRatio);
            case "script" -> script(source.getJSONObject("script"), previous);
            case "cast" -> cast(source.getJSONObject("cast"), previous);
            case "shot" -> shot(source.getJSONObject("shot"), previous, cast);
            default -> throw new BusinessException(ErrorCode.PARAM_INVALID, "不支持的短剧阶段");
        };
    }

    /**
     * 读取给用户展示的回复。模型没有写回复时使用固定说明。
     *
     * @param raw 导演结果
     * @return 回复正文
     */
    public static String reply(JSONObject raw) {
        String reply = raw == null ? null : raw.getString("reply");
        return StringUtils.hasText(reply) ? reply.trim() : "这一阶段已经整理好，请确认后继续。";
    }

    /**
     * 去掉发给模型的上下文里的持久化标识，只保留短序号。
     *
     * @param content 阶段产物
     */
    public static void hidePersistentIds(JSONObject content) {
        if (content == null) {
            return;
        }
        for (String field : new String[] {"scenes", "characters", "locations", "shots"}) {
            JSONArray items = content.getJSONArray(field);
            if (items == null) {
                continue;
            }
            for (int index = 0; index < items.size(); index++) {
                JSONObject item = items.getJSONObject(index);
                if (item != null) {
                    item.remove("id");
                }
            }
        }
    }

    /**
     * 把画幅收成允许的比例。无法识别时使用竖屏。
     *
     * @param value 原始比例
     * @return 9:16、16:9、1:1、3:4、4:3 或 21:9
     */
    public static String normalizeAspect(String value) {
        String ratio = value == null ? "" : value.trim();
        return ASPECTS.contains(ratio) ? ratio : "9:16";
    }

    /**
     * 视频任务若带了别的比例，改回项目比例对应的像素尺寸；已经匹配时保持调用方给出的模型尺寸。
     *
     * @param sent 调用方准备的 size
     * @param aspectRatio 项目画幅
     * @return 应提交的 size
     */
    public static String videoSize(String sent, String aspectRatio) {
        String ratio = normalizeAspect(aspectRatio);
        String size = sent == null ? "" : sent.trim();
        String pixels = VIDEO_PIXELS.get(ratio);
        if (!StringUtils.hasText(size)) {
            return pixels;
        }
        if (size.equals(ratio) || size.equals(pixels)) {
            return size;
        }
        if (ASPECTS.contains(size) || VIDEO_PIXELS.containsValue(size)) {
            return pixels;
        }
        return size;
    }

    private static JSONObject plan(JSONObject body, int fallbackDuration, String aspectRatio) {
        JSONObject content = new JSONObject();
        content.put("title", required(body, "title"));
        content.put("genre", required(body, "genre"));
        content.put("style", required(body, "style"));
        content.put("understanding", required(body, "understanding"));
        content.put("storyDirection", required(body, "storyDirection"));
        content.put("durationSeconds", duration(body == null ? null : body.getInteger("durationSeconds"), fallbackDuration));
        content.put("aspectRatio", normalizeAspect(aspectRatio));
        return content;
    }

    private static JSONObject script(JSONObject body, JSONObject previous) {
        JSONArray scenes = array(body, "scenes");
        if (scenes.isEmpty()) {
            throw invalid("剧本至少要有一个场景");
        }
        JSONArray stored = new JSONArray();
        Set<String> refs = new HashSet<>();
        for (int index = 0; index < scenes.size(); index++) {
            JSONObject scene = scenes.getJSONObject(index);
            String ref = ref(scene, "ref", SCENE, refs);
            JSONObject item = new JSONObject();
            item.put("id", reuse(previous, "scenes", ref));
            item.put("ref", ref);
            item.put("heading", required(scene, "heading"));
            item.put("action", text(scene, "action"));
            item.put("lines", lines(scene == null ? null : scene.getJSONArray("lines")));
            stored.add(item);
        }
        JSONObject content = new JSONObject();
        content.put("synopsis", required(body, "synopsis"));
        content.put("scenes", stored);
        return content;
    }

    private static JSONArray lines(JSONArray source) {
        JSONArray stored = new JSONArray();
        if (source == null) {
            return stored;
        }
        for (int index = 0; index < source.size(); index++) {
            JSONObject line = source.getJSONObject(index);
            String text = required(line, "text");
            String characterRef = text(line, "characterRef");
            if (StringUtils.hasText(characterRef) && !CHARACTER.matcher(characterRef).matches()) {
                throw invalid("对白角色序号不合法");
            }
            JSONObject item = new JSONObject();
            item.put("characterRef", characterRef);
            item.put("speaker", text(line, "speaker"));
            item.put("text", text);
            stored.add(item);
        }
        return stored;
    }

    private static JSONObject cast(JSONObject body, JSONObject previous) {
        JSONArray characters = people(array(body, "characters"), previous);
        JSONArray locations = places(array(body, "locations"), previous);
        if (characters.isEmpty() || locations.isEmpty()) {
            throw invalid("角色与场景都至少要有一项");
        }
        JSONObject content = new JSONObject();
        content.put("characters", characters);
        content.put("locations", locations);
        return content;
    }

    private static JSONArray people(JSONArray source, JSONObject previous) {
        JSONArray stored = new JSONArray();
        Set<String> refs = new HashSet<>();
        for (int index = 0; index < source.size(); index++) {
            JSONObject person = source.getJSONObject(index);
            String ref = ref(person, "ref", CHARACTER, refs);
            JSONObject item = new JSONObject();
            item.put("id", reuse(previous, "characters", ref));
            item.put("ref", ref);
            item.put("name", required(person, "name"));
            item.put("personality", text(person, "personality"));
            item.put("appearance", text(person, "appearance"));
            stored.add(item);
        }
        return stored;
    }

    private static JSONArray places(JSONArray source, JSONObject previous) {
        JSONArray stored = new JSONArray();
        Set<String> refs = new HashSet<>();
        for (int index = 0; index < source.size(); index++) {
            JSONObject place = source.getJSONObject(index);
            String ref = ref(place, "ref", LOCATION, refs);
            JSONObject item = new JSONObject();
            item.put("id", reuse(previous, "locations", ref));
            item.put("ref", ref);
            item.put("name", required(place, "name"));
            item.put("visual", text(place, "visual"));
            stored.add(item);
        }
        return stored;
    }

    private static JSONObject shot(JSONObject body, JSONObject previous, JSONObject cast) {
        JSONArray shots = array(body, "shots");
        if (shots.isEmpty()) {
            throw invalid("分镜镜头至少要有一个镜头");
        }
        Set<String> characters = refsOf(cast, "characters");
        Set<String> locations = refsOf(cast, "locations");
        JSONArray stored = new JSONArray();
        Set<String> refs = new HashSet<>();
        for (int index = 0; index < shots.size(); index++) {
            JSONObject shot = shots.getJSONObject(index);
            String ref = ref(shot, "ref", SHOT, refs);
            String characterRef = resolveStoryRef(text(shot, "characterRef"), characters, cast, "characters", "name", CHARACTER);
            String locationRef = resolveStoryRef(text(shot, "locationRef"), locations, cast, "locations", "name", LOCATION);
            String picture = required(shot, "picture");
            String videoPrompt = text(shot, "videoPrompt");
            JSONObject item = new JSONObject();
            String title = text(shot, "title");
            item.put("id", reuse(previous, "shots", ref));
            item.put("ref", ref);
            item.put("order", index + 1);
            item.put("durationSeconds", shotDuration(shot, previous, ref));
            item.put("title", StringUtils.hasText(title) ? title : fallbackShotTitle(picture, text(shot, "size"), index));
            item.put("size", text(shot, "size"));
            item.put("camera", text(shot, "camera"));
            item.put("picture", picture);
            item.put("dialogue", text(shot, "dialogue"));
            item.put("screenText", text(shot, "screenText"));
            item.put("rhythm", text(shot, "rhythm"));
            item.put("characterRef", characterRef);
            item.put("locationRef", locationRef);
            item.put("videoPrompt", StringUtils.hasText(videoPrompt) ? videoPrompt : picture);
            stored.add(item);
        }
        JSONObject content = new JSONObject();
        content.put("shots", stored);
        return content;
    }

    /**
     * 规范化用户手动编辑后的分镜列表：校验短序号、画面与时长，重算顺序并保留既有持久化标识。
     *
     * @param patches 前端提交的完整分镜列表
     * @param previous 当前版本的旧产物
     * @param cast 已有角色与场景，用于校验引用
     * @return 可原地落库的分镜产物
     * @throws BusinessException 分镜为空、序号不合法或必填字段缺失时抛出
     */
    public static JSONObject normalizeManualShots(List<DramaDtos.ShotPatch> patches, JSONObject previous, JSONObject cast) {
        if (patches == null || patches.isEmpty()) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "分镜镜头至少要保留一个镜头");
        }
        Set<String> characters = refsOf(cast, "characters");
        Set<String> locations = refsOf(cast, "locations");
        JSONArray stored = new JSONArray();
        Set<String> seenRefs = new HashSet<>();
        for (int index = 0; index < patches.size(); index++) {
            DramaDtos.ShotPatch patch = patches.get(index);
            if (patch == null) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "分镜镜头数据不能为空");
            }
            String ref = patch.ref() == null ? "" : patch.ref().trim();
            if (!SHOT.matcher(ref).matches() || !seenRefs.add(ref)) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "镜头短序号不合法或重复: " + ref);
            }
            String picture = patch.picture() == null ? "" : patch.picture().trim();
            if (!StringUtils.hasText(picture)) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "镜头画面描述不能为空");
            }
            int duration = patch.durationSeconds();
            if (duration < 1 || duration > 60) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "镜头时长需在 1 到 60 秒之间");
            }
            String videoPrompt = patch.videoPrompt() == null ? "" : patch.videoPrompt().trim();
            String id = StringUtils.hasText(patch.id()) ? patch.id().trim() : reuse(previous, "shots", ref);
            JSONObject item = new JSONObject();
            item.put("id", id);
            item.put("ref", ref);
            item.put("order", index + 1);
            item.put("durationSeconds", duration);
            item.put("title", trimOrEmpty(patch.title()));
            item.put("size", trimOrEmpty(patch.size()));
            item.put("camera", trimOrEmpty(patch.camera()));
            item.put("picture", picture);
            item.put("dialogue", trimOrEmpty(patch.dialogue()));
            item.put("screenText", trimOrEmpty(patch.screenText()));
            item.put("rhythm", trimOrEmpty(patch.rhythm()));
            item.put("characterRef", resolveStoryRef(trimOrEmpty(patch.characterRef()), characters, cast, "characters", "name", CHARACTER));
            item.put("locationRef", resolveStoryRef(trimOrEmpty(patch.locationRef()), locations, cast, "locations", "name", LOCATION));
            item.put("videoPrompt", StringUtils.hasText(videoPrompt) ? videoPrompt : picture);
            stored.add(item);
        }
        JSONObject content = new JSONObject();
        content.put("shots", stored);
        return content;
    }

    private static String trimOrEmpty(String value) {
        return value == null ? "" : value.trim();
    }

    /** 模型偶发漏填镜头小标题时，从画面首句截取精炼标题兜底，确保列表与时间轴有标题可显示。 */
    private static String fallbackShotTitle(String picture, String size, int index) {
        String source = picture == null ? "" : picture.trim().replaceAll("\\s+", "");
        if (StringUtils.hasText(source)) {
            String firstClause = source.split("[，。！？；：,.!?;:]", 2)[0];
            String candidate = StringUtils.hasText(firstClause) ? firstClause : source;
            return candidate.length() <= 10 ? candidate : candidate.substring(0, 10);
        }
        return StringUtils.hasText(size) ? size : "镜头" + (index + 1);
    }

    private static int shotDuration(JSONObject shot, JSONObject previous, String ref) {
        Integer explicit = shot == null ? null : shot.getInteger("durationSeconds");
        if (explicit != null && explicit >= 1) {
            return explicit;
        }
        return storyboardDuration(durationOfRef(previous, ref));
    }

    /**
     * 分镜引用只保留角色或场景里已经有的短序号。模型写成姓名时按名称对上，对不上就留空，避免整段分镜失败。
     */
    private static String resolveStoryRef(String raw, Set<String> known, JSONObject content, String field, String nameField, Pattern pattern) {
        if (!StringUtils.hasText(raw)) {
            return "";
        }
        if (known.isEmpty()) {
            return pattern.matcher(raw).matches() ? raw : "";
        }
        for (String part : raw.split("[,，、/\\s]+")) {
            String resolved = matchKnownRef(part.trim(), content, field, nameField);
            if (StringUtils.hasText(resolved)) {
                return resolved;
            }
        }
        return "";
    }

    private static String matchKnownRef(String value, JSONObject content, String field, String nameField) {
        if (!StringUtils.hasText(value) || content == null) {
            return "";
        }
        String normalized = value.toLowerCase(java.util.Locale.ROOT).replaceFirst("^([cl])0+([1-9])", "$1$2");
        JSONArray items = content.getJSONArray(field);
        if (items == null) {
            return "";
        }
        String byName = "";
        int nameLength = 0;
        for (int index = 0; index < items.size(); index++) {
            JSONObject item = items.getJSONObject(index);
            if (item == null || !StringUtils.hasText(item.getString("ref"))) {
                continue;
            }
            String ref = item.getString("ref");
            if (normalized.equalsIgnoreCase(ref)) {
                return ref;
            }
            String name = text(item, nameField);
            boolean named = name.length() >= 2 && (value.equals(name) || value.contains(name));
            if (named && name.length() > nameLength) {
                byName = ref;
                nameLength = name.length();
            }
        }
        return byName;
    }

    private static Integer durationOfRef(JSONObject content, String ref) {
        JSONArray items = content == null ? null : content.getJSONArray("shots");
        if (items == null) {
            return null;
        }
        for (int index = 0; index < items.size(); index++) {
            JSONObject item = items.getJSONObject(index);
            if (item != null && ref.equals(item.getString("ref"))) {
                Integer value = item.getInteger("durationSeconds");
                if (value != null && value >= 1) {
                    return value;
                }
            }
        }
        return null;
    }

    private static JSONArray array(JSONObject body, String field) {
        JSONArray value = body == null ? null : body.getJSONArray(field);
        return value == null ? new JSONArray() : value;
    }

    private static String ref(JSONObject item, String field, Pattern pattern, Set<String> seen) {
        String value = required(item, field);
        if (!pattern.matcher(value).matches() || !seen.add(value)) {
            throw invalid("短序号不合法或重复");
        }
        return value;
    }

    private static Set<String> refsOf(JSONObject content, String field) {
        Set<String> refs = new HashSet<>();
        JSONArray items = content == null ? null : content.getJSONArray(field);
        if (items == null) {
            return refs;
        }
        for (int index = 0; index < items.size(); index++) {
            JSONObject item = items.getJSONObject(index);
            if (item != null && StringUtils.hasText(item.getString("ref"))) {
                refs.add(item.getString("ref"));
            }
        }
        return refs;
    }

    private static String reuse(JSONObject previous, String field, String ref) {
        JSONArray items = previous == null ? null : previous.getJSONArray(field);
        if (items != null) {
            for (int index = 0; index < items.size(); index++) {
                JSONObject item = items.getJSONObject(index);
                if (item != null && ref.equals(item.getString("ref")) && StringUtils.hasText(item.getString("id"))) {
                    return item.getString("id");
                }
            }
        }
        return UUID.randomUUID().toString();
    }

    private static String required(JSONObject body, String field) {
        String value = text(body, field);
        if (!StringUtils.hasText(value)) {
            throw invalid("短剧结果缺少" + field);
        }
        return value;
    }

    private static String text(JSONObject body, String field) {
        String value = body == null ? null : body.getString(field);
        return value == null ? "" : value.trim();
    }

    private static int duration(Integer value, int fallback) {
        int resolved = value == null ? fallback : value;
        return Math.max(15, Math.min(180, resolved));
    }

    /**
     * 采用主 Agent 给出的分镜秒数。没有给或不是正数时用 12 秒。
     *
     * @param value 模型给出的秒数
     * @return 落库秒数
     */
    public static int storyboardDuration(Integer value) {
        return value == null || value < 1 ? 12 : value;
    }

    private static int positive(Integer value, int fallback) {
        return value == null || value < 1 ? fallback : value;
    }

    private static BusinessException invalid(String message) {
        return new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, message);
    }
}
