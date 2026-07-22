import { listServerPrompts, type ServerPrompt } from "@/services/api/server";

export type Prompt = {
    id: string;
    title: string;
    coverUrl: string;
    prompt: string;
    tags: string[];
    category: string;
    githubUrl: string;
    preview: string;
    createdAt: string;
    updatedAt: string;
};

export const ALL_PROMPTS_OPTION = "全部";

export type PromptListResponse = {
    items: Prompt[];
    tags: string[];
    categories: string[];
    total: number;
};

export type FetchPromptsParams = {
    keyword?: string;
    tag?: string[];
    category?: string;
    page?: number;
    pageSize?: number;
};

export async function fetchPrompts({ keyword = "", tag = [], category = ALL_PROMPTS_OPTION, page, pageSize }: FetchPromptsParams = {}): Promise<PromptListResponse> {
    const selectedTags = tag.filter((item) => item && item !== ALL_PROMPTS_OPTION);
    const data = await listServerPrompts({
        keyword: keyword.trim(),
        tag: selectedTags,
        category: category !== ALL_PROMPTS_OPTION ? category : undefined,
        page,
        pageSize,
    });

    return {
        items: data.items.map(toPrompt),
        tags: data.tags,
        categories: data.categories,
        total: data.total,
    };
}

function toPrompt(item: ServerPrompt): Prompt {
    return { ...item, id: String(item.id) };
}

export function formatPromptDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
