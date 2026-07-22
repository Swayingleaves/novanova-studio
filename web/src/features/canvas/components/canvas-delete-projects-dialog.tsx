"use client";

import { Modal } from "antd";

import { useAssetStore } from "@/features/assets/stores/use-asset-store";
import { useCanvasStore } from "../stores/use-canvas-store";
import { useCanvasUiStore } from "../stores/use-canvas-ui-store";

export function CanvasDeleteProjectsDialog() {
    const documentIds = useCanvasUiStore((state) => state.pendingDeleteDocumentIds);
    const requestDocumentDeletion = useCanvasUiStore((state) => state.requestDocumentDeletion);
    const applyDeletedDocuments = useCanvasUiStore((state) => state.applyDeletedDocuments);
    const deleteDocuments = useCanvasStore((state) => state.deleteDocuments);
    const cleanupImages = useAssetStore((state) => state.cleanupImages);
    const close = () => requestDocumentDeletion([]);
    const confirm = () => {
        if (documentIds.length === 0) return;
        const deletedDocumentIds = [...documentIds];
        deleteDocuments(deletedDocumentIds);
        applyDeletedDocuments(deletedDocumentIds);
        cleanupImages();
    };

    return (
        <Modal
            title={documentIds.length > 1 ? `删除 ${documentIds.length} 个画布？` : "删除画布？"}
            open={documentIds.length > 0}
            centered
            okText="确认删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onOk={confirm}
            onCancel={close}
        >
            <p className="text-sm text-[var(--studio-muted)]">画布中的节点、连线和会话记录将一起移除，此操作无法撤销。</p>
        </Modal>
    );
}
