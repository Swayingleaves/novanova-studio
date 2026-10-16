"use client";
import { translateMessage as translate } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";


import { useEffect, useMemo, useState, type ReactNode } from "react";
import { App, Modal, Segmented, Tooltip } from "antd";
import { Clapperboard, CloudUpload, Copy, Download, FolderPlus, ImagePlus, Info, LoaderCircle, Minus, Plus, RefreshCw, Scissors, Trash2, Upload, Video } from "lucide-react";

import { formatAudioTime } from "@/features/storage/utils/audio-waveform";
import { formatBytes, getDataUrlByteSize } from "@/features/generation/lib/image-utils";
import { useCopyText } from "@/shared/hooks/use-copy-text";
import type { CanvasNode, CanvasNodeKind, CanvasViewTransform } from "../types";
import { isAudioNode, isDirectorDeskNode, isImageNode, isStoryboardNode, isTextNode, isVideoCompositionNode, isVideoNode } from "../domain/canvas-node";
import { buildImageToolbarTools } from "./canvas-image-toolbar-tools";
import { useCanvasTheme } from "./canvas-theme-provider";
import { useCanvasUiStore } from "../stores/use-canvas-ui-store";
import { formatGenerationStyleMessage } from "@/features/generation/lib/style-command";
import { audioNodeTrimRange } from "../utils/audio-trim";

type ToolbarAction = {
    id: string;
    title: string;
    label: string;
    icon: ReactNode;
    onClick: () => void;
    active?: boolean;
    danger?: boolean;
    disabled?: boolean;
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
    onChooseAsset: (node: CanvasNode) => void;
    onUploadObjectStorage: (node: CanvasNode) => void;
    onDownload: (node: CanvasNode) => void;
    onDecreaseFont: (node: CanvasNode) => void;
    onIncreaseFont: (node: CanvasNode) => void;
    onUpload: (node: CanvasNode) => void;
    onGenerateStoryboardVideos: (node: CanvasNode) => void;
    onTrim: (node: CanvasNode) => void;
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
    onChooseAsset: (node: CanvasNode) => void;
    onCrop: (node: CanvasNode) => void;
    onSplit: (node: CanvasNode) => void;
    onViewImage: (node: CanvasNode) => void;
    onRetry: (node: CanvasNode) => void;
    onToggleFreeResize: (node: CanvasNode) => void;
    onDelete: (node: CanvasNode) => void;
    onGenerateStoryboardVideos: (node: CanvasNode) => void;
    onTrim: (node: CanvasNode) => void;
};

export function CanvasNodeHoverToolbar(props: CanvasNodeHoverToolbarProps) {
    const translate = useTranslation();
    const { message } = App.useApp();
    const copyText = useCopyText();
    const theme = useCanvasTheme();
    const uploading = useCanvasUiStore((state) => Boolean(props.node && state.uploadingNodeIds.has(props.node.id)));

    if (!props.node) return null;

    const node = props.node;
    const hasImage = isImageNode(node) && Boolean(node.content.source);
    const hasVideo = isVideoNode(node) && Boolean(node.content.source);
    const isText = isTextNode(node);
    const canRetry = node.execution.phase === "failed" && !isAudioNode(node) && !isVideoCompositionNode(node) && !isDirectorDeskNode(node);

    const copyImagePrompt = (targetNode: CanvasNode) => {
        const prompt = isImageNode(targetNode) || isVideoNode(targetNode) ? targetNode.generation.prompt.trim() : "";
        if (!prompt) {
            message.warning(translate("canvas.noPromptToCopy"));
            return;
        }
        const styles = isImageNode(targetNode) || isVideoNode(targetNode) ? targetNode.generation.generationStyleSnapshots : [];
        copyText(formatGenerationStyleMessage(prompt, styles), translate("canvas.promptCopied"));
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
        onChooseAsset: props.onChooseAsset,
        onUploadObjectStorage: props.onUploadObjectStorage,
        onDownload: props.onDownload,
        onDecreaseFont: props.onDecreaseFont,
        onIncreaseFont: props.onIncreaseFont,
        onUpload: props.onUpload,
        onGenerateStoryboardVideos: props.onGenerateStoryboardVideos,
        onTrim: props.onTrim,
    });
    const imageActions = imageToolbarTools.map((tool) => ({
        id: tool.id,
        title: tool.title,
        label: tool.label,
        icon: tool.icon,
        active: tool.active,
        onClick: tool.onClick,
    }));
    const allActions: ToolbarAction[] = hasImage ? [...baseActions, ...imageActions] : baseActions;

    const left = props.viewport.x + (node.frame.position.x + node.frame.width / 2) * props.viewport.k;
    // 工具栏上移，为节点外侧左上角的浮动名称预留独立间距，避免两者重叠。
    const top = props.viewport.y + node.frame.position.y * props.viewport.k - 42;

    return (
        <div
            className="absolute z-[70] flex w-max flex-wrap gap-0.5 overflow-hidden rounded-[18px] border p-1 text-[15px] shadow-[0_8px_28px_rgba(15,23,42,.18)]"
            data-canvas-no-zoom
            style={{ left, top, maxWidth: "min(410px, calc(100vw - 32px))", transform: "translate(-50%, -100%)", background: theme.node.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseEnter={() => props.onKeep(node.id)}
            onMouseLeave={props.onLeave}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {allActions.map((action) => (
                <ToolbarActionButton
                    key={action.id}
                    {...action}
                    icon={uploading && action.id === "uploadObjectStorage" ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : action.icon}
                    disabled={uploading || action.disabled}
                    showLabel
                />
            ))}
        </div>
    );
}

export function CanvasNodeInfoModal({ node, open, onClose }: { node: CanvasNode | null; open: boolean; onClose: () => void }) {
    const translate = useTranslation();
    const theme = useCanvasTheme();
    const copyText = useCopyText();
    const [view, setView] = useState<"info" | "json">("info");
    const imageBytes = node && isImageNode(node) && node.content.source ? getDataUrlByteSize(node.content.source) : 0;
    const batchCount = node && isImageNode(node) ? node.grouping.childIds.length : 0;
    const json = useMemo(() => buildNodeInfoJson(node), [node, translate.locale]);

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
                    <span>{translate("canvas.nodeDetails")}</span>
                    <Segmented
                        size="small"
                        value={view}
                        onChange={(value) => setView(value as "info" | "json")}
                        options={[
                            { label: translate("canvas.information"), value: "info" },
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
                                            title={translate("canvas.copyNodeID")}
                                        >
                                            <Copy className="size-3.5" />
                                        </button>
                                    </span>
                                }
                            />
                            <InfoRow label={translate("canvas.type")} value={readNodeTypeLabel(node.kind)} />
                            <InfoRow label={translate("canvas.dimensions")} value={`${Math.round(node.frame.width)} x ${Math.round(node.frame.height)}`} />
                            {node.frame.naturalWidth && node.frame.naturalHeight ? <InfoRow label={translate("canvas.originalResolution")} value={`${node.frame.naturalWidth} x ${node.frame.naturalHeight}`} /> : null}
                            <InfoRow label={translate("canvas.position")} value={`${Math.round(node.frame.position.x)}, ${Math.round(node.frame.position.y)}`} />
                            <InfoRow label={translate("canvas.status")} value={node.execution.phase} />
                            {batchCount > 1 ? <InfoRow label={translate("canvas.imageGroup")} value={translate("canvas.images_a4f725", { value0: batchCount })} /> : null}
                            {(isImageNode(node) || isVideoNode(node)) && node.generation.prompt ? (
                                <InfoRow
                                    label={translate("canvas.prompt")}
                                    value={
                                        <span className="inline-flex items-start gap-2">
                                            {node.generation.prompt}
                                            <button
                                                type="button"
                                                className="inline-flex size-5 shrink-0 items-center justify-center rounded opacity-40 transition hover:opacity-100"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    copyText(node.generation.prompt, translate("canvas.promptCopied"));
                                                }}
                                                title={translate("canvas.copyPrompt")}
                                            >
                                                <Copy className="size-3.5" />
                                            </button>
                                        </span>
                                    }
                                />
                            ) : null}
                            {isAudioNode(node) ? <><InfoRow label={translate("canvas.audioDuration")} value={formatAudioTime(audioNodeTrimRange(node.content).durationMs / 1000)} /><InfoRow label={translate("canvas.audioSize")} value={formatBytes(node.content.bytes || 0)} /><InfoRow label={translate("canvas.audioFormat")} value={node.content.mimeType || translate("canvas.notUploaded")} /></> : null}
                            {imageBytes ? <InfoRow label={translate("canvas.imageSize")} value={formatBytes(imageBytes)} /> : null}
                            {(isImageNode(node) || isVideoNode(node) || isAudioNode(node)) && node.content.objectStorage?.url ? (
                                <InfoRow
                                    label={translate("canvas.cloudStorageURL")}
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
                        <pre className="thin-scrollbar h-full overflow-auto rounded-lg border p-3 text-xs leading-5" style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}>
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
        { id: "info", title: translate("canvas.viewNodeDetails"), label: translate("canvas.information"), icon: <Info className="size-4" />, onClick: () => context.onInfo(context.node) },
        { id: "delete", title: translate("canvas.removeNode"), label: translate("canvas.delete"), icon: <Trash2 className="size-4" />, onClick: () => context.onDelete(context.node), danger: true },
    ];

    if (context.canRetry) {
        actions.push({
            id: "retry",
            title: translate("canvas.regenerate"),
            label: translate("canvas.retry"),
            icon: <RefreshCw className="size-4" />,
            onClick: () => context.onRetry(context.node),
        });
    }
    if (isStoryboardNode(context.node)) {
        actions.splice(1, 0, {
            id: "generateStoryboardVideos",
            title: context.node.storyboard.shots.length ? translate("canvas.generateStoryboardVideosInBatch") : translate("canvas.generateStoryboardShotsFirst"),
            label: translate("canvas.batchVideo"),
            icon: <Clapperboard className="size-4" />,
            disabled: !context.node.storyboard.shots.length,
            onClick: () => context.onGenerateStoryboardVideos(context.node),
        });
    }
    if (context.hasImage || context.hasVideo || context.isText) {
        actions.push({
            id: "saveAsset",
            title: translate("canvas.addToMyAssets"),
            label: translate("canvas.saveAsset"),
            icon: <FolderPlus className="size-4" />,
            onClick: () => context.onSaveAsset(context.node),
        });
    }
    if (isImageNode(context.node)) {
        actions.push({
            id: "chooseAsset",
            title: translate("canvas.chooseCanvasAssetImageToReplaceThisNode"),
            label: translate("canvas.canvasAsset"),
            icon: <ImagePlus className="size-4" />,
            onClick: () => context.onChooseAsset(context.node),
        });
    }
    if (context.hasImage || context.hasVideo) {
        actions.push({
            id: "uploadObjectStorage",
            title: (isImageNode(context.node) || isVideoNode(context.node)) && context.node.content.objectStorage?.url ? translate("canvas.copyCloudStorageURL") : translate("canvas.uploadToCloudStorage"),
            label: translate("canvas.cloudStorage"),
            icon: <CloudUpload className="size-4" />,
            onClick: () => context.onUploadObjectStorage(context.node),
        });
    }
    if (context.hasImage || context.hasVideo) {
        actions.push({
            id: "download",
            title: context.hasVideo ? translate("canvas.downloadVideo") : translate("canvas.downloadImage"),
            label: translate("canvas.download"),
            icon: <Download className="size-4" />,
            onClick: () => context.onDownload(context.node),
        });
    }
    if (context.isText) {
        actions.push(
            {
                id: "decreaseFont",
                title: translate("canvas.decreaseFontSize"),
                label: translate("canvas.zoomOut"),
                icon: <Minus className="size-4" />,
                onClick: () => context.onDecreaseFont(context.node),
            },
            {
                id: "increaseFont",
                title: translate("canvas.increaseFontSize"),
                label: translate("canvas.zoomIn"),
                icon: <Plus className="size-4" />,
                onClick: () => context.onIncreaseFont(context.node),
            },
        );
    }
    if (isImageNode(context.node) && !context.hasImage) {
        actions.push({
            id: "uploadImage",
            title: translate("canvas.uploadImage"),
            label: translate("canvas.uploadImage_a1704b"),
            icon: <Upload className="size-4" />,
            onClick: () => context.onUpload(context.node),
        });
    }
    if (isAudioNode(context.node)) {
        actions.push({ id: "uploadAudio", title: translate("canvas.uploadOrReplaceAudio"), label: translate("canvas.uploadAudio"), icon: <Upload className="size-4" />, onClick: () => context.onUpload(context.node) });
        if (context.node.content.source) actions.push({ id: "downloadAudio", title: translate("canvas.downloadAudio"), label: translate("canvas.download"), icon: <Download className="size-4" />, onClick: () => context.onDownload(context.node) });
        if (context.node.content.source) actions.push({ id: "trimAudio", title: translate("canvas.trimIntoNewAudioNode"), label: translate("canvas.crop"), icon: <Scissors className="size-4" />, onClick: () => context.onTrim(context.node) });
    }
    if (isVideoNode(context.node)) {
        actions.push({
            id: "uploadVideo",
            title: context.hasVideo ? translate("canvas.replaceVideo") : translate("canvas.uploadVideo"),
            label: context.hasVideo ? translate("canvas.replaceVideo") : translate("canvas.uploadVideo_291969"),
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
    if (type === "audio") return translate("canvas.audio");
    if (type === "text") return translate("canvas.text_dd8186");
    if (type === "image") return translate("canvas.image");
    if (type === "storyboard") return translate("canvas.storyboardScript");
    if (type === "videoComposition") return translate("canvas.composeVideo");
    if (type === "directorDesk") return translate("canvas.3DDirectorDesk");
    if (type === "background") return translate("canvas.background");
    return translate("canvas.video");
}

function ToolbarActionButton({ title, label, icon, onClick, showLabel, active = false, danger = false, disabled = false }: ToolbarAction & { showLabel: boolean }) {
    const theme = useCanvasTheme();
    const hasText = showLabel && Boolean(label);
    return (
        <Tooltip title={title} placement="top" mouseEnterDelay={0.2} color="#ffffff" styles={{ root: { color: "#242529", boxShadow: "0 8px 24px rgba(15,23,42,.16)", fontSize: 13, fontWeight: 500 } }}>
            <span className="inline-flex shrink-0">
                <button
                    type="button"
                    disabled={disabled}
                    className={`relative flex h-12 min-w-[78px] shrink-0 items-center justify-center whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-40 ${danger ? "text-[#ef4444]" : ""}`}
                    onClick={onClick}
                    aria-label={title}
                >
                    <span
                        className={`flex h-9 items-center rounded-lg transition ${hasText ? "gap-1.5 px-1.5" : "justify-center px-2"}`}
                        style={active ? { background: theme.toolbar.activeBg, color: theme.toolbar.activeText } : undefined}
                        onMouseEnter={(event) => {
                            if (!active && !disabled) event.currentTarget.style.background = theme.toolbar.itemHover;
                        }}
                        onMouseLeave={(event) => {
                            if (!active) event.currentTarget.style.background = "";
                        }}
                    >
                        {icon}
                        {hasText ? <span className="truncate">{label}</span> : null}
                    </span>
                </button>
            </span>
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
