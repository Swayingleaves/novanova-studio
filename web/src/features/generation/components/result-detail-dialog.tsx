"use client";

import { App, Button, Image, Modal } from "antd";
import { Copy, Download } from "lucide-react";

import { formatBytes, formatDuration } from "@/features/generation/lib/image-utils";
import type { ReferenceImage } from "@/features/generation/types/image";
import type { ReferenceVideo } from "@/features/generation/types/media";

/** 详情弹窗左侧展示的媒体信息 */
export type ResultDetailMedia = {
    kind: "image" | "video";
    url: string;
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
    /** 下载当前结果，未提供时不展示下载按钮 */
    onDownload?: () => void;
};

/** 生成结果详情弹窗：左侧媒体本体，右侧提示词与引用 */
export function ResultDetailDialog({ detail, onClose }: { detail: ResultDetail | null; onClose: () => void }) {
    const { message } = App.useApp();
    if (!detail) return null;

    const { media } = detail;
    const hasSize = (media.width || 0) > 0 && (media.height || 0) > 0;
    const hasBytes = (media.bytes || 0) > 0;
    const hasDuration = media.kind === "video" && (media.durationMs || 0) > 0;
    const visibleReferences = (detail.references || []).filter((reference) => Boolean(reference.dataUrl?.trim()));
    const visibleVideoReferences = (detail.videoReferences || []).filter((reference) => Boolean(reference.url?.trim()));
    const showGenerationPrompt = Boolean(detail.generationPrompt?.trim()) && detail.generationPrompt !== detail.prompt;
    const hasRightContent = Boolean(detail.prompt?.trim()) || showGenerationPrompt || visibleReferences.length > 0 || visibleVideoReferences.length > 0;

    const copyText = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            message.success("已复制");
        } catch {
            message.error("复制失败");
        }
    };

    return (
        <Modal title="结果详情" open centered footer={null} width={980} onCancel={onClose} destroyOnHidden>
            <div className="grid gap-5 pt-1 md:grid-cols-[minmax(0,1fr)_320px]">
                <div className="min-w-0 space-y-2.5">
                    {media.kind === "image" ? (
                        <img src={media.url} alt="结果详情" className="max-h-[64vh] w-full rounded-lg bg-[var(--studio-media)] object-contain" />
                    ) : (
                        <video src={media.url} controls autoPlay className="max-h-[64vh] w-full rounded-lg bg-black" />
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
                        {detail.onDownload ? (
                            <Button size="small" icon={<Download className="size-3.5" />} onClick={detail.onDownload}>
                                下载{media.kind === "video" ? "视频" : "图片"}
                            </Button>
                        ) : null}
                    </div>
                </div>
                <div className="max-h-[64vh] space-y-5 overflow-y-auto">
                    {hasRightContent ? null : <p className="studio-subtitle text-sm">暂无提示词与引用信息</p>}
                    {detail.prompt?.trim() ? (
                        <section className="space-y-2">
                            <div className="flex items-center justify-between">
                                <h4 className="text-sm font-semibold text-[var(--studio-ink)]">提示词</h4>
                                <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => void copyText(detail.prompt!)}>
                                    复制
                                </Button>
                            </div>
                            <p className="studio-panel-solid max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-lg p-3 text-sm leading-6">{detail.prompt}</p>
                        </section>
                    ) : null}
                    {showGenerationPrompt ? (
                        <section className="space-y-2">
                            <div className="flex items-center justify-between">
                                <h4 className="text-sm font-semibold text-[var(--studio-ink)]">实际生成提示词</h4>
                                <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => void copyText(detail.generationPrompt!)}>
                                    复制
                                </Button>
                            </div>
                            <p className="studio-panel-solid max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-lg p-3 text-sm leading-6">{detail.generationPrompt}</p>
                        </section>
                    ) : null}
                    {visibleReferences.length ? (
                        <section className="space-y-2">
                            <h4 className="text-sm font-semibold text-[var(--studio-ink)]">引用图片</h4>
                            <div className="flex flex-wrap gap-2">
                                {visibleReferences.map((reference, index) => (
                                    <Image
                                        key={reference.id}
                                        src={reference.dataUrl}
                                        alt={reference.name || `引用图片 ${index + 1}`}
                                        width={80}
                                        height={80}
                                        style={{ objectFit: "cover" }}
                                        className="rounded-xl"
                                        preview={{ mask: "查看大图" }}
                                    />
                                ))}
                            </div>
                        </section>
                    ) : null}
                    {visibleVideoReferences.length ? (
                        <section className="space-y-2">
                            <h4 className="text-sm font-semibold text-[var(--studio-ink)]">引用视频</h4>
                            <div className="space-y-2">
                                {visibleVideoReferences.map((reference, index) => (
                                    <video key={reference.id} src={reference.url} controls className="max-h-40 w-full rounded-lg bg-black" title={reference.name || `引用视频 ${index + 1}`} />
                                ))}
                            </div>
                        </section>
                    ) : null}
                </div>
            </div>
        </Modal>
    );
}
