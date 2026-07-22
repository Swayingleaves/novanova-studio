import { saveAs } from "file-saver";

import { createZip } from "@/shared/lib/zip";
import { getMediaBlob } from "@/features/storage/services/file-storage";
import { getImageBlob } from "@/features/storage/services/image-storage";
import { CANVAS_EXPORT_APP_ID, CANVAS_EXPORT_MANIFEST_NAME, CANVAS_EXPORT_VERSION, type CanvasExportAsset, type CanvasExportFile } from "../export-types";
import type { CanvasDocument } from "../types";

const IMAGE_STORAGE_PREFIX = "image:";
const FALLBACK_FILE_NAME = "无限画布";

/**
 * 把画布项目导出为 ZIP 并触发下载。
 * <p>
 * 递归扫描项目数据中所有含 `:` 的 storageKey，按前缀分流取回图片或媒体 Blob，
 * 连同 canvas-documents.json 清单一起打包。
 *
 * @param projects 待导出项目
 * @param fileName 输出文件名，默认"无限画布"
 */
export async function exportCanvasDocuments(documents: CanvasDocument[], fileName = FALLBACK_FILE_NAME): Promise<void> {
    const archivedDocuments = await Promise.all(documents.map(exportDocumentBundle));
    const zipFiles = archivedDocuments
        .flatMap((item) => item.binaryFiles)
        .sort((left, right) => left.name.localeCompare(right.name));

    const data: CanvasExportFile = {
        app: CANVAS_EXPORT_APP_ID,
        version: CANVAS_EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        documents: archivedDocuments.map(({ binaryFiles: _binaryFiles, ...item }) => item),
    };

    const zip = await createZip([{ name: CANVAS_EXPORT_MANIFEST_NAME, data: JSON.stringify(data, null, 2) }, ...zipFiles]);
    saveAs(zip, `${sanitizeFileName(fileName)}.zip`);
}

async function exportDocumentBundle(document: CanvasDocument): Promise<{
    document: CanvasDocument;
    files: CanvasExportAsset[];
    binaryFiles: Array<{ name: string; data: BlobPart }>;
}> {
    const storageKeys = readDocumentStorageKeys(document);
    const storedFiles = await Promise.all(storageKeys.map((storageKey) => readStoredFile(document.identity.id, storageKey)));
    const availableFiles = storedFiles.filter((item): item is NonNullable<typeof item> => Boolean(item));

    return {
        document,
        files: availableFiles.map(({ storageKey, path, blob }) => ({
            storageKey,
            path,
            mimeType: blob.type || "application/octet-stream",
            bytes: blob.size,
        })),
        binaryFiles: availableFiles.map(({ path, blob }) => ({ name: path, data: blob })),
    };
}

function readDocumentStorageKeys(document: CanvasDocument): string[] {
    const storageKeys = new Set<string>();
    visitStorageKey(document, storageKeys);
    return [...storageKeys].sort((left, right) => left.localeCompare(right));
}

function visitStorageKey(value: unknown, collectedKeys: Set<string>): void {
    if (!value || typeof value !== "object") return;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.includes(":")) collectedKeys.add(value.storageKey);
    Object.values(value).forEach((child) => {
        if (Array.isArray(child)) child.forEach((item) => visitStorageKey(item, collectedKeys));
        else visitStorageKey(child, collectedKeys);
    });
}

async function readStoredFile(projectId: string, storageKey: string): Promise<{ storageKey: string; path: string; blob: Blob } | null> {
    const blob = storageKey.startsWith(IMAGE_STORAGE_PREFIX) ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
    if (!blob) return null;
    return {
        storageKey,
        path: buildArchivePath(projectId, storageKey, blob.type),
        blob,
    };
}

function buildArchivePath(documentId: string, storageKey: string, mimeType: string): string {
    return `documents/${sanitizeFileName(documentId)}/files/${sanitizeFileName(storageKey)}.${resolveFileExtension(mimeType, storageKey)}`;
}

function resolveFileExtension(mimeType: string, storageKey: string): string {
    const matchedExtension = [
        ["png", "png"],
        ["jpeg", "jpg"],
        ["webp", "webp"],
        ["gif", "gif"],
        ["mp4", "mp4"],
        ["webm", "webm"],
    ].find(([fragment]) => mimeType.includes(fragment))?.[1];

    if (matchedExtension) return matchedExtension;
    return storageKey.startsWith(IMAGE_STORAGE_PREFIX) ? "png" : "bin";
}

function sanitizeFileName(value: string): string {
    return value.replace(/[\\/:*?"<>|]/g, "_");
}
