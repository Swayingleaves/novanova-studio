package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * 短剧生成目标只解析阶段、媒体类型和必需参考图，提示词由 Agent 写。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-15 16:20
 */
class DramaMediaTargetsTest {

    @Test
    void resolvesStageAndMediaType() {
        JSONObject cast = JSON.parseObject("{\"characters\":[{\"ref\":\"c1\",\"name\":\"外卖员\",\"appearance\":\"湿透的深蓝工装\"}]}");
        JSONObject shots = JSON.parseObject("{\"shots\":[{\"ref\":\"sh1\",\"picture\":\"雨夜抬头\",\"durationSeconds\":13}]}");
        DramaMediaTargets.Spec character = DramaMediaTargets.resolve("character:c1", cast, shots);
        assertEquals("cast", character.stage());
        assertEquals("image", character.mediaType());
        assertEquals(0, character.seconds());
        DramaMediaTargets.Spec first = DramaMediaTargets.resolve("shot-first:sh1", null, shots);
        assertEquals("shot", first.stage());
        assertEquals("image", first.mediaType());
        assertEquals(0, first.seconds());
        DramaMediaTargets.Spec last = DramaMediaTargets.resolve("shot-last:sh1", null, shots);
        assertEquals("shot", last.stage());
        assertEquals("image", last.mediaType());
        assertEquals(0, last.seconds());
    }

    @Test
    void lastFrameAndVideoRequireFirstFrame() {
        assertTrue(DramaMediaTargets.requiredReferences("shot-first:sh1").isEmpty());
        assertEquals(List.of("shot-first:sh1"), DramaMediaTargets.requiredReferences("shot-last:sh1"));
        assertEquals(List.of("shot-first:sh1"), DramaMediaTargets.requiredReferences("shot-video:sh1"));
    }

    @Test
    void videoUsesTheShotDuration() {
        JSONObject shots = JSON.parseObject("{\"shots\":[{\"ref\":\"sh1\",\"durationSeconds\":9},{\"ref\":\"sh2\"}]}");
        DramaMediaTargets.Spec video = DramaMediaTargets.resolve("shot-video:sh1", null, shots);
        assertEquals("shot", video.stage());
        assertEquals("video", video.mediaType());
        assertEquals(9, video.seconds());
        assertEquals(5, DramaMediaTargets.resolve("shot-video:sh2", null, shots).seconds());
    }

    @Test
    void missingEntryIsRejected() {
        assertThrows(BusinessException.class, () -> DramaMediaTargets.resolve("shot-first:sh9", JSON.parseObject("{\"shots\":[]}"), null));
    }
}
