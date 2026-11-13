/** 流程提示词里的专用动作。标识定义见 server/config/prompts/agent-user-actions.md，当前这一步再交给前端执行。 */
export const ASK_USER_MODEL_CONFIG = "ask_user_model_config";
export const ASK_USER_CONFIRM = "ask_user_confirm";
export const ASK_USER_UPLOAD_IMAGE = "ask_user_upload_image";
export const ASK_USER_UPLOAD_VIDEO = "ask_user_upload_video";
/** 关闭更多设置后的继续按钮，点击后发送固定确认消息。 */
export const CONTINUE_AFTER_MODEL_CONFIG = "continue_after_model_config";
/** 用户完成模型设置后发给 Agent 的固定消息。 */
export const MODEL_CONFIG_CONFIRMED_MESSAGE = "已确认模型配置";
/** 确认动作发给 Agent 的固定消息。 */
export const SKILL_CONFIRM_MESSAGE = "确认";

export type SkillPromptAction = {
    labelKey: "askUserModelConfig" | "askUserConfirm" | "askUserUploadImage" | "askUserUploadVideo";
    token: typeof ASK_USER_MODEL_CONFIG | typeof ASK_USER_CONFIRM | typeof ASK_USER_UPLOAD_IMAGE | typeof ASK_USER_UPLOAD_VIDEO;
};

export const SKILL_PROMPT_ACTIONS: readonly SkillPromptAction[] = [
    { labelKey: "askUserModelConfig", token: ASK_USER_MODEL_CONFIG },
    { labelKey: "askUserConfirm", token: ASK_USER_CONFIRM },
    { labelKey: "askUserUploadImage", token: ASK_USER_UPLOAD_IMAGE },
    { labelKey: "askUserUploadVideo", token: ASK_USER_UPLOAD_VIDEO },
];

/** 光标前正在输入的 @ 查询。没有未完成的 @ 时返回空。 */
export function mentionQuery(textBeforeCaret: string): { query: string; start: number } | null {
    const match = /@([^\s@]*)$/.exec(textBeforeCaret);
    if (!match) return null;
    return { query: match[1], start: textBeforeCaret.length - match[0].length };
}

/**
 * 流程提示词光标处尚未完成的动作 @。
 * 已经写完的标识不再弹出列表，编辑器会把它渲染成含义芯片。
 */
export function readSkillPromptMention(value: string, cursor: number, tokens: readonly string[]): { query: string; start: number; end: number } | null {
    const match = value.slice(0, cursor).match(/@([^\s@]*)$/);
    if (!match) return null;
    const query = match[1];
    const completed = tokens.some((token) => query === token || (query.startsWith(token) && !/^[A-Za-z0-9_]/.test(query.slice(token.length))));
    if (completed) return null;
    return { query, start: cursor - match[0].length, end: cursor };
}

function agentActionTokenPattern(): RegExp {
    return /@?(ask_user_model_config|ask_user_confirm|ask_user_upload_image|ask_user_upload_video)(?![A-Za-z0-9_])/g;
}

/** 去掉回复里的动作标识，避免把内部标记直接显示给用户。 */
export function stripAgentActionTokens(text: string): string {
    return text.replace(agentActionTokenPattern(), "").replace(/[ \t]{2,}/g, " ").trim();
}

/** 纯文本回复里的动作标识，转成和结构化选项相同的按钮。 */
export function choicesFromAgentActionTokens(text: string): { label: string; value: string; action: string }[] {
    const seen = new Set<string>();
    const choices: { label: string; value: string; action: string }[] = [];
    for (const match of text.matchAll(agentActionTokenPattern())) {
        const token = match[1];
        if (!token || seen.has(token)) continue;
        seen.add(token);
        choices.push(choiceFromAgentActionToken(token));
    }
    return choices;
}

function choiceFromAgentActionToken(token: string): { label: string; value: string; action: string } {
    if (token === ASK_USER_CONFIRM) return { label: "确认", value: SKILL_CONFIRM_MESSAGE, action: token };
    if (token === ASK_USER_UPLOAD_IMAGE) return { label: "上传图片", value: token, action: token };
    if (token === ASK_USER_UPLOAD_VIDEO) return { label: "上传视频", value: token, action: token };
    return { label: "设置模型", value: token, action: token };
}

/** 按中文名称或标识过滤 @ 列表。 */
export function filterSkillPromptActions<T extends { label: string; token: string }>(actions: readonly T[], query: string): T[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [...actions];
    return actions.filter((action) => action.label.toLowerCase().includes(normalized) || action.token.toLowerCase().includes(normalized));
}
