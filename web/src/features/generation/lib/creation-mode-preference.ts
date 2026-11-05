/** 创作页对话模式：agent 由主 Agent 规划优化，chat 直接将提示词交给生成任务。 */
export type CreationMode = "agent" | "chat";

/** 模式记忆维度：图片页与视频页各自独立。 */
export type CreationModeTarget = "image" | "video";

const STORAGE_KEY_PREFIX = "novanova:creation-mode:";

/**
 * 归一化本地存储读取结果，未知值一律回落到 agent。
 *
 * @param value 存储中的原始值
 * @return 合法模式
 */
export function normalizeCreationMode(value: unknown): CreationMode {
    return value === "chat" ? "chat" : "agent";
}

/**
 * 读取指定页面上次选择的模式，服务端渲染或存储不可用时返回 agent。
 *
 * @param target 图片页或视频页
 * @return 上次选择的模式
 */
export function readCreationMode(target: CreationModeTarget): CreationMode {
    if (typeof window === "undefined") return "agent";
    try {
        return normalizeCreationMode(window.localStorage.getItem(`${STORAGE_KEY_PREFIX}${target}`));
    } catch {
        return "agent";
    }
}

/**
 * 写入指定页面的模式选择，隐私模式或配额异常时静默降级为仅本次会话生效。
 *
 * @param target 图片页或视频页
 * @param mode 选择的模式
 * @return void 无返回值
 */
export function writeCreationMode(target: CreationModeTarget, mode: CreationMode): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(`${STORAGE_KEY_PREFIX}${target}`, mode);
    } catch {
        // 存储不可用时保持内存状态即可
    }
}
