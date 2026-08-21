import localforage from "localforage";

export const RECENT_REFERENCE_IMAGE_LIMIT = 20;

const recentReferenceImageStorage = localforage.createInstance({
    name: "novanova-studio",
    storeName: "recent_reference_images",
});

const writeQueues = new Map<string, Promise<void>>();

export function recentReferenceImageStorageKey(userId: string) {
    return `user:${userId}`;
}

export function normalizeRecentReferenceImageUrls(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.reduce<string[]>((urls, item) => {
        const url = normalizeReferenceImageUrl(item);
        if (!url || urls.includes(url) || urls.length >= RECENT_REFERENCE_IMAGE_LIMIT) return urls;
        urls.push(url);
        return urls;
    }, []);
}

export function prependRecentReferenceImageUrl(urls: unknown, url: string): string[] {
    const normalizedUrl = normalizeReferenceImageUrl(url);
    if (!normalizedUrl) return normalizeRecentReferenceImageUrls(urls);
    return normalizeRecentReferenceImageUrls([normalizedUrl, ...normalizeRecentReferenceImageUrls(urls)]);
}

export async function loadRecentReferenceImageUrls(userId?: string): Promise<string[]> {
    if (!userId) return [];
    return normalizeRecentReferenceImageUrls(await recentReferenceImageStorage.getItem<unknown>(recentReferenceImageStorageKey(userId)));
}

export function saveRecentReferenceImageUrls(userId: string | undefined, urls: unknown): Promise<void> {
    if (!userId) return Promise.resolve();
    const key = recentReferenceImageStorageKey(userId);
    const queue = (writeQueues.get(key) || Promise.resolve())
        .catch(() => undefined)
        .then(() => recentReferenceImageStorage.setItem(key, normalizeRecentReferenceImageUrls(urls)))
        .then(() => undefined);
    writeQueues.set(key, queue);
    return queue.finally(() => {
        if (writeQueues.get(key) === queue) writeQueues.delete(key);
    });
}

function normalizeReferenceImageUrl(value: unknown): string {
    if (typeof value !== "string") return "";
    const url = value.trim();
    try {
        const parsed = new URL(url);
        return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
    } catch {
        return "";
    }
}
