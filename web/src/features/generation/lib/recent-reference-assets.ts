import { teamStorageKey } from "@/features/team/stores/use-team-store";
import localforage from "localforage";

export const RECENT_REFERENCE_ASSET_LIMIT = 20;

/** 「最近上传」里的参考素材：图片和视频共用一份列表，按上传先后置顶。 */
export type RecentReferenceAsset = {
    /** 媒体地址，回填参考素材时直接使用。 */
    url: string;
    /** 素材类型，决定缩略图渲染方式和回填到哪一组参考素材。 */
    kind: "image" | "video";
    /** 原始文件名，回填时作为展示名。 */
    name?: string;
    /** 视频时长，回填后仍能参与参考视频时长校验。 */
    durationMs?: number;
};

/** 登记最近上传时的入参：对象存储未启用时上传结果可能没有地址，由内部忽略。 */
export type RecentReferenceAssetInput = Omit<RecentReferenceAsset, "url"> & { url?: string };

const recentReferenceAssetStorage = localforage.createInstance({
    name: "novanova-studio",
    // 沿用图片时期的桶名，已存的最近上传记录不必迁移。
    storeName: "recent_reference_images",
});

const writeQueues = new Map<string, Promise<void>>();

export function recentReferenceAssetStorageKey(userId: string) {
    return `user:${userId}`;
}

export function normalizeRecentReferenceAssets(value: unknown): RecentReferenceAsset[] {
    if (!Array.isArray(value)) return [];
    return value.reduce<RecentReferenceAsset[]>((assets, item) => {
        const asset = normalizeRecentReferenceAsset(item);
        if (!asset || assets.some((current) => current.url === asset.url) || assets.length >= RECENT_REFERENCE_ASSET_LIMIT) return assets;
        assets.push(asset);
        return assets;
    }, []);
}

export function prependRecentReferenceAsset(assets: unknown, asset: RecentReferenceAssetInput): RecentReferenceAsset[] {
    const normalized = normalizeRecentReferenceAsset(asset);
    if (!normalized) return normalizeRecentReferenceAssets(assets);
    return normalizeRecentReferenceAssets([normalized, ...normalizeRecentReferenceAssets(assets)]);
}

export async function loadRecentReferenceAssets(userId?: string): Promise<RecentReferenceAsset[]> {
    if (!userId) return [];
    return normalizeRecentReferenceAssets(await recentReferenceAssetStorage.getItem<unknown>(teamStorageKey(recentReferenceAssetStorageKey(userId))));
}

export function saveRecentReferenceAssets(userId: string | undefined, assets: unknown): Promise<void> {
    if (!userId) return Promise.resolve();
    const key = teamStorageKey(recentReferenceAssetStorageKey(userId));
    const queue = (writeQueues.get(key) || Promise.resolve())
        .catch(() => undefined)
        .then(() => recentReferenceAssetStorage.setItem(key, normalizeRecentReferenceAssets(assets)))
        .then(() => undefined);
    writeQueues.set(key, queue);
    return queue.finally(() => {
        if (writeQueues.get(key) === queue) writeQueues.delete(key);
    });
}

function normalizeRecentReferenceAsset(value: unknown): RecentReferenceAsset | null {
    // 旧版列表只存 URL 字符串，一律按图片处理。
    const record = typeof value === "string" ? { url: value, kind: "image" } : value;
    if (!record || typeof record !== "object") return null;
    const { url, kind, name, durationMs } = record as Record<string, unknown>;
    const normalizedUrl = normalizeReferenceAssetUrl(url);
    if (!normalizedUrl) return null;
    return {
        url: normalizedUrl,
        kind: kind === "video" ? "video" : "image",
        ...(typeof name === "string" && name.trim() ? { name: name.trim() } : {}),
        ...(typeof durationMs === "number" && Number.isFinite(durationMs) ? { durationMs } : {}),
    };
}

function normalizeReferenceAssetUrl(value: unknown): string {
    if (typeof value !== "string") return "";
    const url = value.trim();
    try {
        const parsed = new URL(url);
        return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
    } catch {
        return "";
    }
}
