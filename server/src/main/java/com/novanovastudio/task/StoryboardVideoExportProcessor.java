package com.novanovastudio.task;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.common.StoryboardFontCatalog;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.StoryboardExportSnapshot;
import com.novanovastudio.service.PersistenceService;
import java.awt.Color;
import java.awt.Font;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.font.FontRenderContext;
import java.awt.font.TextAttribute;
import java.awt.font.TextLayout;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Path;
import java.text.AttributedString;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.BooleanSupplier;
import java.util.function.IntConsumer;
import javax.imageio.ImageIO;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * 将分镜项目的镜头、文字与声音渲染为单个视频。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-24 00:00
 */
@Component
@RequiredArgsConstructor
public class StoryboardVideoExportProcessor {

    /** 媒体持久化服务。 */
    private final PersistenceService persistenceService;

    /** 既有FFmpeg执行器。 */
    private final VideoCompositionMediaProcessor videoProcessor;

    /** FFmpeg配置。 */
    private final NovanovaProperties properties;

    /** 输出文件及探测结果。 */
    public record Output(Path path, VideoCompositionMediaProcessor.CompositionResult result) {
    }

    /** 带实际时长的已选择镜头。 */
    private record RenderShot(StoryboardExportSnapshot.Shot source, Path file, boolean hasAudio,
                              long outputStartMs, long durationMs) {
    }

    /** 映射到成片时间轴上的文字事件。 */
    private record TextEvent(StoryboardExportSnapshot.Text text, long startMs, long endMs) {
    }

    /** 映射到成片时间轴上的音频事件。 */
    private record AudioEvent(StoryboardExportSnapshot.Audio audio, long sourceStartMs, long startMs, long durationMs) {
    }

    /**
     * 下载所属媒体后在工作线程合成视频。
     * @param userId 媒体所属用户
     * @param snapshot 已冻结的导出数据
     * @param directory 任务临时目录
     * @param progress 进度回调
     * @param canceled 取消状态查询
     * @return 输出文件和媒体信息
     */
    public Mono<Output> render(Long userId, StoryboardExportSnapshot snapshot, Path directory,
                               IntConsumer progress, BooleanSupplier canceled) {
        List<StoryboardExportSnapshot.Shot> selected = snapshot.shots().stream().filter(StoryboardExportSnapshot.Shot::selected).toList();
        if (selected.isEmpty()) return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "当前导出范围没有镜头"));
        Map<String, Path> videoFiles = new LinkedHashMap<>();
        for (StoryboardExportSnapshot.Shot shot : selected) {
            if (shot.storageKey() != null && !shot.storageKey().isBlank()) {
                videoFiles.computeIfAbsent(shot.storageKey(), key -> directory.resolve("video-" + videoFiles.size() + ".media"));
            }
        }
        Map<String, Path> audioFiles = new LinkedHashMap<>();
        for (StoryboardExportSnapshot.Audio audio : snapshot.audioTracks()) {
            if (selected.stream().anyMatch(shot -> overlaps(shot.startMs(), shot.startMs() + shot.durationMs(),
                    audio.startMs(), audio.startMs() + audio.trimEndMs() - audio.trimStartMs()))) {
                audioFiles.computeIfAbsent(audio.storageKey(), key -> directory.resolve("audio-" + audioFiles.size() + ".media"));
            }
        }
        return Flux.fromIterable(videoFiles.entrySet())
                .concatMap(entry -> Mono.defer(() -> canceled.getAsBoolean()
                        ? Mono.error(new VideoCompositionMediaProcessor.VideoCompositionCanceledException())
                        : persistenceService.downloadVideoMediaToFileForUser(userId, entry.getKey(), entry.getValue())))
                .thenMany(Flux.fromIterable(audioFiles.entrySet())
                        .concatMap(entry -> Mono.defer(() -> canceled.getAsBoolean()
                                ? Mono.error(new VideoCompositionMediaProcessor.VideoCompositionCanceledException())
                                : persistenceService.downloadAudioMediaToFileForUser(userId, entry.getKey(), entry.getValue()))))
                .then(Mono.fromCallable(() -> compose(snapshot, selected, videoFiles, audioFiles, directory, progress, canceled))
                        .subscribeOn(Schedulers.boundedElastic()));
    }

    /**
     * 构造时间映射和FFmpeg滤镜并完成渲染。
     * @param snapshot 已冻结的数据
     * @param selected 选中的镜头
     * @param videoFiles 视频下载文件
     * @param audioFiles 音频下载文件
     * @param directory 临时目录
     * @param progress 进度回调
     * @param canceled 取消状态查询
     * @return 输出文件和媒体信息
     * @throws IOException 字体或文字图片读取失败
     */
    private Output compose(StoryboardExportSnapshot snapshot, List<StoryboardExportSnapshot.Shot> selected,
                           Map<String, Path> videoFiles, Map<String, Path> audioFiles, Path directory,
                           IntConsumer progress, BooleanSupplier canceled) throws IOException {
        if (canceled.getAsBoolean()) throw new VideoCompositionMediaProcessor.VideoCompositionCanceledException();
        int width = switch (snapshot.aspectRatio()) {
            case "9:16" -> 1080;
            case "1:1" -> 1080;
            case "16:9" -> 1920;
            default -> throw new BusinessException(ErrorCode.PARAM_INVALID, "项目画面比例不支持导出");
        };
        int height = switch (snapshot.aspectRatio()) {
            case "9:16" -> 1920;
            case "1:1" -> 1080;
            default -> 1080;
        };
        List<RenderShot> shots = new ArrayList<>();
        Map<Path, VideoCompositionMediaProcessor.VideoProbe> probes = new LinkedHashMap<>();
        long durationMs = 0;
        for (StoryboardExportSnapshot.Shot source : selected) {
            if (canceled.getAsBoolean()) throw new VideoCompositionMediaProcessor.VideoCompositionCanceledException();
            Path file = videoFiles.get(source.storageKey());
            VideoCompositionMediaProcessor.VideoProbe probe = file == null ? null :
                    probes.computeIfAbsent(file, videoProcessor::probe);
            long shotDuration = probe == null ? source.durationMs() : probe.durationMilliseconds();
            if (shotDuration < 1) throw new BusinessException(ErrorCode.PARAM_INVALID, "镜头视频时长无效");
            shots.add(new RenderShot(source, file, probe != null && probe.hasAudio(), durationMs, shotDuration));
            durationMs += shotDuration;
        }
        long maximum = Math.max(1, properties.getAi().getVideoComposition().getMaximumTotalDurationSeconds()) * 1000L;
        if (durationMs > maximum) throw new BusinessException(ErrorCode.PARAM_INVALID, "导出时长不能超过10分钟");

        List<TextEvent> texts = new ArrayList<>();
        for (StoryboardExportSnapshot.Text text : snapshot.texts().stream()
                .sorted(Comparator.comparingInt(StoryboardExportSnapshot.Text::trackNumber)
                        .thenComparingLong(StoryboardExportSnapshot.Text::startMs)).toList()) {
            for (RenderShot shot : shots) {
                long originalStart = shot.source().startMs();
                long originalEnd = originalStart + shot.source().durationMs();
                long start = Math.max(text.startMs(), originalStart);
                long end = Math.min(text.endMs(), originalEnd);
                long mappedStart = shot.outputStartMs() + start - originalStart;
                long mappedEnd = shot.outputStartMs() + end - originalStart;
                if (start < end && mappedEnd > mappedStart && mappedStart < shot.outputStartMs() + shot.durationMs())
                    texts.add(new TextEvent(text, mappedStart, Math.min(mappedEnd, shot.outputStartMs() + shot.durationMs())));
            }
        }
        List<AudioEvent> audios = new ArrayList<>();
        for (StoryboardExportSnapshot.Audio audio : snapshot.audioTracks()) {
            if (!audioFiles.containsKey(audio.storageKey())) continue;
            for (RenderShot shot : shots) {
                long originalStart = shot.source().startMs();
                long originalEnd = originalStart + shot.source().durationMs();
                long start = Math.max(audio.startMs(), originalStart);
                long end = Math.min(audio.startMs() + audio.trimEndMs() - audio.trimStartMs(), originalEnd);
                long mappedStart = shot.outputStartMs() + start - originalStart;
                long mappedEnd = Math.min(shot.outputStartMs() + end - originalStart,
                        shot.outputStartMs() + shot.durationMs());
                if (start < end && mappedEnd > mappedStart) audios.add(new AudioEvent(audio,
                        audio.trimStartMs() + start - audio.startMs(), mappedStart, mappedEnd - mappedStart));
            }
        }

        List<String> command = new ArrayList<>(List.of(properties.getAi().getVideoComposition().getFfmpegExecutable(),
                "-y", "-hide_banner", "-nostdin", "-loglevel", "error", "-progress", "pipe:1"));
        for (RenderShot shot : shots) {
            if (shot.file() == null) {
                command.addAll(List.of("-f", "lavfi", "-t", seconds(shot.durationMs()), "-i",
                        "color=c=black:s=" + width + "x" + height + ":r=30"));
            } else command.addAll(List.of("-i", shot.file().toAbsolutePath().toString()));
        }
        Map<String, Integer> audioInputs = new LinkedHashMap<>();
        for (Map.Entry<String, Path> entry : audioFiles.entrySet()) {
            audioInputs.put(entry.getKey(), shots.size() + audioInputs.size());
            command.addAll(List.of("-i", entry.getValue().toAbsolutePath().toString()));
        }
        Map<String, Integer> imageInputs = new LinkedHashMap<>();
        Map<String, Font> fonts = new LinkedHashMap<>();
        for (TextEvent event : texts) {
            if (imageInputs.containsKey(event.text().id())) continue;
            Path image = directory.resolve("text-" + imageInputs.size() + ".png");
            renderTextImage(event.text(), image, width, fonts);
            imageInputs.put(event.text().id(), shots.size() + audioInputs.size() + imageInputs.size());
            command.addAll(List.of("-loop", "1", "-framerate", "30", "-i", image.toAbsolutePath().toString()));
        }

        List<String> filters = new ArrayList<>();
        StringBuilder concat = new StringBuilder();
        for (int index = 0; index < shots.size(); index++) {
            RenderShot shot = shots.get(index);
            filters.add("[" + index + ":v]scale=" + width + ":" + height
                    + ":force_original_aspect_ratio=decrease,pad=" + width + ":" + height
                    + ":(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,trim=duration=" + seconds(shot.durationMs())
                    + ",setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=" + seconds(shot.durationMs())
                    + ",trim=duration=" + seconds(shot.durationMs()) + ",format=yuv420p[v" + index + "]");
            if (shot.hasAudio()) filters.add("[" + index + ":a]aresample=48000,aformat=channel_layouts=stereo,atrim=duration="
                    + seconds(shot.durationMs()) + ",asetpts=PTS-STARTPTS,apad=pad_dur=" + seconds(shot.durationMs())
                    + ",atrim=duration=" + seconds(shot.durationMs()) + "[a" + index + "]");
            else filters.add("anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration="
                    + seconds(shot.durationMs()) + ",asetpts=PTS-STARTPTS[a" + index + "]");
            concat.append("[v").append(index).append("][a").append(index).append(']');
        }
        filters.add(concat + "concat=n=" + shots.size() + ":v=1:a=1[baseVideo][baseAudio]");
        Map<String, List<Integer>> textEventIndexes = new LinkedHashMap<>();
        for (int index = 0; index < texts.size(); index++) {
            textEventIndexes.computeIfAbsent(texts.get(index).text().id(), ignored -> new ArrayList<>()).add(index);
        }
        Map<Integer, String> textEventInputs = new LinkedHashMap<>();
        textEventIndexes.forEach((textId, indexes) -> {
            int input = imageInputs.get(textId);
            if (indexes.size() == 1) {
                textEventInputs.put(indexes.getFirst(), "[" + input + ":v]");
                return;
            }
            StringBuilder split = new StringBuilder("[" + input + ":v]split=" + indexes.size());
            for (int index : indexes) {
                String label = "textSource" + index;
                split.append('[').append(label).append(']');
                textEventInputs.put(index, "[" + label + "]");
            }
            filters.add(split.toString());
        });
        String lastVideo = "baseVideo";
        for (int index = 0; index < texts.size(); index++) {
            TextEvent event = texts.get(index);
            String next = "textVideo" + index;
            filters.add("[" + lastVideo + "]" + textEventInputs.get(index) + "overlay=x="
                    + String.format(Locale.ROOT, "%.6f", event.text().positionX()) + "*W-w/2:y="
                    + String.format(Locale.ROOT, "%.6f", event.text().positionY()) + "*H-h/2"
                    + ":enable='gte(t," + seconds(event.startMs()) + ")*lt(t," + seconds(event.endMs()) + ")'"
                    + ":repeatlast=1:eof_action=repeat:format=auto[" + next + "]");
            lastVideo = next;
        }
        List<String> mixInputs = new ArrayList<>(List.of("[baseAudio]"));
        Map<String, List<Integer>> audioEventIndexes = new LinkedHashMap<>();
        for (int index = 0; index < audios.size(); index++) {
            audioEventIndexes.computeIfAbsent(audios.get(index).audio().storageKey(), ignored -> new ArrayList<>()).add(index);
        }
        Map<Integer, String> audioEventInputs = new LinkedHashMap<>();
        audioEventIndexes.forEach((storageKey, indexes) -> {
            int input = audioInputs.get(storageKey);
            if (indexes.size() == 1) {
                audioEventInputs.put(indexes.getFirst(), "[" + input + ":a]");
                return;
            }
            StringBuilder split = new StringBuilder("[" + input + ":a]asplit=" + indexes.size());
            for (int index : indexes) {
                String label = "voiceSource" + index;
                split.append('[').append(label).append(']');
                audioEventInputs.put(index, "[" + label + "]");
            }
            filters.add(split.toString());
        });
        for (int index = 0; index < audios.size(); index++) {
            AudioEvent event = audios.get(index);
            String label = "voice" + index;
            long end = event.sourceStartMs() + event.durationMs();
            filters.add(audioEventInputs.get(index) + "atrim=start=" + seconds(event.sourceStartMs())
                    + ":end=" + seconds(end) + ",asetpts=PTS-STARTPTS,aresample=48000,"
                    + "aformat=channel_layouts=stereo,adelay=" + event.startMs() + "|" + event.startMs()
                    + "[" + label + "]");
            mixInputs.add("[" + label + "]");
        }
        if (audios.isEmpty()) filters.add("[baseAudio]anull[audioOutput]");
        else filters.add(String.join("", mixInputs) + "amix=inputs=" + mixInputs.size()
                + ":duration=first:normalize=0,alimiter=limit=0.95[audioOutput]");
        command.addAll(List.of("-filter_complex", String.join(";", filters), "-map", "[" + lastVideo + "]",
                "-map", "[audioOutput]", "-t", seconds(durationMs), "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-r", "30", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-movflags", "+faststart"));
        Path output = directory.resolve("storyboard-export.mp4");
        command.add(output.toAbsolutePath().toString());
        return new Output(output, videoProcessor.runStoryboardCommand(command, output, durationMs,
                width, height, progress, canceled));
    }

    /**
     * 加载经白名单确认且随服务端分发的字体。
     * @param fontFamily 字体标识
     * @param cache 当前导出任务的字体缓存
     * @return 原始字体
     * @throws BusinessException 字体资源缺失或无效
     */
    private Font loadFont(String fontFamily, Map<String, Font> cache) {
        return cache.computeIfAbsent(fontFamily, key -> {
            String fileName = StoryboardFontCatalog.fileName(key);
            try (InputStream input = getClass().getResourceAsStream("/fonts/storyboard/" + fileName)) {
                if (input == null) throw new BusinessException(ErrorCode.BUSINESS_ERROR, "服务端缺少分镜字体资源: " + key);
                return Font.createFont(Font.TRUETYPE_FONT, input);
            } catch (java.awt.FontFormatException | IOException exception) {
                throw new BusinessException(ErrorCode.BUSINESS_ERROR, "分镜字体资源无效: " + key);
            }
        });
    }

    /**
     * 将文字按画面宽度等比排版并绘制到透明PNG。
     * @param text 文字内容及外观
     * @param target 输出图片路径
     * @param videoWidth 成片画面宽度
     * @param fonts 当前导出任务的字体缓存
     * @throws IOException 图片写入失败
     */
    private void renderTextImage(StoryboardExportSnapshot.Text text, Path target, int videoWidth,
                                 Map<String, Font> fonts) throws IOException {
        float size = text.fontSize() * videoWidth / 1000f;
        Font font = loadFont(text.fontFamily(), fonts).deriveFont(Font.PLAIN, size);
        Font fallback = StoryboardFontCatalog.isLatinFont(text.fontFamily())
                ? loadFont(StoryboardFontCatalog.DEFAULT_FONT_FAMILY, fonts).deriveFont(Font.PLAIN, size) : font;
        FontRenderContext context = new FontRenderContext(null, true, true);
        float paddingX = size / 8f;
        float paddingY = size / 16f;
        float maximumTextWidth = Math.max(1f, videoWidth * .9f - paddingX * 2);
        List<String> lines = new ArrayList<>();
        for (String paragraph : text.content().split("\\R", -1)) {
            StringBuilder line = new StringBuilder();
            float lineWidth = 0;
            for (int offset = 0; offset < paragraph.length();) {
                int point = paragraph.codePointAt(offset);
                String character = new String(Character.toChars(point));
                Font characterFont = displayFont(font, fallback, point);
                float characterWidth = (float) characterFont.getStringBounds(character, context).getWidth();
                if (!line.isEmpty() && lineWidth + characterWidth > maximumTextWidth) {
                    lines.add(line.toString());
                    line.setLength(0);
                    lineWidth = 0;
                }
                line.append(character);
                lineWidth += characterWidth;
                offset += Character.charCount(point);
            }
            lines.add(line.toString());
        }
        List<TextLayout> layouts = lines.stream()
                .map(line -> line.isEmpty() ? null : textLayout(line, font, fallback, context)).toList();
        float lineHeight = size * 1.2f;
        int contentWidth = layouts.stream().filter(java.util.Objects::nonNull)
                .mapToInt(layout -> (int) Math.ceil(layout.getAdvance())).max().orElse(1);
        int width = Math.max(1, (int) Math.ceil(contentWidth + paddingX * 2));
        int height = Math.max(1, (int) Math.ceil(lines.size() * lineHeight + paddingY * 2));
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
        Graphics2D graphics = image.createGraphics();
        graphics.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        graphics.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
        graphics.setRenderingHint(RenderingHints.KEY_FRACTIONALMETRICS, RenderingHints.VALUE_FRACTIONALMETRICS_ON);
        if (text.backgroundColor() != null && !text.backgroundColor().isBlank()) {
            graphics.setColor(color(text.backgroundColor()));
            graphics.fillRect(0, 0, width, height);
        }
        for (int index = 0; index < layouts.size(); index++) {
            TextLayout layout = layouts.get(index);
            if (layout == null) continue;
            float x = switch (text.alignment()) {
                case "left" -> paddingX;
                case "right" -> width - paddingX - layout.getAdvance();
                default -> (width - layout.getAdvance()) / 2f;
            };
            float y = paddingY + index * lineHeight
                    + (lineHeight - layout.getAscent() - layout.getDescent()) / 2f + layout.getAscent();
            if (text.backgroundColor() == null || text.backgroundColor().isBlank()) {
                float shadowOffset = videoWidth / 1000f;
                graphics.setColor(new Color(0, 0, 0, 190));
                layout.draw(graphics, x + shadowOffset, y + shadowOffset);
            }
            graphics.setColor(color(text.color()));
            layout.draw(graphics, x, y);
        }
        graphics.dispose();
        ImageIO.write(image, "png", target.toFile());
    }

    /**
     * 为单个字符选择字体；英文字体缺字时明确使用随产品分发的中文黑体。
     * @param font 用户选择的字体
     * @param fallback 中文补字字体
     * @param point Unicode字符值
     * @return 能显示字符的字体
     * @throws BusinessException 两款字体均缺少该字符
     */
    private Font displayFont(Font font, Font fallback, int point) {
        if (font.canDisplay(point)) return font;
        if (fallback.canDisplay(point)) return fallback;
        throw new BusinessException(ErrorCode.PARAM_INVALID, "所选字体不支持字符 U+" + Integer.toHexString(point).toUpperCase(Locale.ROOT));
    }

    /**
     * 使用与预览相同的逐字符字体补字规则创建文字布局。
     * @param line 单行文字
     * @param font 用户选择的字体
     * @param fallback 中文补字字体
     * @param context 字体度量上下文
     * @return Java2D文字布局
     */
    private TextLayout textLayout(String line, Font font, Font fallback, FontRenderContext context) {
        AttributedString attributed = new AttributedString(line);
        for (int offset = 0; offset < line.length();) {
            int point = line.codePointAt(offset);
            int end = offset + Character.charCount(point);
            attributed.addAttribute(TextAttribute.FONT, displayFont(font, fallback, point), offset, end);
            offset = end;
        }
        return new TextLayout(attributed.getIterator(), context);
    }

    /**
     * 判断项目时间段是否相交。
     * @param firstStart 第一段起点
     * @param firstEnd 第一段终点
     * @param secondStart 第二段起点
     * @param secondEnd 第二段终点
     * @return 是否相交
     */
    private boolean overlaps(long firstStart, long firstEnd, long secondStart, long secondEnd) {
        return firstStart < secondEnd && secondStart < firstEnd;
    }

    /**
     * 将毫秒转成FFmpeg秒数。
     * @param milliseconds 毫秒数
     * @return 小数秒文本
     */
    private String seconds(long milliseconds) {
        return String.format(Locale.ROOT, "%.3f", milliseconds / 1000d);
    }

    /**
     * 将时间轴的十六进制色值转为保留透明度的画笔颜色。
     * @param hex 十六进制色值
     * @return 画笔颜色
     */
    private Color color(String hex) {
        String digits = hex.substring(1);
        int rgb = (int) Long.parseLong(digits.substring(0, 6), 16);
        int alpha = digits.length() == 8 ? Integer.parseInt(digits.substring(6), 16) : 255;
        return new Color((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, alpha);
    }
}
