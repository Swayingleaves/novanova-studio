import type { ObjectStorageFile } from "@/shared/types/object-storage";
import type { ReferenceMediaIdentity } from "./image";

type ReferenceVideoDimensions = {
    width?: number;
    height?: number;
    durationMs?: number;
    bytes?: number;
};

type ReferenceVideoLocation = {
    url: string;
    storageKey?: string;
    objectStorage?: ObjectStorageFile;
};

export type ReferenceVideo = ReferenceMediaIdentity & ReferenceVideoDimensions & ReferenceVideoLocation;

export type ReferenceVideoSource =
    | { kind: "objectStorage"; file: ObjectStorageFile }
    | { kind: "stored"; storageKey: string; url: string }
    | { kind: "remote"; url: string };

export function classifyReferenceVideoSource(video: ReferenceVideo): ReferenceVideoSource {
    if (video.objectStorage) return { kind: "objectStorage", file: video.objectStorage };
    if (video.storageKey) return { kind: "stored", storageKey: video.storageKey, url: video.url };
    return { kind: "remote", url: video.url };
}
