
import { translateMessage as translate } from "@/features/locale/translate";
import type { ApiCallFormat } from "@/features/settings/stores/use-config-store";

export function resolveModelIcon(model: string, apiFormat?: ApiCallFormat): string {
    if (apiFormat === "agnes") return "/icons/agnes.svg";
    if (apiFormat === "seedance") return "/icons/bytedance.svg";
    if (apiFormat === "minimax") return "/icons/minimax.svg";

    const name = model.toLowerCase();
    if (name.includes("claude") || name.includes("anthropic")) return "/icons/claude.svg";
    if (name.includes("gemini") || name.includes("google")) return "/icons/gemini.svg";
    if (name.includes("gpt") || name.includes("openai")) return "/icons/openai.svg";
    if (name.includes("grok")) return "/icons/grok.svg";
    if (name.includes("seedance")) return "/icons/bytedance.svg";
    if (name.includes("minimax")) return "/icons/minimax.svg";
    if (name.includes("deepseek")) return "/icons/deepseek.svg";
    if (name.includes("glm")) return "/icons/glm.svg";
    return "";
}

export function isMonochromeModelIcon(model: string, apiFormat?: ApiCallFormat): boolean {
    if (apiFormat === "agnes" || apiFormat === "seedance" || apiFormat === "minimax") return true;

    const name = model.toLowerCase();
    return name.includes("gpt") || name.includes("openai") || name.includes("grok") || name.includes("seedance") || name.includes("minimax");
}

/**
 * 模型展示图标可选项：空串表示自动匹配（按模型名/渠道解析），clapperboard 表示默认图标。
 * 供管理端「模型能力配置」编辑弹窗选择使用。
 */
/** 按调用方语言生成显示文案，业务值保持不变。 */
export const createModelIconOptions = (translator: typeof translate = translate): Array<{ value: string; label: string; path: string }> => ([
    { value: "", get label() { return translator("settings.autoMatch"); }, path: "" },
    { value: "clapperboard", get label() { return translator("settings.defaultClapperboard"); }, path: "" },
    { value: "agnes", label: "Agnes", path: "/icons/agnes.svg" },
    { value: "seedance", get label() { return translator("settings.seedanceByteDance"); }, path: "/icons/bytedance.svg" },
    { value: "claude", label: "Claude", path: "/icons/claude.svg" },
    { value: "openai", label: "OpenAI", path: "/icons/openai.svg" },
    { value: "gemini", label: "Gemini", path: "/icons/gemini.svg" },
    { value: "deepseek", label: "DeepSeek", path: "/icons/deepseek.svg" },
    { value: "glm", label: "GLM", path: "/icons/glm.svg" },
    { value: "grok", label: "Grok", path: "/icons/grok.svg" },
    { value: "minimax", label: "MiniMax", path: "/icons/minimax.svg" },
]);

export const MODEL_ICON_OPTIONS = createModelIconOptions();

/** 按配置的图标标识解析 SVG 路径，自动匹配/默认图标返回空串。 */
export function resolveModelIconByKey(key: string | null | undefined): string {
    if (!key || key === "clapperboard") return "";
    const found = MODEL_ICON_OPTIONS.find((option) => option.value === key);
    return found?.path || "";
}

/** 需要暗色反色处理的品牌图标标识集合。 */
export const MODEL_ICON_MONOCHROME_KEYS = new Set(["agnes", "seedance", "minimax", "openai", "grok"]);
