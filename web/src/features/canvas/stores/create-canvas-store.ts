import { create } from "zustand";
import type { StoreApi } from "zustand";

import {
    createCanvasDocument,
    removeCanvasDocuments,
    renameCanvasDocument,
    replaceCanvasConversation,
    replaceCanvasScene,
    updateCanvasPreferences,
} from "../domain/canvas-document.ts";
import type { CanvasDocumentPersistence } from "../services/canvas-document-persistence.ts";
import type { CanvasDocumentSaveScheduler } from "../services/canvas-document-save-scheduler.ts";
import type { CanvasConversation, CanvasDocument, CanvasPreferences, CanvasScene } from "../types.ts";

export interface CanvasStoreState {
    hydrated: boolean;
    documents: CanvasDocument[];
    saveErrors: Record<string, string>;
    hydrateDocuments: () => Promise<void>;
    createDocument: (title?: string) => string;
    importDocument: (document: CanvasDocument) => string;
    findDocument: (documentId: string) => CanvasDocument | null;
    renameDocument: (documentId: string, title: string) => void;
    replaceScene: (documentId: string, scene: CanvasScene) => void;
    replaceConversation: (documentId: string, conversation: CanvasConversation) => void;
    updatePreferences: (documentId: string, preferences: CanvasPreferences) => void;
    deleteDocuments: (documentIds: string[]) => void;
    replaceDocuments: (documents: CanvasDocument[]) => void;
}

interface CreateCanvasStoreDependencies {
    createId: () => string;
    createTimestamp: () => string;
    persistence: CanvasDocumentPersistence;
    saveScheduler: CanvasDocumentSaveScheduler;
    onDeleteError: (documentIds: string[], error: unknown) => void;
}

const DEFAULT_DOCUMENT_TITLE = "未命名画布";

export function createCanvasStore(dependencies: CreateCanvasStoreDependencies) {
    let hydrationPromise: Promise<void> | null = null;

    return create<CanvasStoreState>()((set, get) => ({
        hydrated: false,
        documents: [],
        saveErrors: {},
        hydrateDocuments: () => {
            if (get().hydrated) return Promise.resolve();
            if (hydrationPromise) return hydrationPromise;
            hydrationPromise = dependencies.persistence
                .loadDocuments()
                .then((documents) => set({ hydrated: true, documents }))
                .finally(() => {
                    hydrationPromise = null;
                });
            return hydrationPromise;
        },
        createDocument: (title = DEFAULT_DOCUMENT_TITLE) => {
            const document = createCanvasDocument({
                id: dependencies.createId(),
                title: title.trim() || DEFAULT_DOCUMENT_TITLE,
                now: dependencies.createTimestamp(),
            });
            set((state) => ({ documents: [document, ...state.documents] }));
            void dependencies.saveScheduler.saveNow(document);
            return document.identity.id;
        },
        importDocument: (source) => {
            const now = dependencies.createTimestamp();
            const document: CanvasDocument = {
                ...source,
                identity: {
                    ...source.identity,
                    id: dependencies.createId(),
                    updatedAt: now,
                },
            };
            set((state) => ({ documents: [document, ...state.documents] }));
            void dependencies.saveScheduler.saveNow(document);
            return document.identity.id;
        },
        findDocument: (documentId) => get().documents.find((document) => document.identity.id === documentId) || null,
        renameDocument: (documentId, title) => {
            const updated = updateDocument(set, documentId, (document) => renameCanvasDocument(document, title, dependencies.createTimestamp()));
            if (updated) void dependencies.saveScheduler.saveNow(updated);
        },
        replaceScene: (documentId, scene) => {
            const updated = updateDocument(set, documentId, (document) => replaceCanvasScene(document, scene, dependencies.createTimestamp()));
            if (updated) dependencies.saveScheduler.schedule(updated);
        },
        replaceConversation: (documentId, conversation) => {
            const updated = updateDocument(set, documentId, (document) => replaceCanvasConversation(document, conversation, dependencies.createTimestamp()));
            if (updated) dependencies.saveScheduler.schedule(updated);
        },
        updatePreferences: (documentId, preferences) => {
            const updated = updateDocument(set, documentId, (document) => updateCanvasPreferences(document, preferences, dependencies.createTimestamp()));
            if (updated) dependencies.saveScheduler.schedule(updated);
        },
        deleteDocuments: (documentIds) => {
            if (!documentIds.length) return;
            documentIds.forEach(dependencies.saveScheduler.cancel);
            set((state) => ({ documents: removeCanvasDocuments(state.documents, documentIds) }));
            void dependencies.persistence.deleteDocuments(documentIds).catch((error) => dependencies.onDeleteError(documentIds, error));
        },
        replaceDocuments: (documents) => {
            set({ documents });
            documents.forEach((document) => void dependencies.saveScheduler.saveNow(document));
        },
    }));
}

type CanvasStoreSetter = StoreApi<CanvasStoreState>["setState"];

function updateDocument(
    setState: CanvasStoreSetter,
    documentId: string,
    updater: (document: CanvasDocument) => CanvasDocument,
): CanvasDocument | null {
    let updatedDocument: CanvasDocument | null = null;
    setState((state) => ({
        documents: state.documents.map((document) => {
            if (document.identity.id !== documentId) return document;
            const nextDocument = updater(document);
            if (nextDocument === document) return document;
            updatedDocument = nextDocument;
            return nextDocument;
        }),
    }));
    return updatedDocument;
}
