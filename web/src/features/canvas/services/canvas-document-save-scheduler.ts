import type { CanvasDocument } from "../types.ts";

export interface CanvasDocumentSaveScheduler {
    saveNow: (document: CanvasDocument) => Promise<void>;
    schedule: (document: CanvasDocument) => void;
    cancel: (documentId: string) => void;
}

interface CreateCanvasDocumentSaveSchedulerOptions {
    delayMilliseconds: number;
    saveDocument: (document: CanvasDocument) => Promise<void>;
    onError: (documentId: string, error: unknown) => void;
}

export function createCanvasDocumentSaveScheduler(options: CreateCanvasDocumentSaveSchedulerOptions): CanvasDocumentSaveScheduler {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const activeSaves = new Map<string, Promise<void>>();

    const cancel = (documentId: string) => {
        const timer = timers.get(documentId);
        if (!timer) return;
        clearTimeout(timer);
        timers.delete(documentId);
    };

    const saveNow = async (document: CanvasDocument) => {
        cancel(document.identity.id);
        const documentId = document.identity.id;
        const previousSave = activeSaves.get(documentId) || Promise.resolve();
        const currentSave = previousSave
            .catch(() => undefined)
            .then(() => options.saveDocument(document))
            .catch((error) => options.onError(documentId, error))
            .finally(() => {
                if (activeSaves.get(documentId) === currentSave) activeSaves.delete(documentId);
            });
        activeSaves.set(documentId, currentSave);
        await currentSave;
    };

    const schedule = (document: CanvasDocument) => {
        cancel(document.identity.id);
        timers.set(
            document.identity.id,
            setTimeout(() => {
                timers.delete(document.identity.id);
                void saveNow(document);
            }, options.delayMilliseconds),
        );
    };

    return { saveNow, schedule, cancel };
}
