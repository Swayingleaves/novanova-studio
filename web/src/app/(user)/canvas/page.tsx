"use client";
import { translateMessage as translate } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";


import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button } from "antd";
import { Download, FileUp, Plus } from "lucide-react";

import { CanvasDeleteProjectsDialog } from "@/features/canvas/components/canvas-delete-projects-dialog";
import { CanvasProjectCard } from "@/features/canvas/components/canvas-project-card";
import { CANVAS_EXPORT_APP_ID, CANVAS_EXPORT_MANIFEST_NAME, CANVAS_EXPORT_VERSION, type CanvasExportFile } from "@/features/canvas/export-types";
import { useCanvasStore } from "@/features/canvas/stores/use-canvas-store";
import { useCanvasUiStore } from "@/features/canvas/stores/use-canvas-ui-store";
import { exportCanvasDocuments } from "@/features/canvas/utils/canvas-export";
import { setMediaBlob } from "@/features/storage/services/file-storage";
import { setImageBlob } from "@/features/storage/services/image-storage";
import { readZip } from "@/shared/lib/zip";
import { readInitialPromptFromLocation, storeInitialPromptForNavigation } from "@/shared/lib/initial-prompt";

export default function CanvasPage() {
    const translate = useTranslation();
    const { message } = App.useApp();
    const router = useRouter();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const documents = useCanvasStore((state) => state.documents);
    const createDocument = useCanvasStore((state) => state.createDocument);
    const importDocument = useCanvasStore((state) => state.importDocument);
    const selectedDocumentIds = useCanvasUiStore((state) => state.selectedDocumentIds);
    const requestDocumentDeletion = useCanvasUiStore((state) => state.requestDocumentDeletion);
    const initialPromptHandledRef = useRef(false);
    const [isImporting, setIsImporting] = useState(false);
    const [isExporting, setIsExporting] = useState(false);

    useEffect(() => {
        if (!hydrated || initialPromptHandledRef.current) return;
        const initialPrompt = readInitialPromptFromLocation();
        if (!initialPrompt) return;
        initialPromptHandledRef.current = true;
        const documentId = createDocument(`${translate("canvas.infiniteCanvas")} ${documents.length + 1}`);
        storeInitialPromptForNavigation(initialPrompt);
        router.replace(`/canvas/${documentId}`);
    }, [createDocument, documents.length, hydrated, router, translate]);

    const openProject = (projectId: string) => {
        router.push(`/canvas/${projectId}`);
    };

    const createAndOpenProject = () => {
        const documentId = createDocument(`${translate("canvas.infiniteCanvas")} ${documents.length + 1}`);
        const initialPrompt = readInitialPromptFromLocation();
        if (initialPrompt) storeInitialPromptForNavigation(initialPrompt);
        router.push(`/canvas/${documentId}`);
    };

    const importCanvasArchive = async (file?: File) => {
        if (!file || isImporting) return;
        setIsImporting(true);
        try {
            const archive = await readZip(file);
            const exportFile = await readArchiveExportFile(archive);
            await restoreArchiveFiles(archive, exportFile);
            exportFile.documents.forEach((item) => importDocument(item.document));
            message.success(translate("canvas.importedCanvases", { value0: exportFile.documents.length }));
        } catch {
            message.error(translate("canvas.invalidCanvasArchiveChooseAnotherFile"));
        } finally {
            setIsImporting(false);
            resetFileInput(fileInputRef.current);
        }
    };

    const exportSelectedCanvasArchives = async () => {
        if (isExporting) return;
        setIsExporting(true);
        try {
            await exportCanvasDocuments(
                documents.filter((document) => selectedDocumentIds.includes(document.identity.id)),
                translate("canvas.infiniteCanvasProjects", { value0: selectedDocumentIds.length }),
            );
        } catch {
            message.error(translate("canvas.exportFailedTryAgainLater"));
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <main className="studio-page h-full overflow-auto">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-5 md:px-8 md:py-8">
                <header className="flex flex-wrap items-end justify-between gap-4">
                    <div className="min-w-0">
                        <p className="studio-caption text-xs">{translate("canvas.canvasLibrary")}</p>
                        <h1 className="studio-title mt-2 text-3xl font-semibold">{translate("canvas.infiniteCanvas")}</h1>
                        <p className="studio-subtitle mt-2 text-sm">{translate("canvas.keepCreativeContextNodesConnectionsAndGeneratedResults")}</p>
                    </div>
                    <div className="studio-glass flex flex-wrap items-center gap-2 rounded-[10px] p-2">
                        {selectedDocumentIds.length ? (
                            <>
                                <Button
                                    disabled={!hydrated || isImporting || isExporting}
                                    icon={<Download className="size-4" />}
                                    loading={isExporting}
                                    onClick={() => void exportSelectedCanvasArchives()}
                                >
                                    {translate("canvas.exportSelected")}</Button>
                                <Button disabled={!hydrated} onClick={() => requestDocumentDeletion(selectedDocumentIds)}>
                                    {translate("canvas.deleteSelected")}</Button>
                            </>
                        ) : null}
                        <Button disabled={!hydrated || isImporting || isExporting} icon={<FileUp className="size-4" />} loading={isImporting} onClick={() => fileInputRef.current?.click()}>
                            {translate("canvas.importCanvas")}</Button>
                        <Button disabled={!hydrated} type="primary" icon={<Plus className="size-4" />} onClick={createAndOpenProject}>
                            {translate("canvas.newCanvas")}</Button>
                    </div>
                </header>

                {!hydrated ? (
                    <section className="studio-empty flex min-h-[360px] items-center justify-center text-sm">{translate("canvas.loadingCanvas")}</section>
                ) : documents.length ? (
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        {documents.map((document) => (
                            <CanvasProjectCard key={document.identity.id} document={document} />
                        ))}
                    </div>
                ) : (
                    <section className="studio-empty flex min-h-[360px] flex-col items-center justify-center text-center">
                        <h2 className="studio-title text-xl font-medium">{translate("canvas.noCanvasesYet")}</h2>
                        <p className="studio-subtitle mt-3 text-sm">{translate("canvas.createACanvasToSaveItsNodesConnectionsAnd")}</p>
                        <Button type="primary" className="mt-6" icon={<Plus className="size-4" />} onClick={createAndOpenProject}>
                            {translate("canvas.newCanvas")}</Button>
                    </section>
                )}
            </div>

            <input ref={fileInputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvasArchive(event.target.files?.[0])} />
            <CanvasDeleteProjectsDialog />
        </main>
    );
}

async function readArchiveExportFile(archive: Awaited<ReturnType<typeof readZip>>) {
    const manifestFile = archive.get(CANVAS_EXPORT_MANIFEST_NAME);
    if (!manifestFile) {
        throw new Error(translate("canvas.missingProjectManifest"));
    }
    const parsedFile = JSON.parse(await manifestFile.text()) as CanvasExportFile;
    if (parsedFile.app !== CANVAS_EXPORT_APP_ID || parsedFile.version !== CANVAS_EXPORT_VERSION || !Array.isArray(parsedFile.documents)) {
        throw new Error(translate("canvas.invalidCanvasArchive"));
    }
    return parsedFile;
}

async function restoreArchiveFiles(archive: Awaited<ReturnType<typeof readZip>>, exportFile: CanvasExportFile) {
    await Promise.all(
        exportFile.documents.flatMap((documentItem) =>
            documentItem.files.map(async (fileItem) => {
                const fileBlob = archive.get(fileItem.path);
                if (!fileBlob) return;
                const typedBlob = fileBlob.type ? fileBlob : fileBlob.slice(0, fileBlob.size, fileItem.mimeType);
                if (fileItem.storageKey.startsWith("image:")) {
                    await setImageBlob(fileItem.storageKey, typedBlob);
                    return;
                }
                await setMediaBlob(fileItem.storageKey, typedBlob);
            }),
        ),
    );
}

function resetFileInput(input: HTMLInputElement | null) {
    if (input) {
        input.value = "";
    }
}
