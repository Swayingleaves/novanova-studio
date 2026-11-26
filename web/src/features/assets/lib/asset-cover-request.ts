import type { Asset } from "../stores/use-asset-store";

type AssetCoverRequest =
    | { kind: "image" | "video"; key: string; url?: never }
    | { kind: "imageUrl"; key: string; url: string };

/** 明确区分图片来源与视频封面存储键，视频地址只交给播放器。 */
export function getAssetCoverRequest(asset: Asset | null): AssetCoverRequest | undefined {
    if (!asset) return undefined;
    const storedCover = asset.coverUrl?.trim();
    const coverUrl = asset.kind === "video" && storedCover === asset.data.url?.trim() ? undefined : storedCover;
    if (asset.kind === "image" && asset.data.storageKey && (!coverUrl || coverUrl === asset.data.dataUrl?.trim())) {
        return { kind: "image", key: asset.data.storageKey };
    }

    const imageUrl = coverUrl || (asset.kind === "image" ? asset.data.dataUrl?.trim() : "");
    if (imageUrl) {
        // 自定义封面没有独立媒体键，用资产版本区分更新前后的图片。
        return { kind: "imageUrl", key: `asset-cover:${asset.id}:${asset.updatedAt}`, url: imageUrl };
    }
    if (asset.kind === "video" && asset.data.storageKey) {
        return { kind: "video", key: asset.data.storageKey };
    }
    return undefined;
}
