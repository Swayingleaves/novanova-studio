"use client";

import type { ChangeEvent, RefObject } from "react";
import { Empty, Modal } from "antd";

import { AssetPickerModal, type InsertAssetPayload } from "@/features/assets/components/asset-picker-modal";
import { isImageNode, isVideoNode } from "../domain/canvas-node";
import type { CanvasNode, CanvasNodeKind, CanvasPoint, ContextMenuState } from "../types";
import type { CanvasNavigationStoryboardAsset } from "./canvas-navigation-panel";
import { CanvasNodeContextMenu } from "./canvas-context-menu";
import { CanvasNodeCropDialog, type CanvasImageCropRect } from "./canvas-node-crop-dialog";
import { CanvasNodeInfoModal } from "./canvas-node-hover-toolbar";
import { CanvasNodeSplitDialog, type CanvasImageSplitParams } from "./canvas-node-split-dialog";

type CanvasWorkspaceOverlaysProps = {
    contextMenu: ContextMenuState | null;
    imageInputRef: RefObject<HTMLInputElement | null>;
    infoNode: CanvasNode | null;
    cropNode: CanvasNode | null;
    cropLoading: boolean;
    splitNode: CanvasNode | null;
    splitLoading: boolean;
    previewNode: CanvasNode | null;
    clearConfirmOpen: boolean;
    assetPickerOpen: boolean;
    canvasAssetPickerOpen: boolean;
    canvasAssets: CanvasNavigationStoryboardAsset[];
    onCloseContextMenu: () => void;
    onCreateNode: (kind: CanvasNodeKind, position: CanvasPoint) => void;
    onDuplicateNode: (nodeId: string) => void;
    onDeleteNodes: (nodeIds: Set<string>) => void;
    onDeleteBackgroundOnly: (nodeId: string) => void;
    onDeleteConnection: (connectionId: string) => void;
    onImageInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
    onCloseInfo: () => void;
    onCloseCrop: () => void;
    onCrop: (node: CanvasNode, crop: CanvasImageCropRect) => void;
    onCloseSplit: () => void;
    onSplit: (node: CanvasNode, params: CanvasImageSplitParams) => void;
    onClosePreview: () => void;
    onCloseClearConfirm: () => void;
    onClearCanvas: () => void;
    onInsertAsset: (payload: InsertAssetPayload) => void;
    onCloseAssetPicker: () => void;
    onSelectCanvasAsset: (asset: CanvasNavigationStoryboardAsset) => void;
    onCloseCanvasAssetPicker: () => void;
};

export function CanvasWorkspaceOverlays(props: CanvasWorkspaceOverlaysProps) {
    const cropSource = readImageSource(props.cropNode);
    const splitSource = readImageSource(props.splitNode);
    const previewSource = readMediaSource(props.previewNode);
    const previewIsVideo = Boolean(props.previewNode && isVideoNode(props.previewNode));

    const deleteContextTarget = () => {
        const menu = props.contextMenu;
        if (!menu) return;
        if (menu.type === "node") props.onDeleteNodes(new Set([menu.nodeId]));
        else if (menu.type === "selection") props.onDeleteNodes(new Set(menu.nodeIds));
        else if (menu.type === "connection") props.onDeleteConnection(menu.connectionId);
        props.onCloseContextMenu();
    };

    return (
        <>
            {props.contextMenu ? (
                <CanvasNodeContextMenu
                    menu={props.contextMenu}
                    onClose={props.onCloseContextMenu}
                    onCreateNode={(kind) => {
                        if (props.contextMenu?.type === "canvas") props.onCreateNode(kind, props.contextMenu.position);
                        props.onCloseContextMenu();
                    }}
                    onDuplicate={() => {
                        if (props.contextMenu?.type === "node") props.onDuplicateNode(props.contextMenu.nodeId);
                        props.onCloseContextMenu();
                    }}
                    onDelete={deleteContextTarget}
                    onDeleteBackgroundOnly={() => {
                        if (props.contextMenu?.type === "node") props.onDeleteBackgroundOnly(props.contextMenu.nodeId);
                        props.onCloseContextMenu();
                    }}
                />
            ) : null}

            <input ref={props.imageInputRef} type="file" accept="image/*,video/*" hidden onChange={props.onImageInputChange} />
            <CanvasNodeInfoModal node={props.infoNode} open={Boolean(props.infoNode)} onClose={props.onCloseInfo} />

            {cropSource && props.cropNode ? (
                <CanvasNodeCropDialog dataUrl={cropSource} open loading={props.cropLoading} onClose={props.onCloseCrop} onConfirm={(crop) => props.onCrop(props.cropNode!, crop)} />
            ) : null}
            {splitSource && props.splitNode ? (
                <CanvasNodeSplitDialog dataUrl={splitSource} open loading={props.splitLoading} onClose={props.onCloseSplit} onConfirm={(params) => props.onSplit(props.splitNode!, params)} />
            ) : null}

            <Modal
                title={props.previewNode?.title || (previewIsVideo ? "视频播放" : "图片详情")}
                open={Boolean(previewSource)}
                centered
                footer={null}
                width={previewIsVideo ? "min(960px, calc(100vw - 32px))" : "auto"}
                destroyOnHidden
                onCancel={props.onClosePreview}
            >
                {previewSource && previewIsVideo ? <video src={previewSource} className="block max-h-[80vh] w-full max-w-full object-contain" autoPlay controls playsInline /> : null}
                {previewSource && !previewIsVideo ? <img src={previewSource} alt={props.previewNode?.title || "图片"} className="max-h-[80vh] max-w-full object-contain" /> : null}
            </Modal>

            <Modal
                title="清空当前画布？"
                open={props.clearConfirmOpen}
                centered
                okText="清空"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                onOk={props.onClearCanvas}
                onCancel={props.onCloseClearConfirm}
            >
                <p className="text-sm opacity-70">所有节点和连线都会被移除，此操作仍可通过撤销恢复。</p>
            </Modal>

            <AssetPickerModal open={props.assetPickerOpen} onInsert={props.onInsertAsset} onClose={props.onCloseAssetPicker} />
            <Modal title="选择画布资产图片" open={props.canvasAssetPickerOpen} onCancel={props.onCloseCanvasAssetPicker} footer={null} width={760} centered destroyOnHidden>
                {props.canvasAssets.length ? (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {props.canvasAssets.map((item) => (
                            <button key={item.id} type="button" className="overflow-hidden rounded-xl border text-left transition hover:-translate-y-0.5 hover:border-[var(--studio-primary)]" onClick={() => props.onSelectCanvasAsset(item)}>
                                {item.asset.image?.source ? <img src={item.asset.image.source} alt={item.asset.name || "画布资产"} className="aspect-[4/3] w-full object-contain" /> : null}
                                <div className="p-2"><div className="truncate text-sm font-medium">{item.asset.name || "未命名资产"}</div><div className="mt-1 truncate text-xs opacity-60">{item.storyboardNodeTitle}</div></div>
                            </button>
                        ))}
                    </div>
                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前画布暂无可用的图片资产" className="py-12" />}
            </Modal>
        </>
    );
}

function readImageSource(node: CanvasNode | null): string {
    return node && isImageNode(node) ? node.content.source : "";
}

function readMediaSource(node: CanvasNode | null): string {
    return node && (isImageNode(node) || isVideoNode(node)) ? node.content.source : "";
}
