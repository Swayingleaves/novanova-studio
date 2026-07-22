import { nanoid } from "nanoid";

import type { AiConfig } from "@/features/settings/stores/use-config-store";

import type { AiTextMessage, ImageRequestOptions, ResponseFunctionTool, ResponseInputMessage, ResponseToolCall, ToolChoice, ToolResponseResult } from "./image-contracts";
import { createGeminiApiUrl, createGeminiHeaders, readFailedResponse } from "./image-request-context";

type GeminiPart = {
    text?: string;
    inlineData?: { mimeType: string; data: string };
    fileData?: { mimeType: string; fileUri: string };
    functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
    functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
    thoughtSignature?: string;
    thought_signature?: string;
};

type GeminiPayload = {
    candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
    error?: { message?: string };
    promptFeedback?: { blockReason?: string };
};

export async function requestGeminiConversation(config: AiConfig, messages: ResponseInputMessage[], tools: ResponseFunctionTool[], toolChoice: ToolChoice, onDelta?: (text: string) => void, options?: ImageRequestOptions): Promise<ToolResponseResult> {
    const response = await fetch(`${createGeminiApiUrl(config, "streamGenerateContent")}?alt=sse`, {
        method: "POST",
        headers: createGeminiHeaders(config),
        body: JSON.stringify(createGeminiBody(config, messages, tools, toolChoice)),
        signal: options?.signal,
    });
    if (!response.ok) throw new Error(await readFailedResponse(response, "请求失败"));
    if (!response.body) return normalizeGeminiPayload(await response.json() as GeminiPayload);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    const toolCalls: ResponseToolCall[] = [];
    const consume = (block: string) => {
        const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n").trim();
        if (!data || data === "[DONE]") return;
        const result = normalizeGeminiPayload(JSON.parse(data) as GeminiPayload);
        if (result.content) {
            content += result.content;
            onDelta?.(content);
        }
        toolCalls.push(...result.toolCalls);
    };
    const flush = (final: boolean) => {
        for (;;) {
            const boundary = buffer.match(/\r?\n\r?\n/);
            if (!boundary?.index && boundary?.index !== 0) break;
            consume(buffer.slice(0, boundary.index));
            buffer = buffer.slice(boundary.index + boundary[0].length);
        }
        if (final && buffer.trim()) consume(buffer);
    };
    for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        flush(false);
    }
    buffer += decoder.decode();
    flush(true);
    return { content, toolCalls };
}

function createGeminiBody(config: AiConfig, messages: ResponseInputMessage[], tools: ResponseFunctionTool[], toolChoice: ToolChoice) {
    const callNames = new Map<string, string>();
    const systemMessages = messages.filter((message) => !("type" in message) && message.role === "system").map((message) => textContent(message.content));
    const contents = messages.filter((message) => "type" in message || message.role !== "system").map((message) => {
        if ("type" in message) {
            callNames.set(message.call_id, message.name);
            return { role: "model", parts: [{ functionCall: { id: message.call_id, name: message.name, args: parseJsonObject(message.arguments) }, ...(message.thoughtSignature ? { thoughtSignature: message.thoughtSignature } : {}) }] };
        }
        if (message.role === "tool") return { role: "user", parts: [{ functionResponse: { id: message.tool_call_id, name: callNames.get(message.tool_call_id) || "tool_result", response: { result: parseJsonValue(message.content) } } }] };
        return { role: message.role === "assistant" ? "model" : "user", parts: toGeminiParts(message.content) };
    });
    const systemText = [config.systemPrompt.trim(), ...systemMessages].filter(Boolean).join("\n\n");
    return {
        contents,
        ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
        ...(tools.length ? createGeminiToolConfig(tools, toolChoice) : {}),
    };
}

function createGeminiToolConfig(tools: ResponseFunctionTool[], toolChoice: ToolChoice) {
    const mode = typeof toolChoice === "object" || toolChoice === "required" ? "ANY" : "AUTO";
    return {
        tools: [{ functionDeclarations: tools.map((tool) => ({ name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters })) }],
        toolConfig: { functionCallingConfig: { mode, ...(typeof toolChoice === "object" ? { allowedFunctionNames: [toolChoice.name] } : {}) } },
    };
}

function normalizeGeminiPayload(payload: GeminiPayload): ToolResponseResult {
    if (payload.error?.message) throw new Error(payload.error.message);
    if (payload.promptFeedback?.blockReason) throw new Error(`Gemini 拒绝了本次请求：${payload.promptFeedback.blockReason}`);
    const parts = payload.candidates?.flatMap((candidate) => candidate.content?.parts ?? []) ?? [];
    return {
        content: parts.map((part) => part.text || "").join(""),
        toolCalls: parts.flatMap((part) => part.functionCall?.name ? [{
            id: part.functionCall.id || nanoid(),
            type: "function" as const,
            function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args || {}) },
            ...((part.thoughtSignature || part.thought_signature) ? { thoughtSignature: part.thoughtSignature || part.thought_signature } : {}),
        }] : []),
    };
}

function toGeminiParts(content: AiTextMessage["content"]): GeminiPart[] {
    if (!Array.isArray(content)) return [{ text: String(content || "") }];
    return content.map((item) => {
        if (item.type === "text") return { text: item.text };
        const match = item.image_url.url.match(/^data:([^;,]+);base64,(.+)$/);
        return match ? { inlineData: { mimeType: match[1], data: match[2] } } : { fileData: { mimeType: "image/png", fileUri: item.image_url.url } };
    });
}

function textContent(content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>): string {
    return Array.isArray(content) ? content.map((item) => item.type === "text" ? item.text : item.image_url.url).join("\n") : content;
}

function parseJsonObject(value: string): Record<string, unknown> {
    const parsed = parseJsonValue(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function parseJsonValue(value: string): unknown {
    try { return JSON.parse(value); } catch { return value; }
}
