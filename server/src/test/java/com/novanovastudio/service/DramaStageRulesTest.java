package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import org.junit.jupiter.api.Test;

/**
 * 短剧阶段推进和产物短序号的纯规则。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-14 00:40
 */
class DramaStageRulesTest {

    /**
     * 确认只指向下一阶段，修改则把后续阶段列为待更新。
     */
    @Test
    void stageOrderStopsAtPreviewAndListsDownstream() {
        assertEquals("script", DramaStageRules.next("plan"));
        assertNull(DramaStageRules.next("preview"));
        assertEquals(java.util.List.of("preview"), DramaStageRules.downstream("shot"));
        assertTrue(DramaStageRules.canRevise("preview", "script", true));
        assertFalse(DramaStageRules.canRevise("plan", "script", false));
        assertEquals("720x1280", DramaArtifacts.videoSize("1280x720", "9:16"));
        assertEquals("720x1280", DramaArtifacts.videoSize("720x1280", "9:16"));
        assertEquals("9:16", DramaArtifacts.videoSize("9:16", "9:16"));
    }

    /**
     * 同一短序号沿用原标识，非法序号整份拒绝。
     */
    @Test
    void artifactReusesShortRefAndRejectsUnknownRef() {
        JSONObject previous = JSON.parseObject("{\"characters\":[{\"id\":\"kept\",\"ref\":\"c1\",\"name\":\"甲\"}]}");
        JSONObject raw = JSON.parseObject("{\"cast\":{\"characters\":[{\"ref\":\"c1\",\"name\":\"甲\",\"personality\":\"冷静\",\"appearance\":\"黑衣\"}],\"locations\":[{\"ref\":\"l1\",\"name\":\"巷口\",\"visual\":\"夜雨\"}]}}");
        JSONObject content = DramaArtifacts.normalize("cast", raw, previous, null, null, 60);
        assertEquals("kept", content.getJSONArray("characters").getJSONObject(0).getString("id"));

        JSONObject broken = JSON.parseObject("{\"storyboard\":{\"shots\":[{\"ref\":\"sh1\",\"picture\":\"近景\",\"characterRef\":\"c9\"}]}}");
        JSONObject cast = JSON.parseObject("{\"characters\":[{\"ref\":\"c1\"}],\"locations\":[{\"ref\":\"l1\"}]}");
        assertThrows(BusinessException.class, () -> DramaArtifacts.normalize("storyboard", broken, null, cast, null, 60));
    }
}
