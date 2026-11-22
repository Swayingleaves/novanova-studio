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
    void shotKeepsKnownCharactersAndDropsUnknownOnes() {
        com.alibaba.fastjson2.JSONObject cast = com.alibaba.fastjson2.JSON.parseObject("{\"characters\":[{\"ref\":\"c1\",\"name\":\"指挥官\"}],\"locations\":[{\"ref\":\"l1\",\"name\":\"指挥大厅\"}]}");
        com.alibaba.fastjson2.JSONObject raw = com.alibaba.fastjson2.JSON.parseObject("{\"shot\":{\"shots\":[{\"ref\":\"sh1\",\"picture\":\"抬头\",\"durationSeconds\":12,\"characterRef\":\"指挥官\",\"locationRef\":\"l1\",\"videoPrompt\":\"镜头推进\"},{\"ref\":\"sh2\",\"picture\":\"离开\",\"durationSeconds\":12,\"characterRef\":\"c4\",\"locationRef\":\"火星\"}]}}");
        com.alibaba.fastjson2.JSONObject stored = DramaArtifacts.normalize("shot", raw, null, cast, null, 60);
        com.alibaba.fastjson2.JSONArray shots = stored.getJSONArray("shots");
        assertEquals("c1", shots.getJSONObject(0).getString("characterRef"));
        assertEquals("l1", shots.getJSONObject(0).getString("locationRef"));
        assertEquals("镜头推进", shots.getJSONObject(0).getString("videoPrompt"));
        assertEquals("", shots.getJSONObject(1).getString("characterRef"));
        assertEquals("", shots.getJSONObject(1).getString("locationRef"));
        assertEquals("离开", shots.getJSONObject(1).getString("videoPrompt"));
    }

    @Test
    void shotKeepsCustomShotCountAndDurationAndFallsBackToPrevious() {
        com.alibaba.fastjson2.JSONObject previous = com.alibaba.fastjson2.JSON.parseObject(
                "{\"shots\":[{\"ref\":\"sh1\",\"durationSeconds\":10},{\"ref\":\"sh2\",\"durationSeconds\":10},{\"ref\":\"sh3\",\"durationSeconds\":10}]}");
        com.alibaba.fastjson2.JSONObject raw = com.alibaba.fastjson2.JSON.parseObject(
                "{\"shot\":{\"shots\":[{\"ref\":\"sh1\",\"picture\":\"第一镜\",\"durationSeconds\":30,\"videoPrompt\":\"前30秒\"},{\"ref\":\"sh2\",\"picture\":\"第二镜\",\"videoPrompt\":\"沿用上一版时长\"}]}}");
        com.alibaba.fastjson2.JSONObject stored = DramaArtifacts.normalize("shot", raw, previous, null, null, 60);
        com.alibaba.fastjson2.JSONArray shots = stored.getJSONArray("shots");
        assertEquals(2, shots.size());
        assertEquals(30, shots.getJSONObject(0).getIntValue("durationSeconds"));
        assertEquals(10, shots.getJSONObject(1).getIntValue("durationSeconds"));
    }
}
