import type { ResponseToolCall, ToolResponseResult } from "./image-response-normalizer";

export type AiTextMessage = {
    role: "system" | "user" | "assistant";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

export type ResponseInputMessage =
    | AiTextMessage
    | { type: "function_call"; call_id: string; name: string; arguments: string; thoughtSignature?: string }
    | { role: "tool"; tool_call_id: string; content: string };

export type ResponseFunctionTool = {
    type: "function";
    function: { name: string; description?: string; parameters: Record<string, unknown>; strict?: boolean };
};

export type ToolChoice = "auto" | "required" | { type: "function"; name: string };
export type ImageRequestOptions = { signal?: AbortSignal; generationStyleIds?: number[]; generationStyleSnapshots?: import("@/services/api/server").GenerationStyleSnapshot[] };

export type { ResponseToolCall, ToolResponseResult };
