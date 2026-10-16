"use client";
import { useTranslation } from "@/features/locale/use-translation";


import { Modal } from "antd";

import { useAssetStore } from "@/features/assets/stores/use-asset-store";
import { useCanvasStore } from "../stores/use-canvas-store";
import { useCanvasUiStore } from "../stores/use-canvas-ui-store";

export function CanvasDeleteProjectsDialog() {
    const translate = useTranslation();
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
            title={documentIds.length > 1 ? translate("canvas.deleteCanvases", { value0: documentIds.length }) : translate("canvas.deleteCanvas")}
            open={documentIds.length > 0}
            centered
            okText={translate("canvas.confirmDeletion")}
            cancelText={translate("canvas.cancel")}
            okButtonProps={{ danger: true }}
            onOk={confirm}
            onCancel={close}
        >
            <p className="text-sm text-[var(--studio-muted)]">{translate("canvas.canvasNodesConnectionsAndConversationsWillBeDeletedPermanently")}</p>
        </Modal>
    );
}
