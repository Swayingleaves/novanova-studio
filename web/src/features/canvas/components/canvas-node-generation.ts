import type { AiTextMessage } from "@/features/generation/api/image";
import { imageReferenceLabel } from "@/features/generation/lib/image-reference-prompt";
import { seedanceReferenceLabel } from "@/features/generation/lib/seedance-video";
import type { ReferenceImage } from "@/features/generation/types/image";
import type { ReferenceVideo } from "@/features/generation/types/media";
import type { CanvasConnection, CanvasGenerationMode, CanvasNode } from "../types";
import { isImageNode, isTextNode, isVideoNode } from "../domain/canvas-node";
import { getGenerationResourceNodes } from "../utils/canvas-resource-references";

type NodeMediaReferences = {
    referenceImages: ReferenceImage[];
    referenceVideos: ReferenceVideo[];
};

export type NodeGenerationContext = NodeMediaReferences & {
    prompt: string;
    textCount: number;
    imageCount: number;
    videoCount: number;
};

export type NodeGenerationInput = {
    nodeId: string;
    type: "text" | "image" | "video";
    title: string;
    text?: string;
    image?: ReferenceImage;
    video?: ReferenceVideo;
};

export function buildNodeGenerationContext(nodeId: string, nodes: CanvasNode[], connections: CanvasConnection[], prompt: string): NodeGenerationContext {
    const inputs = buildNodeGenerationInputs(nodeId, nodes, connections);
    return buildPlainContext(inputs, prompt);
}

export function buildNodeGenerationInputs(nodeId: string, nodes: CanvasNode[], connections: CanvasConnection[]): NodeGenerationInput[] {
    return getGenerationResourceNodes(nodeId, nodes, connections).flatMap((node) => {
        const image = readReferenceImage(node);
        if (image) return [{ nodeId: node.id, type: "image" as const, title: node.title, image }];
        const video = readReferenceVideo(node);
        if (video) return [{ nodeId: node.id, type: "video" as const, title: node.title, video }];
        const text = readNodeText(node);
        if (text) return [{ nodeId: node.id, type: "text" as const, title: node.title, text }];
        return [];
    });
}

export function buildNodeResponseMessages(context: NodeGenerationContext): AiTextMessage[] {
    if (!context.referenceImages.length) {
        return [{ role: "user", content: context.prompt }];
    }
    return [
        {
            role: "user",
            content: [
                { type: "text" as const, text: context.prompt },
                ...context.referenceImages.map((image) => ({
                    type: "image_url" as const,
                    image_url: { url: image.dataUrl },
                })),
            ],
        },
    ];
}

export async function hydrateNodeGenerationContext(context: NodeGenerationContext, mode: CanvasGenerationMode) {
    if (mode === "video") return context;
    const { imageToDataUrl } = await import("@/features/storage/services/image-storage");
    return {
        ...context,
        referenceImages: await Promise.all(
            context.referenceImages.map(async (image) => ({
                ...image,
                dataUrl: await imageToDataUrl(image),
            })),
        ),
    };
}

function buildPlainContext(inputs: NodeGenerationInput[], prompt: string): NodeGenerationContext {
    const textBlocks = inputs.map((input) => input.text).filter((text): text is string => Boolean(text));
    const upstreamText = textBlocks.join("\n\n");
    const references = collectMediaReferences(inputs);

    return {
        prompt: upstreamText && !prompt.includes(upstreamText) ? `${prompt}\n\n${upstreamText}` : prompt,
        ...references,
        textCount: inputs.filter((input) => input.type === "text").length,
        imageCount: references.referenceImages.length,
        videoCount: references.referenceVideos.length,
    };
}

function collectMediaReferences(inputs: NodeGenerationInput[]): NodeMediaReferences {
    return {
        referenceImages: inputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image)),
        referenceVideos: inputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video)),
    };
}

function readNodeText(node: CanvasNode) {
    if (isTextNode(node)) return node.content.text;
    return node.generation.prompt;
}

function createGenerationLabel(type: NodeGenerationInput["type"], index: number) {
    if (type === "image") return imageReferenceLabel(index);
    if (type === "video") return seedanceReferenceLabel("video", index);
    return `文本${index + 1}`;
}

function readReferenceImage(node: CanvasNode): ReferenceImage | null {
    if (!isImageNode(node) || !node.content.source) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.png`,
        type: node.content.mimeType || "image/png",
        dataUrl: node.content.source,
        storageKey: node.content.storageKey,
        objectStorage: node.content.objectStorage,
    };
}

function readReferenceVideo(node: CanvasNode): ReferenceVideo | null {
    if (!isVideoNode(node) || !node.content.source) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.mp4`,
        type: node.content.mimeType || "video/mp4",
        url: node.content.source,
        storageKey: node.content.storageKey,
        bytes: node.content.bytes,
        width: node.frame.naturalWidth,
        height: node.frame.naturalHeight,
        durationMs: node.content.durationMilliseconds,
        objectStorage: node.content.objectStorage,
    };
}
