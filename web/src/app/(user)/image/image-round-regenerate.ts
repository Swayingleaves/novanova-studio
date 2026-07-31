import type { ReferenceImage } from "@/features/generation/types/image";
import type { AiConfig } from "@/features/settings/stores/use-config-store";

type ImageRoundRegenerateInput = {
    prompt: string;
    references: ReferenceImage[];
    config: ImageGenerationSettings;
};

type ImageGenerationSettings = Partial<Pick<AiConfig, "model" | "imageModel" | "quality" | "imageResolution" | "size" | "count">>;

type ImageRoundAttachment = {
    url: string;
    type: string;
    name: string;
    storageKey?: string;
};

type ImageRoundRegeneratePayload = {
    prompt: string;
    attachments?: ImageRoundAttachment[];
    creationSettings: {
        model: string;
        size?: string;
        resolution?: string;
        quality?: string;
        count?: number;
    };
};

type RegenerateImageRoundOptions = {
    fallbackModel: string;
    appendUserMessage: (message: string) => void;
    sendMessage: (message: string, attachments?: ImageRoundAttachment[], creationSettings?: ImageRoundRegeneratePayload["creationSettings"]) => Promise<void>;
};

export function buildImageRoundRegeneratePayload(round: ImageRoundRegenerateInput, fallbackModel: string): ImageRoundRegeneratePayload {
    const attachments = round.references.map((reference) => ({
        url: reference.dataUrl,
        type: reference.type,
        name: reference.name,
        storageKey: reference.storageKey,
    }));
    return {
        prompt: round.prompt,
        attachments: attachments.length ? attachments : undefined,
        creationSettings: {
            model: round.config.imageModel || round.config.model || fallbackModel,
            ...(round.config.size ? { size: round.config.size } : {}),
            ...(round.config.imageResolution ? { resolution: round.config.imageResolution } : {}),
            ...(round.config.quality ? { quality: round.config.quality } : {}),
            count: 1,
        },
    };
}

export async function regenerateImageRound(round: ImageRoundRegenerateInput, options: RegenerateImageRoundOptions) {
    const payload = buildImageRoundRegeneratePayload(round, options.fallbackModel);
    options.appendUserMessage(payload.prompt);
    await options.sendMessage(payload.prompt, payload.attachments, payload.creationSettings);
}
