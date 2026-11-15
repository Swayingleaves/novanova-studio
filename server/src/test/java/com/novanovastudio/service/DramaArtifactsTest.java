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
}
