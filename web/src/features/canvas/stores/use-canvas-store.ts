import { nanoid } from "nanoid";

import { createCanvasDocumentPersistence } from "../services/canvas-document-persistence";
import { createCanvasDocumentSaveScheduler } from "../services/canvas-document-save-scheduler";
import { createCanvasStore } from "./create-canvas-store";

const persistence = createCanvasDocumentPersistence();
let storeReference: ReturnType<typeof createCanvasStore>;

const saveScheduler = createCanvasDocumentSaveScheduler({
    delayMilliseconds: 400,
    saveDocument: persistence.saveDocument,
    onError: (documentId, error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error("保存画布文档失败", { documentId, error });
        storeReference.setState((state) => ({
            saveErrors: {
                ...state.saveErrors,
                [documentId]: message,
            },
        }));
    },
});

export const useCanvasStore = createCanvasStore({
    createId: nanoid,
    createTimestamp: () => new Date().toISOString(),
    persistence,
    saveScheduler,
    onDeleteError: (documentIds, error) => {
        console.error("删除画布文档失败", { documentIds, error });
    },
});

storeReference = useCanvasStore;

/** 切换空间前同步保存已加载文档，失败由调用方提示并保留原空间。 */
export async function saveCanvasBeforeTeamSwitch() {
    const state = useCanvasStore.getState();
    if (!state.hydrated) return;
    for (const document of state.documents) {
        saveScheduler.cancel(document.identity.id);
        await persistence.saveDocument(document);
    }
    if (Object.keys(state.saveErrors).length) throw new Error("画布存在保存错误，请处理后再切换空间");
}
