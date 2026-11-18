package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.dto.ScriptDtos;
import org.junit.jupiter.api.Test;

/**
 * 剧本单集目标时长解析与场次、字数预算单元测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-18 09:48
 */
class ScriptDurationBudgetTest {

    /**
     * 验证单集目标时长按“请求显式值 > 分集自身时长 > 概览总时长均摊 > 默认180秒”优先级解析。
     */
    @Test
    void shouldResolveEpisodeSecondsByPriority() {
        ScriptDtos.ProjectOverview overview = new ScriptDtos.ProjectOverview(
                "漫剧", "comicDrama", "", "", "", 1200, 10, "", "", "", "", "");
        ScriptDtos.EpisodeSummary episode = new ScriptDtos.EpisodeSummary(
                "ep-1", 1, "第一集", "", "", "", "", "", 150, "planning", 0);

        assertEquals(90, ScriptDurationBudget.resolveEpisodeSeconds(90, episode, overview));
        assertEquals(150, ScriptDurationBudget.resolveEpisodeSeconds(null, episode, overview));
        assertEquals(120, ScriptDurationBudget.resolveEpisodeSeconds(null, null, overview));
        assertEquals(180, ScriptDurationBudget.resolveEpisodeSeconds(null, null, null));
    }

    /**
     * 验证 3 分钟（180秒）单集生成的场次数预算与正文总字数上限符合预期。
     */
    @Test
    void shouldBuildSceneAndCharacterBudgetInstructionsForThreeMinuteEpisode() {
        String planInstruction = ScriptDurationBudget.episodePlanInstruction(180);
        String bodyInstruction = ScriptDurationBudget.episodeBodyInstruction(180);

        assertTrue(planInstruction.contains("180 秒"));
        assertTrue(planInstruction.contains("9-15 个场次"));
        assertTrue(bodyInstruction.contains("9-15 场"));
        assertTrue(bodyInstruction.contains("900 字以内"));
    }

    /**
     * 验证单集目标时长可正确写回分集规划草稿与单集正文草稿。
     */
    @Test
    void shouldApplyEpisodeDurationToGeneratedDrafts() {
        JSONObject planDraft = JSONObject.of("episodes", JSONArray.of(
                JSONObject.of("id", "ep-1", "targetDurationSeconds", 0),
                JSONObject.of("id", "ep-2", "targetDurationSeconds", 90)));
        ScriptDurationBudget.applyEpisodeDuration(planDraft, "episodes", 180, false);
        assertEquals(180, planDraft.getJSONArray("episodes").getJSONObject(0).getIntValue("targetDurationSeconds"));
        assertEquals(90, planDraft.getJSONArray("episodes").getJSONObject(1).getIntValue("targetDurationSeconds"));

        ScriptDurationBudget.applyEpisodeDuration(planDraft, "episodes", 180, true);
        assertEquals(180, planDraft.getJSONArray("episodes").getJSONObject(1).getIntValue("targetDurationSeconds"));

        JSONObject episodeDraft = JSONObject.of("episode", JSONObject.of("id", "ep-1", "targetDurationSeconds", 60));
        ScriptDurationBudget.applyEpisodeDuration(episodeDraft, "episode", 120, true);
        assertEquals(120, episodeDraft.getJSONObject("episode").getIntValue("targetDurationSeconds"));
    }
}
