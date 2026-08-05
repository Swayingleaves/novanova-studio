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
