import type { CanvasDocument } from "./types";

export const CANVAS_EXPORT_APP_ID = "novanova-studio";
export const CANVAS_EXPORT_VERSION = 4;
export const CANVAS_EXPORT_MANIFEST_NAME = "canvas-documents.json";

export type CanvasExportApp = typeof CANVAS_EXPORT_APP_ID;

export type CanvasExportAsset = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
};

type ExportedCanvasDocumentResources = {
    document: CanvasDocument;
    files: CanvasExportAsset[];
};

export type CanvasExportFile = {
    app: CanvasExportApp;
    version: typeof CANVAS_EXPORT_VERSION;
    exportedAt: string;
    documents: ExportedCanvasDocumentResources[];
};

export type CanvasDocumentExportItem = ExportedCanvasDocumentResources;
