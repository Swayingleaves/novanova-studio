import type { ReferenceImage } from "@/features/generation/types/image";
import type { AiConfig } from "@/features/settings/stores/use-config-store";
import { createAiTask, subscribeAiTaskDeltas, waitAiTask, type ServerGenerationSource } from "@/services/api/server";

import type { AiTextMessage, ImageRequestOptions, ResponseFunctionTool, ResponseInputMessage, ToolChoice, ToolResponseResult } from "./image-contracts";
import { requestServerGeneratedImages } from "./image-task-provider";

export type { AiTextMessage, ResponseFunctionTool, ResponseInputMessage, ResponseToolCall, ToolResponseResult } from "./image-contracts";

export function requestGeneration(config: AiConfig, prompt: string, generationSource: ServerGenerationSource, options?: ImageRequestOptions) {
    return requestServerGeneratedImages(config, prompt, [], undefined, generationSource, options);
}

export function requestEdit(config: AiConfig, prompt: string, references: ReferenceImage[], mask: ReferenceImage | undefined, generationSource: ServerGenerationSource, options?: ImageRequestOptions) {
    return requestServerGeneratedImages(config, prompt, references, mask, generationSource, options);
}

export async function requestImageQuestion(config: AiConfig, messages: AiTextMessage[], onDelta: (text: string) => void, options?: ImageRequestOptions): Promise<string> {
    let taskId = "";
    let streamed = "";
    const unsubscribe = subscribeAiTaskDeltas((eventTaskId, delta) => {
        if (eventTaskId !== taskId) return;
        streamed += delta;
        onDelta(streamed);
    });
    try {
        const task = await createAiTask({
            taskType: "text",
            prompt: textTaskPrompt(messages),
            model: config.model || config.textModel,
        });
        taskId = task.id;
        const completed = await waitAiTask(task.id, { signal: options?.signal });
        const answer = textTaskResult(completed.resultData) || streamed || "没有返回内容";
        if (!streamed) onDelta(answer);
        return answer;
    } finally {
        unsubscribe();
    }
}

function textTaskPrompt(messages: AiTextMessage[]) {
    return messages.map((message) => `${message.role}：${textMessageContent(message.content)}`).join("\n\n");
}

function textMessageContent(content: AiTextMessage["content"]) {
    if (typeof content === "string") return content;
    return content.map((item) => item.type === "text" ? item.text : `[图片：${item.image_url.url}]`).join("\n");
}

function textTaskResult(resultData: unknown) {
    if (!resultData || typeof resultData !== "object") return "";
    const content = (resultData as { content?: unknown }).content;
    return typeof content === "string" ? content : "";
}
