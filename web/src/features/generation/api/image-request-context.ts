import { buildApiUrl, type AiConfig } from "@/features/settings/stores/use-config-store";

import type { ResponseInputMessage } from "./image-contracts";

export function createAiApiUrl(config: Pick<AiConfig, "baseUrl">, path: string): string {
    return buildApiUrl(config.baseUrl, path);
}

export function createBearerHeaders(config: Pick<AiConfig, "apiKey">, contentType = "application/json") {
    return { Authorization: `Bearer ${config.apiKey}`, "Content-Type": contentType };
}

export function createGeminiApiUrl(config: Pick<AiConfig, "baseUrl" | "model">, action?: "generateContent" | "streamGenerateContent"): string {
    const baseUrl = normalizeGeminiBaseUrl(config.baseUrl);
    if (!action) return `${baseUrl}/models`;
    const model = config.model.trim().replace(/^models\//, "");
    return `${baseUrl}/models/${encodeURIComponent(model)}:${action}`;
}

export function createGeminiHeaders(config: Pick<AiConfig, "apiKey">) {
    return { "x-goog-api-key": config.apiKey, "Content-Type": "application/json" };
}

export function prependSystemPrompt(config: Pick<AiConfig, "systemPrompt">, messages: ResponseInputMessage[]): ResponseInputMessage[] {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? [{ role: "system", content: systemPrompt }, ...messages] : messages;
}

export async function readFailedResponse(response: Response, fallback: string): Promise<string> {
    const text = await response.text();
    if (text) {
        try {
            const payload = JSON.parse(text) as { msg?: string; error?: { message?: string } };
            if (payload.msg || payload.error?.message) return payload.msg || payload.error?.message || fallback;
        } catch {
            return text.slice(0, 300);
        }
    }
    if (response.status === 401 || response.status === 403) return "鉴权失败，请检查 API Key 和模型权限";
    if (response.status === 429) return "请求被限流或额度不足，请稍后重试";
    return `${fallback}：${response.status}`;
}

export function normalizeRequestError(error: unknown, fallback: string): Error {
    if (error instanceof DOMException && error.name === "AbortError") return new Error("请求已取消");
    if (error instanceof Error && error.name === "AbortError") return new Error("请求已取消");
    return new Error(error instanceof Error ? error.message : fallback);
}

function normalizeGeminiBaseUrl(value: string): string {
    const baseUrl = value.trim().replace(/\/+$/, "");
    return /\/v1(?:beta)?$/i.test(baseUrl) ? baseUrl : `${baseUrl}/v1beta`;
}
