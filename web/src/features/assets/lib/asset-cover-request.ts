import type { Asset, ImageAsset } from "../stores/use-asset-store";

type AssetCoverRequest =
    | { kind: "image" | "video"; key: string; url?: never }
    | { kind: "imageUrl"; key: string; url: string };

/** 去掉签名参数后比较，避免同一对象的新旧签名被当成两张图。 */
function mediaIdentity(url: string | undefined): string {
    const value = url?.trim() || "";
    if (!value) return "";
    try {
        const parsed = new URL(value);
        parsed.search = "";
        parsed.hash = "";
        return parsed.toString();
    } catch {
        return value.split("#")[0]?.split("?")[0] || "";
    }
}

function sameMedia(left: string | undefined, right: string | undefined): boolean {
    const a = mediaIdentity(left);
    const b = mediaIdentity(right);
    return Boolean(a) && a === b;
}

/** 封面就是图片文件本身时，列表应按存储键重新取缩略图，而不是抓历史签名地址。 */
export function isOwnImageCover(asset: ImageAsset): boolean {
    const cover = asset.coverUrl?.trim() || "";
    if (!cover || cover.startsWith("blob:")) return true;
    const dataUrl = asset.data.dataUrl?.trim() || "";
    const objectUrl = asset.data.objectStorage?.url;
    if (sameMedia(cover, dataUrl) || sameMedia(cover, objectUrl) || coverMatchesObjectKey(cover, asset.data.objectStorage?.key)) return true;
    return !dataUrl && !objectUrl;
}

function coverMatchesObjectKey(cover: string, objectKey: string | undefined): boolean {
    const key = objectKey?.trim();
    if (!key) return false;
    const path = mediaIdentity(cover);
    return path.endsWith(`/${key}`) || path.endsWith(`/${key.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`);
}

/** 明确区分图片来源与视频封面存储键，视频地址只交给播放器。 */
export function getAssetCoverRequest(asset: Asset | null): AssetCoverRequest | undefined {
    if (!asset) return undefined;
    const storedCover = asset.coverUrl?.trim();
    const coverUrl = asset.kind === "video" && sameMedia(storedCover, asset.data.url) ? undefined : storedCover;
    if (asset.kind === "image" && asset.data.storageKey && isOwnImageCover({ ...asset, coverUrl: coverUrl || "" })) {
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
