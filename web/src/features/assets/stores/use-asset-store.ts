"use client";

import { create } from "zustand";

import { nanoid } from "nanoid";
import { deleteAsset, listAssets, saveAsset } from "@/services/api/server";
import { cleanupUnusedImages, resolveImageUrl, uploadImage } from "@/features/storage/services/image-storage";
import { cleanupUnusedMedia, resolveMediaUrl, uploadMediaFile } from "@/features/storage/services/file-storage";
import type { ObjectStorageFile } from "@/shared/types/object-storage";

export type AssetKind = "text" | "image" | "video";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string; objectStorage?: ObjectStorageFile } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string; objectStorage?: ObjectStorageFile } };
export type Asset = TextAsset | ImageAsset | VideoAsset;

type AssetBase<T extends AssetKind> = {
    id: string;
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
};

type AssetStore = {
    hydrated: boolean;
    assets: Asset[];
    hydrateAssets: () => Promise<void>;
    addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => string;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => void;
    removeAsset: (id: string) => void;
    replaceAssets: (assets: Asset[]) => void;
    cleanupImages: (extra?: unknown) => void;
};

export const useAssetStore = create<AssetStore>()((set, get) => ({
    hydrated: false,
    assets: [],
    hydrateAssets: async () => {
        if (get().hydrated) return;
        const assets = await listAssets<Asset>();
        set({ assets: await Promise.all(assets.map(hydrateAsset)), hydrated: true });
    },
    addAsset: (asset) => {
        const now = new Date().toISOString();
        const id = nanoid();
        const nextAsset = { ...asset, id, createdAt: now, updatedAt: now } as Asset;
        set((state) => ({ assets: [nextAsset, ...state.assets] }));
        void persistAsset(nextAsset, (savedAsset) => {
            set((state) => ({ assets: state.assets.map((item) => (item.id === savedAsset.id ? savedAsset : item)) }));
        });
        return id;
    },
    updateAsset: (id, patch) => {
        let nextAsset: Asset | null = null;
        set((state) => ({
            assets: state.assets.map((asset) => {
                if (asset.id !== id) return asset;
                nextAsset = { ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset;
                return nextAsset;
            }),
        }));
        if (nextAsset) void persistAsset(nextAsset, (savedAsset) => set((state) => ({ assets: state.assets.map((item) => (item.id === savedAsset.id ? savedAsset : item)) })));
    },
    removeAsset: (id) => {
        set((state) => ({ assets: state.assets.filter((asset) => asset.id !== id) }));
        get().cleanupImages({ assets: get().assets });
        void deleteAsset([id]).catch((error) => console.error("删除素材失败", error));
    },
    replaceAssets: (assets) => {
        set({ assets });
        void Promise.all(assets.map((asset) => persistAsset(asset)));
    },
    cleanupImages: (extra) => {
        window.setTimeout(async () => {
            const { useCanvasStore } = await import("@/features/canvas/stores/use-canvas-store");
            await cleanupUnusedImages({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
            await cleanupUnusedMedia({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
        }, 0);
    },
}));

async function hydrateAsset(asset: Asset): Promise<Asset> {
    if (asset.kind === "video" && asset.data.storageKey) {
        const url = await resolveMediaUrl(asset.data.storageKey, asset.data.url);
        return { ...asset, data: { ...asset.data, url } };
    }
    if (asset.kind !== "image") return asset;
    if (!asset.data.storageKey) return asset;
    const dataUrl = await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl);
    return {
        ...asset,
        coverUrl: asset.coverUrl.startsWith("blob:") || asset.coverUrl === "" ? dataUrl : asset.coverUrl,
        data: { ...asset.data, dataUrl },
    };
}

async function persistAsset(asset: Asset, onSaved?: (asset: Asset) => void) {
    try {
        const normalized = await normalizeAssetMedia(asset);
        onSaved?.(normalized);
        await saveAsset(normalized);
    } catch (error) {
        console.error("保存素材失败", error);
    }
}

async function normalizeAssetMedia(asset: Asset): Promise<Asset> {
    if (asset.kind === "image") {
        let nextAsset = asset;
        if (nextAsset.data.dataUrl.startsWith("data:image/")) {
            const image = await uploadImage(nextAsset.data.dataUrl);
            nextAsset = { ...nextAsset, coverUrl: nextAsset.coverUrl === nextAsset.data.dataUrl ? image.url : nextAsset.coverUrl, data: { ...nextAsset.data, dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType, objectStorage: image.objectStorage } };
        }
        if (nextAsset.coverUrl.startsWith("data:image/")) {
            const cover = await uploadImage(nextAsset.coverUrl);
            nextAsset = { ...nextAsset, coverUrl: cover.url };
        }
        return nextAsset;
    }
    if (asset.kind === "video" && asset.data.url.startsWith("data:")) {
        const video = await uploadMediaFile(asset.data.url, "video");
        return { ...asset, data: { ...asset.data, url: video.url, storageKey: video.storageKey, width: video.width || asset.data.width, height: video.height || asset.data.height, bytes: video.bytes, mimeType: video.mimeType, objectStorage: video.objectStorage } };
    }
    return asset;
}
