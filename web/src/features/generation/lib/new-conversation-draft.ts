import localforage from "localforage";

import type { ReferenceImage } from "@/features/generation/types/image";
import type { ReferenceVideo } from "@/features/generation/types/media";

export type NewConversationDraftKind = "image" | "video";

export type NewConversationDraft = {
    prompt: string;
    references: ReferenceImage[];
    videoReferences?: ReferenceVideo[];
};

const draftStorage = localforage.createInstance({
    name: "novanova-studio",
    storeName: "new_conversation_drafts",
});

const memoryDrafts = new Map<string, NewConversationDraft>();

function storageKey(kind: NewConversationDraftKind, userId: string | number | null | undefined) {
    return `${kind}:${userId ?? "guest"}`;
}

/** 过滤仍在上传中或仅含临时 blob 地址的未完成参考素材，避免刷新后产生失效链接。 */
export function sanitizeDraftReferences<T extends { id: string; url?: string; storageKey?: string }>(
    items: T[],
    uploadingIds: readonly string[] = [],
): T[] {
    const uploading = new Set(uploadingIds);
    return items.filter((item) => {
        if (uploading.has(item.id)) return false;
        const url = item.url?.trim() || "";
        if (!url && !item.storageKey) return false;
        if (url.startsWith("blob:") && !item.storageKey) return false;
        return true;
    });
}

/** 判断草稿是否包含任意有效内容（提示词或参考素材）。 */
export function hasNewConversationDraftContent(draft: NewConversationDraft | null | undefined): boolean {
    if (!draft) return false;
    return Boolean(draft.prompt.trim() || draft.references.length || draft.videoReferences?.length);
}

/** 同步读取内存中的最新草稿，供页内切换历史记录后点击「新增」时瞬时恢复。 */
export function peekNewConversationDraft(kind: NewConversationDraftKind, userId: string | number | null | undefined): NewConversationDraft | null {
    return memoryDrafts.get(storageKey(kind, userId)) || null;
}

/** 读取持久化的新建对话草稿（内存命中优先，未命中则从 localforage 恢复）。 */
export async function loadNewConversationDraft(kind: NewConversationDraftKind, userId: string | number | null | undefined): Promise<NewConversationDraft | null> {
    const key = storageKey(kind, userId);
    const cached = memoryDrafts.get(key);
    if (cached) return cached;
    try {
        const stored = await draftStorage.getItem<NewConversationDraft>(key);
        if (!hasNewConversationDraftContent(stored)) return null;
        const normalized: NewConversationDraft = {
            prompt: stored?.prompt || "",
            references: Array.isArray(stored?.references) ? stored.references : [],
            videoReferences: Array.isArray(stored?.videoReferences) ? stored.videoReferences : [],
        };
        memoryDrafts.set(key, normalized);
        return normalized;
    } catch {
        return null;
    }
}

/** 保存新建对话草稿；内容全空时自动清理。 */
export async function saveNewConversationDraft(
    kind: NewConversationDraftKind,
    userId: string | number | null | undefined,
    draft: NewConversationDraft,
): Promise<void> {
    const key = storageKey(kind, userId);
    if (!hasNewConversationDraftContent(draft)) {
        memoryDrafts.delete(key);
        try {
            await draftStorage.removeItem(key);
        } catch {
            // 本地存储不可用时忽略，保留内存态。
        }
        return;
    }
    const normalized: NewConversationDraft = {
        prompt: draft.prompt,
        references: draft.references,
        ...(kind === "video" ? { videoReferences: draft.videoReferences || [] } : {}),
    };
    memoryDrafts.set(key, normalized);
    try {
        await draftStorage.setItem(key, normalized);
    } catch {
        // 本地存储不可用时忽略，保留内存态。
    }
}

/** 清理新建对话草稿（例如新建对话成功提交生成后调用）。 */
export async function clearNewConversationDraft(kind: NewConversationDraftKind, userId: string | number | null | undefined): Promise<void> {
    const key = storageKey(kind, userId);
    memoryDrafts.delete(key);
    try {
        await draftStorage.removeItem(key);
    } catch {
        // 本地存储不可用时忽略。
    }
}
