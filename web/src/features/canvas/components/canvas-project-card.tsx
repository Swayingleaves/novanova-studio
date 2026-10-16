"use client";
import { currentLanguageTag } from "@/features/locale/translate";

import { translateMessage as translate } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";


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
    const translate = useTranslation();
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
            await exportCanvasDocuments([document], document.identity.title || translate("canvas.infiniteCanvas"));
        } catch {
            message.error(translate("canvas.exportFailedTryAgainLater"));
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <article className="studio-panel-solid flex flex-col gap-3 p-3 transition hover:border-[var(--studio-primary-line)] hover:shadow-[0_8px_22px_rgba(46,16,101,0.08)]">
            <button type="button" className="overflow-hidden rounded-lg text-left" onClick={openDocument} aria-label={translate("canvas.openCanvas", { value0: document.identity.title })}>
                <CanvasProjectPreview document={document} />
            </button>

            <div className="flex min-w-0 items-start gap-3">
                <input
                    type="checkbox"
                    className="mt-1 size-4 accent-[var(--studio-primary)]"
                    checked={selectedDocumentIds.includes(documentId)}
                    onChange={(event) => setDocumentSelected(documentId, event.target.checked)}
                    aria-label={translate("canvas.select", { value0: document.identity.title })}
                />
                <div className="min-w-0 flex-1">
                    {editing ? (
                        <Input
                            autoFocus
                            value={renameDraft.title}
                            aria-label={translate("canvas.canvasName")}
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
                            <Button type="text" size="small" icon={<Check className="size-4" />} onClick={saveRename}>{translate("canvas.save")}</Button>
                            <Button type="text" size="small" icon={<X className="size-4" />} onClick={endRename}>{translate("canvas.cancel")}</Button>
                        </>
                    ) : (
                        <>
                            <Button type="text" size="small" icon={<Download className="size-4" />} loading={isExporting} disabled={isExporting} onClick={() => void exportDocument()}>{translate("canvas.export")}</Button>
                            <Button type="text" size="small" icon={<Pencil className="size-4" />} onClick={() => beginRename(documentId, document.identity.title)} aria-label={translate("canvas.rename")} />
                            <Button danger type="text" size="small" icon={<Trash2 className="size-4" />} onClick={() => requestDocumentDeletion([documentId])} aria-label={translate("canvas.delete")} />
                        </>
                    )}
                </div>
            </footer>
        </article>
    );
}

function describeCanvasDocument(document: CanvasDocument): string {
    const nodeText = translate("canvas.nodes_4f04bf", { value0: document.scene.nodes.length });
    const connectionText = translate("canvas.connections", { value0: document.scene.connections.length });
    return `${nodeText}，${connectionText}`;
}

function formatCanvasDocumentTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return translate("canvas.updateTimeUnknown");
    return translate("canvas.updated", { value0: new Intl.DateTimeFormat(currentLanguageTag(), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date) });
}
