"use client";
import { useTranslation } from "@/features/locale/use-translation";


import { App, Button, Image, Modal } from "antd";
import { Copy, Download, Link2, PanelRightClose, PanelRightOpen } from "lucide-react";
import { cloneElement, useId, useRef, useState, type CSSProperties, type ReactElement } from "react";

import { MEDIA_FALLBACK_IMAGE, useMediaFallback } from "@/features/generation/components/media-fallback";
import { formatBytes, formatDuration } from "@/features/generation/lib/image-utils";
import type { ReferenceImage } from "@/features/generation/types/image";
import type { ReferenceVideo } from "@/features/generation/types/media";

/** 详情弹窗左侧展示的媒体信息 */
export type ResultDetailMedia = {
    kind: "image" | "video";
    url: string;
    /** 已转存云储存时的 OSS 地址，用于「拷贝链接」优先复制 */
    ossUrl?: string;
    width?: number;
    height?: number;
    bytes?: number;
    durationMs?: number;
    mimeType?: string;
};

/** 结果详情数据：媒体 + 提示词 + 引用 */
export type ResultDetail = {
    media: ResultDetailMedia;
    prompt?: string;
    generationPrompt?: string;
    references?: ReferenceImage[];
    videoReferences?: ReferenceVideo[];
    /** 下载当前结果，返回下载任务以跟踪加载状态；未提供时不展示下载按钮 */
    onDownload?: () => Promise<void>;
};

/** 生成结果详情弹窗：左侧媒体本体，右侧提示词与引用 */
export function ResultDetailDialog({ detail, onClose }: { detail: ResultDetail | null; onClose: () => void }) {
    const translate = useTranslation();
    const { message } = App.useApp();
    const activeDownloads = useRef(new Set<string>());
    const [downloadingMedia, setDownloadingMedia] = useState(new Set<string>());
    const [detailsCollapsed, setDetailsCollapsed] = useState(false);
    const [originalSize, setOriginalSize] = useState(false);
    const detailsId = useId();
    // 生成结果地址过期或加载失败时回落到默认占位图
    const mediaFallback = useMediaFallback(detail?.media.url);
    if (!detail) return null;

    const { media } = detail;
    const downloadKey = `${media.kind}:${media.url}`;
    const isDownloading = downloadingMedia.has(downloadKey);
    const hasSize = (media.width || 0) > 0 && (media.height || 0) > 0;
    const hasBytes = (media.bytes || 0) > 0;
    const hasDuration = media.kind === "video" && (media.durationMs || 0) > 0;
    const visibleReferences = (detail.references || []).filter((reference) => Boolean(reference.dataUrl?.trim()));
    const visibleVideoReferences = (detail.videoReferences || []).filter((reference) => Boolean(reference.url?.trim()));
    const showGenerationPrompt = Boolean(detail.generationPrompt?.trim()) && detail.generationPrompt !== detail.prompt;
    const hasRightContent = Boolean(detail.prompt?.trim()) || showGenerationPrompt || visibleReferences.length > 0 || visibleVideoReferences.length > 0;
    const showDetails = hasRightContent && !detailsCollapsed;
    // 为弹窗标题与下载操作预留空间，短屏也能完整看到媒体。
    const mediaHeight = "min(80dvh, calc(100dvh - 180px))";

    /** 按媒体跟踪下载，避免重复请求，并在切换或重新打开详情时保留正确状态。 */
    const downloadResult = async () => {
        if (!detail.onDownload || activeDownloads.current.has(downloadKey)) return;
        activeDownloads.current.add(downloadKey);
        setDownloadingMedia(new Set(activeDownloads.current));
        try {
            await detail.onDownload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("generation.downloadFailed"));
        } finally {
            activeDownloads.current.delete(downloadKey);
            setDownloadingMedia(new Set(activeDownloads.current));
        }
    };

    const copyText = async (text: string, successText = translate("generation.copied")) => {
        try {
            await navigator.clipboard.writeText(text);
            message.success(successText);
        } catch {
            message.error(translate("generation.copyFailed"));
        }
    };

    return (
        <Modal
            title={
                <div className="flex flex-wrap items-center justify-between gap-2 pr-8">
                    <span>{translate("generation.resultDetails")}</span>
                    {hasRightContent ? (
                        <Button type="text" size="small" icon={detailsCollapsed ? <PanelRightOpen className="size-4" /> : <PanelRightClose className="size-4" />} aria-expanded={showDetails} aria-controls={detailsId} onClick={() => setDetailsCollapsed((current) => !current)}>
                            {detailsCollapsed ? translate("generation.expandDetails") : translate("generation.collapseDetails")}
                        </Button>
                    ) : null}
                </div>
            }
            open
            centered
            footer={null}
            width="min(1600px, 92vw)"
            styles={{ body: { maxHeight: "calc(100dvh - 112px)", overflowY: "auto" } }}
            onCancel={onClose}
            destroyOnHidden
        >
            <div className={`grid gap-5 pt-1 ${showDetails ? "lg:grid-cols-[minmax(0,1fr)_300px]" : "grid-cols-1"}`}>
                <div className="min-w-0 space-y-2.5">
                    {media.kind === "image" ? (
                        <Image
                            key={media.url}
                            src={media.url}
                            alt={translate("generation.imageGeneratedClickToEnlarge")}
                            styles={{ root: { width: "100%", height: mediaHeight }, image: { width: "100%", height: "100%", objectFit: "contain" } }}
                            classNames={{ root: "overflow-hidden rounded-lg bg-[var(--studio-media)]" }}
                            preview={{
                                cover: translate("generation.viewFullSize"),
                                onOpenChange: () => setOriginalSize(false),
                                imageRender: (node) => {
                                    // 保留组件的缩放、拖动与事件，只切换图片的显示尺寸约束。
                                    const imageNode = node as ReactElement<{ style?: CSSProperties }>;
                                    return cloneElement(imageNode, {
                                        style: { ...imageNode.props.style, flexShrink: 0, width: "auto", height: "auto", maxWidth: originalSize ? "none" : "100%", maxHeight: originalSize ? "none" : "80dvh" },
                                    });
                                },
                                actionsRender: (actionsNode, { actions }) => (
                                    <div className="flex flex-wrap items-center justify-center gap-2">
                                        {actionsNode}
                                        <Button onClick={() => {
                                            actions.onReset();
                                            setOriginalSize((current) => !current);
                                        }}>
                                            {originalSize ? translate("generation.fitToWindow") : translate("generation.originalSize100")}
                                        </Button>
                                    </div>
                                ),
                            }}
                        />
                    ) : mediaFallback.missing ? (
                        <img src={mediaFallback.displaySrc} alt={translate("generation.generatedVideoCannotBeLoaded")} className="w-full rounded-lg bg-[var(--studio-media)] object-contain" style={{ height: mediaHeight }} />
                    ) : (
                        <video src={media.url} controls autoPlay className="w-full rounded-lg bg-[var(--studio-media)] object-contain" style={{ height: mediaHeight }} onError={mediaFallback.onError} />
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--studio-muted)]">
                            {hasSize ? (
                                <span>
                                    {media.width} × {media.height}
                                </span>
                            ) : null}
                            {hasBytes ? <span>{formatBytes(media.bytes!)}</span> : null}
                            {hasDuration ? <span>{formatDuration(media.durationMs!)}</span> : null}
                            {media.mimeType ? <span>{media.mimeType}</span> : null}
                        </div>
                        <div className="flex items-center gap-1.5">
                            <Button size="small" icon={<Link2 className="size-3.5" />} onClick={() => void copyText(media.ossUrl || media.url, translate("generation.linkCopied"))}>
                                {translate("generation.copyLink")}</Button>
                            {detail.onDownload ? (
                                <Button size="small" icon={<Download className="size-3.5" />} loading={isDownloading} disabled={isDownloading} aria-busy={isDownloading} onClick={() => void downloadResult()}>
                                    {isDownloading ? translate("generation.downloading") : translate("generation.download", { value0: media.kind === "video" ? translate("generation.video") : translate("generation.image_d24c10") })}
                                </Button>
                            ) : null}
                        </div>
                    </div>
                </div>
                <div id={detailsId} hidden={!showDetails} className="min-w-0 space-y-5 overflow-y-auto" style={{ maxHeight: mediaHeight }}>
                    {detail.prompt?.trim() ? (
                        <section className="space-y-2">
                            <div className="flex items-center justify-between">
                                <h4 className="text-sm font-semibold text-[var(--studio-ink)]">{translate("generation.prompt")}</h4>
                                <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => void copyText(detail.prompt!)}>
                                    {translate("generation.copy")}</Button>
                            </div>
                            <p className="studio-panel-solid max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-lg p-3 text-sm leading-6">{detail.prompt}</p>
                        </section>
                    ) : null}
                    {showGenerationPrompt ? (
                        <section className="space-y-2">
                            <div className="flex items-center justify-between">
                                <h4 className="text-sm font-semibold text-[var(--studio-ink)]">{translate("generation.actualGenerationPrompt")}</h4>
                                <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => void copyText(detail.generationPrompt!)}>
                                    {translate("generation.copy")}</Button>
                            </div>
                            <p className="studio-panel-solid max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-lg p-3 text-sm leading-6">{detail.generationPrompt}</p>
                        </section>
                    ) : null}
                    {visibleReferences.length ? (
                        <section className="space-y-2">
                            <h4 className="text-sm font-semibold text-[var(--studio-ink)]">{translate("generation.referenceImage")}</h4>
                            <div className="flex flex-wrap gap-2">
                                {visibleReferences.map((reference, index) => (
                                    <Image
                                        key={reference.id}
                                        src={reference.dataUrl}
                                        alt={reference.name || translate("generation.referenceImage_5fe380", { value0: index + 1 })}
                                        width={80}
                                        height={80}
                                        style={{ objectFit: "cover" }}
                                        className="rounded-xl"
                                        preview={{ mask: translate("generation.viewFullSize") }}
                                    />
                                ))}
                            </div>
                        </section>
                    ) : null}
                    {visibleVideoReferences.length ? (
                        <section className="space-y-2">
                            <h4 className="text-sm font-semibold text-[var(--studio-ink)]">{translate("generation.referenceVideo")}</h4>
                            <div className="space-y-2">
                                {visibleVideoReferences.map((reference, index) => (
                                    <video key={reference.id} src={reference.url} controls className="max-h-40 w-full rounded-lg bg-black" title={reference.name || translate("generation.referenceVideo_773960", { value0: index + 1 })} />
                                ))}
                            </div>
                        </section>
                    ) : null}
                </div>
            </div>
        </Modal>
    );
}
