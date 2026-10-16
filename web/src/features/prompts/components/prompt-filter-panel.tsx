"use client";
import { useTranslation } from "@/features/locale/use-translation";


import { Input, Select } from "antd";
import { Search } from "lucide-react";

import { ALL_PROMPTS_OPTION } from "../api/prompts";
import { normalizePromptTags } from "../lib/prompt-query";

type PromptFilterPanelProps = {
    keyword: string;
    selectedTags: string[];
    selectedCategory: string;
    tags: string[];
    categories: string[];
    onKeywordChange: (value: string) => void;
    onTagsChange: (value: string[]) => void;
    onCategoryChange: (value: string) => void;
};

export function PromptFilterPanel(props: PromptFilterPanelProps) {
    const translate = useTranslation();
    return (
        <section className="studio-glass grid gap-3 rounded-lg p-3 md:grid-cols-[minmax(240px,1fr)_220px_minmax(260px,1fr)]" aria-label={translate("prompts.filterPrompts")}>
            <Input allowClear prefix={<Search className="size-4 text-[var(--studio-faint)]" />} value={props.keyword} placeholder={translate("prompts.searchPromptTitles")} onChange={(event) => props.onKeywordChange(event.target.value)} />
            <Select value={props.selectedCategory} options={props.categories.map((category) => ({ label: category === ALL_PROMPTS_OPTION ? translate("prompts.all") : category, value: category }))} onChange={props.onCategoryChange} aria-label={translate("prompts.promptCategory")} />
            <Select
                mode="multiple"
                allowClear
                maxTagCount="responsive"
                value={props.selectedTags}
                options={props.tags.filter((tag) => tag !== ALL_PROMPTS_OPTION).map((tag) => ({ label: tag, value: tag }))}
                placeholder={translate("prompts.filterTags")}
                getPopupContainer={(trigger) => trigger.parentElement as HTMLElement}
                popupRender={(menu) => <div onWheelCapture={(event) => event.stopPropagation()}>{menu}</div>}
                onChange={(values) => props.onTagsChange(normalizePromptTags(values))}
            />
        </section>
    );
}
