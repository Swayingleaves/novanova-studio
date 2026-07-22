import type { CanvasConversation, CanvasDocument, CanvasPreferences, CanvasScene } from "../types.ts";

export interface CreateCanvasDocumentInput {
    id: string;
    title: string;
    now: string;
}

export function createCanvasDocument(input: CreateCanvasDocumentInput): CanvasDocument {
    return {
        identity: {
            id: input.id,
            title: input.title,
            createdAt: input.now,
            updatedAt: input.now,
        },
        scene: {
            nodes: [],
            connections: [],
            viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
        },
        conversation: {
            sessions: [],
            activeSessionId: null,
        },
        preferences: {
            background: "dots",
            showImageInformation: false,
        },
    };
}

export function renameCanvasDocument(document: CanvasDocument, title: string, now: string): CanvasDocument {
    const normalizedTitle = title.trim();
    if (!normalizedTitle || normalizedTitle === document.identity.title) return document;

    return {
        ...document,
        identity: {
            ...document.identity,
            title: normalizedTitle,
            updatedAt: now,
        },
    };
}

export function replaceCanvasScene(document: CanvasDocument, scene: CanvasScene, now: string): CanvasDocument {
    if (scene === document.scene) return document;

    return {
        ...document,
        identity: {
            ...document.identity,
            updatedAt: now,
        },
        scene,
    };
}

export function replaceCanvasConversation(document: CanvasDocument, conversation: CanvasConversation, now: string): CanvasDocument {
    if (conversation === document.conversation) return document;

    return {
        ...document,
        identity: {
            ...document.identity,
            updatedAt: now,
        },
        conversation,
    };
}

export function updateCanvasPreferences(document: CanvasDocument, preferences: CanvasPreferences, now: string): CanvasDocument {
    if (preferences === document.preferences) return document;

    return {
        ...document,
        identity: {
            ...document.identity,
            updatedAt: now,
        },
        preferences,
    };
}

export function removeCanvasDocuments(documents: CanvasDocument[], documentIds: string[]): CanvasDocument[] {
    if (!documentIds.length) return documents;
    const removedDocumentIds = new Set(documentIds);
    return documents.filter((document) => !removedDocumentIds.has(document.identity.id));
}
