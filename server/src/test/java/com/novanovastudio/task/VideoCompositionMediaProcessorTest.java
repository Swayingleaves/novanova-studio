package com.novanovastudio.task;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.config.NovanovaProperties;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * 视频合成媒体处理器测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-11 00:00
 */
class VideoCompositionMediaProcessorTest {

    /**
     * 命令应以首段视频规格输出，并为缺失音轨补充静音。
     */
    @Test
    void shouldBuildNormalizedFfmpegCommand() {
        NovanovaProperties properties = new NovanovaProperties();
        properties.getAi().getVideoComposition().setFfmpegExecutable("ffmpeg-custom");
        VideoCompositionMediaProcessor processor = new VideoCompositionMediaProcessor(properties);
        List<String> command = processor.buildFfmpegCommand(
                List.of(Path.of("first.mp4"), Path.of("second.webm")),
                List.of(
                        new VideoCompositionMediaProcessor.VideoProbe(1920, 1080, "30000/1001", 5_000, true),
                        new VideoCompositionMediaProcessor.VideoProbe(1280, 720, "24", 3_000, false)
                ),
                Path.of("result.mp4")
        );

        String filter = command.get(command.indexOf("-filter_complex") + 1);
        Assertions.assertEquals("ffmpeg-custom", command.getFirst());
        Assertions.assertTrue(filter.contains("scale=1920:1080"));
        Assertions.assertTrue(filter.contains("fps=30000/1001"));
        Assertions.assertTrue(filter.contains("anullsrc=channel_layout=stereo:sample_rate=48000"));
        Assertions.assertTrue(command.containsAll(List.of("-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p")));
    }

    /**
     * 命令构造时文件与探测结果数量不一致必须拒绝。
     */
    @Test
    void shouldRejectMismatchedSourceAndProbeCounts() {
        VideoCompositionMediaProcessor processor = new VideoCompositionMediaProcessor(new NovanovaProperties());

        Assertions.assertThrows(IllegalArgumentException.class, () -> processor.buildFfmpegCommand(
                List.of(Path.of("first.mp4")),
                List.of(
                        new VideoCompositionMediaProcessor.VideoProbe(1920, 1080, "30", 5_000, true),
                        new VideoCompositionMediaProcessor.VideoProbe(1920, 1080, "30", 5_000, true)
                ),
                Path.of("result.mp4")
        ));
    }

    /**
     * 源视频总时长超过配置上限时必须失败。
     */
    @Test
    void shouldRejectSourceDurationOverLimit() {
        NovanovaProperties properties = new NovanovaProperties();
        properties.getAi().getVideoComposition().setMaximumTotalDurationSeconds(600);
        VideoCompositionMediaProcessor processor = new VideoCompositionMediaProcessor(properties);

        BusinessException exception = Assertions.assertThrows(BusinessException.class, () -> processor.validateTotalDuration(List.of(
                new VideoCompositionMediaProcessor.VideoProbe(1920, 1080, "30", 360_000, true),
                new VideoCompositionMediaProcessor.VideoProbe(1920, 1080, "30", 241_000, true)
        )));

        Assertions.assertEquals("源视频总时长不能超过10分钟", exception.getMessage());
    }
}
