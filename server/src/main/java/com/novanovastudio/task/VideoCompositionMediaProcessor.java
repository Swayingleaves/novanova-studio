package com.novanovastudio.task;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BooleanSupplier;
import java.util.function.IntConsumer;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * 基于FFmpeg的画布视频合成媒体处理器。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-11 00:00
 */
@Component
@RequiredArgsConstructor
public class VideoCompositionMediaProcessor {

    /** FFprobe探测最长等待时间 */
    private static final Duration PROBE_TIMEOUT = Duration.ofSeconds(60);

    /** FFmpeg错误日志保留上限 */
    private static final int PROCESS_ERROR_MAXIMUM_CHARACTERS = 4000;

    /** 服务配置 */
    private final NovanovaProperties properties;

    /**
     * 探测源视频并生成标准化MP4成片。
     *
     * @param sourceFiles List<Path> 源视频本地文件路径
     * @param outputFile Path 输出MP4路径
     * @param progressConsumer IntConsumer 进度回调
     * @param cancellationRequested BooleanSupplier 是否已请求取消
     * @return CompositionResult 合成结果元数据
     */
    public CompositionResult compose(List<Path> sourceFiles, Path outputFile, IntConsumer progressConsumer,
                                     BooleanSupplier cancellationRequested) {
        if (sourceFiles == null || sourceFiles.size() < 2) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "至少需要两个视频才能合成");
        }
        if (isCancellationRequested(cancellationRequested)) {
            throw new VideoCompositionCanceledException();
        }
        List<VideoProbe> probes = sourceFiles.stream().map(this::probe).toList();
        long totalDurationMilliseconds = validateTotalDuration(probes);
        VideoProbe first = probes.getFirst();
        runFfmpeg(sourceFiles, probes, outputFile, totalDurationMilliseconds, progressConsumer, cancellationRequested);
        if (!Files.isRegularFile(outputFile)) {
            throw new BusinessException(ErrorCode.BUSINESS_ERROR, "FFmpeg未生成合成视频文件");
        }
        VideoProbe result = probe(outputFile);
        return new CompositionResult(first.width(), first.height(), result.durationMilliseconds());
    }

    /**
     * 校验源视频总时长不超过当前合成上限。
     *
     * @param probes List<VideoProbe> 源视频探测结果
     * @return long 源视频总时长毫秒数
     */
    long validateTotalDuration(List<VideoProbe> probes) {
        long totalDurationMilliseconds = probes.stream().mapToLong(VideoProbe::durationMilliseconds).sum();
        long maximumDurationMilliseconds = Math.max(1, properties.getAi().getVideoComposition().getMaximumTotalDurationSeconds()) * 1000L;
        if (totalDurationMilliseconds > maximumDurationMilliseconds) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "源视频总时长不能超过10分钟");
        }
        return totalDurationMilliseconds;
    }

    /**
     * 探测单个视频的流信息。
     *
     * @param sourceFile Path 源视频文件
     * @return VideoProbe 视频探测结果
     */
    VideoProbe probe(Path sourceFile) {
        List<String> command = List.of(
                executable(properties.getAi().getVideoComposition().getFfprobeExecutable(), "ffprobe"),
                "-v", "error",
                "-show_entries", "stream=codec_type,width,height,avg_frame_rate:format=duration",
                "-of", "json",
                sourceFile.toAbsolutePath().toString()
        );
        String payload = runProbe(command);
        try {
            JSONObject root = JSON.parseObject(payload);
            JSONArray streams = root == null ? null : root.getJSONArray("streams");
            JSONObject videoStream = null;
            boolean hasAudio = false;
            if (streams != null) {
                for (int index = 0; index < streams.size(); index += 1) {
                    JSONObject stream = streams.getJSONObject(index);
                    if (stream == null) {
                        continue;
                    }
                    if ("video".equals(stream.getString("codec_type")) && videoStream == null) {
                        videoStream = stream;
                    }
                    if ("audio".equals(stream.getString("codec_type"))) {
                        hasAudio = true;
                    }
                }
            }
            JSONObject format = root == null ? null : root.getJSONObject("format");
            int width = videoStream == null ? 0 : videoStream.getIntValue("width");
            int height = videoStream == null ? 0 : videoStream.getIntValue("height");
            long durationMilliseconds = parseDurationMilliseconds(format == null ? null : format.getString("duration"));
            if (width < 1 || height < 1 || durationMilliseconds < 1) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "视频缺少有效的画面或时长信息");
            }
            return new VideoProbe(evenSize(width), evenSize(height), normalizeFrameRate(videoStream.getString("avg_frame_rate")), durationMilliseconds, hasAudio);
        } catch (BusinessException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new BusinessException(ErrorCode.BUSINESS_ERROR, "解析视频媒体信息失败");
        }
    }

    /**
     * 构造FFmpeg合成命令。
     *
     * @param sourceFiles List<Path> 源视频文件
     * @param probes List<VideoProbe> 源视频探测结果
     * @param outputFile Path 输出文件
     * @return List<String> 可直接传给ProcessBuilder的命令参数
     */
    List<String> buildFfmpegCommand(List<Path> sourceFiles, List<VideoProbe> probes, Path outputFile) {
        if (sourceFiles.size() != probes.size() || sourceFiles.isEmpty()) {
            throw new IllegalArgumentException("视频文件与探测结果数量不一致");
        }
        VideoProbe first = probes.getFirst();
        List<String> command = new ArrayList<>();
        command.add(executable(properties.getAi().getVideoComposition().getFfmpegExecutable(), "ffmpeg"));
        command.add("-y");
        command.add("-hide_banner");
        command.add("-nostdin");
        command.add("-loglevel");
        command.add("error");
        command.add("-progress");
        command.add("pipe:1");
        sourceFiles.forEach(sourceFile -> {
            command.add("-i");
            command.add(sourceFile.toAbsolutePath().toString());
        });
        command.add("-filter_complex");
        command.add(buildFilter(probes, first));
        command.add("-map");
        command.add("[video-output]");
        command.add("-map");
        command.add("[audio-output]");
        command.add("-c:v");
        command.add("libx264");
        command.add("-pix_fmt");
        command.add("yuv420p");
        command.add("-c:a");
        command.add("aac");
        command.add("-ar");
        command.add("48000");
        command.add("-ac");
        command.add("2");
        command.add("-movflags");
        command.add("+faststart");
        command.add(outputFile.toAbsolutePath().toString());
        return List.copyOf(command);
    }

    /**
     * 执行FFmpeg合成进程并回写进度。
     *
     * @param sourceFiles List<Path> 源视频文件
     * @param probes List<VideoProbe> 源视频探测结果
     * @param outputFile Path 输出文件
     * @param totalDurationMilliseconds long 总时长毫秒数
     * @param progressConsumer IntConsumer 进度回调
     * @param cancellationRequested BooleanSupplier 是否已请求取消
     */
    private void runFfmpeg(List<Path> sourceFiles, List<VideoProbe> probes, Path outputFile, long totalDurationMilliseconds,
                           IntConsumer progressConsumer, BooleanSupplier cancellationRequested) {
        Process process;
        try {
            Files.createDirectories(outputFile.toAbsolutePath().getParent());
            process = new ProcessBuilder(buildFfmpegCommand(sourceFiles, probes, outputFile)).start();
        } catch (IOException exception) {
            throw new BusinessException(ErrorCode.BUSINESS_ERROR, "服务端未安装FFmpeg或FFmpeg路径配置错误");
        }
        StringBuilder errorOutput = new StringBuilder();
        AtomicInteger maximumProgress = new AtomicInteger(0);
        Thread outputReader = Thread.ofVirtual().start(() -> readProgress(process.getInputStream(), totalDurationMilliseconds, maximumProgress, progressConsumer));
        Thread errorReader = Thread.ofVirtual().start(() -> readProcessError(process.getErrorStream(), errorOutput));
        try {
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(Math.max(1, properties.getAi().getVideoComposition().getExecutionTimeoutSeconds()));
            while (!process.waitFor(1, TimeUnit.SECONDS)) {
                if (isCancellationRequested(cancellationRequested)) {
                    terminateProcess(process);
                    throw new VideoCompositionCanceledException();
                }
                if (System.nanoTime() > deadline) {
                    terminateProcess(process);
                    throw new BusinessException(ErrorCode.BUSINESS_ERROR, "视频合成超时");
                }
            }
            joinReader(outputReader);
            joinReader(errorReader);
            if (isCancellationRequested(cancellationRequested)) {
                throw new VideoCompositionCanceledException();
            }
            if (process.exitValue() != 0) {
                throw new BusinessException(ErrorCode.BUSINESS_ERROR, "视频合成失败: " + processError(errorOutput));
            }
            progressConsumer.accept(99);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            terminateProcess(process);
            throw new BusinessException(ErrorCode.BUSINESS_ERROR, "视频合成任务已中断");
        } finally {
            if (process.isAlive()) {
                terminateProcess(process);
            }
            joinReader(outputReader);
            joinReader(errorReader);
        }
    }

    /**
     * 读取FFmpeg进度输出。
     *
     * @param inputStream InputStream FFmpeg标准输出流
     * @param totalDurationMilliseconds long 源视频总时长毫秒数
     * @param maximumProgress AtomicInteger 已上报最大进度
     * @param progressConsumer IntConsumer 进度回调
     */
    private void readProgress(InputStream inputStream, long totalDurationMilliseconds, AtomicInteger maximumProgress,
                              IntConsumer progressConsumer) {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (!line.startsWith("out_time_us=") && !line.startsWith("out_time_ms=")) {
                    continue;
                }
                long microseconds = parseLong(line.substring(line.indexOf('=') + 1));
                if (microseconds < 0 || totalDurationMilliseconds < 1) {
                    continue;
                }
                int progress = (int) Math.min(98L, Math.max(1L, microseconds / 1000L * 100L / totalDurationMilliseconds));
                if (progress > maximumProgress.getAndAccumulate(progress, Math::max)) {
                    progressConsumer.accept(progress);
                }
            }
        } catch (Exception ignored) {
            // FFmpeg退出时标准输出关闭属于正常流程，主进程会根据退出码判断任务结果。
        }
    }

    /**
     * 读取FFmpeg错误输出。
     *
     * @param inputStream InputStream FFmpeg错误输出流
     * @param errorOutput StringBuilder 错误输出缓存
     */
    private void readProcessError(InputStream inputStream, StringBuilder errorOutput) {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (errorOutput.length() < PROCESS_ERROR_MAXIMUM_CHARACTERS) {
                    int remaining = PROCESS_ERROR_MAXIMUM_CHARACTERS - errorOutput.length();
                    errorOutput.append(line, 0, Math.min(line.length(), remaining)).append('\n');
                }
            }
        } catch (IOException ignored) {
            // 进程结束时错误输出流关闭属于正常流程。
        }
    }

    /**
     * 等待输出读取线程结束。
     *
     * @param reader Thread 输出读取线程
     */
    private void joinReader(Thread reader) {
        try {
            reader.join(TimeUnit.SECONDS.toMillis(5));
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
        }
    }

    /**
     * 终止外部进程。
     *
     * @param process Process 待终止进程
     */
    private void terminateProcess(Process process) {
        process.destroy();
        try {
            if (!process.waitFor(3, TimeUnit.SECONDS)) {
                process.destroyForcibly();
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            process.destroyForcibly();
        }
    }

    /**
     * 执行FFprobe命令。
     *
     * @param command List<String> FFprobe命令参数
     * @return String JSON输出
     */
    private String runProbe(List<String> command) {
        Process process;
        try {
            process = new ProcessBuilder(command).redirectErrorStream(true).start();
        } catch (IOException exception) {
            throw new BusinessException(ErrorCode.BUSINESS_ERROR, "服务端未安装FFprobe或FFprobe路径配置错误");
        }
        StringBuilder output = new StringBuilder();
        Thread outputReader = Thread.ofVirtual().start(() -> readProcessError(process.getInputStream(), output));
        try {
            if (!process.waitFor(PROBE_TIMEOUT.toSeconds(), TimeUnit.SECONDS)) {
                terminateProcess(process);
                throw new BusinessException(ErrorCode.BUSINESS_ERROR, "读取视频媒体信息超时");
            }
            joinReader(outputReader);
            if (process.exitValue() != 0) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "读取视频媒体信息失败: " + processError(output));
            }
            return output.toString();
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            terminateProcess(process);
            throw new BusinessException(ErrorCode.BUSINESS_ERROR, "读取视频媒体信息已中断");
        } finally {
            if (process.isAlive()) {
                terminateProcess(process);
            }
            joinReader(outputReader);
        }
    }

    /**
     * 构造FFmpeg滤镜图。
     *
     * @param probes List<VideoProbe> 源视频探测结果
     * @param first VideoProbe 首个视频探测结果
     * @return String FFmpeg滤镜图
     */
    private String buildFilter(List<VideoProbe> probes, VideoProbe first) {
        List<String> filters = new ArrayList<>();
        StringBuilder concatInputs = new StringBuilder();
        for (int index = 0; index < probes.size(); index += 1) {
            VideoProbe probe = probes.get(index);
            filters.add("[" + index + ":v:0]scale=" + first.width() + ":" + first.height()
                    + ":force_original_aspect_ratio=decrease,pad=" + first.width() + ":" + first.height()
                    + ":(ow-iw)/2:(oh-ih)/2,setsar=1,fps=" + first.frameRate()
                    + ",format=yuv420p,setpts=PTS-STARTPTS[video" + index + "]");
            String duration = formatDuration(probe.durationMilliseconds());
            if (probe.hasAudio()) {
                filters.add("[" + index + ":a:0]aresample=48000,aformat=channel_layouts=stereo,atrim=duration=" + duration
                        + ",asetpts=PTS-STARTPTS[audio" + index + "]");
            } else {
                filters.add("anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=" + duration
                        + ",asetpts=PTS-STARTPTS[audio" + index + "]");
            }
            concatInputs.append("[video").append(index).append("][audio").append(index).append(']');
        }
        filters.add(concatInputs + "concat=n=" + probes.size() + ":v=1:a=1[video-output][audio-output]");
        return String.join(";", filters);
    }

    /**
     * 判断是否已请求取消。
     *
     * @param cancellationRequested BooleanSupplier 取消查询函数
     * @return boolean 是否已取消
     */
    private boolean isCancellationRequested(BooleanSupplier cancellationRequested) {
        try {
            return cancellationRequested != null && cancellationRequested.getAsBoolean();
        } catch (Exception exception) {
            return false;
        }
    }

    /**
     * 规范化可执行文件配置。
     *
     * @param value String 配置值
     * @param fallback String 默认命令
     * @return String 可执行文件命令
     */
    private String executable(String value, String fallback) {
        return StringUtils.hasText(value) ? value.trim() : fallback;
    }

    /**
     * 将视频尺寸调整为不小于2的偶数。
     *
     * @param value int 原始尺寸
     * @return int 偶数尺寸
     */
    private int evenSize(int value) {
        int normalized = Math.max(2, value);
        return normalized % 2 == 0 ? normalized : normalized - 1;
    }

    /**
     * 解析视频时长。
     *
     * @param value String 秒数文本
     * @return long 毫秒数
     */
    private long parseDurationMilliseconds(String value) {
        try {
            return Math.max(0L, Math.round(Double.parseDouble(value) * 1000D));
        } catch (Exception exception) {
            return 0L;
        }
    }

    /**
     * 规范化帧率表达式。
     *
     * @param value String FFprobe帧率文本
     * @return String FFmpeg可用帧率表达式
     */
    private String normalizeFrameRate(String value) {
        if (!StringUtils.hasText(value) || "0/0".equals(value)) {
            return "30";
        }
        return value.matches("\\d+(?:/\\d+)?") ? value : "30";
    }

    /**
     * 格式化时长秒数。
     *
     * @param durationMilliseconds long 时长毫秒数
     * @return String 秒数文本
     */
    private String formatDuration(long durationMilliseconds) {
        return String.format(Locale.ROOT, "%.3f", Math.max(1L, durationMilliseconds) / 1000D);
    }

    /**
     * 安全解析长整型。
     *
     * @param value String 原始值
     * @return long 解析结果，无效时返回-1
     */
    private long parseLong(String value) {
        try {
            return Long.parseLong(value.trim());
        } catch (Exception exception) {
            return -1L;
        }
    }

    /**
     * 整理FFmpeg错误输出。
     *
     * @param errorOutput StringBuilder 错误输出
     * @return String 可展示错误信息
     */
    private String processError(StringBuilder errorOutput) {
        String value = errorOutput.toString().strip();
        return StringUtils.hasText(value) ? abbreviate(value) : "外部媒体命令未返回错误信息";
    }

    /**
     * 截断外部命令输出。
     *
     * @param value String 原始输出
     * @return String 截断后的输出
     */
    private String abbreviate(String value) {
        if (value == null || value.length() <= PROCESS_ERROR_MAXIMUM_CHARACTERS) {
            return value == null ? "" : value;
        }
        return value.substring(0, PROCESS_ERROR_MAXIMUM_CHARACTERS) + "...";
    }

    /**
     * 视频探测结果。
     *
     * @param width int 视频宽度
     * @param height int 视频高度
     * @param frameRate String 帧率表达式
     * @param durationMilliseconds long 时长毫秒数
     * @param hasAudio boolean 是否包含音轨
     */
    record VideoProbe(int width, int height, String frameRate, long durationMilliseconds, boolean hasAudio) {
    }

    /**
     * 视频合成输出结果。
     *
     * @param width int 输出宽度
     * @param height int 输出高度
     * @param durationMilliseconds long 输出时长毫秒数
     */
    public record CompositionResult(int width, int height, long durationMilliseconds) {
    }

    /**
     * 视频合成被取消时使用的内部异常。
     */
    public static class VideoCompositionCanceledException extends RuntimeException {
    }
}
