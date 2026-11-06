"use client";

import type { ReactElement } from "react";

import type { ChatAttachment } from "@/features/chat/types";
import { imageMentionPattern, type PromptImageReference } from "@/features/generation/lib/image-reference-mentions";

/**
 * 把对话历史里的 @图片1 / @视频1 渲染成与输入框一致的缩略图芯片。
 *
 * 纯文本仍用于复制与提交，这里只改变展示。
 *
 * @param props 消息文本与本次对话可用的素材引用
 * @return 文本与引用芯片组成的行内内容
 */
export function PromptMentionText({ text, references }: { text: string; references: PromptImageReference[] }) {
    const referencesByLabel = new Map(references.map((reference) => [reference.label, reference]));
    const pattern = imageMentionPattern([...referencesByLabel.keys()]);
    if (!pattern) return <>{text}</>;
    const nodes: Array<string | ReactElement> = [];
    let cursor = 0;
    for (const match of text.matchAll(pattern)) {
        const index = match.index ?? 0;
        if (index > cursor) nodes.push(text.slice(cursor, index));
        const reference = referencesByLabel.get(match[1]);
        nodes.push(reference ? <ReferenceMentionChip key={`${reference.id}-${index}`} reference={reference} /> : match[0]);
        cursor = index + match[0].length;
    }
    if (cursor < text.length) nodes.push(text.slice(cursor));
    return <>{nodes}</>;
}

/** 与输入框 @ 芯片保持一致：缩略图 + 编号，悬停显示素材名称。 */
function ReferenceMentionChip({ reference }: { reference: PromptImageReference }) {
    return (
        <span className="inline-flex items-center gap-1 rounded-sm bg-[var(--studio-surface-hover)] px-1 text-[var(--studio-action)] align-baseline whitespace-nowrap" title={reference.name}>
            {!reference.previewUrl ? (
                <span className="inline-block size-5 shrink-0 rounded-xs bg-[var(--studio-media)] align-middle" />
            ) : reference.kind === "video" ? (
                <span className="relative inline-block size-5 shrink-0 overflow-hidden rounded-xs bg-black/70 align-middle">
                    <video src={reference.previewUrl} muted playsInline preload="metadata" className="block size-full object-cover" />
                    <span className="pointer-events-none absolute inset-0 grid place-items-center text-[8px] leading-none text-white">▶</span>
                </span>
            ) : (
                <img src={reference.previewUrl} alt="" draggable={false} className="inline-block size-5 shrink-0 rounded-xs object-cover align-middle" />
            )}
            {`@${reference.label}`}
        </span>
    );
}

/**
 * 从聊天消息附件还原引用编号：图片在前、视频在后，与发送时的附件顺序一致。
 *
 * @param attachments 聊天消息携带的素材附件
 * @param labelFor 按类型和序号生成编号（图片页与视频页编号规则不同）
 * @return 可用于渲染引用的 PromptImageReference 列表
 */
export function chatAttachmentsToMentionReferences(attachments: ChatAttachment[] | undefined, labelFor: (kind: "image" | "video", index: number) => string): PromptImageReference[] {
    const list = attachments || [];
    const images = list.filter((attachment) => !attachment.type || attachment.type.startsWith("image/"));
    const videos = list.filter((attachment) => attachment.type?.startsWith("video/"));
    return [
        ...images.map((attachment, index) => ({ id: attachment.id, name: attachment.name, label: labelFor("image", index), previewUrl: attachment.url, kind: "image" as const })),
        ...videos.map((attachment, index) => ({ id: attachment.id, name: attachment.name, label: labelFor("video", index), previewUrl: attachment.url, kind: "video" as const })),
    ];
}
