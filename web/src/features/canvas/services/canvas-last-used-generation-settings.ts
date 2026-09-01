import type { CanvasNodeAttributes } from "../domain/canvas-node";
import type { CanvasNodeKind } from "../types";

type CanvasLastUsedGenerationSettings = {
    version: 1;
    image?: {
        quality?: string;
        imageResolution?: string;
        size?: string;
        count?: number;
    };
    video?: {
        vquality?: string;
        size?: string;
        seconds?: string;
        videoGenerationMode?: import("@/features/settings/stores/use-config-store").VideoGenerationMode;
        watermark?: string;
        count?: number;
    };
};

const storageKey = "novanova-studio.canvas-generation-settings.v1";

export function readCanvasLastUsedGenerationSettings(kind: CanvasNodeKind): CanvasNodeAttributes | undefined {
    const settings = readSettings();
    if (kind === "image" && settings.image) return settings.image;
    if (kind === "video" && settings.video) return settings.video;
    return undefined;
}

export function saveCanvasLastUsedGenerationSettings(kind: CanvasNodeKind, attributes: CanvasNodeAttributes) {
    const settings = readSettings();
    if (kind === "image") {
        const image = {
            ...settings.image,
            ...(typeof attributes.quality === "string" ? { quality: attributes.quality } : {}),
            ...(typeof attributes.imageResolution === "string" ? { imageResolution: attributes.imageResolution } : {}),
            ...(typeof attributes.size === "string" ? { size: attributes.size } : {}),
            ...(typeof attributes.count === "number" ? { count: attributes.count } : {}),
        };
        if (!Object.keys(image).length) return;
        writeSettings({ ...settings, image });
        return;
    }
    if (kind === "video") {
        const video = {
            ...settings.video,
            ...(typeof attributes.vquality === "string" ? { vquality: attributes.vquality } : {}),
            ...(typeof attributes.size === "string" ? { size: attributes.size } : {}),
            ...(typeof attributes.seconds === "string" ? { seconds: attributes.seconds } : {}),
            ...(typeof attributes.videoGenerationMode === "string" ? { videoGenerationMode: attributes.videoGenerationMode } : {}),
            ...(typeof attributes.watermark === "string" ? { watermark: attributes.watermark } : {}),
            ...(typeof attributes.count === "number" ? { count: attributes.count } : {}),
        };
        if (!Object.keys(video).length) return;
        writeSettings({ ...settings, video });
    }
}

function readSettings(): CanvasLastUsedGenerationSettings {
    if (typeof window === "undefined") return { version: 1 };
    try {
        const value = window.localStorage.getItem(storageKey);
        if (!value) return { version: 1 };
        const settings = JSON.parse(value) as CanvasLastUsedGenerationSettings;
        return settings && typeof settings === "object" && settings.version === 1 ? settings : { version: 1 };
    } catch {
        return { version: 1 };
    }
}

function writeSettings(settings: CanvasLastUsedGenerationSettings) {
    try {
        window.localStorage.setItem(storageKey, JSON.stringify(settings));
    } catch (error) {
        console.error("保存画布生成设置失败", error);
    }
}
