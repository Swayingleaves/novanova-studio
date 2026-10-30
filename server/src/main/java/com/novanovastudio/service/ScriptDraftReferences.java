package com.novanovastudio.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.ScriptDtos;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.util.StringUtils;

/**
 * 剧本正文生成的人物、地点短序号映射，同一次调用的所有引用共用一套标识。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-10-28 11:00
 */
final class ScriptDraftReferences {

    /** 仅供本次模型调用使用的上下文副本。 */
    private final JSONObject context;
    /** 按字段区分的人物、地点短序号到正式标识的映射，允许两类实体使用相同正式标识。 */
    private final Map<String, Map<String, String>> originalIdentifiers;

    /**
     * 从普通剧本或小说改编上下文建立引用映射，不修改正式快照。
     *
     * @param source Object 包含正式人物、地点列表的上下文
     */
    ScriptDraftReferences(Object source) {
        context = JSON.parseObject(JSON.toJSONString(source));
        JSONObject settings = context.containsKey("project") ? context.getJSONObject("project") : context;
        Map<String, String> characters = identifiers(settings.getJSONArray("characters"), "character");
        Map<String, String> locations = identifiers(settings.getJSONArray("locations"), "location");
        Map<String, Map<String, String>> modelIdentifiers = fields(characters, locations);
        originalIdentifiers = fields(reverse(characters), reverse(locations));
        // 同时转换设定列表、人物关系、当前分集与目标快照，避免模型看到两种引用写法。
        translate(context, "", modelIdentifiers, "context", false);
    }

    /**
     * 获取已使用短序号的模型上下文。
     *
     * @return JSONObject 本次调用的上下文副本
     */
    JSONObject context() {
        return context;
    }

    /**
     * 在正式结构校验和保存前还原引用，未提供的序号明确报错。
     *
     * @param generated GeneratedDraft 模型返回的草稿
     * @return GeneratedDraft 仅引用正式人物和地点的草稿
     * @throws BusinessException 模型使用未提供的非空引用时抛出
     */
    ScriptDtos.GeneratedDraft restore(ScriptDtos.GeneratedDraft generated) {
        translate(generated.draftData(), "", originalIdentifiers, "draftData", true);
        return generated;
    }

    /**
     * 按正式列表顺序分配从一开始的短序号。
     *
     * @param entries JSONArray 正式实体列表
     * @param prefix String 实体类型全称
     * @return Map<String, String> 正式标识到短序号的映射
     */
    private static Map<String, String> identifiers(JSONArray entries, String prefix) {
        Map<String, String> result = new LinkedHashMap<>();
        for (int index = 0; index < entries.size(); index++) {
            result.put(entries.getJSONObject(index).getString("id"), prefix + (index + 1));
        }
        return result;
    }

    /**
     * 按字段绑定实体类型，防止人物和地点标识互相混用。
     *
     * @param characters Map<String, String> 人物标识映射
     * @param locations Map<String, String> 地点标识映射
     * @return Map<String, Map<String, String>> 各引用字段的映射
     */
    private static Map<String, Map<String, String>> fields(Map<String, String> characters, Map<String, String> locations) {
        return Map.of("characters", characters, "characterIds", characters, "characterId", characters,
                "sourceCharacterId", characters, "targetCharacterId", characters,
                "locations", locations, "locationId", locations);
    }

    /**
     * 反转一一对应的短序号映射。
     *
     * @param identifiers Map<String, String> 原始方向映射
     * @return Map<String, String> 相反方向映射
     */
    private static Map<String, String> reverse(Map<String, String> identifiers) {
        Map<String, String> result = new LinkedHashMap<>();
        identifiers.forEach((original, model) -> result.put(model, original));
        return result;
    }

    /**
     * 仅按结构化字段翻译引用，不替换名称、正文或故事事实中的普通文本。
     *
     * @param value Object 当前字段值
     * @param field String 当前引用字段或实体列表名称
     * @param identifiers Map<String, Map<String, String>> 本次翻译方向的映射
     * @param path String 当前字段路径，用于定位非法引用
     * @param restoring boolean 是否正在还原模型返回值
     * @return Object 翻译后的字段值
     * @throws BusinessException 非空引用不在正式列表或本次序号中时抛出
     */
    private static Object translate(Object value, String field, Map<String, Map<String, String>> identifiers,
                                    String path, boolean restoring) {
        if (value instanceof JSONObject object) {
            object.replaceAll((key, child) -> translate(child,
                    "id".equals(key) && ("characters".equals(field) || "locations".equals(field)) ? field : key,
                    identifiers, path + "." + key, restoring));
        } else if (value instanceof JSONArray array) {
            for (int index = 0; index < array.size(); index++) {
                array.set(index, translate(array.get(index), field, identifiers, path + "[" + index + "]", restoring));
            }
        } else if (value instanceof String identifier && StringUtils.hasText(identifier) && identifiers.containsKey(field)) {
            String translated = identifiers.get(field).get(identifier);
            if (translated == null) {
                String type = "locationId".equals(field) || "locations".equals(field) ? "地点" : "人物";
                throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR,
                        (restoring ? "剧本Agent返回了无效的" : "剧本上下文包含无效的") + type
                                + "引用：字段=" + path + "，标识=" + identifier);
            }
            return translated;
        }
        return value;
    }
}
