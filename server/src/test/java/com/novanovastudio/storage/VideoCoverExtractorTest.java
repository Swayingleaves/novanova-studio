package com.novanovastudio.storage;

import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * 视频封面截帧命令测试。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-11 10:44
 */
class VideoCoverExtractorTest {

    @Test
    void 截帧命令读取第一帧并限制长边() {
        List<String> command = VideoCoverExtractor.command("ffmpeg-custom", Path.of("clip.mp4"), Path.of("cover.jpg"));
        Assertions.assertEquals("ffmpeg-custom", command.getFirst());
        Assertions.assertTrue(command.contains("-frames:v"));
        Assertions.assertEquals("1", command.get(command.indexOf("-frames:v") + 1));
        Assertions.assertTrue(command.contains("scale=160:160:force_original_aspect_ratio=decrease"));
        Assertions.assertTrue(command.getLast().endsWith("cover.jpg"));
    }
}
