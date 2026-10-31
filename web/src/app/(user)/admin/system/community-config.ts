import { nanoid } from "nanoid";

import type { CommunityConfig } from "@/services/api/community";

/** 社群草稿条目，本地标识只用于拖拽和输入焦点，不提交给服务端。 */
export type CommunityConfigDraft = {
    id: string;
    name: string;
    imageUrl: string;
};

/** 草稿校验问题，空串表示通过。 */
export type CommunityDraftIssue = "" | "name" | "url" | "duplicate";

/** 单份社群配置允许的最大条数，与服务端保持一致。 */
export const COMMUNITY_CONFIG_LIMIT = 20;

/** 把服务端配置转换成草稿，每次重置都生成新的本地标识。 */
export function createCommunityDrafts(configs: CommunityConfig[]): CommunityConfigDraft[] {
    return configs.map((config) => ({ id: `community-${nanoid()}`, name: config.name, imageUrl: config.imageUrl }));
}

/** 只比较名称、图片地址和顺序，忽略本地标识和首尾空白。 */
export function communityDraftSignature(items: Array<Pick<CommunityConfigDraft, "name" | "imageUrl">>) {
    return JSON.stringify(items.map((item) => [item.name.trim(), item.imageUrl.trim()]));
}

/** 提交前校验整份草稿，返回第一个问题的编码。 */
export function communityDraftIssue(items: CommunityConfigDraft[]): CommunityDraftIssue {
    const names = new Set<string>();
    const imageUrls = new Set<string>();
    for (const item of items) {
        const name = item.name.trim();
        if (!name) return "name";
        const imageUrl = item.imageUrl.trim();
        if (!isHttpImageUrl(imageUrl)) return "url";
        const nameKey = name.toLowerCase();
        if (names.has(nameKey) || imageUrls.has(imageUrl)) return "duplicate";
        names.add(nameKey);
        imageUrls.add(imageUrl);
    }
    return "";
}

function isHttpImageUrl(value: string) {
    if (!value || value.length > 2048) return false;
    try {
        const url = new URL(value);
        return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
    } catch {
        return false;
    }
}
