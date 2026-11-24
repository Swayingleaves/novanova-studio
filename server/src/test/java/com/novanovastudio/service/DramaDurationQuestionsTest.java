package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import org.junit.jupiter.api.Test;

/**
 * 验证智能短剧总时长与分镜单镜时长询问、选项结构及用户输入解析。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-24 22:08
 */
class DramaDurationQuestionsTest {

    @Test
    void parseTotalDurationSecondsSupportsCommonFormats() {
        assertEquals(30, DramaDurationQuestions.parseTotalDurationSeconds("总时长 30 秒"));
        assertEquals(60, DramaDurationQuestions.parseTotalDurationSeconds("总时长 60 秒（1 分钟）"));
        assertEquals(60, DramaDurationQuestions.parseTotalDurationSeconds("1分钟"));
        assertEquals(60, DramaDurationQuestions.parseTotalDurationSeconds("一分钟"));
        assertEquals(90, DramaDurationQuestions.parseTotalDurationSeconds("1分30秒"));
        assertEquals(90, DramaDurationQuestions.parseTotalDurationSeconds("1分半"));
        assertEquals(90, DramaDurationQuestions.parseTotalDurationSeconds("1.5分钟"));
        assertEquals(120, DramaDurationQuestions.parseTotalDurationSeconds("两分钟"));
        assertEquals(45, DramaDurationQuestions.parseTotalDurationSeconds("45s"));
        assertEquals(45, DramaDurationQuestions.parseTotalDurationSeconds("45"));
        assertEquals(180, DramaDurationQuestions.parseTotalDurationSeconds("300秒"));
        assertEquals(15, DramaDurationQuestions.parseTotalDurationSeconds("10秒"));
        assertNull(DramaDurationQuestions.parseTotalDurationSeconds("先帮我分析一下剧情风格"));
    }

    @Test
    void detectsShotDurationAnswersAccurately() {
        assertTrue(DramaDurationQuestions.isShotDurationAnswer("每个镜头 10~15 秒（常规镜头）"));
        assertTrue(DramaDurationQuestions.isShotDurationAnswer("每个镜头 20~30 秒（超长镜头）"));
        assertTrue(DramaDurationQuestions.isShotDurationAnswer("长镜头"));
        assertTrue(DramaDurationQuestions.isShotDurationAnswer("每镜30秒"));
        assertTrue(DramaDurationQuestions.isShotDurationAnswer("12"));
        assertFalse(DramaDurationQuestions.isShotDurationAnswer("哪个视频模型支持30秒？"));
    }

    @Test
    void buildsVerticalSingleSelectQuestionMetaWithCustomInput() {
        JSONObject totalMeta = JSON.parseObject(DramaDurationQuestions.totalDurationMeta());
        assertEquals("question", totalMeta.getString("kind"));
        assertEquals("plan", totalMeta.getString("stage"));
        assertEquals("total_duration", totalMeta.getString("questionType"));
        assertFalse(totalMeta.getBooleanValue("multiple"));
        JSONArray totalChoices = totalMeta.getJSONArray("choices");
        assertEquals(5, totalChoices.size());
        assertTrue(totalChoices.getJSONObject(4).getBooleanValue("customInput"));

        JSONObject shotMeta = JSON.parseObject(DramaDurationQuestions.shotDurationMeta());
        assertEquals("question", shotMeta.getString("kind"));
        assertEquals("shot", shotMeta.getString("stage"));
        assertEquals("shot_duration", shotMeta.getString("questionType"));
        assertFalse(shotMeta.getBooleanValue("multiple"));
        JSONArray shotChoices = shotMeta.getJSONArray("choices");
        assertEquals(5, shotChoices.size());
        assertTrue(shotChoices.getJSONObject(2).getString("description").contains("30 秒"));
        assertTrue(shotChoices.getJSONObject(4).getBooleanValue("customInput"));
    }

    @Test
    void attachesDirectorChoicesToAnswerMeta() {
        JSONObject meta = new JSONObject();
        JSONObject raw = JSON.parseObject("""
                {
                  "multiple": true,
                  "choices": [
                    { "label": "赛博朋克", "value": "赛博朋克风格" },
                    { "label": "水墨国风" },
                    { "label": "自己输入", "customInput": true, "placeholder": "输入风格" }
                  ]
                }
                """);
        DramaDurationQuestions.attachChoices(meta, raw);
        assertTrue(meta.getBooleanValue("multiple"));
        JSONArray choices = meta.getJSONArray("choices");
        assertEquals(3, choices.size());
        assertEquals("水墨国风", choices.getJSONObject(1).getString("value"));
        assertTrue(choices.getJSONObject(2).getBooleanValue("customInput"));
    }
}
