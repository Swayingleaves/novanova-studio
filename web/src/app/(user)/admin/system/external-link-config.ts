import type { ExternalLinkConfig } from "@/services/api/external-link";

/** 展示外链草稿，字段与服务端配置一致。 */
export type ExternalLinkDraft = ExternalLinkConfig;

/** 草稿校验问题，空串表示通过。 */
export type ExternalLinkDraftIssue = "" | "title" | "url" | "coverUrl";

/** 空草稿，表示右上角不展示入口。 */
export function emptyExternalLinkDraft(): ExternalLinkDraft {
    return { title: "", url: "", description: "", coverUrl: "" };
}

/** 把服务端配置转换成草稿，未配置时返回空草稿。 */
export function createExternalLinkDraft(config: ExternalLinkConfig | null | undefined): ExternalLinkDraft {
    return {
        title: config?.title ?? "",
        url: config?.url ?? "",
        description: config?.description ?? "",
        coverUrl: config?.coverUrl ?? "",
    };
}

/** 只比较去掉首尾空白的字段值，用于判断草稿是否有未保存修改。 */
export function externalLinkDraftSignature(draft: ExternalLinkDraft) {
    return JSON.stringify([draft.title.trim(), draft.url.trim(), draft.description.trim(), draft.coverUrl.trim()]);
}

/** 提交前校验草稿，标题和链接同时为空表示移除入口。 */
export function externalLinkDraftIssue(draft: ExternalLinkDraft): ExternalLinkDraftIssue {
    const title = draft.title.trim();
    const url = draft.url.trim();
    if (!title && !url) return "";
    if (!title) return "title";
    if (!isHttpUrl(url)) return "url";
    if (draft.coverUrl.trim() && !isHttpUrl(draft.coverUrl.trim())) return "coverUrl";
    return "";
}

function isHttpUrl(value: string) {
    if (!value || value.length > 2048) return false;
    try {
        const url = new URL(value);
        return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
    } catch {
        return false;
    }
}
