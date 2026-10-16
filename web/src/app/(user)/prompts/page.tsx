"use client";
import { useTranslation } from "@/features/locale/use-translation";


import { useEffect, useState, type UIEvent } from "react";
import { App, Button, Empty, Spin } from "antd";
import { FolderPlus } from "lucide-react";

import { useAssetStore } from "@/features/assets/stores/use-asset-store";
import { ALL_PROMPTS_OPTION, type Prompt } from "@/features/prompts/api/prompts";
import { PromptCard } from "@/features/prompts/components/prompt-card";
import { PromptDetailDialog } from "@/features/prompts/components/prompt-detail-dialog";
import { PromptFilterPanel } from "@/features/prompts/components/prompt-filter-panel";
import { usePromptList } from "@/features/prompts/hooks/use-prompt-list";
import { useCopyText } from "@/shared/hooks/use-copy-text";

export default function PromptsPage() {
    const translate = useTranslation();
    const { message } = App.useApp();
    const copyText = useCopyText();
    const addAsset = useAssetStore((state) => state.addAsset);
    const [keyword, setKeyword] = useState("");
    const [tags, setTags] = useState<string[]>([]);
    const [category, setCategory] = useState(ALL_PROMPTS_OPTION);
    const [previewPrompt, setPreviewPrompt] = useState<Prompt | null>(null);
    const promptList = usePromptList({ keyword, tags, category });

    useEffect(() => {
        if (promptList.query.isError) message.error(promptList.query.error instanceof Error ? promptList.query.error.message : translate("prompts.failedToFetchPrompt"));
    }, [message, promptList.query.error, promptList.query.isError]);

    const saveAsAsset = (prompt: Prompt) => {
        addAsset({ kind: "text", title: prompt.title, coverUrl: prompt.coverUrl, tags: prompt.tags, source: prompt.category, data: { content: prompt.prompt }, metadata: { source: "prompt-library", promptId: prompt.id, githubUrl: prompt.githubUrl } });
        message.success(translate("prompts.addedToMyAssets"));
    };
    const loadNextPage = (event: UIEvent<HTMLElement>) => {
        const element = event.currentTarget;
        if (promptList.query.hasNextPage && !promptList.query.isFetchingNextPage && element.scrollHeight - element.scrollTop - element.clientHeight < 180) void promptList.query.fetchNextPage();
    };

    return (
        <main className="studio-page h-full overflow-y-auto px-4 py-6 sm:px-6" onScroll={loadNextPage}>
            <div className="mx-auto flex max-w-7xl flex-col gap-5">
                <header className="border-b border-[var(--studio-line)] pb-5"><p className="studio-caption text-xs">{translate("prompts.creativeReference")}</p><h1 className="studio-title mt-2 text-2xl font-semibold">{translate("prompts.promptCenter")}</h1><p className="studio-subtitle mt-2 text-sm">{translate("prompts.from")}{promptList.total} {translate("prompts.promptsToExploreCopyOrSaveToYourLibrary")}</p></header>
                <PromptFilterPanel keyword={keyword} selectedTags={tags} selectedCategory={category} tags={promptList.tags} categories={promptList.categories} onKeywordChange={setKeyword} onTagsChange={setTags} onCategoryChange={setCategory} />

                {promptList.query.isPending ? <div className="flex h-60 items-center justify-center"><Spin /></div> : null}
                {!promptList.query.isPending && promptList.items.length ? <section className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{promptList.items.map((prompt) => <PromptCard key={prompt.id} item={prompt} onOpen={() => setPreviewPrompt(prompt)} onCopy={() => copyText(prompt.prompt, translate("prompts.promptCopied"))} extraAction={<Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => saveAsAsset(prompt)}>{translate("prompts.saveAsAsset")}</Button>} />)}</section> : null}
                {!promptList.query.isPending && !promptList.items.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={translate("prompts.noMatchingPromptsFound")} className="py-20" /> : null}
                {promptList.items.length ? <p className="studio-caption text-center text-xs">{promptList.query.isFetchingNextPage ? translate("prompts.loadingMore") : promptList.query.hasNextPage ? translate("prompts.scrollDownToLoadMore") : translate("prompts.allResultsShown")}</p> : null}
            </div>

            <PromptDetailDialog prompt={previewPrompt} onClose={() => setPreviewPrompt(null)} onCopy={(value) => copyText(value, translate("prompts.promptCopied"))} onSaveAsset={saveAsAsset} />
        </main>
    );
}
