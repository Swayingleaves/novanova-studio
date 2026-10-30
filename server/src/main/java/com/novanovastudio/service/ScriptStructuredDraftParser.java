package com.novanovastudio.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.dto.ScriptDtos;
import java.util.ArrayList;
import java.util.List;

/**
 * 剧本AI草稿JSON解析器，负责将嵌套数组显式转换为领域数据结构。
 * <p>
 * Fastjson2直接把JSONObject转换为包含泛型列表的record时，列表元素可能保留为JSONObject。
 * 本解析器逐层转换嵌套对象，避免业务校验阶段出现ClassCastException。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-20 23:50
 */
public final class ScriptStructuredDraftParser {

    /**
     * 工具类禁止实例化。
     */
    private ScriptStructuredDraftParser() {
    }

    /**
     * 解析候选故事方向草稿。
     *
     * @param draftData JSONObject 草稿JSON
     * @return StoryDirectionDraft 候选故事方向
     * @throws DraftStructureException 字段类型或嵌套结构不符合协议时抛出
     */
    public static ScriptDtos.StoryDirectionDraft parseStoryDirectionDraft(JSONObject draftData) {
        List<ScriptDtos.StoryDirection> candidates = parseObjectList(
                requireDraft(draftData), "candidates", ScriptDtos.StoryDirection.class);
        Object selectedIndexValue = draftData.get("selectedIndex");
        if (!(selectedIndexValue instanceof Number selectedIndexNumber)
                || selectedIndexNumber.doubleValue() != selectedIndexNumber.intValue()) {
            throw invalid("selectedIndex必须是整数");
        }
        return new ScriptDtos.StoryDirectionDraft(candidates, selectedIndexNumber.intValue());
    }

    /**
     * 解析故事大纲草稿。
     *
     * @param draftData JSONObject 草稿JSON
     * @return OutlineDraft 大纲结构段与关键事件
     * @throws DraftStructureException 嵌套数组不符合协议时抛出
     */
    public static ScriptDtos.OutlineDraft parseOutlineDraft(JSONObject draftData) {
        JSONObject source = requireDraft(draftData);
        return new ScriptDtos.OutlineDraft(
                parseObjectList(source, "sections", ScriptDtos.OutlineSection.class),
                parseObjectList(source, "events", ScriptDtos.StoryEvent.class));
    }

    /**
     * 解析人物与人物关系草稿。
     *
     * @param draftData JSONObject 草稿JSON
     * @return CharacterDraft 人物与关系数据
     * @throws DraftStructureException 嵌套数组不符合协议时抛出
     */
    public static ScriptDtos.CharacterDraft parseCharacterDraft(JSONObject draftData) {
        JSONObject source = requireDraft(draftData);
        return new ScriptDtos.CharacterDraft(
                parseObjectList(source, "characters", ScriptDtos.Character.class),
                parseObjectList(source, "relations", ScriptDtos.CharacterRelation.class));
    }

    /**
     * 解析世界观、条目与地点草稿。
     *
     * @param draftData JSONObject 草稿JSON
     * @return WorldDraft 世界观数据
     * @throws DraftStructureException 嵌套对象或数组不符合协议时抛出
     */
    public static ScriptDtos.WorldDraft parseWorldDraft(JSONObject draftData) {
        JSONObject source = requireDraft(draftData);
        return new ScriptDtos.WorldDraft(
                parseObjectField(source, "worldSetting", ScriptDtos.WorldSetting.class),
                parseObjectList(source, "worldItems", ScriptDtos.WorldItem.class),
                parseObjectList(source, "locations", ScriptDtos.Location.class));
    }

    /**
     * 解析分集规划草稿。
     *
     * @param draftData JSONObject 草稿JSON
     * @return EpisodePlanDraft 分集摘要列表
     * @throws DraftStructureException 嵌套数组不符合协议时抛出
     */
    public static ScriptDtos.EpisodePlanDraft parseEpisodePlanDraft(JSONObject draftData) {
        return new ScriptDtos.EpisodePlanDraft(parseObjectList(
                requireDraft(draftData), "episodes", ScriptDtos.EpisodeSummary.class));
    }

    /**
     * 解析完整单集草稿。
     *
     * @param draftData JSONObject 草稿JSON
     * @return EpisodeDetail 单集摘要与场次
     * @throws DraftStructureException 嵌套对象或数组不符合协议时抛出
     */
    public static ScriptDtos.EpisodeDetail parseEpisodeDetail(JSONObject draftData) {
        JSONObject source = requireDraft(draftData);
        ScriptDtos.EpisodeSummary episode = parseObjectField(source, "episode", ScriptDtos.EpisodeSummary.class);
        List<?> scenes = requireArray(source, "scenes");
        List<ScriptDtos.Scene> parsedScenes = new ArrayList<>(scenes.size());
        for (int index = 0; index < scenes.size(); index++) {
            parsedScenes.add(parseScene(requireObject(scenes.get(index), "scenes[" + index + "]"),
                    "scenes[" + index + "]"));
        }
        return new ScriptDtos.EpisodeDetail(episode, parsedScenes);
    }

    /**
     * 解析单个场次草稿。
     *
     * @param draftData JSONObject 草稿JSON
     * @return Scene 场次及正文块
     * @throws DraftStructureException 嵌套字段不符合协议时抛出
     */
    public static ScriptDtos.Scene parseScene(JSONObject draftData) {
        return parseScene(requireDraft(draftData), "scene");
    }

    /**
     * 解析单个正文块草稿。
     *
     * @param draftData JSONObject 草稿JSON
     * @return ScriptBlock 正文块
     * @throws DraftStructureException 对象结构不符合协议时抛出
     */
    public static ScriptDtos.ScriptBlock parseScriptBlock(JSONObject draftData) {
        return parseObject(requireDraft(draftData), ScriptDtos.ScriptBlock.class, "block");
    }

    /**
     * 解析包含人物引用与正文块的场次对象。
     *
     * @param source JSONObject 场次JSON
     * @param path String 当前字段路径
     * @return Scene 场次数据
     * @throws DraftStructureException 嵌套字段不符合协议时抛出
     */
    private static ScriptDtos.Scene parseScene(JSONObject source, String path) {
        List<String> characterIds = parseStringList(source, "characterIds", path + ".characterIds");
        List<ScriptDtos.ScriptBlock> blocks = parseObjectList(
                source, "blocks", ScriptDtos.ScriptBlock.class, path + ".blocks");
        return new ScriptDtos.Scene(source.getString("id"), source.getString("locationId"),
                source.getIntValue("sceneNumber"), source.getString("title"), source.getString("interiorExterior"),
                source.getString("timeDescription"), source.getString("sceneGoal"), source.getString("actionSummary"),
                source.getString("transitionDescription"), source.getString("previousRelation"),
                source.getString("nextRelation"), source.getIntValue("sortOrder"), characterIds, blocks);
    }

    /**
     * 解析指定字段中的对象列表。
     *
     * @param source JSONObject 父级JSON对象
     * @param fieldName String 字段名称
     * @param type Class&lt;T&gt; 目标元素类型
     * @param <T> 元素类型
     * @return List&lt;T&gt; 已转换列表
     * @throws DraftStructureException 数组或元素类型不符合协议时抛出
     */
    private static <T> List<T> parseObjectList(JSONObject source, String fieldName, Class<T> type) {
        return parseObjectList(source, fieldName, type, fieldName);
    }

    /**
     * 按指定字段路径解析对象列表。
     *
     * @param source JSONObject 父级JSON对象
     * @param fieldName String 字段名称
     * @param type Class&lt;T&gt; 目标元素类型
     * @param path String 错误提示使用的字段路径
     * @param <T> 元素类型
     * @return List&lt;T&gt; 已转换列表
     * @throws DraftStructureException 数组或元素类型不符合协议时抛出
     */
    private static <T> List<T> parseObjectList(JSONObject source, String fieldName, Class<T> type, String path) {
        List<?> values = requireArray(source, fieldName);
        List<T> result = new ArrayList<>(values.size());
        for (int index = 0; index < values.size(); index++) {
            result.add(parseObject(requireObject(values.get(index), path + "[" + index + "]"),
                    type, path + "[" + index + "]"));
        }
        return result;
    }

    /**
     * 解析指定字段中的单个对象。
     *
     * @param source JSONObject 父级JSON对象
     * @param fieldName String 字段名称
     * @param type Class&lt;T&gt; 目标类型
     * @param <T> 对象类型
     * @return T 已转换对象
     * @throws DraftStructureException 字段不是对象或无法转换时抛出
     */
    private static <T> T parseObjectField(JSONObject source, String fieldName, Class<T> type) {
        return parseObject(requireObject(source.get(fieldName), fieldName), type, fieldName);
    }

    /**
     * 将一个扁平JSON对象转换为指定数据类型。
     *
     * @param source JSONObject JSON对象
     * @param type Class&lt;T&gt; 目标类型
     * @param path String 错误提示使用的字段路径
     * @param <T> 对象类型
     * @return T 已转换对象
     * @throws DraftStructureException 无法转换时抛出
     */
    private static <T> T parseObject(JSONObject source, Class<T> type, String path) {
        try {
            return JSON.parseObject(source.toJSONString(), type);
        } catch (RuntimeException exception) {
            throw invalid(path + "结构无法解析");
        }
    }

    /**
     * 解析字符串数组并拒绝非字符串元素。
     *
     * @param source JSONObject 父级JSON对象
     * @param fieldName String 字段名称
     * @param path String 错误提示使用的字段路径
     * @return List&lt;String&gt; 字符串列表
     * @throws DraftStructureException 数组或元素类型不符合协议时抛出
     */
    private static List<String> parseStringList(JSONObject source, String fieldName, String path) {
        List<?> values = requireArray(source, fieldName);
        List<String> result = new ArrayList<>(values.size());
        for (int index = 0; index < values.size(); index++) {
            Object value = values.get(index);
            if (!(value instanceof String text)) throw invalid(path + "[" + index + "]必须是字符串");
            result.add(text);
        }
        return result;
    }

    /**
     * 读取必需数组字段。
     *
     * @param source JSONObject 父级JSON对象
     * @param fieldName String 字段名称
     * @return List&lt;?&gt; 数组字段
     * @throws DraftStructureException 字段缺失或不是数组时抛出
     */
    private static List<?> requireArray(JSONObject source, String fieldName) {
        Object value = source.get(fieldName);
        if (!(value instanceof List<?> values)) throw invalid(fieldName + "必须是数组");
        return values;
    }

    /**
     * 校验根草稿对象存在。
     *
     * @param draftData JSONObject 草稿JSON
     * @return JSONObject 非空草稿对象
     * @throws DraftStructureException 草稿为空时抛出
     */
    private static JSONObject requireDraft(JSONObject draftData) {
        if (draftData == null) throw invalid("草稿不能为空");
        return draftData;
    }

    /**
     * 读取必需对象值。
     *
     * @param value Object JSON字段值
     * @param path String 错误提示使用的字段路径
     * @return JSONObject 对象字段
     * @throws DraftStructureException 字段缺失或不是对象时抛出
     */
    private static JSONObject requireObject(Object value, String path) {
        if (value instanceof JSONObject object) {
            return object;
        }
        if (value != null && !(value instanceof CharSequence) && !(value instanceof Number)
                && !(value instanceof Boolean) && !(value instanceof Iterable<?>)) {
            try {
                Object converted = JSON.toJSON(value);
                if (converted instanceof JSONObject object) {
                    return object;
                }
            } catch (Exception ignored) {
            }
        }
        throw invalid(path + "必须是对象");
    }

    /**
     * 创建结构化草稿解析异常。
     *
     * @param message String 字段级错误说明
     * @return DraftStructureException 解析异常
     */
    private static DraftStructureException invalid(String message) {
        return new DraftStructureException(message);
    }

    /**
     * 剧本结构化草稿字段或嵌套类型不符合协议时抛出的异常。
     */
    public static final class DraftStructureException extends RuntimeException {

        /**
         * 创建草稿结构异常。
         *
         * @param message String 字段级错误说明
         */
        private DraftStructureException(String message) {
            super(message);
        }
    }
}
