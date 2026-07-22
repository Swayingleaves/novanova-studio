import type { ReferenceImage } from "@/features/generation/types/image";
import type { AiConfig } from "@/features/settings/stores/use-config-store";

type ImageRoundRegenerateInput = {
    prompt: string;
    references: ReferenceImage[];
    config: ImageGenerationSettings;
};

type ImageGenerationSettings = Partial<Pick<AiConfig, "model" | "imageModel" | "quality" | "imageResolution" | "size">>;

type ImageRoundAttachment = {
    url: string;
    type: string;
    name: string;
};

type ImageRoundRegeneratePayload = {
    prompt: string;
    contextualPrompt: string;
    attachments?: ImageRoundAttachment[];
};

type RegenerateImageRoundOptions = {
    fallbackModel: string;
    appendUserMessage: (message: string) => void;
    sendMessage: (message: string, attachments?: ImageRoundAttachment[]) => Promise<void>;
};

export function buildImageRoundRegeneratePayload(round: ImageRoundRegenerateInput, fallbackModel: string): ImageRoundRegeneratePayload {
    const contextualPrompt = `${buildImageGenerationContextualPrompt(round.config, fallbackModel)}\n\n${round.prompt}`;
    const attachments = round.references.map((reference) => ({
        url: reference.dataUrl,
        type: reference.type,
        name: reference.name,
    }));
    return {
        prompt: round.prompt,
        contextualPrompt,
        attachments: attachments.length ? attachments : undefined,
    };
}

/**
 * 组装图片 Agent 必须按原值使用的生成设置。
 *
 * @param settings ImageGenerationSettings 图片生成设置
 * @param fallbackModel string 未选择图片模型时使用的默认模型
 * @return string 传递给图片 Agent 的设置文本
 */
export function buildImageGenerationContextualPrompt(settings: ImageGenerationSettings, fallbackModel: string): string {
    const imageModel = settings.imageModel || settings.model || fallbackModel;
    return `[用户设置：尺寸=${settings.size || "1:1"}，清晰度=${settings.imageResolution || "2K"}，质量=${settings.quality || "high"}，生图模型=${imageModel}]`;
}

export async function regenerateImageRound(round: ImageRoundRegenerateInput, options: RegenerateImageRoundOptions) {
    const payload = buildImageRoundRegeneratePayload(round, options.fallbackModel);
    options.appendUserMessage(payload.prompt);
    await options.sendMessage(payload.contextualPrompt, payload.attachments);
}
