"use client";

import { Check, Download, Pencil, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Input } from "antd";

import { useCanvasStore } from "../stores/use-canvas-store";
import { useCanvasUiStore } from "../stores/use-canvas-ui-store";
import type { CanvasDocument } from "../types";
import { exportCanvasDocuments } from "../utils/canvas-export";
import { CanvasProjectPreview } from "./canvas-project-preview";

type CanvasProjectCardProps = {
    document: CanvasDocument;
};

export function CanvasProjectCard({ document }: CanvasProjectCardProps) {
    const { message } = App.useApp();
    const router = useRouter();
    const renameDocument = useCanvasStore((state) => state.renameDocument);
    const renameDraft = useCanvasUiStore((state) => state.renameDraft);
    const selectedDocumentIds = useCanvasUiStore((state) => state.selectedDocumentIds);
    const beginRename = useCanvasUiStore((state) => state.beginRename);
    const changeRenameTitle = useCanvasUiStore((state) => state.changeRenameTitle);
    const endRename = useCanvasUiStore((state) => state.endRename);
    const setDocumentSelected = useCanvasUiStore((state) => state.setDocumentSelected);
    const requestDocumentDeletion = useCanvasUiStore((state) => state.requestDocumentDeletion);
    const documentId = document.identity.id;
    const editing = renameDraft?.documentId === documentId;
    const [isExporting, setIsExporting] = useState(false);
    const openDocument = () => router.push(`/canvas/${documentId}`);
    const saveRename = () => {
        if (editing) renameDocument(documentId, renameDraft.title);
        endRename();
    };
    const exportDocument = async () => {
        if (isExporting) return;
        setIsExporting(true);
        try {
            await exportCanvasDocuments([document], document.identity.title || "无限画布");
        } catch {
            message.error("导出失败，请稍后重试");
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <article className="studio-panel-solid flex flex-col gap-3 p-3 transition hover:border-[var(--studio-primary-line)] hover:shadow-[0_8px_22px_rgba(46,16,101,0.08)]">
            <button type="button" className="overflow-hidden rounded-lg text-left" onClick={openDocument} aria-label={`打开画布 ${document.identity.title}`}>
                <CanvasProjectPreview document={document} />
            </button>

            <div className="flex min-w-0 items-start gap-3">
                <input
                    type="checkbox"
                    className="mt-1 size-4 accent-[var(--studio-primary)]"
                    checked={selectedDocumentIds.includes(documentId)}
                    onChange={(event) => setDocumentSelected(documentId, event.target.checked)}
                    aria-label={`选择 ${document.identity.title}`}
                />
                <div className="min-w-0 flex-1">
                    {editing ? (
                        <Input
                            autoFocus
                            value={renameDraft.title}
                            aria-label="画布名称"
                            onChange={(event) => changeRenameTitle(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") saveRename();
                                if (event.key === "Escape") endRename();
                            }}
                        />
                    ) : (
                        <button type="button" className="block w-full text-left" onClick={openDocument}>
                            <h2 className="studio-title truncate text-base font-semibold">{document.identity.title}</h2>
                            <p className="studio-subtitle mt-1 text-xs">{describeCanvasDocument(document)}</p>
                        </button>
                    )}
                </div>
            </div>

            <footer className="flex items-center justify-between gap-3">
                <time className="studio-caption text-xs" dateTime={document.identity.updatedAt}>
                    {formatCanvasDocumentTime(document.identity.updatedAt)}
                </time>
                <div className="flex items-center gap-1">
                    {editing ? (
                        <>
                            <Button type="text" size="small" icon={<Check className="size-4" />} onClick={saveRename}>保存</Button>
                            <Button type="text" size="small" icon={<X className="size-4" />} onClick={endRename}>取消</Button>
                        </>
                    ) : (
                        <>
                            <Button type="text" size="small" icon={<Download className="size-4" />} loading={isExporting} disabled={isExporting} onClick={() => void exportDocument()}>导出</Button>
                            <Button type="text" size="small" icon={<Pencil className="size-4" />} onClick={() => beginRename(documentId, document.identity.title)} aria-label="重命名" />
                            <Button danger type="text" size="small" icon={<Trash2 className="size-4" />} onClick={() => requestDocumentDeletion([documentId])} aria-label="删除" />
                        </>
                    )}
                </div>
            </footer>
        </article>
    );
}

function describeCanvasDocument(document: CanvasDocument): string {
    const nodeText = `${document.scene.nodes.length} 个节点`;
    const connectionText = `${document.scene.connections.length} 条连线`;
    return `${nodeText}，${connectionText}`;
}

function formatCanvasDocumentTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "更新时间未知";
    return `更新于 ${new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date)}`;
}
