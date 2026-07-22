export type ResponseToolCall = {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
    thoughtSignature?: string;
};

export type ToolResponseResult = {
    content: string;
    toolCalls: ResponseToolCall[];
};

export type ResponsePayload = {
    output_text?: string;
    output?: Array<{
        type?: "message" | "function_call";
        id?: string;
        call_id?: string;
        name?: string;
        arguments?: string;
        content?: Array<{ type?: string; text?: string }>;
    }>;
    error?: { message?: string };
    code?: number;
    msg?: string;
};

export function normalizeResponsePayload(payload: ResponsePayload): ToolResponseResult {
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || "请求失败");
    if (payload.error?.message) throw new Error(payload.error.message);
    const output = payload.output ?? [];
    const content = payload.output_text || output
        .filter((item) => item.type === "message")
        .flatMap((item) => item.content ?? [])
        .map((item) => item.text ?? "")
        .join("");
    const toolCalls = output
        .filter((item) => item.type === "function_call")
        .map((item) => ({
            id: item.call_id || item.id || "",
            type: "function" as const,
            function: { name: item.name || "", arguments: item.arguments || "{}" },
        }))
        .filter((item) => item.id && item.function.name);
    return { content, toolCalls };
}

export function readPayloadError(value: unknown): string {
    if (!isRecord(value)) return "";
    const error = isRecord(value.error) ? value.error : null;
    const response = isRecord(value.response) ? value.response : null;
    const responseError = response && isRecord(response.error) ? response.error : null;
    return readString(value.msg) || readString(error?.message) || readString(responseError?.message);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
    return typeof value === "string" ? value : "";
}
