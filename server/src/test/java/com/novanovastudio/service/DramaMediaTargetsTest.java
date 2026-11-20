package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.List;
import javax.imageio.ImageIO;
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
        JSONObject storyboard = JSON.parseObject("{\"shots\":[{\"ref\":\"sh1\",\"picture\":\"雨夜抬头\",\"durationSeconds\":13}]}");
        DramaMediaTargets.Spec character = DramaMediaTargets.resolve("character:c1", cast, storyboard);
        assertEquals("cast", character.stage());
        assertEquals("image", character.mediaType());
        assertEquals(0, character.seconds());
        DramaMediaTargets.Spec sheet = DramaMediaTargets.resolve("sheet:sh1", null, storyboard);
        assertEquals("storyboard", sheet.stage());
        assertEquals("image", sheet.mediaType());
        assertEquals(13, sheet.seconds());
    }

    @Test
    void eachSheetRequiresThePreviousLastFrame() {
        JSONObject storyboard = JSON.parseObject("{\"shots\":[{\"ref\":\"sh1\",\"order\":1},{\"ref\":\"sh2\",\"order\":2}]}");
        assertTrue(DramaMediaTargets.requiredReferences("sheet:sh1", storyboard).isEmpty());
        assertEquals(List.of("cut:last:sh1"), DramaMediaTargets.requiredReferences("sheet:sh2", storyboard));
        assertTrue(DramaMediaTargets.requiredReferences("board:sh2", storyboard).isEmpty());
    }

    @Test
    void videoUsesTheShotDuration() {
        JSONObject storyboard = JSON.parseObject("{\"shots\":[{\"ref\":\"sh1\",\"durationSeconds\":9},{\"ref\":\"sh2\"}]}");
        DramaMediaTargets.Spec video = DramaMediaTargets.resolve("shot-video:sh1", null, storyboard);
        assertEquals("storyboard", video.stage());
        assertEquals("video", video.mediaType());
        assertEquals(9, video.seconds());
        assertEquals(5, DramaMediaTargets.resolve("shot-video:sh2", null, storyboard).seconds());
    }

    @Test
    void cropSheetKeepsTheOpeningAndClosingCells() throws Exception {
        BufferedImage image = new BufferedImage(8, 6, BufferedImage.TYPE_INT_RGB);
        image.setRGB(0, 0, 0xFF0000);
        image.setRGB(7, 5, 0x0000FF);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        ImageIO.write(image, "png", output);
        byte[][] cells = DramaArtifacts.cropSheet(output.toByteArray());
        BufferedImage first = ImageIO.read(new ByteArrayInputStream(cells[0]));
        BufferedImage last = ImageIO.read(new ByteArrayInputStream(cells[1]));
        assertEquals(0xFF0000, first.getRGB(0, 0) & 0xFFFFFF);
        assertEquals(0x0000FF, last.getRGB(last.getWidth() - 1, last.getHeight() - 1) & 0xFFFFFF);
    }

    @Test
    void missingEntryIsRejected() {
        assertThrows(BusinessException.class, () -> DramaMediaTargets.resolve("board:sh9", JSON.parseObject("{\"shots\":[]}"), null));
    }
}
