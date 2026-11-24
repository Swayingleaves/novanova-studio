package com.novanovastudio.service;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.util.StringUtils;

/**
 * 智能短剧开场总时长与分镜单镜时长询问、选项结构及回答解析。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-24 22:05
 */
public final class DramaDurationQuestions {

    private static final int MIN_TOTAL_SECONDS = 15;
    private static final int MAX_TOTAL_SECONDS = 180;

    private static final Pattern MIN_SEC_PATTERN = Pattern.compile("(\\d+(?:\\.\\d+)?)\\s*分(?:钟)?\\s*(\\d+)\\s*秒?");
    private static final Pattern MIN_HALF_PATTERN = Pattern.compile("(\\d+)\\s*分半");
    private static final Pattern MINUTES_PATTERN = Pattern.compile("(\\d+(?:\\.\\d+)?)\\s*(?:分钟|分|min|mins|minute|minutes|m\\b)", Pattern.CASE_INSENSITIVE);
    private static final Pattern SECONDS_PATTERN = Pattern.compile("(\\d+(?:\\.\\d+)?)\\s*(?:秒钟|秒|sec|secs|second|seconds|s\\b)", Pattern.CASE_INSENSITIVE);
    private static final Pattern CN_MIN_PATTERN = Pattern.compile("(半|[一二两三])\\s*分钟");
    private static final Pattern BARE_NUMBER_PATTERN = Pattern.compile("^\\s*(\\d{1,3})\\s*$");
    private static final Pattern RANGE_SECONDS_PATTERN = Pattern.compile("\\d+\\s*[~～\\-—到至]\\s*\\d+\\s*(?:秒|s)?", Pattern.CASE_INSENSITIVE);
    private static final Pattern SHOT_KEYWORDS = Pattern.compile("长镜头|短镜头|常规镜头|超长镜头|较长镜头|每镜|单镜|镜头时长|一镜");
    private static final Pattern QUESTION_PATTERN = Pattern.compile("[?？]|哪个|哪些|什么|怎么|为什么|吗$|能不能|是否");

    private static final Map<String, Integer> CN_MINUTES = Map.of(
            "半", 30,
            "一", 60,
            "二", 120,
            "两", 120,
            "三", 180);

    private DramaDurationQuestions() {
    }

    /**
     * 开场询问总时长的回复正文。
     *
     * @return String 询问文案
     */
    public static String totalDurationReply() {
        return "收到你的创意！在开始制作方案前，先确认一下这条短剧预计生成多长？";
    }

    /**
     * 开场询问总时长的消息 meta（竖向单选选项，含自定义输入）。
     *
     * @return String JSON 字符串
     */
    public static String totalDurationMeta() {
        JSONArray choices = new JSONArray();
        choices.add(choice("30 秒", "总时长 30 秒", "紧凑快节奏，约 2~3 个镜头", false, null));
        choices.add(choice("60 秒（1 分钟）", "总时长 60 秒（1 分钟）", "标准短剧时长，节奏完整，约 4~6 个镜头", false, null));
        choices.add(choice("90 秒", "总时长 90 秒", "中篇叙事，情节更充分，约 6~8 个镜头", false, null));
        choices.add(choice("120 秒（2 分钟）", "总时长 120 秒（2 分钟）", "较长篇幅，完整起承转合，约 8~12 个镜头", false, null));
        choices.add(choice("自己输入", "", "输入自定义总时长（15~180 秒）", true, "例如：45 秒、1 分 30 秒"));
        return questionMeta("plan", "total_duration", false, choices);
    }

    /**
     * 进入分镜阶段前询问单镜时长的回复正文。
     *
     * @param totalDurationSeconds int 项目总时长（秒）
     * @return String 询问文案
     */
    public static String shotDurationReply(int totalDurationSeconds) {
        return "角色与场景已确认，接下来准备生成分镜镜头（总时长 " + totalDurationSeconds
                + " 秒）。请选择每个镜头希望生成的时长，一般建议选择 10 秒以上（10~15 秒为常规时长，超过 15 秒属于较长镜头；如果每个镜头达到 30 秒，需要选用具备最长 30 秒生成能力的视频模型）：";
    }

    /**
     * 进入分镜阶段前询问单镜时长的消息 meta（竖向单选选项，含自定义输入）。
     *
     * @return String JSON 字符串
     */
    public static String shotDurationMeta() {
        JSONArray choices = new JSONArray();
        choices.add(choice("10~15 秒（推荐，常规镜头）", "每个镜头 10~15 秒（常规镜头）", "节奏自然、画质稳定，主流视频模型均支持", false, null));
        choices.add(choice("15~20 秒（较长镜头）", "每个镜头 15~20 秒（较长镜头）", "超过 15 秒属于较长镜头，单镜叙事更连贯，需选用支持 20 秒以上的视频模型", false, null));
        choices.add(choice("20~30 秒（超长镜头）", "每个镜头 20~30 秒（超长镜头）", "每镜最长可达 30 秒，需选用具备最长 30 秒生成能力的视频模型", false, null));
        choices.add(choice("5~10 秒（短镜头）", "每个镜头 5~10 秒（短镜头）", "切镜更密、节奏更快，适合高密度快剪", false, null));
        choices.add(choice("自己输入", "", "自定义单个镜头的时长", true, "例如：每镜 12 秒、每镜 30 秒"));
        return questionMeta("shot", "shot_duration", false, choices);
    }

    /**
     * 从用户回复中解析总时长（秒），无法识别时返回 null。
     *
     * @param text String 用户输入
     * @return Integer 规范化后的总时长（15~180 秒），未识别返回 null
     */
    public static Integer parseTotalDurationSeconds(String text) {
        if (!StringUtils.hasText(text)) {
            return null;
        }
        String trimmed = text.trim();
        if (QUESTION_PATTERN.matcher(trimmed).find()) {
            return null;
        }
        Matcher minSec = MIN_SEC_PATTERN.matcher(trimmed);
        if (minSec.find()) {
            double minutes = Double.parseDouble(minSec.group(1));
            int seconds = Integer.parseInt(minSec.group(2));
            return clampTotal((int) Math.round(minutes * 60 + seconds));
        }
        Matcher minHalf = MIN_HALF_PATTERN.matcher(trimmed);
        if (minHalf.find()) {
            int minutes = Integer.parseInt(minHalf.group(1));
            return clampTotal(minutes * 60 + 30);
        }
        Matcher cnMin = CN_MIN_PATTERN.matcher(trimmed);
        if (cnMin.find()) {
            Integer mapped = CN_MINUTES.get(cnMin.group(1));
            if (mapped != null) {
                return clampTotal(mapped);
            }
        }
        Matcher seconds = SECONDS_PATTERN.matcher(trimmed);
        if (seconds.find()) {
            return clampTotal((int) Math.round(Double.parseDouble(seconds.group(1))));
        }
        Matcher minutes = MINUTES_PATTERN.matcher(trimmed);
        if (minutes.find()) {
            return clampTotal((int) Math.round(Double.parseDouble(minutes.group(1)) * 60));
        }
        Matcher bare = BARE_NUMBER_PATTERN.matcher(trimmed);
        if (bare.matches()) {
            int value = Integer.parseInt(bare.group(1));
            if (value >= 1 && value <= 5) {
                return clampTotal(value * 60);
            }
            return clampTotal(value);
        }
        return null;
    }

    /**
     * 判断用户回复是否在回答分镜单镜时长偏好。
     *
     * @param text String 用户输入
     * @return boolean 属于单镜时长回答时返回 true
     */
    public static boolean isShotDurationAnswer(String text) {
        if (!StringUtils.hasText(text)) {
            return false;
        }
        String trimmed = text.trim();
        if (QUESTION_PATTERN.matcher(trimmed).find()) {
            return false;
        }
        if (SHOT_KEYWORDS.matcher(trimmed).find() || RANGE_SECONDS_PATTERN.matcher(trimmed).find()
                || SECONDS_PATTERN.matcher(trimmed).find()) {
            return true;
        }
        Matcher bare = BARE_NUMBER_PATTERN.matcher(trimmed);
        if (bare.matches()) {
            int value = Integer.parseInt(bare.group(1));
            return value >= 3 && value <= 60;
        }
        return false;
    }

    /**
     * 将导演 Agent 返回的结构化选项复制到消息 meta。
     *
     * @param meta JSONObject 目标 meta
     * @param raw JSONObject 导演结构化输出
     */
    public static void attachChoices(JSONObject meta, JSONObject raw) {
        if (meta == null || raw == null) {
            return;
        }
        JSONArray source = raw.getJSONArray("choices");
        if (source == null || source.isEmpty()) {
            return;
        }
        JSONArray normalized = new JSONArray();
        for (int index = 0; index < source.size(); index++) {
            JSONObject item = source.getJSONObject(index);
            if (item == null) {
                continue;
            }
            String label = item.getString("label");
            boolean customInput = Boolean.TRUE.equals(item.getBoolean("customInput"));
            if (!StringUtils.hasText(label) && !customInput) {
                continue;
            }
            String resolvedLabel = StringUtils.hasText(label) ? label.trim() : "自己输入";
            String value = item.getString("value");
            String resolvedValue = customInput ? "" : (StringUtils.hasText(value) ? value.trim() : resolvedLabel);
            normalized.add(choice(resolvedLabel, resolvedValue, item.getString("description"), customInput, item.getString("placeholder")));
        }
        if (!normalized.isEmpty()) {
            meta.put("choices", normalized);
            meta.put("multiple", Boolean.TRUE.equals(raw.getBoolean("multiple")));
        }
    }

    private static int clampTotal(int value) {
        return Math.max(MIN_TOTAL_SECONDS, Math.min(MAX_TOTAL_SECONDS, value));
    }

    private static String questionMeta(String stage, String questionType, boolean multiple, JSONArray choices) {
        JSONObject meta = new JSONObject();
        meta.put("kind", "question");
        meta.put("stage", stage);
        meta.put("questionType", questionType);
        meta.put("multiple", multiple);
        meta.put("choices", choices);
        return meta.toJSONString();
    }

    private static JSONObject choice(String label, String value, String description, boolean customInput, String placeholder) {
        JSONObject item = new JSONObject();
        item.put("label", label);
        item.put("value", value);
        if (StringUtils.hasText(description)) {
            item.put("description", description.trim());
        }
        if (customInput) {
            item.put("customInput", true);
        }
        if (StringUtils.hasText(placeholder)) {
            item.put("placeholder", placeholder.trim());
        }
        return item;
    }
}
