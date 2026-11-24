package com.novanovastudio.service;

import com.novanovastudio.ai.VideoGenerationMode;
import com.novanovastudio.dto.AiTaskDtos;
import java.util.List;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * 智能短剧分镜视频模式选择与全能参考回退单元测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-24 21:55:00
 */
class DramaMediaServiceVideoModeTest {

    @Test
    void fallsBackToReferenceToVideoWhenFirstLastFrameDisabled() {
        List<AiTaskDtos.AiTaskMediaReference> refs = List.of(
                new AiTaskDtos.AiTaskMediaReference("1", "shot-first:sh1", "image/png", "k1", "https://example.com/1.png", "first_frame"),
                new AiTaskDtos.AiTaskMediaReference("2", "shot-last:sh1", "image/png", "k2", "https://example.com/2.png", "last_frame"));

        String mode = DramaMediaService.resolveVideoMode("shot-video:sh1", "video", refs,
                List.of(VideoGenerationMode.TEXT_TO_VIDEO, VideoGenerationMode.REFERENCE_TO_VIDEO));

        assertEquals(VideoGenerationMode.REFERENCE_TO_VIDEO, mode);
        List<AiTaskDtos.AiTaskMediaReference> adjusted = DramaMediaService.adjustReferenceRolesForVideoMode(refs, mode);
        assertEquals(List.of("reference_image", "reference_image"), adjusted.stream().map(AiTaskDtos.AiTaskMediaReference::role).toList());
    }

    @Test
    void prefersFirstLastFrameWhenEnabled() {
        List<AiTaskDtos.AiTaskMediaReference> refs = List.of(
                new AiTaskDtos.AiTaskMediaReference("1", "shot-first:sh1", "image/png", "k1", "https://example.com/1.png", "first_frame"),
                new AiTaskDtos.AiTaskMediaReference("2", "shot-last:sh1", "image/png", "k2", "https://example.com/2.png", "last_frame"));

        String mode = DramaMediaService.resolveVideoMode("shot-video:sh1", "video", refs,
                List.of(VideoGenerationMode.FIRST_LAST_FRAME_TO_VIDEO, VideoGenerationMode.REFERENCE_TO_VIDEO));

        assertEquals(VideoGenerationMode.FIRST_LAST_FRAME_TO_VIDEO, mode);
        List<AiTaskDtos.AiTaskMediaReference> adjusted = DramaMediaService.adjustReferenceRolesForVideoMode(refs, mode);
        assertEquals(List.of("first_frame", "last_frame"), adjusted.stream().map(AiTaskDtos.AiTaskMediaReference::role).toList());
    }

    @Test
    void fallsBackToReferenceToVideoForSingleFrameWhenImageToVideoDisabled() {
        List<AiTaskDtos.AiTaskMediaReference> refs = List.of(
                new AiTaskDtos.AiTaskMediaReference("1", "shot-first:sh1", "image/png", "k1", "https://example.com/1.png", "first_frame"));

        String mode = DramaMediaService.resolveVideoMode("shot-video:sh1", "video", refs,
                List.of(VideoGenerationMode.REFERENCE_TO_VIDEO));

        assertEquals(VideoGenerationMode.REFERENCE_TO_VIDEO, mode);
    }
}
