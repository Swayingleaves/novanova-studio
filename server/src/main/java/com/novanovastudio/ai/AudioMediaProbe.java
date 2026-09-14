package com.novanovastudio.ai;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import org.springframework.util.StringUtils;

/**
 * 使用 FFprobe 校验上传音频的实际容器和时长。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-09-12 00:00
 */
public final class AudioMediaProbe {

    /** FFprobe 识别出的音频媒体信息。 */
    public record ProbeResult(int durationMs, String mimeType) {
    }

    /** 音频探测最大等待时间。 */
    private static final Duration PROBE_TIMEOUT = Duration.ofSeconds(60);
    /** 允许的 FFprobe 音频容器标识。 */
    private static final Set<String> CONTAINER_NAMES = Set.of("mp3", "wav", "wave", "xwav");

    private AudioMediaProbe() {
    }

    /**
     * 校验音频字节并返回实际时长。
     *
     * @param data byte[] 上传音频字节
     * @param fileName String 原始文件名
     * @param properties NovanovaProperties 服务配置
     * @return ProbeResult 实际时长和媒体类型
     */
    public static ProbeResult probe(byte[] data, String fileName, NovanovaProperties properties) {
        if (data == null || data.length == 0) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "音频不能为空");
        }
        Path input = null;
        try {
            String extension = extension(fileName);
            input = Files.createTempFile("novanova-audio-probe-", extension);
            Files.write(input, data);
            String configuredExecutable = properties == null || properties.getAi() == null || properties.getAi().getVideoComposition() == null
                    ? null : properties.getAi().getVideoComposition().getFfprobeExecutable();
            String executable = StringUtils.hasText(configuredExecutable) ? configuredExecutable.trim() : "ffprobe";
            List<String> command = List.of(executable, "-v", "error", "-show_entries",
                    "stream=codec_type:format=format_name,duration", "-of", "json", input.toAbsolutePath().toString());
            Process process = new ProcessBuilder(command).redirectErrorStream(true).start();
            StringBuilder output = new StringBuilder();
            Thread outputReader = Thread.ofVirtual().start(() -> readOutput(process, output));
            if (!process.waitFor(PROBE_TIMEOUT.toSeconds(), TimeUnit.SECONDS)) {
                process.destroyForcibly();
                process.waitFor(5, TimeUnit.SECONDS);
                outputReader.join(1000);
                throw new BusinessException(ErrorCode.BUSINESS_ERROR, "读取音频媒体信息超时");
            }
            outputReader.join(1000);
            if (process.exitValue() != 0) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "音频解析失败，请选择有效的 MP3 或 WAV 文件");
            }
            JSONObject root = JSONObject.parseObject(output.toString());
            JSONArray streams = root == null ? null : root.getJSONArray("streams");
            boolean hasAudio = false;
            if (streams != null) {
                for (int index = 0; index < streams.size(); index++) {
                    String codecType = streams.getJSONObject(index).getString("codec_type");
                    if ("audio".equals(codecType)) hasAudio = true;
                    if ("video".equals(codecType)) {
                        throw new BusinessException(ErrorCode.PARAM_INVALID, "音频仅支持 MP3、WAV 格式");
                    }
                }
            }
            JSONObject format = root == null ? null : root.getJSONObject("format");
            String formatName = format == null ? "" : format.getString("format_name");
            boolean supportedContainer = StringUtils.hasText(formatName)
                    && java.util.Arrays.stream(formatName.toLowerCase(Locale.ROOT).split(","))
                    .map(String::trim).anyMatch(CONTAINER_NAMES::contains);
            double durationSeconds = format == null ? 0 : Double.parseDouble(format.getString("duration"));
            long durationMilliseconds = Math.round(durationSeconds * 1000D);
            if (!hasAudio || !supportedContainer || durationMilliseconds < 1 || durationMilliseconds > Integer.MAX_VALUE) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "音频仅支持有效的 MP3、WAV 文件");
            }
            return new ProbeResult((int) durationMilliseconds, detectMimeType(formatName));
        } catch (BusinessException exception) {
            throw exception;
        } catch (IOException exception) {
            throw new BusinessException(ErrorCode.BUSINESS_ERROR, "服务端未安装 FFprobe 或 FFprobe 路径配置错误");
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new BusinessException(ErrorCode.BUSINESS_ERROR, "读取音频媒体信息已中断");
        } catch (Exception exception) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "音频解析失败，请选择有效的 MP3 或 WAV 文件");
        } finally {
            if (input != null) {
                try {
                    Files.deleteIfExists(input);
                } catch (IOException ignored) {
                    // 临时文件清理失败不影响已完成的媒体校验。
                }
            }
        }
    }

    /** 根据 FFprobe 容器名称确定可信 MIME 类型。 */
    private static String detectMimeType(String formatName) {
        String normalized = formatName == null ? "" : formatName.toLowerCase(Locale.ROOT);
        boolean wav = java.util.Arrays.stream(normalized.split(","))
                .map(String::trim)
                .anyMatch(value -> Set.of("wav", "wave", "xwav").contains(value));
        return wav ? "audio/wav" : "audio/mpeg";
    }

    /**
     * 根据文件名选择探测文件扩展名。
     *
     * @param fileName String 原始文件名
     * @return String 临时文件扩展名
     */
    private static String extension(String fileName) {
        if (fileName == null) return ".audio";
        String lower = fileName.toLowerCase(Locale.ROOT);
        return lower.endsWith(".wav") ? ".wav" : ".mp3";
    }

    /**
     * 读取 FFprobe 输出，限制日志缓冲区大小。
     *
     * @param process Process FFprobe进程
     * @param output StringBuilder 输出缓冲区
     */
    private static void readOutput(Process process, StringBuilder output) {
        try (var reader = process.inputReader(StandardCharsets.UTF_8)) {
            String line;
            while ((line = reader.readLine()) != null && output.length() < 20000) {
                output.append(line);
            }
        } catch (IOException ignored) {
            // 主线程会根据进程状态返回统一的解析错误。
        }
    }
}
