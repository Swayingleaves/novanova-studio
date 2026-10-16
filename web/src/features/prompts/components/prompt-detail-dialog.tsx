"use client";
import { useTranslation } from "@/features/locale/use-translation";


import { Button, Modal, Tag } from "antd";
import { Copy, FolderPlus } from "lucide-react";

import { formatPromptDate, type Prompt } from "../api/prompts";

export function PromptDetailDialog({ prompt, onClose, onCopy, onSaveAsset }: { prompt: Prompt | null; onClose: () => void; onCopy: (prompt: string) => void; onSaveAsset?: (prompt: Prompt) => void }) {
    const translate = useTranslation();
    if (!prompt) return null;
    return (
        <Modal title={prompt.title} open centered footer={null} width={900} onCancel={onClose}>
            <div className="grid gap-6 pt-2 md:grid-cols-[280px_minmax(0,1fr)]">
                <aside className="grid h-fit gap-3">{prompt.coverUrl ? <img src={prompt.coverUrl} alt={prompt.title} className="aspect-[4/3] w-full rounded-lg object-cover" /> : <div className="studio-empty aspect-[4/3]" />}{prompt.preview ? <pre className="studio-soft-surface max-h-56 overflow-auto whitespace-pre-wrap p-3 text-xs leading-5">{prompt.preview}</pre> : null}</aside>
                <article className="min-w-0"><div className="flex flex-wrap gap-1">{prompt.category ? <Tag color="blue">{prompt.category}</Tag> : null}{prompt.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</div><div className="studio-panel-solid mt-4 whitespace-pre-wrap p-4 text-sm leading-7">{prompt.prompt}</div><p className="studio-caption mt-3 text-xs">{translate("prompts.created")}{formatPromptDate(prompt.createdAt)}{translate("prompts.updated")}{formatPromptDate(prompt.updatedAt)}</p><div className="mt-5 flex flex-wrap gap-2"><Button type="primary" icon={<Copy className="size-4" />} onClick={() => onCopy(prompt.prompt)}>{translate("prompts.copyPrompt")}</Button>{onSaveAsset ? <Button icon={<FolderPlus className="size-4" />} onClick={() => onSaveAsset(prompt)}>{translate("prompts.addToMyAssets")}</Button> : null}</div></article>
            </div>
        </Modal>
    );
}
