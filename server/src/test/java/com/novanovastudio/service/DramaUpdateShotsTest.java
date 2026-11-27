package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.dto.DramaDtos;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * 手动编辑分镜表规范化逻辑测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-26 23:20
 */
class DramaUpdateShotsTest {

    @Test
    void normalizeManualShotsReordersAndPreservesIds() {
        JSONObject previous = new JSONObject()
                .fluentPut("shots", new JSONArray()
                        .fluentAdd(new JSONObject().fluentPut("id", "id-sh1").fluentPut("ref", "sh1"))
                        .fluentAdd(new JSONObject().fluentPut("id", "id-sh2").fluentPut("ref", "sh2")));
        JSONObject cast = new JSONObject()
                .fluentPut("characters", new JSONArray().fluentAdd(new JSONObject().fluentPut("ref", "c1").fluentPut("name", "林澈")))
                .fluentPut("locations", new JSONArray().fluentAdd(new JSONObject().fluentPut("ref", "l1").fluentPut("name", "江岸")));

        List<DramaDtos.ShotPatch> patches = List.of(
                new DramaDtos.ShotPatch("", "sh2", 8, "隔江望两岸", "远景", "缓慢拉远", "对岸高楼剪影", "同一条江", "镜头缓缓拉远", "隔江望", "节奏：矛盾", "c1", "l1"),
                new DramaDtos.ShotPatch("id-sh1", "sh1", 6, "江上第一笔", "全景", "右移", "宽幅速写江岸", "从江岸画起", "", "一条江", "节奏：钩子", "c1", "l1"));

        JSONObject result = DramaArtifacts.normalizeManualShots(patches, previous, cast);
        JSONArray shots = result.getJSONArray("shots");
        assertEquals(2, shots.size());

        JSONObject first = shots.getJSONObject(0);
        assertEquals("id-sh2", first.getString("id"));
        assertEquals("sh2", first.getString("ref"));
        assertEquals(1, first.getIntValue("order"));
        assertEquals(8, first.getIntValue("durationSeconds"));
        assertEquals("隔江望两岸", first.getString("title"));
        assertEquals("隔江望", first.getString("screenText"));
        assertEquals("节奏：矛盾", first.getString("rhythm"));

        JSONObject second = shots.getJSONObject(1);
        assertEquals("id-sh1", second.getString("id"));
        assertEquals(2, second.getIntValue("order"));
        assertEquals("宽幅速写江岸", second.getString("videoPrompt"));
    }

    @Test
    void normalizeManualShotsRejectsEmptyOrDuplicateRefs() {
        assertThrows(BusinessException.class, () -> DramaArtifacts.normalizeManualShots(List.of(), null, null));
        List<DramaDtos.ShotPatch> duplicate = List.of(
                new DramaDtos.ShotPatch("", "sh1", 5, "", "", "", "画面一", "", "", "", "", "", ""),
                new DramaDtos.ShotPatch("", "sh1", 5, "", "", "", "画面二", "", "", "", "", "", ""));
        assertThrows(BusinessException.class, () -> DramaArtifacts.normalizeManualShots(duplicate, null, null));
    }

    @Test
    void normalizeGeneratedShotsKeepsTitleAndFallsBackWhenBlank() {
        JSONObject raw = new JSONObject().fluentPut("shot", new JSONObject().fluentPut("shots", new JSONArray()
                .fluentAdd(new JSONObject()
                        .fluentPut("ref", "sh1")
                        .fluentPut("title", "江上第一笔")
                        .fluentPut("rhythm", "钩子 · 笔尖勾出江岸")
                        .fluentPut("durationSeconds", 6)
                        .fluentPut("picture", "米色宽幅速写纸上勾出江岸线"))
                .fluentAdd(new JSONObject()
                        .fluentPut("ref", "sh2")
                        .fluentPut("durationSeconds", 8)
                        .fluentPut("picture", "雨夜巷口灯光摇晃，外卖员停下脚步"))));

        JSONObject result = DramaArtifacts.normalize("shot", raw, null, null, null, 60);
        JSONArray shots = result.getJSONArray("shots");
        assertEquals("江上第一笔", shots.getJSONObject(0).getString("title"));
        assertEquals("钩子 · 笔尖勾出江岸", shots.getJSONObject(0).getString("rhythm"));
        assertEquals("雨夜巷口灯光摇晃", shots.getJSONObject(1).getString("title"));
    }
}
