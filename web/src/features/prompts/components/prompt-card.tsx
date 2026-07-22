"use client";

import type { ReactNode } from "react";
import { Button, Tag } from "antd";
import { Copy } from "lucide-react";

import { formatPromptDate, type Prompt } from "../api/prompts";
import { createPromptExcerpt } from "../lib/prompt-query";

type PromptCardProps = {
    item: Prompt;
    onOpen: () => void;
    onCopy: () => void;
    actionLabel?: string;
    actionIcon?: ReactNode;
    actionType?: "text" | "primary";
    extraAction?: ReactNode;
};

export function PromptCard({ item, onOpen, onCopy, actionLabel = "复制", actionIcon = <Copy className="size-3.5" />, actionType = "text", extraAction }: PromptCardProps) {
    return (
        <article className="studio-panel-solid flex flex-col overflow-hidden">
            <button type="button" className="block text-left" onClick={onOpen}>
                {item.coverUrl ? <img src={item.coverUrl} alt={item.title} className="aspect-[4/3] w-full object-cover" /> : <div className="studio-empty flex aspect-[4/3] items-center justify-center p-4 text-center text-sm">{createPromptExcerpt(item.prompt, 80)}</div>}
                <div className="p-4"><div className="flex items-start justify-between gap-3"><h2 className="studio-title truncate text-sm font-semibold">{item.title}</h2><time className="studio-caption shrink-0 text-xs" dateTime={item.updatedAt}>{formatPromptDate(item.updatedAt)}</time></div><p className="studio-subtitle mt-2 line-clamp-3 text-xs leading-5">{createPromptExcerpt(item.prompt, 120)}</p><div className="mt-3 flex flex-wrap gap-1">{item.tags.slice(0, 4).map((tag) => <Tag key={tag} className="m-0 text-[11px]">{tag}</Tag>)}</div></div>
            </button>
            <footer className="mt-auto flex items-center gap-2 px-4 pb-4"><Button block={actionType === "primary"} type={actionType} size="small" icon={actionIcon} onClick={onCopy}>{actionLabel}</Button>{extraAction}</footer>
        </article>
    );
}
