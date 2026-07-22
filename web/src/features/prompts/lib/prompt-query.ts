const ALL_PROMPTS_OPTION = "全部";

export function normalizePromptTags(tags: readonly string[]): string[] {
    const normalizedTags: string[] = [];
    tags.forEach((tag) => {
        const normalizedTag = tag.trim();
        if (!normalizedTag || normalizedTag === ALL_PROMPTS_OPTION || normalizedTags.includes(normalizedTag)) return;
        normalizedTags.push(normalizedTag);
    });
    return normalizedTags;
}

export function togglePromptTag(tags: readonly string[], tag: string): string[] {
    if (tag === ALL_PROMPTS_OPTION) return [];
    const normalizedTags = normalizePromptTags(tags);
    return normalizedTags.includes(tag) ? normalizedTags.filter((item) => item !== tag) : [...normalizedTags, tag];
}

export function createPromptExcerpt(content: string, maximumLength: number): string {
    const normalizedContent = content.trim().replace(/\s+/g, " ");
    const length = Math.max(1, Math.floor(maximumLength) || 1);
    if (normalizedContent.length <= length) return normalizedContent;
    return `${normalizedContent.slice(0, Math.max(0, length - 1))}…`;
}
