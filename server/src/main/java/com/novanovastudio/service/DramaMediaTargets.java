package com.novanovastudio.service;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import org.springframework.util.StringUtils;

/**
 * 解析短剧生成目标，给出阶段、媒体类型、视频秒数和必须存在的参考图。
 * <p>提示词全部由短剧 Agent 撰写，这里不产出任何文案。</p>
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-15 16:20
 */
public final class DramaMediaTargets {

    private DramaMediaTargets() {
    }

    /**
     * 生成目标的协议信息。
     *
     * @param stage 目标所属阶段
     * @param mediaType image 或 video
     * @param seconds 视频秒数，图片为 0
     */
    public record Spec(String stage, String mediaType, int seconds) {
    }

    /**
     * 解析一次生成目标。
     *
     * @param targetKey 目标，形如 character:c1、sheet:sh1
     * @param versionContent 请求指定的阶段版本内容
     * @param storyboard 最新分镜，可为空
     * @return 协议信息
     * @throws BusinessException 目标不合法或条目不存在时抛出
     */
    public static Spec resolve(String targetKey, JSONObject versionContent, JSONObject storyboard) {
        String kind = kind(targetKey);
        String ref = ref(targetKey);
        return switch (kind) {
            case "character" -> {
                item(versionContent, "characters", ref);
                yield new Spec("cast", "image", 0);
            }
            case "location" -> {
                item(versionContent, "locations", ref);
                yield new Spec("cast", "image", 0);
            }
            case "board" -> {
                item(versionContent, "shots", ref);
                yield new Spec("storyboard", "image", 0);
            }
            case "sheet" -> {
                JSONObject shot = item(storyboard, "shots", ref);
                yield new Spec("storyboard", "image", seconds(shot));
            }
            case "shot-video" -> {
                JSONObject shot = item(storyboard, "shots", ref);
                yield new Spec("storyboard", "video", seconds(shot));
            }
            default -> throw invalid("生成目标不正确");
        };
    }

    /**
     * 必须有成功参考图的目标。连续图不是第一个镜头时，必须带上上一镜的尾帧。
     *
     * @param targetKey 生成目标
     * @param storyboard 最新分镜
     * @return 必需的参考图目标，没有时为 {@link List#of()}
     */
    public static List<String> requiredReferences(String targetKey, JSONObject storyboard) {
        if (!"sheet".equals(kind(targetKey))) {
            return List.of();
        }
        String previous = previousRef(storyboard, ref(targetKey));
        return StringUtils.hasText(previous) ? List.of("cut:last:" + previous) : List.of();
    }

    /**
     * 按分镜顺序找上一个镜头。第一个镜头没有上一镜。
     *
     * @param storyboard 最新分镜
     * @param ref 当前镜头
     * @return 上一镜的短序号，没有时为空
     */
    public static String previousRef(JSONObject storyboard, String ref) {
        List<JSONObject> shots = new ArrayList<>();
        JSONArray array = storyboard == null ? null : storyboard.getJSONArray("shots");
        if (array != null) {
            for (int index = 0; index < array.size(); index++) {
                JSONObject shot = array.getJSONObject(index);
                if (shot != null && StringUtils.hasText(shot.getString("ref"))) {
                    shots.add(shot);
                }
            }
        }
        shots.sort(Comparator.comparingInt(shot -> {
            Integer order = shot.getInteger("order");
            return order == null ? Integer.MAX_VALUE : order;
        }));
        String previous = "";
        for (JSONObject shot : shots) {
            if (ref.equals(shot.getString("ref"))) {
                return previous;
            }
            previous = shot.getString("ref");
        }
        return "";
    }

    /**
     * 取目标前缀。
     *
     * @param targetKey 生成目标
     * @return character、location、board、sheet 或 shot-video
     */
    public static String kind(String targetKey) {
        int split = targetKey == null ? -1 : targetKey.indexOf(':');
        if (split <= 0 || split == targetKey.length() - 1) {
            throw invalid("生成目标不正确");
        }
        return targetKey.substring(0, split);
    }

    /**
     * 取目标里的短序号。
     *
     * @param targetKey 生成目标
     * @return c1、l1、sh1 之类的短序号
     */
    public static String ref(String targetKey) {
        int split = targetKey == null ? -1 : targetKey.indexOf(':');
        if (split <= 0 || split == targetKey.length() - 1) {
            throw invalid("生成目标不正确");
        }
        return targetKey.substring(split + 1);
    }

    private static JSONObject item(JSONObject content, String arrayName, String ref) {
        JSONArray array = content == null ? null : content.getJSONArray(arrayName);
        if (array != null) {
            for (int index = 0; index < array.size(); index++) {
                JSONObject item = array.getJSONObject(index);
                if (item != null && ref.equals(item.getString("ref"))) {
                    return item;
                }
            }
        }
        throw invalid("当前版本里没有这个条目");
    }

    private static int seconds(JSONObject shot) {
        Integer value = shot.getInteger("durationSeconds");
        return value == null || value < 1 ? 5 : value;
    }

    private static BusinessException invalid(String message) {
        return new BusinessException(ErrorCode.PARAM_INVALID, message);
    }
}
