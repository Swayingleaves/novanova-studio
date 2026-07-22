"use client";

import { Copy, Grid2x2, Lock, LockOpen, Maximize2, Scissors, Upload } from "lucide-react";

import { buildCanvasImageToolActions, type CanvasImageNodeActionId } from "../domain/canvas-image-tool-actions";
import type { CanvasNode } from "../types";

export type ImageNodeActionToolId = CanvasImageNodeActionId;

export type ImageToolHandlers = {
    onUpload: (node: CanvasNode) => void;
    onUploadObjectStorage: (node: CanvasNode) => void;
    onToggleFreeResize: (node: CanvasNode) => void;
    onCrop: (node: CanvasNode) => void;
    onSplit: (node: CanvasNode) => void;
    onViewImage: (node: CanvasNode) => void;
    onCopyPrompt: (node: CanvasNode) => void;
};

const ICONS = { copyPrompt: Copy, replace: Upload, crop: Scissors, split: Grid2x2, view: Maximize2 } as const;

export function buildImageToolbarTools(node: CanvasNode, handlers: ImageToolHandlers) {
    return buildCanvasImageToolActions({ freeResize: Boolean(node.frame.freeResize) }).map((action) => {
        const Icon = action.id === "resize" ? (action.active ? LockOpen : Lock) : ICONS[action.id];
        return { ...action, icon: <Icon className="size-4" />, onClick: () => runImageTool(action.id, node, handlers) };
    });
}

function runImageTool(id: ImageNodeActionToolId, node: CanvasNode, handlers: ImageToolHandlers) {
    const actions: Record<ImageNodeActionToolId, (target: CanvasNode) => void> = {
        copyPrompt: handlers.onCopyPrompt,
        replace: handlers.onUpload,
        resize: handlers.onToggleFreeResize,
        crop: handlers.onCrop,
        split: handlers.onSplit,
        view: handlers.onViewImage,
    };
    actions[id](node);
}
