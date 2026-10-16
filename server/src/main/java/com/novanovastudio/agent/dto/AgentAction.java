package com.novanovastudio.agent.dto;

import java.util.List;
import java.util.Locale;
import com.novanovastudio.common.SystemMessage;

/**
 * Agent返回给前端的结构化交互动作。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-31 21:17
 * @param type String 动作类型
 * @param label String 按钮显示文案
 * @param href String 动作目标地址
 * @param initialPrompt String 需要带入目标页面的原始提示词
 * @param options List<AgentChoice> type=choice 时的可点击选项
 * @param labelMessage SystemMessage 内置按钮的语言中立文案
 */
public record AgentAction(
        String type,
        String label,
        String href,
        String initialPrompt,
        List<AgentChoice> options,
        SystemMessage labelMessage
) {

    /**
     * 创建自定义交互动作，文案和内容保留原文。
     * @param type String 动作类型
     * @param label String 原始文案
     * @param href String 跳转地址
     * @param initialPrompt String 原始提示词
     * @param options List<AgentChoice> 选项
     */
    public AgentAction(String type, String label, String href, String initialPrompt, List<AgentChoice> options) {
        this(type, label, href, initialPrompt, options, null);
    }

    /**
     * 创建跳转画布动作。
     *
     * @param initialPrompt String 需要带入画布的原始提示词
     * @return AgentAction 跳转画布动作
     */
    public static AgentAction navigateToCanvas(String initialPrompt) {
        return new AgentAction("navigate", "去画布操作", "/canvas", initialPrompt, null, SystemMessage.of("business.openCanvas"));
    }

    /**
     * 创建选项选择动作，用户点击某个选项后其 value 将作为用户消息发送。
     *
     * @param options List<AgentChoice> 可点击选项
     * @return AgentAction 选项选择动作
     */
    public static AgentAction choice(List<AgentChoice> options) {
        return new AgentAction("choice", "请选择", null, null, options, SystemMessage.of("business.chooseAnOption"));
    }

    /**
     * 按订阅语言翻译内置动作，原始提示词及选项业务值保持不变。
     * @param locale Locale 当前订阅语言
     * @return AgentAction 当前语言动作
     */
    public AgentAction withLocale(Locale locale) {
        return new AgentAction(type, labelMessage == null ? label : labelMessage.render(locale), href, initialPrompt,
                options == null ? null : options.stream().map(option -> localizedChoice(option, locale)).toList(), labelMessage);
    }

    /**
     * 翻译具有固定业务值的系统操作，普通模型候选值和文案保持原文。
     * @param option AgentChoice 操作选项
     * @param locale Locale 当前订阅语言
     * @return AgentChoice 当前语言选项
     */
    private AgentChoice localizedChoice(AgentChoice option, Locale locale) {
        if (option.value() == null) return option;
        String key = switch (option.value()) {
            case "确认生成" -> "business.confirmGeneration";
            case "用这些图片生成视频" -> "business.generateVideoWithTheseImages";
            case "修改提示词重新生成" -> "business.editPromptAndRegenerate";
            case "我想调整提示词" -> "business.adjustPrompt";
            default -> null;
        };
        return key == null ? option : new AgentChoice(SystemMessage.of(key).render(locale), option.value(), option.multiple(), option.action());
    }
}
