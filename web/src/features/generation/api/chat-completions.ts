type ChatMessageContent = string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;

type ChatInputMessage =
    | { role: "system" | "user" | "assistant"; content: ChatMessageContent }
    | { type: "function_call"; call_id: string; name: string; arguments: string; thoughtSignature?: string }
    | { role: "tool"; tool_call_id: string; content: string };

type ChatCompletionToolCallDelta = {
    index?: number;
    id?: string;
    type?: "function";
    function?: { name?: string; arguments?: string };
};

export type ChatCompletionToolCall = {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
};

export type ChatCompletionMessage =
    | { role: "system" | "user"; content: ChatMessageContent }
    | { role: "assistant"; content: ChatMessageContent | ""; tool_calls?: ChatCompletionToolCall[] }
    | { role: "tool"; tool_call_id: string; content: string };

export type ChatCompletionPayload = {
    choices?: Array<{
        delta?: { content?: string | null; tool_calls?: ChatCompletionToolCallDelta[] };
        message?: { content?: string | null; tool_calls?: ChatCompletionToolCall[] };
    }>;
    error?: { message?: string };
    code?: number;
    msg?: string;
};

export type ChatCompletionStreamState = {
    buffer: string;
    text: string;
    toolCalls: ChatCompletionToolCall[];
    error?: string;
};

export type ChatCompletionToolChoice = "auto" | "required" | { type: "function"; name: string };

export type ChatCompletionResult = {
    content: string;
    toolCalls: ChatCompletionToolCall[];
};

/**
 * 将 Responses API 风格的工具循环消息转换为 Chat Completions 消息。
 *
 * @param messages ChatInputMessage[] 工具循环消息
 * @return ChatCompletionMessage[] Chat Completions 消息
 */
export function toChatCompletionMessages(messages: ChatInputMessage[]): ChatCompletionMessage[] {
    const result: ChatCompletionMessage[] = [];
    let pendingToolCalls: ChatCompletionToolCall[] = [];

    const flushPendingToolCalls = () => {
        if (!pendingToolCalls.length) return;
        result.push({ role: "assistant", content: "", tool_calls: pendingToolCalls });
        pendingToolCalls = [];
    };

    for (const message of messages) {
        if ("type" in message) {
            pendingToolCalls.push({ id: message.call_id, type: "function", function: { name: message.name, arguments: message.arguments || "{}" } });
            continue;
        }
        flushPendingToolCalls();
        if (message.role === "tool") {
            result.push({ role: "tool", tool_call_id: message.tool_call_id, content: message.content });
        } else {
            result.push({ role: message.role, content: message.content } as ChatCompletionMessage);
        }
    }

    flushPendingToolCalls();
    return result;
}

/**
 * 转换 Chat Completions 工具选择参数。
 *
 * @param toolChoice ChatCompletionToolChoice 工具选择配置
 * @return string | object Chat Completions tool_choice
 */
export function toChatCompletionToolChoice(toolChoice: ChatCompletionToolChoice) {
    if (typeof toolChoice === "object") return { type: "function", function: { name: toolChoice.name } };
    return toolChoice;
}

/**
 * 创建 Chat Completions 流式解析状态。
 *
 * @return ChatCompletionStreamState 流式解析状态
 */
export function createChatCompletionStreamState(): ChatCompletionStreamState {
    return { buffer: "", text: "", toolCalls: [] };
}

/**
 * 解析非流式 Chat Completions 响应。
 *
 * @param payload ChatCompletionPayload 响应载荷
 * @return ChatCompletionResult 文本与工具调用结果
 */
export function parseChatCompletionPayload(payload: ChatCompletionPayload): ChatCompletionResult {
    validateChatCompletionPayload(payload);
    const choices = payload.choices || [];
    return {
        content: choices.map((choice) => stringValue(choice.message?.content) || stringValue(choice.delta?.content)).join(""),
        toolCalls: choices.flatMap((choice) => normalizeToolCalls(choice.message?.tool_calls || choice.delta?.tool_calls || [])),
    };
}

/**
 * 读取并解析 Chat Completions SSE 文本。
 *
 * @param state ChatCompletionStreamState 流式解析状态
 * @param text String 本次读取的文本片段
 * @param onDelta Function 文本增量回调
 * @param flush boolean 是否强制刷新缓冲区
 */
export function consumeChatCompletionStreamText(state: ChatCompletionStreamState, text: string, onDelta?: (text: string) => void, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        consumeChatCompletionStreamBlock(state.buffer.slice(0, match.index), state, onDelta);
        state.buffer = state.buffer.slice(match.index + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeChatCompletionStreamBlock(state.buffer, state, onDelta);
        state.buffer = "";
    }
}

/**
 * 输出流式解析结果。
 *
 * @param state ChatCompletionStreamState 流式解析状态
 * @return ChatCompletionResult 文本与工具调用结果
 */
export function chatCompletionStreamResult(state: ChatCompletionStreamState): ChatCompletionResult {
    return { content: state.text, toolCalls: normalizeToolCalls(state.toolCalls) };
}

/**
 * 校验 Chat Completions 响应错误。
 *
 * @param payload ChatCompletionPayload 响应载荷
 * @throws Error 接口返回错误时抛出异常
 */
function validateChatCompletionPayload(payload: ChatCompletionPayload) {
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || "请求失败");
    if (payload.error?.message) throw new Error(payload.error.message);
}

/**
 * 解析单个 SSE 块。
 *
 * @param block String SSE块文本
 * @param state ChatCompletionStreamState 流式解析状态
 * @param onDelta Function 文本增量回调
 */
function consumeChatCompletionStreamBlock(block: string, state: ChatCompletionStreamState, onDelta?: (text: string) => void) {
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
    if (!data || data === "[DONE]") return;
    const payload = JSON.parse(data) as ChatCompletionPayload;
    const errorMessage = chatCompletionErrorMessage(payload);
    if (errorMessage) {
        state.error = errorMessage;
        return;
    }
    for (const choice of payload.choices || []) {
        const content = stringValue(choice.delta?.content) || stringValue(choice.message?.content);
        if (content) {
            state.text += content;
            onDelta?.(state.text);
        }
        mergeToolCallDeltas(state.toolCalls, choice.delta?.tool_calls || choice.message?.tool_calls || []);
    }
}

/**
 * 合并流式工具调用片段。
 *
 * @param toolCalls ChatCompletionToolCall[] 已解析工具调用
 * @param deltas ChatCompletionToolCallDelta[] 本次工具调用片段
 */
function mergeToolCallDeltas(toolCalls: ChatCompletionToolCall[], deltas: ChatCompletionToolCallDelta[]) {
    deltas.forEach((delta, fallbackIndex) => {
        const index = typeof delta.index === "number" ? delta.index : fallbackIndex;
        const current = toolCalls[index] || { id: "", type: "function" as const, function: { name: "", arguments: "" } };
        toolCalls[index] = {
            id: delta.id || current.id,
            type: "function",
            function: {
                name: delta.function?.name || current.function.name,
                arguments: `${current.function.arguments}${delta.function?.arguments || ""}`,
            },
        };
    });
}

/**
 * 规范化工具调用列表，过滤无效工具调用。
 *
 * @param toolCalls Array<ChatCompletionToolCall | ChatCompletionToolCallDelta> 原始工具调用列表
 * @return ChatCompletionToolCall[] 有效工具调用列表
 */
function normalizeToolCalls(toolCalls: Array<ChatCompletionToolCall | ChatCompletionToolCallDelta>): ChatCompletionToolCall[] {
    return toolCalls
        .map((toolCall) => ({
            id: toolCall.id || "",
            type: "function" as const,
            function: {
                name: toolCall.function?.name || "",
                arguments: toolCall.function?.arguments || "{}",
            },
        }))
        .filter((toolCall) => toolCall.id && toolCall.function.name);
}

/**
 * 读取 Chat Completions 错误信息。
 *
 * @param payload ChatCompletionPayload 响应载荷
 * @return String 错误信息
 */
function chatCompletionErrorMessage(payload: ChatCompletionPayload) {
    if (typeof payload.code === "number" && payload.code !== 0) return payload.msg || "请求失败";
    return payload.error?.message || "";
}

/**
 * 读取字符串值。
 *
 * @param value unknown 原始值
 * @return String 字符串值
 */
function stringValue(value: unknown) {
    return typeof value === "string" ? value : "";
}
