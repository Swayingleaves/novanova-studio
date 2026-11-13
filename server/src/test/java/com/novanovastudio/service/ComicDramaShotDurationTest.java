package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.novanovastudio.common.BusinessException;
import org.junit.jupiter.api.Test;

/**
 * 漫剧自动拆分镜头的单镜头时长档位。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-09 23:50
 */
class ComicDramaShotDurationTest {

    @Test
    void shouldDescribeEachShotDurationLevelForTheStoryboardAgent() {
        assertEquals("每个镜头时长控制在 5 秒左右，只使用 4、5 或 6 秒，并以 5 秒为主",
                ComicDramaService.shotDurationInstruction("short"));
        assertEquals("每个镜头时长控制在 5 到 8 秒", ComicDramaService.shotDurationInstruction("medium"));
        assertEquals("每个镜头时长控制在 10 到 15 秒，不要短于 10 秒，也不要超过 15 秒",
                ComicDramaService.shotDurationInstruction("long"));
        assertThrows(BusinessException.class, () -> ComicDramaService.shotDurationInstruction("tiny"));
    }

    @Test
    void shouldKeepReturnedShotDurationInsideTheSelectedRange() {
        assertEquals(5, ComicDramaService.alignShotDuration("short", 5));
        assertEquals(4, ComicDramaService.alignShotDuration("short", 1));
        assertEquals(6, ComicDramaService.alignShotDuration("short", 9));
        assertEquals(5, ComicDramaService.alignShotDuration("medium", 3));
        assertEquals(8, ComicDramaService.alignShotDuration("medium", 8));
        assertEquals(8, ComicDramaService.alignShotDuration("medium", 12));
        assertEquals(10, ComicDramaService.alignShotDuration("long", 6));
        assertEquals(12, ComicDramaService.alignShotDuration("long", 12));
        assertEquals(15, ComicDramaService.alignShotDuration("long", 20));
        assertThrows(BusinessException.class, () -> ComicDramaService.alignShotDuration("tiny", 5));
    }

    @Test
    void shouldUseFewerShotsWhenTheSameScriptUsesALongerDuration() {
        String script = "林晚推开门，看见桌上的旧照片。她拿起来擦了擦，低声说了一句我回来了，然后在窗边坐下。"
                + "雨还在下，她把照片翻过来，背面写着今年冬天。";

        int shortCount = ComicDramaService.estimateShotCount("short", script);
        int mediumCount = ComicDramaService.estimateShotCount("medium", script);
        int longCount = ComicDramaService.estimateShotCount("long", script);

        assertTrue(shortCount > mediumCount && mediumCount > longCount);
        assertEquals("请拆分为约8个镜头", ComicDramaService.shotPlanInstruction(8, "long", script));
        assertTrue(ComicDramaService.shotPlanInstruction(null, "long", script).contains("约" + longCount + "个镜头"));
        assertEquals(1, ComicDramaService.estimateShotCount("long", "……"));
        assertThrows(BusinessException.class, () -> ComicDramaService.estimateShotCount("tiny", script));
    }
}
