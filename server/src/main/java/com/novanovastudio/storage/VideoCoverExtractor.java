package com.novanovastudio.storage;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.util.StringUtils;

/**
 * 从视频文件截取第一帧，并缩到列表封面尺寸。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-11 10:44
 */
public final class VideoCoverExtractor {

    private static final Logger log = LoggerFactory.getLogger(VideoCoverExtractor.class);

    /** 封面长边上限，和图片任务列表缩略图一致。 */
    static final int EDGE = 160;

    /** 分享作品封面长边上限，首页作品墙按卡片宽度展示，需要比任务列表清楚。 */
    public static final int SHARE_EDGE = 720;

    /** 截帧最长等待时间。 */
    private static final long TIMEOUT_SECONDS = 20;

    private VideoCoverExtractor() {
    }

    /**
     * 截取视频第一帧。
     *
     * @param video Path 本地视频文件
     * @param ffmpegExecutable String FFmpeg 可执行文件
     * @return byte[] JPEG 封面；截取失败时返回 null，不抛出异常
     */
    public static byte[] extract(Path video, String ffmpegExecutable) {
        return extract(video, ffmpegExecutable, EDGE);
    }

    /**
     * 按指定长边截取视频第一帧。
     *
     * @param video Path 本地视频文件
     * @param ffmpegExecutable String FFmpeg 可执行文件
     * @param edge int 封面长边上限
     * @return byte[] JPEG 封面；截取失败时返回 null，不抛出异常
     */
    public static byte[] extract(Path video, String ffmpegExecutable, int edge) {
        if (video == null || !Files.isRegularFile(video)) {
            return null;
        }
        Path output = null;
        try {
            output = Files.createTempFile("novanova-video-cover-", ".jpg");
            List<String> command = command(ffmpegExecutable, video, output, edge);
            Process process = new ProcessBuilder(command).redirectErrorStream(true).start();
            Thread outputReader = Thread.ofVirtual().start(() -> discardOutput(process));
            if (!process.waitFor(TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                process.waitFor(5, TimeUnit.SECONDS);
                outputReader.join(1000);
                log.error("截取视频封面超时: video={}", video);
                return null;
            }
            outputReader.join(1000);
            if (process.exitValue() != 0) {
                log.error("截取视频封面失败: video={}, exit={}", video, process.exitValue());
                return null;
            }
            byte[] bytes = Files.readAllBytes(output);
            if (bytes.length == 0) {
                log.error("截取视频封面失败: video={}, 输出为空", video);
                return null;
            }
            return bytes;
        } catch (Exception exception) {
            log.error("截取视频封面失败: video={}", video, exception);
            return null;
        } finally {
            if (output != null) {
                try {
                    Files.deleteIfExists(output);
                } catch (IOException exception) {
                    log.error("清理视频封面临时文件失败: file={}", output, exception);
                }
            }
        }
    }

    /**
     * 组装截取第一帧的 FFmpeg 命令。
     *
     * @param ffmpegExecutable String FFmpeg 可执行文件，空时使用 ffmpeg
     * @param video Path 输入视频
     * @param output Path 输出 JPEG
     * @return List&lt;String&gt; 命令参数
     */
    static List<String> command(String ffmpegExecutable, Path video, Path output) {
        return command(ffmpegExecutable, video, output, EDGE);
    }

    /**
     * 按指定长边组装截取第一帧的 FFmpeg 命令。
     *
     * @param ffmpegExecutable String FFmpeg 可执行文件，空时使用 ffmpeg
     * @param video Path 输入视频
     * @param output Path 输出 JPEG
     * @param edge int 封面长边上限
     * @return List&lt;String&gt; 命令参数
     */
    static List<String> command(String ffmpegExecutable, Path video, Path output, int edge) {
        String executable = StringUtils.hasText(ffmpegExecutable) ? ffmpegExecutable.trim() : "ffmpeg";
        int size = Math.max(1, edge);
        return List.of(executable, "-y", "-hide_banner", "-nostdin", "-loglevel", "error",
                "-ss", "0", "-i", video.toAbsolutePath().toString(),
                "-frames:v", "1",
                "-vf", "scale=" + size + ":" + size + ":force_original_aspect_ratio=decrease",
                "-q:v", "5",
                output.toAbsolutePath().toString());
    }

    /**
     * 读完进程输出，避免缓冲区写满后 FFmpeg 停住。
     *
     * @param process Process FFmpeg 进程
     */
    private static void discardOutput(Process process) {
        try (var input = process.getInputStream()) {
            input.readAllBytes();
        } catch (IOException exception) {
            log.error("读取视频封面命令输出失败", exception);
        }
    }
}
