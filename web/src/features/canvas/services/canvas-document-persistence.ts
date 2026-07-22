import { deleteCanvasProjects, listCanvasProjects, saveCanvasProject } from "@/services/api/server";

import type { CanvasDocument } from "../types";

export interface CanvasDocumentPersistence {
    loadDocuments: () => Promise<CanvasDocument[]>;
    saveDocument: (document: CanvasDocument) => Promise<void>;
    deleteDocuments: (documentIds: string[]) => Promise<void>;
}

export function createCanvasDocumentPersistence(): CanvasDocumentPersistence {
    return {
        loadDocuments: () => listCanvasProjects<CanvasDocument>(),
        saveDocument: async (document) => {
            await saveCanvasProject(document);
        },
        deleteDocuments: async (documentIds) => {
            await deleteCanvasProjects(documentIds);
        },
    };
}
