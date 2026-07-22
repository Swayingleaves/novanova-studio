import type { AiConfig } from "@/features/settings/stores/use-config-store";

import { chatCompletionStreamResult, consumeChatCompletionStreamText, createChatCompletionStreamState, parseChatCompletionPayload, toChatCompletionMessages, toChatCompletionToolChoice, type ChatCompletionPayload } from "./chat-completions";
import type { ImageRequestOptions, ResponseFunctionTool, ResponseInputMessage, ToolChoice, ToolResponseResult } from "./image-contracts";
import { createAiApiUrl, createBearerHeaders, readFailedResponse } from "./image-request-context";

export async function requestChatCompletionConversation(config: AiConfig, messages: ResponseInputMessage[], tools: ResponseFunctionTool[], toolChoice: ToolChoice, onDelta?: (text: string) => void, options?: ImageRequestOptions): Promise<ToolResponseResult> {
    const systemPrompt = config.systemPrompt.trim();
    const preparedMessages = systemPrompt ? [{ role: "system" as const, content: systemPrompt }, ...messages] : messages;
    const response = await fetch(createAiApiUrl(config, "/chat/completions"), {
        method: "POST",
        headers: { ...createBearerHeaders(config), Accept: "text/event-stream" },
        body: JSON.stringify({ model: config.model, messages: toChatCompletionMessages(preparedMessages), ...(tools.length ? { tools, tool_choice: toChatCompletionToolChoice(toolChoice) } : {}), stream: true }),
        signal: options?.signal,
    });
    if (!response.ok) throw new Error(await readFailedResponse(response, "请求失败"));
    if (!response.body) return parseChatCompletionPayload(await response.json() as ChatCompletionPayload);

    const state = createChatCompletionStreamState();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        consumeChatCompletionStreamText(state, decoder.decode(chunk.value, { stream: true }), onDelta);
        if (state.error) throw new Error(state.error);
    }
    consumeChatCompletionStreamText(state, decoder.decode(), onDelta, true);
    if (state.error) throw new Error(state.error);
    return chatCompletionStreamResult(state);
}
