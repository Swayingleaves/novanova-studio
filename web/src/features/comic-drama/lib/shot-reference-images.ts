import type { ComicDramaAssetVersion, ComicDramaMediaResult, ComicDramaShot } from "../types";

/** 与服务端一致，仅使用非空地址或存储键判定图片是否有效。 */
function hasImageLocation(value: unknown): boolean {
    if (!value || typeof value !== "object") return false;
    const item = value as Record<string, unknown>;
    return [item.storageKey, item.url].some((location) => typeof location === "string" && location.trim().length > 0);
}

/** 优先采用版本，再按创建时间和媒体标识选择；选中结果无效时不改选其他生成版本。 */
function hasSelectedGeneratedImage(media: ComicDramaMediaResult[], targetType: string, targetId: string): boolean {
    const selected = media
        .filter((item) => item.targetType === targetType && item.targetId === targetId && item.mediaType === "image" && (item.status === "completed" || item.status === "needsUpdate"))
        .sort((left, right) => Number(right.adopted) - Number(left.adopted) || Date.parse(right.createdAt || "") - Date.parse(left.createdAt || "") || left.id.localeCompare(right.id))[0];
    if (!selected) return false;
    const items = selected.resultData.items;
    return hasImageLocation(selected.resultData.item ?? (Array.isArray(items) ? items[0] : undefined));
}

/** 按服务端实际选择规则计数：分镜图在前，每个资产选择生成图或首张有效上传图。 */
export function countShotReferenceImages(shot: ComicDramaShot, media: ComicDramaMediaResult[], versions: ComicDramaAssetVersion[]): number {
    const versionsById = new Map(versions.map((version) => [version.id, version]));
    return (
        Number(hasSelectedGeneratedImage(media, "shot", shot.id)) +
        shot.assetVersionIds.reduce((count, versionId) => {
            const hasImage = hasSelectedGeneratedImage(media, "assetVersion", versionId) || versionsById.get(versionId)?.referenceMedia.some(hasImageLocation);
            return count + Number(Boolean(hasImage));
        }, 0)
    );
}
