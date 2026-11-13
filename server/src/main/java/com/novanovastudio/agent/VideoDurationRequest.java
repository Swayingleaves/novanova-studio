package com.novanovastudio.agent;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 从用户对话中识别明确要求的视频时长，并和页面配置比较。
 * <p>
 * 只认“时长是10秒”“时长:约10秒”“生成10秒视频”这类生成时长，不把镜头时间码（如 8-10s、2.5s）当成整段时长。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-10 19:30
 */
public final class VideoDurationRequest {

    /** 秒、s、seconds。秒后面不能用词边界，否则中文结尾匹配不到。 */
    private static final String DURATION_UNIT = "(?:秒|s(?![a-z])|seconds\\b)";
    /** 带时长标签的写法，取最后一次出现的秒数。 */
    private static final Pattern LABELED_DURATION = Pattern.compile(
            "(?:时长|片长|持续时间|duration)\\s*(?:[:：=是为]|is|of)?\\s*约?\\s*(\\d{1,3})(?!\\d)(?:\\s*" + DURATION_UNIT + ")?",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    /** “生成10秒”这类直接说明成片时长的写法。 */
    private static final Pattern GENERATION_DURATION = Pattern.compile(
            "(?:生成|做成|输出|拍成|制作)\\s*(\\d{1,3})(?!\\d)\\s*" + DURATION_UNIT,
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    /** “10秒视频”这类把秒数直接修饰成片的写法。 */
    private static final Pattern DURATION_VIDEO = Pattern.compile(
            "(?<![\\d.\\-–—到至])(\\d{1,3})(?!\\d)\\s*" + DURATION_UNIT + "\\s*(?:的)?(?:视频|片子|成片)",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    /** 短回复里单独出现的秒数，例如“10秒”。 */
    private static final Pattern STANDALONE_DURATION = Pattern.compile(
            "(?<![\\d.\\-–—到至])(\\d{1,3})(?!\\d)\\s*" + DURATION_UNIT,
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    /** 短回复才把单独的秒数当成生成时长，避免长分镜里的时间码被误判。 */
    private static final int STANDALONE_MESSAGE_LIMIT = 80;

    private VideoDurationRequest() {
    }

    /**
     * 对话要求的时长和页面配置不一致时返回两边的秒数。
     *
     * @param message String 用户本轮消息
     * @param configuredSeconds String 页面配置的时长
     * @return Mismatch 不一致的秒数；无法判断或两边相同则返回 null
     */
    public static Mismatch mismatch(String message, String configuredSeconds) {
        Integer requested = requestedSeconds(message);
        Integer configured = parseSeconds(configuredSeconds);
        if (requested == null || configured == null || requested.equals(configured)) {
            return null;
        }
        return new Mismatch(requested, configured);
    }

    /**
     * 读取用户明确要求的生成时长。
     *
     * @param message String 用户消息
     * @return Integer 秒数；没有明确要求时返回 null
     */
    public static Integer requestedSeconds(String message) {
        if (message == null || message.isBlank()) {
            return null;
        }
        Integer labeled = lastSeconds(LABELED_DURATION, message);
        if (labeled != null) {
            return labeled;
        }
        Integer generated = lastSeconds(GENERATION_DURATION, message);
        if (generated != null) {
            return generated;
        }
        Integer video = lastSeconds(DURATION_VIDEO, message);
        if (video != null) {
            return video;
        }
        if (message.trim().length() > STANDALONE_MESSAGE_LIMIT) {
            return null;
        }
        return lastSeconds(STANDALONE_DURATION, message);
    }

    /**
     * 解析页面配置或捕获到的秒数。
     *
     * @param value String 原始秒数
     * @return Integer 1 到 600 的整数秒；无法解析时返回 null
     */
    public static Integer parseSeconds(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String trimmed = value.trim().toLowerCase(Locale.ROOT).replaceAll("(?:秒|seconds|s)$", "").trim();
        if (!trimmed.matches("\\d{1,3}")) {
            return null;
        }
        int seconds = Integer.parseInt(trimmed);
        if (seconds < 1 || seconds > 600) {
            return null;
        }
        return seconds;
    }

    /**
     * 取模式最后一次匹配到的合法秒数。
     *
     * @param pattern Pattern 时长模式
     * @param message String 用户消息
     * @return Integer 最后一次合法秒数
     */
    private static Integer lastSeconds(Pattern pattern, String message) {
        Matcher matcher = pattern.matcher(message);
        Integer seconds = null;
        while (matcher.find()) {
            Integer parsed = parseSeconds(matcher.group(1));
            if (parsed != null) {
                seconds = parsed;
            }
        }
        return seconds;
    }

    /**
     * 对话要求的时长和页面配置的时长。
     *
     * @param requestedSeconds int 对话要求的秒数
     * @param configuredSeconds int 页面配置的秒数
     */
    public record Mismatch(int requestedSeconds, int configuredSeconds) {
    }
}
