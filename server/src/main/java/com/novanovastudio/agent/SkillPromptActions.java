package com.novanovastudio.agent;

import com.novanovastudio.agent.dto.AgentChoice;
import com.novanovastudio.agent.dto.CreationPlan;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.util.StringUtils;

/**
 * 对话和规划里的用户动作标识。
 * <p>
 * 任何和用户对话或返回计划的 Agent 都可以触发这些标识。模型可能把标识写进
 * action、选项、澄清问题或纯文本回复。这里收敛成稳定的 choice.action，
 * 并从用户可见文案中去掉标识。
 */
public final class SkillPromptActions {

    /** 打开更多设置，让用户确认模型。 */
    public static final String ASK_USER_MODEL_CONFIG = "ask_user_model_config";
    /** 向用户确认是否继续。 */
    public static final String ASK_USER_CONFIRM = "ask_user_confirm";
    /** 让用户上传参考图片。 */
    public static final String ASK_USER_UPLOAD_IMAGE = "ask_user_upload_image";
    /** 让用户上传参考视频。 */
    public static final String ASK_USER_UPLOAD_VIDEO = "ask_user_upload_video";
    /** 标识本体，可带一个前导 @。 */
    private static final Pattern TOKEN = Pattern.compile("@?(ask_user_model_config|ask_user_confirm|ask_user_upload_image|ask_user_upload_video)(?![A-Za-z0-9_])");

    private SkillPromptActions() {
    }

    /**
     * 从纯文本回复里取出用户动作，并去掉可见文案中的标识。
     *
     * @param text String 模型回复
     * @return NormalizedReply 去掉标识后的文本和对应选项；没有标识时原样返回
     */
    public static NormalizedReply normalizeReply(String text) {
        Set<String> tokens = tokensIn(text);
        if (tokens.isEmpty()) {
            return new NormalizedReply(text, List.of());
        }
        List<AgentChoice> choices = new ArrayList<>();
        for (String token : tokens) {
            choices.add(choiceFor(token, null));
        }
        String cleaned = strip(text);
        if (!StringUtils.hasText(cleaned)) {
            cleaned = defaultQuestion(choices);
        }
        return new NormalizedReply(cleaned, List.copyOf(choices));
    }

    /**
     * 保留已经声明的用户动作，供其他固定选项合并时使用。
     *
     * @param choices List<AgentChoice> 模型返回的选项
     * @return List<AgentChoice> 只含用户动作的选项
     */
    public static List<AgentChoice> userActions(List<AgentChoice> choices) {
        if (choices == null || choices.isEmpty()) {
            return List.of();
        }
        List<AgentChoice> actions = new ArrayList<>();
        for (AgentChoice choice : choices) {
            if (choice != null && choiceToken(choice) != null) {
                actions.add(choice);
            }
        }
        return actions;
    }

    /** 纯文本回复收敛后的可见文本和选项。 */
    public record NormalizedReply(String text, List<AgentChoice> choices) {
    }

    /**
     * 把计划里的技能动作标识收敛为选项动作。
     *
     * @param plan CreationPlan 模型返回的计划
     * @return CreationPlan 用户可见文案已去掉标识的计划；没有标识时原样返回
     */
    public static CreationPlan normalize(CreationPlan plan) {
        if (plan == null || !containsToken(plan)) {
            return plan;
        }
        Set<String> questionTokens = tokensIn(plan.clarificationQuestion());
        List<AgentChoice> rewritten = new ArrayList<>();
        for (AgentChoice choice : plan.choices() == null ? List.<AgentChoice>of() : plan.choices()) {
            if (choice == null) {
                continue;
            }
            String token = choiceToken(choice);
            if (token == null) {
                rewritten.add(choice);
                continue;
            }
            questionTokens.remove(token);
            rewritten.add(choiceFor(token, choice));
        }
        for (String token : questionTokens) {
            rewritten.add(choiceFor(token, null));
        }
        String question = strip(plan.clarificationQuestion());
        if (!StringUtils.hasText(question) && rewritten.stream().anyMatch(choice -> choiceToken(choice) != null)) {
            question = defaultQuestion(rewritten);
        }
        return new CreationPlan(plan.planId(), plan.intent(), plan.entrySource(), strip(plan.summary()),
                question, plan.canvasGuidance(), plan.creationSettings(), plan.tasks(), rewritten,
                plan.workflowType(), plan.workflowId());
    }

    /** 计划的可见字段或选项里是否出现动作标识。 */
    private static boolean containsToken(CreationPlan plan) {
        if (tokensIn(plan.clarificationQuestion()).size() > 0 || tokensIn(plan.summary()).size() > 0) {
            return true;
        }
        for (AgentChoice choice : plan.choices() == null ? List.<AgentChoice>of() : plan.choices()) {
            if (choice != null && choiceToken(choice) != null) {
                return true;
            }
        }
        return false;
    }

    /** 选项已经声明的动作，或写在文案里的标识。其他专用动作保持不变。 */
    private static String choiceToken(AgentChoice choice) {
        String action = canonical(choice.action());
        if (action != null) {
            return action;
        }
        if (StringUtils.hasText(choice.action())) {
            return null;
        }
        String valueToken = firstToken(choice.value());
        return valueToken != null ? valueToken : firstToken(choice.label());
    }

    /** 用中文按钮替换标识。确认动作的提交文本固定为「确认」，上传动作只打开文件选择。 */
    private static AgentChoice choiceFor(String token, AgentChoice original) {
        String label = strip(original == null ? "" : original.label());
        if (ASK_USER_CONFIRM.equals(token)) {
            return new AgentChoice(StringUtils.hasText(label) ? label : "确认", "确认", false, token);
        }
        if (ASK_USER_UPLOAD_IMAGE.equals(token)) {
            return new AgentChoice(StringUtils.hasText(label) ? label : "上传图片", token, false, token);
        }
        if (ASK_USER_UPLOAD_VIDEO.equals(token)) {
            return new AgentChoice(StringUtils.hasText(label) ? label : "上传视频", token, false, token);
        }
        return new AgentChoice(StringUtils.hasText(label) ? label : "设置模型", token, false, token);
    }

    /** 标识被从问题里拿掉后，补一句用户能看懂的说明。 */
    private static String defaultQuestion(List<AgentChoice> choices) {
        boolean model = choices.stream().anyMatch(choice -> ASK_USER_MODEL_CONFIG.equals(choice.action()));
        boolean confirm = choices.stream().anyMatch(choice -> ASK_USER_CONFIRM.equals(choice.action()));
        boolean image = choices.stream().anyMatch(choice -> ASK_USER_UPLOAD_IMAGE.equals(choice.action()));
        boolean video = choices.stream().anyMatch(choice -> ASK_USER_UPLOAD_VIDEO.equals(choice.action()));
        if (model && confirm) {
            return "请先在更多设置里确认模型配置，并确认是否继续。";
        }
        if (model) {
            return "请先在更多设置里确认模型配置。";
        }
        if (confirm) {
            return "请确认是否继续。";
        }
        if (image && video) {
            return "请上传图片或视频。";
        }
        if (image) {
            return "请上传图片。";
        }
        if (video) {
            return "请上传视频。";
        }
        return "请确认是否继续。";
    }

    /** 按出现顺序收集不重复的标识。 */
    private static Set<String> tokensIn(String text) {
        Set<String> tokens = new LinkedHashSet<>();
        if (!StringUtils.hasText(text)) {
            return tokens;
        }
        Matcher matcher = TOKEN.matcher(text);
        while (matcher.find()) {
            tokens.add(matcher.group(1));
        }
        return tokens;
    }

    /** 文本中的第一个标识。 */
    private static String firstToken(String text) {
        if (!StringUtils.hasText(text)) {
            return null;
        }
        Matcher matcher = TOKEN.matcher(text);
        return matcher.find() ? matcher.group(1) : null;
    }

    /** 去掉标识和因此多出来的空白。 */
    private static String strip(String text) {
        if (text == null) {
            return "";
        }
        return TOKEN.matcher(text).replaceAll("").replaceAll("[ \\t]{2,}", " ").trim();
    }

    /** 规范化 action 上的标识。 */
    private static String canonical(String action) {
        if (!StringUtils.hasText(action)) {
            return null;
        }
        String value = action.trim();
        if (value.startsWith("@")) {
            value = value.substring(1);
        }
        return ASK_USER_MODEL_CONFIG.equals(value) || ASK_USER_CONFIRM.equals(value)
                || ASK_USER_UPLOAD_IMAGE.equals(value) || ASK_USER_UPLOAD_VIDEO.equals(value) ? value : null;
    }
}
