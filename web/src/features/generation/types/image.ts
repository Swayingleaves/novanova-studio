import type { ObjectStorageFile } from "@/shared/types/object-storage";

export interface ReferenceMediaIdentity {
    id: string;
    name: string;
    type: string;
}

type ReferenceImageContent = {
    dataUrl: string;
};

type ReferenceImageLocation = {
    url?: string;
    storageKey?: string;
    objectStorage?: ObjectStorageFile;
};

export type ReferenceImage = ReferenceMediaIdentity & ReferenceImageContent & ReferenceImageLocation;

export type ReferenceImageSource =
    | { kind: "objectStorage"; file: ObjectStorageFile }
    | { kind: "remote"; url: string }
    | { kind: "stored"; storageKey: string; dataUrl: string }
    | { kind: "inline"; dataUrl: string };

export function classifyReferenceImageSource(image: ReferenceImage): ReferenceImageSource {
    if (image.objectStorage) return { kind: "objectStorage", file: image.objectStorage };
    if (image.url) return { kind: "remote", url: image.url };
    if (image.storageKey) return { kind: "stored", storageKey: image.storageKey, dataUrl: image.dataUrl };
    return { kind: "inline", dataUrl: image.dataUrl };
}
