import type { ObjectStorageFile } from "@/shared/types/object-storage";

export type MediaStorageInfo = {
    url: string;
    objectStorage?: ObjectStorageFile;
};

export function mergeMediaStorageInfo(
    fallbackUrl: string,
    fallbackObjectStorage?: ObjectStorageFile,
    serverMedia?: { url?: string; objectStorage?: ObjectStorageFile },
): MediaStorageInfo {
    return {
        url: serverMedia?.url || fallbackUrl,
        objectStorage: serverMedia?.objectStorage || fallbackObjectStorage,
    };
}
