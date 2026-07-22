import { buildApiUrl, type AiConfig, type ModelChannel } from "@/features/settings/stores/use-config-store";

import { createGeminiApiUrl, createGeminiHeaders, normalizeRequestError, readFailedResponse } from "./image-request-context";

type ModelListPayload = { data?: Array<{ id?: string }>; error?: { message?: string } };
type GeminiModelListPayload = { models?: Array<{ name?: string }>; error?: { message?: string } };

export async function fetchConfiguredImageModels(config: Pick<AiConfig, "baseUrl" | "apiKey" | "apiFormat">): Promise<string[]> {
    try {
        if (config.apiFormat === "gemini") return fetchGeminiModels(config);
        if (config.apiFormat === "anthropic") return fetchAnthropicModels(config);
        return fetchOpenAiCompatibleModels(config);
    } catch (error) {
        throw normalizeRequestError(error, "读取模型失败");
    }
}

export function fetchModelsForChannel(channel: ModelChannel): Promise<string[]> {
    return fetchConfiguredImageModels({ baseUrl: channel.baseUrl, apiKey: channel.apiKey, apiFormat: channel.apiFormat });
}

async function fetchGeminiModels(config: Pick<AiConfig, "baseUrl" | "apiKey">) {
    const geminiConfig = { ...config, model: "" };
    const response = await fetch(createGeminiApiUrl(geminiConfig), { headers: createGeminiHeaders(geminiConfig) });
    if (!response.ok) throw new Error(await readFailedResponse(response, "读取模型失败"));
    const payload = await response.json() as GeminiModelListPayload;
    if (payload.error?.message) throw new Error(payload.error.message);
    return uniqueSortedIds((payload.models ?? []).map((model) => model.name?.replace(/^models\//, "")));
}

async function fetchAnthropicModels(config: Pick<AiConfig, "baseUrl" | "apiKey">) {
    const baseUrl = config.baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
    const response = await fetch(`${baseUrl}/v1/models`, { headers: { "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" } });
    if (!response.ok) throw new Error(await readFailedResponse(response, "读取模型失败"));
    const payload = await response.json() as ModelListPayload;
    if (payload.error?.message) throw new Error(payload.error.message);
    return uniqueSortedIds((payload.data ?? []).map((model) => model.id));
}

async function fetchOpenAiCompatibleModels(config: Pick<AiConfig, "baseUrl" | "apiKey">) {
    const response = await fetch(buildApiUrl(config.baseUrl, "/models"), { headers: { Authorization: `Bearer ${config.apiKey}` } });
    if (!response.ok) throw new Error(await readFailedResponse(response, "读取模型失败"));
    const payload = await response.json() as ModelListPayload;
    if (payload.error?.message) throw new Error(payload.error.message);
    return uniqueSortedIds((payload.data ?? []).map((model) => model.id));
}

function uniqueSortedIds(ids: Array<string | undefined>): string[] {
    return [...new Set(ids.filter((id): id is string => Boolean(id)))].sort((left, right) => left.localeCompare(right));
}
