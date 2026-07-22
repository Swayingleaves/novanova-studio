import type { AiConfig } from "@/features/settings/stores/use-config-store";

import type { ImageRequestOptions, ResponseFunctionTool, ResponseInputMessage, ToolChoice, ToolResponseResult } from "./image-contracts";
import { createAiApiUrl, createBearerHeaders, prependSystemPrompt, readFailedResponse } from "./image-request-context";
import { normalizeResponsePayload, type ResponsePayload } from "./image-response-normalizer";
import { createResponseEventStreamParser } from "./image-stream-parser";

type ResponseApiInput =
    | { role: "system" | "user" | "assistant"; content: string | Array<{ type: "input_text"; text: string } | { type: "input_image"; image_url: string }> }
    | { type: "function_call"; call_id: string; name: string; arguments: string }
    | { type: "function_call_output"; call_id: string; output: string };

export async function requestResponsesConversation(config: AiConfig, messages: ResponseInputMessage[], tools: ResponseFunctionTool[], toolChoice: ToolChoice, onDelta?: (text: string) => void, options?: ImageRequestOptions): Promise<ToolResponseResult> {
    const body = {
        model: config.model,
        input: prependSystemPrompt(config, messages).flatMap(toResponseInput),
        ...(tools.length ? { tools: tools.map(toResponseTool), tool_choice: toolChoice, parallel_tool_calls: false } : {}),
        stream: true,
    };
    const response = await fetch(createAiApiUrl(config, "/responses"), {
        method: "POST",
        headers: { ...createBearerHeaders(config), Accept: "text/event-stream" },
        body: JSON.stringify(body),
        signal: options?.signal,
    });
    if (!response.ok) throw new Error(await readFailedResponse(response, "请求失败"));
    if (!response.body) return normalizeResponsePayload(await response.json() as ResponsePayload);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parser = createResponseEventStreamParser(onDelta);
    for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        parser.push(decoder.decode(chunk.value, { stream: true }));
    }
    parser.push(decoder.decode());
    const streamed = parser.finish();
    if (!streamed.payload) return { content: streamed.content, toolCalls: [] };
    const normalized = normalizeResponsePayload(streamed.payload as ResponsePayload);
    return { ...normalized, content: streamed.content || normalized.content };
}

function toResponseInput(message: ResponseInputMessage): ResponseApiInput[] {
    if ("type" in message) return [{ type: "function_call", call_id: message.call_id, name: message.name, arguments: message.arguments }];
    if (message.role === "tool") return [{ type: "function_call_output", call_id: message.tool_call_id, output: message.content }];
    const content = Array.isArray(message.content)
        ? message.content.map((item) => item.type === "text" ? { type: "input_text" as const, text: item.text } : { type: "input_image" as const, image_url: item.image_url.url })
        : String(message.content || "");
    return [{ role: message.role, content }];
}

function toResponseTool(tool: ResponseFunctionTool) {
    return { type: "function", name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters, strict: tool.function.strict };
}
