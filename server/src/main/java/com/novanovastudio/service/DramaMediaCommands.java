package com.novanovastudio.service;

import java.util.ArrayList;
import java.util.List;
import org.springframework.util.StringUtils;

/**
 * 对话触发出图之后的完成反馈。生成哪些内容由主 Agent 决定，这里不再识别用户原话。
 */
public final class DramaMediaCommands {

    private DramaMediaCommands() {
    }

    /** @param name 角色或场景名称 @param key 生成目标 */
    public record NameTarget(String name, String key) {
    }

    /**
     * 一批对话里的图片或视频都结束后，给用户的反馈。
     *
     * @param names 名称，顺序与状态一致
     * @param statuses success、failed 或 canceled
     * @return 回复正文
     */
    public static String completionReply(List<String> names, List<String> statuses) {
        List<String> done = new ArrayList<>();
        List<String> failed = new ArrayList<>();
        List<String> stopped = new ArrayList<>();
        for (int index = 0; index < names.size() && index < statuses.size(); index++) {
            String name = StringUtils.hasText(names.get(index)) ? names.get(index) : "这项";
            switch (statuses.get(index)) {
                case "success" -> done.add(name);
                case "canceled" -> stopped.add(name);
                default -> failed.add(name);
            }
        }
        StringBuilder text = new StringBuilder();
        if (!done.isEmpty()) {
            text.append(String.join("、", done)).append("已经生成完成了。");
        }
        if (!failed.isEmpty()) {
            text.append(String.join("、", failed)).append("没有生成成功。");
        }
        if (!stopped.isEmpty()) {
            text.append(String.join("、", stopped)).append("已停止生成。");
        }
        text.append("您可以继续跟我对话，比如调整外形、生成其他图片，或继续做分镜和视频。");
        return text.toString();
    }
}
