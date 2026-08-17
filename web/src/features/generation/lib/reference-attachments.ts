import type { AgentAttachment } from "@/features/canvas/api/agent";

type ReferenceMedia = {
    name?: string;
    type?: string;
    mimeType?: string;
    dataUrl?: string;
    url?: string;
    storageKey?: string;
    objectStorage?: { url?: string } | null;
};

export function referenceMediaUrl(reference: ReferenceMedia): string {
    return [reference.objectStorage?.url, reference.url, reference.dataUrl]
        .map((value) => value?.trim() || "")
        .find(Boolean) || "";
}

export function referenceMediaType(reference: ReferenceMedia, fallbackType: string): string {
    return reference.type?.trim() || reference.mimeType?.trim() || fallbackType;
}

export function imageReferenceAttachments(references: readonly ReferenceMedia[]): AgentAttachment[] {
    return references.flatMap((reference) => toAgentAttachment(reference, "image/*", "参考图"));
}

export function videoReferenceAttachments(references: readonly ReferenceMedia[]): AgentAttachment[] {
    return references.flatMap((reference) => toAgentAttachment(reference, "video/*", "参考视频"));
}

function toAgentAttachment(reference: ReferenceMedia, fallbackType: string, fallbackName: string): AgentAttachment[] {
    const url = referenceMediaUrl(reference);
    const storageKey = reference.storageKey?.trim() || "";
    if (!url && !storageKey) return [];
    return [{
        url,
        type: referenceMediaType(reference, fallbackType),
        name: reference.name?.trim() || fallbackName,
        ...(storageKey ? { storageKey } : {}),
    }];
}
