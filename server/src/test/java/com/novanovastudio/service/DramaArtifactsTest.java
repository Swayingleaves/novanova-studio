package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class DramaArtifactsTest {

    @Test
    void storyboardKeepsTheDurationTheAgentChose() {
        assertEquals(12, DramaArtifacts.storyboardDuration(null));
        assertEquals(5, DramaArtifacts.storyboardDuration(5));
        assertEquals(12, DramaArtifacts.storyboardDuration(12));
        assertEquals(20, DramaArtifacts.storyboardDuration(20));
    }

    @Test
    void storyboardKeepsKnownCharactersAndDropsUnknownOnes() {
        com.alibaba.fastjson2.JSONObject cast = com.alibaba.fastjson2.JSON.parseObject("{\"characters\":[{\"ref\":\"c1\",\"name\":\"指挥官\"}],\"locations\":[{\"ref\":\"l1\",\"name\":\"指挥大厅\"}]}");
        com.alibaba.fastjson2.JSONObject raw = com.alibaba.fastjson2.JSON.parseObject("{\"storyboard\":{\"shots\":[{\"ref\":\"sh1\",\"picture\":\"抬头\",\"durationSeconds\":12,\"characterRef\":\"指挥官\",\"locationRef\":\"l1\"},{\"ref\":\"sh2\",\"picture\":\"离开\",\"durationSeconds\":12,\"characterRef\":\"c4\",\"locationRef\":\"火星\"}]}}");
        com.alibaba.fastjson2.JSONObject stored = DramaArtifacts.normalize("storyboard", raw, null, cast, null, 60);
        com.alibaba.fastjson2.JSONArray shots = stored.getJSONArray("shots");
        assertEquals("c1", shots.getJSONObject(0).getString("characterRef"));
        assertEquals("l1", shots.getJSONObject(0).getString("locationRef"));
        assertEquals("", shots.getJSONObject(1).getString("characterRef"));
        assertEquals("", shots.getJSONObject(1).getString("locationRef"));
    }

    @Test
    void shotKeepsCustomShotCountAndDurationAndFallsBackToStoryboard() {
        com.alibaba.fastjson2.JSONObject storyboard = com.alibaba.fastjson2.JSON.parseObject(
                "{\"shots\":[{\"ref\":\"sh1\",\"durationSeconds\":10},{\"ref\":\"sh2\",\"durationSeconds\":10},{\"ref\":\"sh3\",\"durationSeconds\":10}]}");
        com.alibaba.fastjson2.JSONObject raw = com.alibaba.fastjson2.JSON.parseObject(
                "{\"shot\":{\"shots\":[{\"ref\":\"sh1\",\"durationSeconds\":30,\"videoPrompt\":\"前30秒\"},{\"ref\":\"sh2\",\"videoPrompt\":\"沿用分镜时长\"}]}}");
        com.alibaba.fastjson2.JSONObject stored = DramaArtifacts.normalize("shot", raw, null, null, storyboard, 60);
        com.alibaba.fastjson2.JSONArray shots = stored.getJSONArray("shots");
        assertEquals(2, shots.size());
        assertEquals(30, shots.getJSONObject(0).getIntValue("durationSeconds"));
        assertEquals(10, shots.getJSONObject(1).getIntValue("durationSeconds"));
    }
}
