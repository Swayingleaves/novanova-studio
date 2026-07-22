"use client";

import { createContext, useContext } from "react";
import type { CanvasNode, CanvasPoint } from "../types";

export type BatchImagePreview = {
  id: string;
  source: string;
};

/** 画布节点操作回调集合，由 canvas-client-page 提供 */
export type NodeActions = {
  textEditingNodeId?: string | null;
  textEditRequestVersion?: number;
  onInfo: (node: CanvasNode) => void;
  onEditText: (node: CanvasNode) => void;
  onContentChange?: (nodeId: string, content: string) => void;
  onDecreaseFont: (node: CanvasNode) => void;
  onIncreaseFont: (node: CanvasNode) => void;
  onGenerateImage: (node: CanvasNode) => void;
  onUpload: (node: CanvasNode) => void;
  onUploadObjectStorage: (node: CanvasNode) => void;
  onDownload: (node: CanvasNode) => void;
  onSaveAsset: (node: CanvasNode) => void;
  onCrop: (node: CanvasNode) => void;
  onSplit: (node: CanvasNode) => void;
  onViewImage: (node: CanvasNode) => void;
  onRetry: (node: CanvasNode) => void;
  onToggleBatch?: (nodeId: string) => void;
  batchOpeningRootIds?: Set<string>;
  batchCollapsingRootIds?: Set<string>;
  batchImagePreviewsByRootId?: Map<string, BatchImagePreview[]>;
  batchCardStackTransformsByNodeId?: Map<string, string>;
  onToggleFreeResize: (node: CanvasNode) => void;
  onDelete: (node: CanvasNode) => void;
  onKeepToolbar?: (nodeId: string) => void;
  onHideToolbar?: () => void;
  onResize?: (nodeId: string, width: number, height: number, position?: CanvasPoint) => void;
};

const noop = () => {};

const NodeActionContext = createContext<NodeActions>({
  onInfo: noop,
  onEditText: noop,
  onDecreaseFont: noop,
  onIncreaseFont: noop,
  onGenerateImage: noop,
  onUpload: noop,
  onUploadObjectStorage: noop,
  onDownload: noop,
  onSaveAsset: noop,
  onCrop: noop,
  onSplit: noop,
  onViewImage: noop,
  onRetry: noop,
  onToggleFreeResize: noop,
  onDelete: noop,
});

export const NodeActionProvider = NodeActionContext.Provider;

export function useNodeActions(): NodeActions {
  return useContext(NodeActionContext);
}
