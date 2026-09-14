package com.novanovastudio.ai;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.service.PersistenceService;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * @title        AudioClipService.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  音频引用裁剪和派生媒体存储服务
 * @createTime   2026-09-12 00:00:00
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AudioClipService {

    /** 派生处理版本，变更编码参数时同步递增。 */
    private static final String CLIP_VERSION = "1";
    /** 派生音频最大输入字节数。 */
    private static final long MAXIMUM_AUDIO_BYTES = 15L * 1024 * 1024;

    private final AiHttpClient aiHttpClient;
    private final PersistenceService persistenceService;
    private final NovanovaProperties properties;
    /** 同一用户和裁剪区间的并发生成共享一个任务，避免重复转码。 */
    private final ConcurrentMap<String, Mono<String>> inFlightClips = new ConcurrentHashMap<>();

    /**
     * 解析音频引用地址，必要时返回裁剪后的派生媒体地址。
     * @param userId Long 当前用户ID
     * @param reference AiTaskMediaReference 音频引用
     * @param media UploadedMediaResponse 用户媒体记录
     * @return Mono<String> 可供渠道访问的音频地址
     */
    public Mono<String> resolveReferenceUrl(Long userId, AiTaskDtos.AiTaskMediaReference reference,
                                             PersistenceDtos.UploadedMediaResponse media) {
        if (reference == null || media == null) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "参考音频不能为空"));
        }
        if (reference.trimStartMs() == null && reference.trimEndMs() == null) {
            return requireReferenceUrl(media.url(), "原始参考音频");
        }
        if (!AudioInputSupport.isAudioMimeType(media.mimeType())) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "裁剪引用必须是MP3或WAV音频"));
        }
        long originalDuration = media.durationMs() == null ? 0 : media.durationMs();
        long startMs = reference.trimStartMs() == null ? 0 : reference.trimStartMs();
        long endMs = reference.trimEndMs() == null ? originalDuration : reference.trimEndMs();
        log.info("解析音频裁剪引用: userId={}, storageKey={}, sourceDurationMs={}, startMs={}, endMs={}, sourceUrlPresent={}",
                userId, media.storageKey(), originalDuration, startMs, endMs, StringUtils.hasText(media.url()));
        if (originalDuration < 1 || startMs < 0 || endMs > originalDuration || endMs <= startMs) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "参考音频裁剪区间无效"));
        }
        if (startMs == 0 && endMs == originalDuration) {
            return requireReferenceUrl(media.url(), "原始参考音频");
        }
        if (!StringUtils.hasText(media.url()) || !isHttpUrl(media.url())) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "参考音频没有可下载的地址"));
        }
        String storageKey = derivedStorageKey(media.storageKey(), startMs, endMs);
        log.info("准备解析音频派生媒体: userId={}, derivedStorageKey={}, startMs={}, endMs={}",
                userId, storageKey, startMs, endMs);
        return persistenceService.getMediaInfoForUser(userId, storageKey)
                .flatMap(existing -> {
                    if (!StringUtils.hasText(existing.url()) || !isHttpUrl(existing.url())) {
                        log.info("已存在的音频派生媒体地址无效，重新生成: userId={}, storageKey={}", userId, storageKey);
                        return Mono.empty();
                    }
                    String url = existing.url().trim();
                    log.info("复用已存在的音频派生媒体: userId={}, storageKey={}, url={}", userId, storageKey, url);
                    return Mono.just(url);
                })
                .onErrorResume(BusinessException.class,
                        exception -> exception.getCode() == ErrorCode.RESOURCE_NOT_FOUND ? Mono.empty() : Mono.error(exception))
                .switchIfEmpty(Mono.defer(() -> {
                    String requestKey = userId + ":" + storageKey;
                    Mono<String> generation = inFlightClips.computeIfAbsent(requestKey,
                            ignored -> createAndStore(userId, media, storageKey, startMs, endMs).cache());
                    return generation.doFinally(signal -> inFlightClips.remove(requestKey, generation));
                }))
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "音频裁剪后没有得到可访问地址")));
    }

    /** 创建并保存派生音频，usingWhen保证临时目录在所有终止信号下清理。 */
    private Mono<String> createAndStore(Long userId, PersistenceDtos.UploadedMediaResponse media,
                                        String storageKey, long startMs, long endMs) {
        log.info("开始创建音频派生媒体: userId={}, sourceStorageKey={}, derivedStorageKey={}, startMs={}, endMs={}",
                userId, media.storageKey(), storageKey, startMs, endMs);
        return Mono.usingWhen(
                Mono.fromCallable(() -> Files.createTempDirectory("novanova-audio-clip-"))
                        .subscribeOn(Schedulers.boundedElastic()),
                directory -> {
                    Path input = directory.resolve("source" + extension(media.mimeType()));
                    Path output = directory.resolve("clip" + extension(media.mimeType()));
                    return aiHttpClient.downloadRemoteMediaToFile(media.url(), media.mimeType(), input, MAXIMUM_AUDIO_BYTES)
                            .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "下载参考音频没有返回文件")))
                            .flatMap(downloaded -> {
                                log.info("参考音频下载完成: userId={}, storageKey={}, bytes={}, mimeType={}",
                                        userId, media.storageKey(), downloaded.bytes(), downloaded.mimeType());
                                return Mono.fromRunnable(() -> runFfmpeg(input, output, startMs, endMs - startMs))
                                        .subscribeOn(Schedulers.boundedElastic())
                                        .thenReturn(output);
                            })
                            .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "音频裁剪没有生成输出文件")))
                            .flatMap(outputFile -> persistenceService.storeDerivedMediaFileForUser(
                                    userId, storageKey, "audio", "audio-clip" + extension(media.mimeType()),
                                    media.mimeType(), outputFile, (int) (endMs - startMs)))
                            .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "裁剪音频上传后没有返回媒体记录")))
                            .flatMap(stored -> requireReferenceUrl(stored.url(), "裁剪后的参考音频")
                                    .doOnSuccess(url -> log.info("音频派生媒体保存成功: userId={}, storageKey={}, bytes={}, url={}",
                                            userId, storageKey, stored.bytes(), url)));
                },
                directory -> Mono.fromRunnable(() -> deleteDirectory(directory)).subscribeOn(Schedulers.boundedElastic()),
                (directory, exception) -> Mono.fromRunnable(() -> deleteDirectory(directory)).subscribeOn(Schedulers.boundedElastic()),
                directory -> Mono.fromRunnable(() -> deleteDirectory(directory)).subscribeOn(Schedulers.boundedElastic())
        ).switchIfEmpty(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "音频派生流程返回空结果")))
                .doOnError(exception -> log.error("创建音频派生媒体失败: userId={}, sourceStorageKey={}, derivedStorageKey={}",
                userId, media.storageKey(), storageKey, exception));
    }

    /** 校验裁剪流程产出的媒体地址。 */
    private Mono<String> requireReferenceUrl(String url, String mediaDescription) {
        if (!StringUtils.hasText(url) || !isHttpUrl(url)) {
            return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, mediaDescription + "没有返回可访问的HTTP地址"));
        }
        return Mono.just(url.trim());
    }

    /** 执行FFmpeg音频裁剪。 */
    private void runFfmpeg(Path input, Path output, long startMs, long durationMs) {
        NovanovaProperties.Ai.VideoComposition composition = videoComposition();
        String codec = isWav(input) ? "pcm_s16le" : "libmp3lame";
        List<String> command = List.of(
                executable(composition.getFfmpegExecutable(), "ffmpeg"),
                "-y", "-hide_banner", "-nostdin", "-loglevel", "error",
                "-ss", seconds(startMs), "-i", input.toAbsolutePath().toString(),
                "-t", seconds(durationMs), "-vn", "-c:a", codec,
                "-ar", "44100", "-ac", "2", output.toAbsolutePath().toString());
        try {
            Process process = new ProcessBuilder(command).start();
            StringBuilder error = new StringBuilder();
            Thread reader = Thread.ofVirtual().start(() -> readError(process, error));
            boolean completed = process.waitFor(Math.max(1, composition.getExecutionTimeoutSeconds()), TimeUnit.SECONDS);
            if (!completed) {
                process.destroyForcibly();
                process.waitFor(5, TimeUnit.SECONDS);
                throw new BusinessException(ErrorCode.BUSINESS_ERROR, "音频裁剪超时");
            }
            reader.join(1000);
            if (process.exitValue() != 0 || !Files.exists(output) || Files.size(output) < 1) {
                throw new BusinessException(ErrorCode.BUSINESS_ERROR, "音频裁剪失败" + (error.isEmpty() ? "" : ": " + error));
            }
        } catch (BusinessException exception) {
            throw exception;
        } catch (IOException exception) {
            throw new BusinessException(ErrorCode.BUSINESS_ERROR, "服务端未安装FFmpeg或FFmpeg路径配置错误");
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new BusinessException(ErrorCode.BUSINESS_ERROR, "音频裁剪任务已中断");
        }
    }

    /** 读取音视频工具配置，配置对象缺失时返回明确业务错误。 */
    private NovanovaProperties.Ai.VideoComposition videoComposition() {
        if (properties == null || properties.getAi() == null || properties.getAi().getVideoComposition() == null) {
            throw new BusinessException(ErrorCode.BUSINESS_ERROR, "音频裁剪缺少FFmpeg配置");
        }
        return properties.getAi().getVideoComposition();
    }

    /** 读取FFmpeg错误输出。 */
    private void readError(Process process, StringBuilder error) {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getErrorStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null && error.length() < 2000) error.append(line).append(' ');
        } catch (IOException ignored) {
            log.info("读取音频裁剪进程输出失败");
        }
    }

    /** 生成包含源文件和区间的稳定派生存储键。 */
    private String derivedStorageKey(String sourceKey, long startMs, long endMs) {
        String raw = String.valueOf(sourceKey) + ":" + startMs + ":" + endMs + ":" + CLIP_VERSION;
        try {
            return "audio-clip:" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(raw.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw new BusinessException(ErrorCode.BUSINESS_ERROR, "生成音频派生标识失败");
        }
    }

    /** 根据音频MIME类型选择派生文件扩展名。 */
    private String extension(String mimeType) {
        return AudioInputSupport.isAudioMimeType(mimeType) && mimeType.toLowerCase(Locale.ROOT).contains("wav") ? ".wav" : ".mp3";
    }

    /** 判断输入文件是否为WAV。 */
    private boolean isWav(Path input) { return input.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".wav"); }
    /** 将毫秒格式化为FFmpeg时间参数。 */
    private String seconds(long milliseconds) { return String.format(Locale.ROOT, "%.3f", milliseconds / 1000d); }
    /** 读取配置中的可执行文件路径。 */
    private String executable(String configured, String fallback) { return StringUtils.hasText(configured) ? configured.trim() : fallback; }
    /** 判断媒体地址是否为HTTP(S)地址。 */
    private boolean isHttpUrl(String url) { return StringUtils.hasText(url) && (url.trim().toLowerCase(Locale.ROOT).startsWith("http://") || url.trim().toLowerCase(Locale.ROOT).startsWith("https://")); }

    /** 递归清理裁剪临时目录。 */
    private void deleteDirectory(Path directory) {
        try (var paths = Files.walk(directory)) {
            paths.sorted(java.util.Comparator.reverseOrder()).forEach(path -> {
                try { Files.deleteIfExists(path); } catch (IOException exception) { log.info("清理音频裁剪临时文件失败: {}", path); }
            });
        } catch (IOException exception) {
            log.info("清理音频裁剪临时目录失败: {}", directory);
        }
    }
}
