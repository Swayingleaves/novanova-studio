"use client";

import { useEffect, useState, type UIEvent } from "react";
import { App, Empty, Modal, Spin } from "antd";
import { Check } from "lucide-react";

import { ALL_PROMPTS_OPTION } from "../api/prompts";
import { usePromptList } from "../hooks/use-prompt-list";
import { PromptCard } from "./prompt-card";
import { PromptFilterPanel } from "./prompt-filter-panel";

type PromptSelectDialogProps = { open: boolean; onOpenChange: (open: boolean) => void; onSelect: (prompt: string) => void };

export function PromptSelectDialog({ open, onOpenChange, onSelect }: PromptSelectDialogProps) {
    const { message } = App.useApp();
    const [keyword, setKeyword] = useState("");
    const [tags, setTags] = useState<string[]>([]);
    const [category, setCategory] = useState(ALL_PROMPTS_OPTION);
    const promptList = usePromptList({ keyword, tags, category, enabled: open });
    useEffect(() => {
        if (promptList.query.isError) message.error(promptList.query.error instanceof Error ? promptList.query.error.message : "获取提示词失败");
    }, [message, promptList.query.error, promptList.query.isError]);
    const loadNextPage = (event: UIEvent<HTMLDivElement>) => {
        const element = event.currentTarget;
        if (promptList.query.hasNextPage && !promptList.query.isFetchingNextPage && element.scrollHeight - element.scrollTop - element.clientHeight < 120) void promptList.query.fetchNextPage();
    };
    const choose = (prompt: string) => {
        onSelect(prompt);
        onOpenChange(false);
    };

    return (
        <Modal title="选择提示词" open={open} centered footer={null} width={1040} onCancel={() => onOpenChange(false)}>
            <div className="grid gap-5" data-canvas-no-zoom onWheelCapture={(event) => event.stopPropagation()}>
                <PromptFilterPanel keyword={keyword} selectedTags={tags} selectedCategory={category} tags={promptList.tags} categories={promptList.categories} onKeywordChange={setKeyword} onTagsChange={setTags} onCategoryChange={setCategory} />
                <div className="thin-scrollbar max-h-[520px] overflow-y-auto pr-2" onScroll={loadNextPage}>
                    {promptList.query.isPending ? <div className="flex h-40 items-center justify-center"><Spin /></div> : null}
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{promptList.items.map((prompt) => <PromptCard key={prompt.id} item={prompt} onOpen={() => choose(prompt.prompt)} onCopy={() => choose(prompt.prompt)} actionLabel="使用" actionIcon={<Check className="size-4" />} actionType="primary" />)}</div>
                    {!promptList.query.isPending && !promptList.items.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的提示词" className="py-12" /> : null}
                    {promptList.query.isFetchingNextPage ? <div className="py-4 text-center"><Spin size="small" /></div> : null}
                </div>
            </div>
        </Modal>
    );
}
