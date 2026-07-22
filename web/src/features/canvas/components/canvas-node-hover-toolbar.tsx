"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { App, Modal, Segmented, Tooltip } from "antd";
import { CloudUpload, Copy, Download, FolderPlus, Info, Minus, Plus, RefreshCw, Trash2, Upload, Video } from "lucide-react";

import { formatBytes, getDataUrlByteSize } from "@/features/generation/lib/image-utils";
import { useCopyText } from "@/shared/hooks/use-copy-text";
import type { CanvasNode, CanvasNodeKind, CanvasViewTransform } from "../types";
import { isImageNode, isTextNode, isVideoNode } from "../domain/canvas-node";
import { buildImageToolbarTools } from "./canvas-image-toolbar-tools";
import { useCanvasTheme } from "./canvas-theme-provider";

type ToolbarAction = {
    id: string;
    title: string;
    label: string;
    icon: ReactNode;
    onClick: () => void;
    active?: boolean;
    danger?: boolean;
};

type ToolbarActionFactoryContext = {
    node: CanvasNode;
    hasImage: boolean;
    hasVideo: boolean;
    isText: boolean;
    canRetry: boolean;
    onInfo: (node: CanvasNode) => void;
    onDelete: (node: CanvasNode) => void;
    onRetry: (node: CanvasNode) => void;
    onSaveAsset: (node: CanvasNode) => void;
    onUploadObjectStorage: (node: CanvasNode) => void;
    onDownload: (node: CanvasNode) => void;
    onDecreaseFont: (node: CanvasNode) => void;
    onIncreaseFont: (node: CanvasNode) => void;
    onUpload: (node: CanvasNode) => void;
};

type CanvasNodeHoverToolbarProps = {
    node: CanvasNode | null;
    viewport: CanvasViewTransform;
    onKeep: (nodeId: string) => void;
    onLeave: () => void;
    onInfo: (node: CanvasNode) => void;
    onDecreaseFont: (node: CanvasNode) => void;
    onIncreaseFont: (node: CanvasNode) => void;
    onUpload: (node: CanvasNode) => void;
    onUploadObjectStorage: (node: CanvasNode) => void;
    onDownload: (node: CanvasNode) => void;
    onSaveAsset: (node: CanvasNode) => void;
    onCrop: (node: CanvasNode) => void;
    onSplit: (node: CanvasNode) => void;
    onViewImage: (node: CanvasNode) => void;
    onRetry: (node: CanvasNode) => void;
    onToggleFreeResize: (node: CanvasNode) => void;
    onDelete: (node: CanvasNode) => void;
};

export function CanvasNodeHoverToolbar(props: CanvasNodeHoverToolbarProps) {
    const { message } = App.useApp();
    const copyText = useCopyText();
    const theme = useCanvasTheme();

    if (!props.node) return null;

    const node = props.node;
    const hasImage = isImageNode(node) && Boolean(node.content.source);
    const hasVideo = isVideoNode(node) && Boolean(node.content.source);
    const isText = isTextNode(node);
    const canRetry = node.execution.phase === "failed";

    const copyImagePrompt = (targetNode: CanvasNode) => {
        const prompt = isTextNode(targetNode) ? "" : targetNode.generation.prompt.trim();
        if (!prompt) {
            message.warning("暂无可复制的提示词");
            return;
        }
        copyText(prompt, "提示词已复制");
    };

    const imageToolbarTools = buildImageToolbarTools(node, {
        onUpload: props.onUpload,
        onUploadObjectStorage: props.onUploadObjectStorage,
        onToggleFreeResize: props.onToggleFreeResize,
        onCrop: props.onCrop,
        onSplit: props.onSplit,
        onViewImage: props.onViewImage,
        onCopyPrompt: copyImagePrompt,
    });
    const baseActions = buildBaseToolbarActions({
        node,
        hasImage,
        hasVideo,
        isText,
        canRetry,
        onInfo: props.onInfo,
        onDelete: props.onDelete,
        onRetry: props.onRetry,
        onSaveAsset: props.onSaveAsset,
        onUploadObjectStorage: props.onUploadObjectStorage,
        onDownload: props.onDownload,
        onDecreaseFont: props.onDecreaseFont,
        onIncreaseFont: props.onIncreaseFont,
        onUpload: props.onUpload,
    });
    const imageActions = imageToolbarTools.map((tool) => ({
        id: tool.id,
        title: tool.title,
        label: tool.label,
        icon: tool.icon,
        active: tool.active,
        onClick: tool.onClick,
    }));
    const allActions = hasImage ? [...baseActions, ...imageActions] : baseActions;

    const left = props.viewport.x + (node.frame.position.x + node.frame.width / 2) * props.viewport.k;
    const top = props.viewport.y + node.frame.position.y * props.viewport.k - 14;

    return (
        <div
            className="absolute z-[70] flex max-w-[410px] flex-wrap gap-0.5 overflow-hidden rounded-[18px] border p-1 text-[15px] shadow-[0_8px_28px_rgba(15,23,42,.18)]"
            data-canvas-no-zoom
            style={{ left, top, transform: "translate(-50%, -100%)", background: theme.node.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseEnter={() => props.onKeep(node.id)}
            onMouseLeave={props.onLeave}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {allActions.map((action) => (
                <ToolbarActionButton key={action.id} {...action} showLabel />
            ))}
        </div>
    );
}

export function CanvasNodeInfoModal({ node, open, onClose }: { node: CanvasNode | null; open: boolean; onClose: () => void }) {
    const theme = useCanvasTheme();
    const copyText = useCopyText();
    const [view, setView] = useState<"info" | "json">("info");
    const imageBytes = node && isImageNode(node) && node.content.source ? getDataUrlByteSize(node.content.source) : 0;
    const batchCount = node && isImageNode(node) ? node.grouping.childIds.length : 0;
    const json = useMemo(() => buildNodeInfoJson(node), [node]);

    useEffect(() => {
        if (open) {
            setView("info");
        }
    }, [node?.id, open]);

    return (
        <Modal
            className="canvas-node-info-modal"
            title={
                <div className="flex items-center justify-between gap-4 pr-12">
                    <span>节点信息</span>
                    <Segmented
                        size="small"
                        value={view}
                        onChange={(value) => setView(value as "info" | "json")}
                        options={[
                            { label: "信息", value: "info" },
                            { label: "JSON", value: "json" },
                        ]}
                    />
                </div>
            }
            open={open && Boolean(node)}
            centered
            footer={null}
            onCancel={onClose}
        >
            {node ? (
                <div className="h-[56vh] min-h-[360px] text-sm">
                    {view === "info" ? (
                        <div className="thin-scrollbar h-full space-y-3 overflow-auto pr-1">
                            <InfoRow
                                label="ID"
                                value={
                                    <span className="inline-flex items-center gap-2">
                                        {node.id}
                                        <button
                                            type="button"
                                            className="inline-flex size-5 items-center justify-center rounded opacity-40 transition hover:opacity-100"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                copyText(node.id);
                                            }}
                                            title="复制节点 ID"
                                        >
                                            <Copy className="size-3.5" />
                                        </button>
                                    </span>
                                }
                            />
                            <InfoRow label="类型" value={readNodeTypeLabel(node.kind)} />
                            <InfoRow label="尺寸" value={`${Math.round(node.frame.width)} x ${Math.round(node.frame.height)}`} />
                            {node.frame.naturalWidth && node.frame.naturalHeight ? (
                                <InfoRow label="原始分辨率" value={`${node.frame.naturalWidth} x ${node.frame.naturalHeight}`} />
                            ) : null}
                            <InfoRow label="位置" value={`${Math.round(node.frame.position.x)}, ${Math.round(node.frame.position.y)}`} />
                            <InfoRow label="状态" value={node.execution.phase} />
                            {batchCount > 1 ? <InfoRow label="图片组" value={`${batchCount} 张`} /> : null}
                            {!isTextNode(node) && node.generation.prompt ? (
                                <InfoRow
                                    label="提示词"
                                    value={
                                        <span className="inline-flex items-start gap-2">
                                            {node.generation.prompt}
                                            <button
                                                type="button"
                                                className="inline-flex size-5 shrink-0 items-center justify-center rounded opacity-40 transition hover:opacity-100"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    copyText(node.generation.prompt, "提示词已复制");
                                                }}
                                                title="复制提示词"
                                            >
                                                <Copy className="size-3.5" />
                                            </button>
                                        </span>
                                    }
                                />
                            ) : null}
                            {imageBytes ? <InfoRow label="图片大小" value={formatBytes(imageBytes)} /> : null}
                            {!isTextNode(node) && node.content.objectStorage?.url ? (
                                <InfoRow
                                    label="云储存地址"
                                    value={
                                        <a href={node.content.objectStorage.url} target="_blank" rel="noreferrer" className="break-all text-[var(--studio-primary)]">
                                            {node.content.objectStorage.url}
                                        </a>
                                    }
                                />
                            ) : null}
                            {node.execution.errorMessage ? (
                                <div className="rounded-lg border p-3 text-red-400" style={{ borderColor: theme.node.stroke }}>
                                    {node.execution.errorMessage}
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <pre
                            className="thin-scrollbar h-full overflow-auto rounded-lg border p-3 text-xs leading-5"
                            style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}
                        >
                            {json}
                        </pre>
                    )}
                </div>
            ) : null}
        </Modal>
    );
}

function buildBaseToolbarActions(context: ToolbarActionFactoryContext): ToolbarAction[] {
    const actions: ToolbarAction[] = [
        { id: "info", title: "查看节点信息", label: "信息", icon: <Info className="size-4" />, onClick: () => context.onInfo(context.node) },
        { id: "delete", title: "移除节点", label: "删除", icon: <Trash2 className="size-4" />, onClick: () => context.onDelete(context.node), danger: true },
    ];

    if (context.canRetry) {
        actions.push({
            id: "retry",
            title: "重新生成",
            label: "重试",
            icon: <RefreshCw className="size-4" />,
            onClick: () => context.onRetry(context.node),
        });
    }
    if (context.hasImage || context.hasVideo || context.isText) {
        actions.push({
            id: "saveAsset",
            title: "加入我的资产",
            label: "存资产",
            icon: <FolderPlus className="size-4" />,
            onClick: () => context.onSaveAsset(context.node),
        });
    }
    if (context.hasImage || context.hasVideo) {
        actions.push({
            id: "uploadObjectStorage",
            title: !isTextNode(context.node) && context.node.content.objectStorage?.url ? "复制云储存地址" : "上传到云储存",
            label: "云储存",
            icon: <CloudUpload className="size-4" />,
            onClick: () => context.onUploadObjectStorage(context.node),
        });
    }
    if (context.hasImage || context.hasVideo) {
        actions.push({
            id: "download",
            title: context.hasVideo ? "下载视频" : "下载图片",
            label: "下载",
            icon: <Download className="size-4" />,
            onClick: () => context.onDownload(context.node),
        });
    }
    if (context.isText) {
        actions.push(
            {
                id: "decreaseFont",
                title: "减小字号",
                label: "缩小",
                icon: <Minus className="size-4" />,
                onClick: () => context.onDecreaseFont(context.node),
            },
            {
                id: "increaseFont",
                title: "增大字号",
                label: "放大",
                icon: <Plus className="size-4" />,
                onClick: () => context.onIncreaseFont(context.node),
            },
        );
    }
    if (isImageNode(context.node) && !context.hasImage) {
        actions.push({
            id: "uploadImage",
            title: "上传图片",
            label: "传图片",
            icon: <Upload className="size-4" />,
            onClick: () => context.onUpload(context.node),
        });
    }
    if (isVideoNode(context.node)) {
        actions.push({
            id: "uploadVideo",
            title: context.hasVideo ? "替换视频" : "上传视频",
            label: context.hasVideo ? "替换视频" : "传视频",
            icon: <Video className="size-4" />,
            onClick: () => context.onUpload(context.node),
        });
    }
    return actions;
}

function buildNodeInfoJson(node: CanvasNode | null) {
    if (!node) return "";
    return JSON.stringify(
        node,
        (key, value) => {
            if (key === "title") return undefined;
            if (key === "content" && typeof value === "string" && value.startsWith("data:")) {
                return "[base64 media]";
            }
            return value;
        },
        2,
    );
}

function readNodeTypeLabel(type: CanvasNodeKind) {
    if (type === "text") return "文本";
    if (type === "image") return "图片";
    return "视频";
}

function ToolbarActionButton({
    title,
    label,
    icon,
    onClick,
    showLabel,
    active = false,
    danger = false,
}: ToolbarAction & { showLabel: boolean }) {
    const theme = useCanvasTheme();
    const hasText = showLabel && Boolean(label);
    return (
        <Tooltip
            title={title}
            placement="top"
            mouseEnterDelay={0.2}
            color="#ffffff"
            styles={{ root: { color: "#242529", boxShadow: "0 8px 24px rgba(15,23,42,.16)", fontSize: 13, fontWeight: 500 } }}
        >
            <button
                type="button"
                className={`relative flex h-12 w-[78px] shrink-0 items-center justify-center whitespace-nowrap ${danger ? "text-[#ef4444]" : ""}`}
                onClick={onClick}
                aria-label={title}
            >
                <span
                    className={`flex h-9 items-center rounded-lg transition ${
                        hasText ? "gap-1.5 px-1.5" : "justify-center px-2"
                    }`}
                    style={active ? { background: theme.toolbar.activeBg, color: theme.toolbar.activeText } : undefined}
                    onMouseEnter={(event) => {
                        if (!active) event.currentTarget.style.background = theme.toolbar.itemHover;
                    }}
                    onMouseLeave={(event) => {
                        if (!active) event.currentTarget.style.background = "";
                    }}
                >
                    {icon}
                    {hasText ? <span className="truncate">{label}</span> : null}
                </span>
            </button>
        </Tooltip>
    );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3">
            <span className="opacity-50">{label}</span>
            <span className="min-w-0 whitespace-pre-wrap break-words">{value}</span>
        </div>
    );
}
