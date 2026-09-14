import { create } from "zustand";

import {
    normalizeCanvasDocumentIds,
    removeCanvasDocumentIds,
    toggleCanvasDocumentSelection,
} from "../domain/canvas-project-selection";

type CanvasRenameDraft = {
    documentId: string;
    title: string;
};

type CanvasUiState = {
    uploadingNodeIds: Set<string>;
    beginNodeUpload: (nodeId: string) => boolean;
    finishNodeUpload: (nodeId: string) => void;
    renameDraft: CanvasRenameDraft | null;
    selectedDocumentIds: string[];
    pendingDeleteDocumentIds: string[];
    beginRename: (documentId: string, title: string) => void;
    changeRenameTitle: (title: string) => void;
    endRename: () => void;
    setDocumentSelected: (documentId: string, selected: boolean) => void;
    requestDocumentDeletion: (documentIds: readonly string[]) => void;
    applyDeletedDocuments: (documentIds: readonly string[]) => void;
};

export const useCanvasUiStore = create<CanvasUiState>()((set, get) => ({
    uploadingNodeIds: new Set(),
    // 上传状态仅保存在内存中，避免写入画布文档或撤销历史。
    beginNodeUpload: (nodeId) => {
        if (get().uploadingNodeIds.has(nodeId)) return false;
        set((state) => ({ uploadingNodeIds: new Set(state.uploadingNodeIds).add(nodeId) }));
        return true;
    },
    finishNodeUpload: (nodeId) =>
        set((state) => {
            const uploadingNodeIds = new Set(state.uploadingNodeIds);
            uploadingNodeIds.delete(nodeId);
            return { uploadingNodeIds };
        }),
    renameDraft: null,
    selectedDocumentIds: [],
    pendingDeleteDocumentIds: [],
    beginRename: (documentId, title) => set({ renameDraft: { documentId, title } }),
    changeRenameTitle: (title) => set((state) => ({ renameDraft: state.renameDraft ? { ...state.renameDraft, title } : null })),
    endRename: () => set({ renameDraft: null }),
    setDocumentSelected: (documentId, selected) =>
        set((state) => ({ selectedDocumentIds: toggleCanvasDocumentSelection(state.selectedDocumentIds, documentId, selected) })),
    requestDocumentDeletion: (documentIds) => set({ pendingDeleteDocumentIds: normalizeCanvasDocumentIds(documentIds) }),
    applyDeletedDocuments: (documentIds) =>
        set((state) => {
            const nextState = removeCanvasDocumentIds(
                {
                    editingDocumentId: state.renameDraft?.documentId ?? null,
                    editingTitleDraft: state.renameDraft?.title ?? "",
                    selectedDocumentIds: state.selectedDocumentIds,
                    pendingDeleteDocumentIds: state.pendingDeleteDocumentIds,
                },
                documentIds,
            );
            return {
                renameDraft: nextState.editingDocumentId
                    ? { documentId: nextState.editingDocumentId, title: nextState.editingTitleDraft }
                    : null,
                selectedDocumentIds: nextState.selectedDocumentIds,
                pendingDeleteDocumentIds: nextState.pendingDeleteDocumentIds,
            };
        }),
}));
