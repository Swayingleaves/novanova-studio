export type CanvasProjectSelectionState = {
    editingDocumentId: string | null;
    editingTitleDraft: string;
    selectedDocumentIds: string[];
    pendingDeleteDocumentIds: string[];
};

export function normalizeCanvasDocumentIds(ids: readonly string[]): string[] {
    const normalizedIds: string[] = [];
    const knownIds = new Set<string>();
    ids.forEach((id) => {
        const normalizedId = id.trim();
        if (!normalizedId || knownIds.has(normalizedId)) return;
        knownIds.add(normalizedId);
        normalizedIds.push(normalizedId);
    });
    return normalizedIds;
}

export function toggleCanvasDocumentSelection(ids: readonly string[], id: string, selected: boolean): string[] {
    const normalizedId = id.trim();
    if (!normalizedId) return normalizeCanvasDocumentIds(ids);
    return selected
        ? normalizeCanvasDocumentIds([...ids, normalizedId])
        : normalizeCanvasDocumentIds(ids).filter((candidateId) => candidateId !== normalizedId);
}

export function removeCanvasDocumentIds(state: CanvasProjectSelectionState, removedIds: readonly string[]): CanvasProjectSelectionState {
    const removedIdSet = new Set(normalizeCanvasDocumentIds(removedIds));
    const editingRemoved = state.editingDocumentId !== null && removedIdSet.has(state.editingDocumentId);
    return {
        editingDocumentId: editingRemoved ? null : state.editingDocumentId,
        editingTitleDraft: editingRemoved ? "" : state.editingTitleDraft,
        selectedDocumentIds: state.selectedDocumentIds.filter((id) => !removedIdSet.has(id)),
        pendingDeleteDocumentIds: state.pendingDeleteDocumentIds.filter((id) => !removedIdSet.has(id)),
    };
}
