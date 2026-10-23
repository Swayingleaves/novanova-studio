/** 提示词中可用 @ 引用的参考素材；图片与视频共用编号、装饰和落库为纯文本的引用写法。 */
export type PromptImageReference = {
    id: string;
    name: string;
    label: string;
    previewUrl: string;
    kind: "image" | "video";
    disabled?: boolean;
};

/** 读取光标前的图片引用命令，允许紧接中文输入 @。 */
export function readImageMentionCommand(value: string, cursor: number, imageLabels: string[] = []) {
    const match = value.slice(0, cursor).match(/@([^@\s]*)$/);
    if (!match || imageLabels.some((label) => match[1].startsWith(label) && !/^\d/.test(match[1].slice(label.length)))) return null;
    return { start: cursor - match[0].length, end: cursor, query: match[1] };
}

/** 按完整编号匹配引用；优化回填时可同时识别省略 @ 的图片标签。 */
export function imageMentionPattern(labels: string[], optionalAtSign = false) {
    const alternatives = [...new Set(labels)].sort((first, second) => second.length - first.length).map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return alternatives.length ? new RegExp(`@${optionalAtSign ? "?" : ""}(${alternatives.join("|")})(?![0-9])`, "g") : null;
}

/** 将优化结果中的已知素材编号统一为引用标记；遗漏原有引用时返回 null，阻止覆盖原文。 */
export function normalizeOptimizedImageMentions(value: string, original: string, images: Pick<PromptImageReference, "label">[]) {
    const pattern = imageMentionPattern(images.map((image) => image.label), true);
    if (!pattern) return value;
    const normalized = value.replace(pattern, (_mention, label: string) => `@${label}`);
    const returnedLabels = new Set(Array.from(normalized.matchAll(pattern), (match) => match[1]));
    return Array.from(original.matchAll(pattern)).every((match) => returnedLabels.has(match[1])) ? normalized : null;
}

/** 删除素材后按稳定标识更新引用编号，同时移除被删除素材的引用。 */
export function reconcileImageMentions(value: string, previous: Pick<PromptImageReference, "id" | "label">[], current: Pick<PromptImageReference, "id" | "label">[]) {
    const pattern = imageMentionPattern(previous.map((image) => image.label));
    if (!pattern) return value;
    const currentLabels = new Map(current.map((image) => [image.id, image.label]));
    const replacements = new Map(previous.map((image) => [image.label, currentLabels.get(image.id)]));
    return value.replace(pattern, (_mention, label: string) => {
        const nextLabel = replacements.get(label);
        return nextLabel ? `@${nextLabel}` : "";
    });
}
