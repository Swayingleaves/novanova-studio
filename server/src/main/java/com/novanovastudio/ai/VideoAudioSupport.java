package com.novanovastudio.ai;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.common.SystemMessage;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * 视频「生成音频」开关：每个视频模型的声音能力，以及任务参数 generateAudio（不传＝按模型默认）的读取与扣费前校验。
 * <p>
 * 四类：switchable 接口能开关；always 接口没有开关、成片固定带声；none 不能出声；unknown 判断不了，按模型默认、不能开关。
 * <p>
 * 只覆盖内置渠道格式；自定义模型只知道接口名，判断不了，一律按 unknown。
 * 依据（2026-11-17 逐个核对文档与线上成片）：方舟 Seedance 2.0 / 2.5 系列 generate_audio（默认 true，1.0 pro 是无声模型，方舟强校验参数）；
 * Evolink Seedance 2.0 九个模型 generate_audio（默认 true）；Evolink MiniMax H3 参数表 additionalProperties=false、没有声音字段；
 * New API 豆包插件把 metadata 原样合进方舟请求体，海螺 H3 只转 aigc_watermark；Agnes Video 2.5 / Flash、MiniMax H3、WeNew h3_video、
 * OpenAI /v1/videos 都没有声音开关，成片带 AAC 音轨。自定义模型按该模式约束里的 audioOutput。
 * 规则只在两处实现，改一边同步另一边：这里与前端 generation/lib/video-audio.ts。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-17 00:00
 */
public final class VideoAudioSupport {

    /** 任务参数名：true 生成声音、false 无声，不传按模型默认。 */
    public static final String PARAMETER = "generateAudio";

    /** 接口能开关声音。 */
    public static final String SWITCHABLE = "switchable";

    /** 接口没有开关，成片固定带声。 */
    public static final String ALWAYS = "always";

    /** 模型不能出声。 */
    public static final String NONE = "none";

    /** 判断不了，按模型默认、不能开关。 */
    public static final String UNKNOWN = "unknown";

    /** Seedance 1.0（pro / pro fast / lite）：无声模型。 */
    private static final Pattern SEEDANCE_SILENT = Pattern.compile("seedance-?1[-.]0(?!\\d)");

    /** Seedance 1.5 pro、2.0、2.5 系列：generate_audio 可开关。 */
    private static final Pattern SEEDANCE_AUDIBLE = Pattern.compile("seedance-?(?:1[-.]5|2(?:[-.]\\d)?)(?!\\d)");

    /** 模型名里单独的 h3（MiniMax-H3、minimax-h3-reference-to-video、h3_video）。 */
    private static final Pattern H3 = Pattern.compile("(?:^|[^a-z0-9])h3(?:[^a-z0-9]|$)");

    private VideoAudioSupport() {
    }

    /**
     * 视频模型的声音能力。自定义模型只知道接口名、判断不了，按 unknown（模型默认）处理。
     *
     * @param apiFormat String 渠道格式
     * @param model     String 模型名
     * @return String switchable / always / none / unknown
     */
    public static String output(String apiFormat, String model) {
        String name = lower(model);
        return switch (lower(apiFormat)) {
            case "agnes", "minimax", "wenew" -> ALWAYS;
            case "seedance" -> seedanceOutput(name);
            case "evolink", "newapi" -> name.contains("seedance") ? seedanceOutput(name) : alwaysAudible(name) ? ALWAYS : UNKNOWN;
            case "openai" -> alwaysAudible(name) ? ALWAYS : UNKNOWN;
            default -> UNKNOWN;
        };
    }

    /**
     * Seedance 按版本：1.0 不能出声，1.5 pro、2.0、2.5 可开关，看不出版本（如方舟接入点 ID）按模型默认。
     *
     * @param model String 模型名
     * @return String none / switchable / unknown
     */
    public static String seedanceOutput(String model) {
        String name = lower(model);
        if (SEEDANCE_SILENT.matcher(name).find()) {
            return NONE;
        }
        return SEEDANCE_AUDIBLE.matcher(name).find() ? SWITCHABLE : UNKNOWN;
    }

    /**
     * 读取任务参数 generateAudio：布尔或 "true"/"false"（不区分大小写），没传或为空时返回空。
     *
     * @param parameters Map<String, Object> 任务参数
     * @return Boolean 是否生成声音，没传为 null
     * @throws BusinessException 取值不是布尔时抛出
     */
    public static Boolean requested(Map<String, Object> parameters) {
        Object value = parameters == null ? null : parameters.get(PARAMETER);
        if (value == null) {
            return null;
        }
        if (value instanceof Boolean flag) {
            return flag;
        }
        String text = String.valueOf(value).trim().toLowerCase(Locale.ROOT);
        if (text.isEmpty()) {
            return null;
        }
        if ("true".equals(text) || "false".equals(text)) {
            return Boolean.valueOf(text);
        }
        throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.videoGenerateAudioInvalid"));
    }

    /**
     * 扣费前拦下做不到的要求：固定有声的模型不能关，不能出声的模型不能开；按模型默认的模型不校验（不会照着发）。
     *
     * @param output    String 模型的声音能力
     * @param requested Boolean 本次要求，没传为 null
     * @throws BusinessException 要求与模型能力矛盾时抛出
     */
    public static void validate(String output, Boolean requested) {
        if (Boolean.FALSE.equals(requested) && ALWAYS.equals(output)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.videoModelAlwaysGeneratesAudio"));
        }
        if (Boolean.TRUE.equals(requested) && NONE.equals(output)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.videoModelCannotGenerateAudio"));
        }
    }

    /**
     * 要写进接口请求的开关值：只有能开关的模型、而且这次传了才有。
     *
     * @param output     String 模型的声音能力
     * @param parameters Map<String, Object> 任务参数
     * @return Boolean 写给接口的值，不写时为 null
     */
    public static Boolean nativeValue(String output, Map<String, Object> parameters) {
        return SWITCHABLE.equals(output) ? requested(parameters) : null;
    }

    /** 中转渠道上认得出、固定带声的模型族：Agnes、H3、Sora。 */
    private static boolean alwaysAudible(String name) {
        return name.contains("agnes") || name.contains("sora") || H3.matcher(name).find();
    }

    private static String lower(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }
}