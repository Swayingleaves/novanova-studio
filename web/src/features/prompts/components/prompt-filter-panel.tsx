"use client";

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
    return (
        <section className="studio-glass grid gap-3 rounded-lg p-3 md:grid-cols-[minmax(240px,1fr)_220px_minmax(260px,1fr)]" aria-label="提示词筛选">
            <Input allowClear prefix={<Search className="size-4 text-[var(--studio-faint)]" />} value={props.keyword} placeholder="搜索提示词标题" onChange={(event) => props.onKeywordChange(event.target.value)} />
            <Select value={props.selectedCategory} options={props.categories.map((category) => ({ label: category, value: category }))} onChange={props.onCategoryChange} aria-label="提示词分类" />
            <Select
                mode="multiple"
                allowClear
                maxTagCount="responsive"
                value={props.selectedTags}
                options={props.tags.filter((tag) => tag !== ALL_PROMPTS_OPTION).map((tag) => ({ label: tag, value: tag }))}
                placeholder="筛选标签"
                getPopupContainer={(trigger) => trigger.parentElement as HTMLElement}
                popupRender={(menu) => <div onWheelCapture={(event) => event.stopPropagation()}>{menu}</div>}
                onChange={(values) => props.onTagsChange(normalizePromptTags(values))}
            />
        </section>
    );
}
