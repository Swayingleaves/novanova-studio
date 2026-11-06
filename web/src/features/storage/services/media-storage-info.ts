import type { ObjectStorageFile } from "@/shared/types/object-storage";

export type MediaStorageInfo = {
    url: string;
    sourceUrl?: string;
    objectStorage?: ObjectStorageFile;
};

export function mergeMediaStorageInfo(
    fallbackUrl: string,
    fallbackObjectStorage?: ObjectStorageFile,
    serverMedia?: { url?: string; sourceUrl?: string; objectStorage?: ObjectStorageFile },
): MediaStorageInfo {
    return {
        url: serverMedia?.url || fallbackUrl,
        sourceUrl: serverMedia?.sourceUrl,
        objectStorage: serverMedia?.objectStorage || fallbackObjectStorage,
    };
}
