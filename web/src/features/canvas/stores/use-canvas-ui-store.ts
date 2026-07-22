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

export const useCanvasUiStore = create<CanvasUiState>()((set) => ({
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
