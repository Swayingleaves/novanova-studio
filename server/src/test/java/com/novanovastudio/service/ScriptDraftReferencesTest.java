package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.dto.ScriptDtos;
import org.junit.jupiter.api.Test;

/**
 * 剧本生成引用短序号的往返映射与非法引用边界测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-10-28 11:00
 */
class ScriptDraftReferencesTest {

    /**
     * 验证设定、人物关系和重复目标快照统一使用短序号，正式快照与正文不被替换。
     */
    @Test
    void shouldTranslateAllFormalReferencesWithoutChangingSourceOrText() {
        JSONObject source = context();
        String original = source.toJSONString();
        JSONObject model = new ScriptDraftReferences(source).context();

        assertEquals("character1", model.getJSONObject("project").getJSONArray("characters").getJSONObject(0).getString("id"));
        assertEquals("location1", model.getJSONObject("project").getJSONArray("locations").getJSONObject(0).getString("id"));
        JSONObject relation = model.getJSONObject("project").getJSONArray("characterRelations").getJSONObject(0);
        assertEquals("character1", relation.getString("sourceCharacterId"));
        assertEquals("character2", relation.getString("targetCharacterId"));
        JSONObject scene = model.getJSONObject("episode").getJSONArray("scenes").getJSONObject(0);
        assertEquals("location1", scene.getString("locationId"));
        assertEquals("character1", scene.getJSONArray("characterIds").getString(0));
        assertEquals("character1", scene.getJSONArray("blocks").getJSONObject(0).getString("characterId"));
        assertEquals("location1", model.getJSONObject("target").getString("locationId"));
        assertEquals("shared-original", scene.getJSONArray("blocks").getJSONObject(0).getString("content"));
        assertEquals("shared-original", model.getJSONObject("project").getJSONArray("characters").getJSONObject(0).getString("name"));
        assertEquals(original, source.toJSONString());
    }

    /**
     * 验证人物与地点共用正式标识或正式标识恰好等于短序号时仍能精确往返。
     */
    @Test
    void shouldRestoreReferencesByEntityTypeWithoutAliasCollisions() {
        ScriptDraftReferences references = new ScriptDraftReferences(context());
        JSONObject draft = JSON.parseObject("""
                {"id":"scene-new","locationId":"location1","characterIds":["character1","character2"],
                 "blocks":[{"id":"block-new","characterId":"character2","content":"character1"}]}
                """);

        JSONObject restored = references.restore(new ScriptDtos.GeneratedDraft(draft)).draftData();

        assertEquals("shared-original", restored.getString("locationId"));
        assertEquals("shared-original", restored.getJSONArray("characterIds").getString(0));
        assertEquals("character1", restored.getJSONArray("characterIds").getString(1));
        assertEquals("character1", restored.getJSONArray("blocks").getJSONObject(0).getString("characterId"));
        assertEquals("character1", restored.getJSONArray("blocks").getJSONObject(0).getString("content"));
        assertEquals("scene-new", restored.getString("id"));
    }

    /**
     * 验证小说改编使用根层正式列表，事实标识不参与正式引用映射。
     */
    @Test
    void shouldTranslateAdaptationContextWithoutChangingFactIdentifiers() {
        JSONObject source = context().getJSONObject("project");
        source.put("confirmedFacts", JSON.parseArray("[{\"id\":\"shared-original\",\"name\":\"事实\"}]"));

        JSONObject model = new ScriptDraftReferences(source).context();

        assertEquals("character1", model.getJSONArray("characters").getJSONObject(0).getString("id"));
        assertEquals("location1", model.getJSONArray("locations").getJSONObject(0).getString("id"));
        assertEquals("shared-original", model.getJSONArray("confirmedFacts").getJSONObject(0).getString("id"));
    }

    /**
     * 验证不存在的地点、人物和跨类型引用明确失败并定位字段，不自动丢弃引用。
     */
    @Test
    void shouldRejectUnknownAndCrossTypeReferences() {
        ScriptDraftReferences references = new ScriptDraftReferences(context());
        for (JSONObject draft : new JSONObject[] {
                JSONObject.of("locationId", "location3"), JSONObject.of("locationId", "character1"),
                JSONObject.of("characterIds", JSON.parseArray("[\"character0\"]")),
                JSONObject.of("characterId", "shared-original")}) {
            BusinessException exception = assertThrows(BusinessException.class,
                    () -> references.restore(new ScriptDtos.GeneratedDraft(draft)));
            assertTrue(exception.getMessage().contains("draftData."));
            assertTrue(exception.getMessage().contains("标识="));
        }
    }

    /**
     * 验证没有正式地点时可以保留空引用，新编地点仍被拒绝。
     */
    @Test
    void shouldAllowEmptyLocationWithoutInventingOne() {
        ScriptDraftReferences references = new ScriptDraftReferences(JSON.parseObject("{\"characters\":[],\"locations\":[]}"));
        JSONObject draft = JSONObject.of("locationId", "", "characterId", "", "characterIds", JSON.parseArray("[]"));

        assertEquals("", references.restore(new ScriptDtos.GeneratedDraft(draft)).draftData().getString("locationId"));
        assertThrows(BusinessException.class,
                () -> references.restore(new ScriptDtos.GeneratedDraft(JSONObject.of("locationId", "location1"))));
    }

    /**
     * 构造包含标识冲突与重复正式引用的普通剧本上下文。
     *
     * @return JSONObject 含正式列表、人物关系和目标快照的上下文
     */
    private JSONObject context() {
        return JSON.parseObject("""
                {"project":{"characters":[{"id":"shared-original","name":"shared-original"},
                                            {"id":"character1","name":"配角"}],
                            "locations":[{"id":"shared-original","name":"客厅"}],
                            "characterRelations":[{"id":"relation-a","sourceCharacterId":"shared-original",
                                                     "targetCharacterId":"character1"}]},
                 "episode":{"scenes":[{"id":"scene-a","locationId":"shared-original",
                           "characterIds":["shared-original"],"blocks":[{"id":"block-a",
                           "characterId":"shared-original","content":"shared-original"}]}]},
                 "target":{"id":"scene-a","locationId":"shared-original"}}
                """);
    }
}
