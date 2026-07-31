"use client";

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

const NEW_PROJECT_TITLE_PREFIX = "无限画布";
const IMPORT_ERROR_MESSAGE = "导入失败，请选择有效的画布压缩包";

export default function CanvasPage() {
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
        const documentId = createDocument(`${NEW_PROJECT_TITLE_PREFIX} ${documents.length + 1}`);
        storeInitialPromptForNavigation(initialPrompt);
        router.replace(`/canvas/${documentId}`);
    }, [createDocument, documents.length, hydrated, router]);

    const openProject = (projectId: string) => {
        router.push(`/canvas/${projectId}`);
    };

    const createAndOpenProject = () => {
        const documentId = createDocument(`${NEW_PROJECT_TITLE_PREFIX} ${documents.length + 1}`);
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
            message.success(`已导入 ${exportFile.documents.length} 个画布`);
        } catch {
            message.error(IMPORT_ERROR_MESSAGE);
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
                `无限画布-${selectedDocumentIds.length}个项目`,
            );
        } catch {
            message.error("导出失败，请稍后重试");
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <main className="studio-page h-full overflow-auto">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-5 md:px-8 md:py-8">
                <header className="flex flex-wrap items-end justify-between gap-4">
                    <div className="min-w-0">
                        <p className="studio-caption text-xs">画布库</p>
                        <h1 className="studio-title mt-2 text-3xl font-semibold">无限画布</h1>
                        <p className="studio-subtitle mt-2 text-sm">保存创作上下文，继续组织节点、连线和生成结果。</p>
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
                                    导出选中
                                </Button>
                                <Button disabled={!hydrated} onClick={() => requestDocumentDeletion(selectedDocumentIds)}>
                                    删除选中
                                </Button>
                            </>
                        ) : null}
                        <Button disabled={!hydrated || isImporting || isExporting} icon={<FileUp className="size-4" />} loading={isImporting} onClick={() => fileInputRef.current?.click()}>
                            导入画布
                        </Button>
                        <Button disabled={!hydrated} type="primary" icon={<Plus className="size-4" />} onClick={createAndOpenProject}>
                            新建画布
                        </Button>
                    </div>
                </header>

                {!hydrated ? (
                    <section className="studio-empty flex min-h-[360px] items-center justify-center text-sm">正在加载画布...</section>
                ) : documents.length ? (
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        {documents.map((document) => (
                            <CanvasProjectCard key={document.identity.id} document={document} />
                        ))}
                    </div>
                ) : (
                    <section className="studio-empty flex min-h-[360px] flex-col items-center justify-center text-center">
                        <h2 className="studio-title text-xl font-medium">还没有画布</h2>
                        <p className="studio-subtitle mt-3 text-sm">新建一个画布后，就可以独立保存节点、连线和画布外观。</p>
                        <Button type="primary" className="mt-6" icon={<Plus className="size-4" />} onClick={createAndOpenProject}>
                            新建画布
                        </Button>
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
        throw new Error("缺少项目清单");
    }
    const parsedFile = JSON.parse(await manifestFile.text()) as CanvasExportFile;
    if (parsedFile.app !== CANVAS_EXPORT_APP_ID || parsedFile.version !== CANVAS_EXPORT_VERSION || !Array.isArray(parsedFile.documents)) {
        throw new Error("画布压缩包格式无效");
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
