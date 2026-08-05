/**
 * 读取输入框光标前正在编辑的风格命令。
 *
 * @param value 输入框文本
 * @param cursor 光标位置
 * @returns 命令起止位置和筛选词；不在命令上下文时返回null
 */
export function getStyleCommandRange(value: string, cursor: number) {
    const beforeCursor = value.slice(0, cursor);
    const match = beforeCursor.match(/(?:^|\s)\/([^\s/]*)$/);
    if (!match) return null;
    const start = cursor - match[0].length + (match[0].startsWith("/") ? 0 : 1);
    return { start, end: cursor, query: match[1] || "" };
}

/**
 * 从输入中移除已选择的风格命令。
 *
 * @param value 输入框文本
 * @param start 命令起点
 * @param end 命令终点
 * @returns 移除命令后的文本
 */
export function removeStyleCommand(value: string, start: number, end: number) {
    return `${value.slice(0, start)}${value.slice(end)}`;
}

/**
 * 格式化带风格的用户消息，供历史消息复制和再次粘贴使用。
 *
 * @param prompt 用户提示词
 * @param styles 已选择的风格
 * @returns 可复制的纯文本消息
 */
export function formatGenerationStyleMessage(prompt: string, styles?: Array<{ name: string }>) {
    const names = styles?.map((style) => style.name.trim()).filter(Boolean) || [];
    return names.length ? `风格：${names.join("、")}\n${prompt}` : prompt;
}

export type GenerationStyleMessageGroups<T> = {
    image: T[];
    video: T[];
};

/** 格式化画布 Agent 的分组风格消息。 */
export function formatGroupedGenerationStyleMessage<T extends { name: string; generationType: "image" | "video" }>(prompt: string, styles?: T[]) {
    const image = (styles || []).filter((style) => style.generationType === "image");
    const video = (styles || []).filter((style) => style.generationType === "video");
    if (image.length && !video.length) return formatGenerationStyleMessage(prompt, image);
    if (video.length && !image.length) return formatGenerationStyleMessage(prompt, video);
    const lines = [
        image.length ? `图片风格：${image.map((style) => style.name.trim()).filter(Boolean).join("、")}` : "",
        video.length ? `视频风格：${video.map((style) => style.name.trim()).filter(Boolean).join("、")}` : "",
    ].filter(Boolean);
    return lines.length ? `${lines.join("\n")}\n${prompt}` : prompt;
}

/**
 * 解析从历史消息粘贴回来的风格消息，并匹配当前可用风格。
 *
 * @param value 剪贴板文本
 * @param availableStyles 当前页面可选风格
 * @returns 清理后的提示词和匹配到的风格；无法完整匹配时返回null
 */
export function parseGenerationStyleMessage<T extends { name: string }>(value: string, availableStyles: T[]) {
    const match = value.match(/^\s*风格\s*[:：]\s*([^\r\n]+)(?:\r?\n|$)/);
    if (!match) return null;
    const names = match[1].split(/[、,，|]/).map((name) => name.trim()).filter(Boolean);
    if (!names.length) return null;
    const styles = names.map((name) => availableStyles.find((style) => style.name.trim() === name));
    if (styles.some((style) => !style)) return null;
    const matchedStyles = styles as T[];
    if (new Set(matchedStyles.map((style) => style.name.trim())).size !== matchedStyles.length) return null;
    return { prompt: value.slice(match[0].length), styles: matchedStyles };
}

/** 解析画布 Agent 的图片/视频分组风格消息。 */
export function parseGroupedGenerationStyleMessage<T extends { name: string; generationType: "image" | "video" }>(value: string, availableStyles: T[]) {
    const lines = value.replace(/^\s+/, "").split(/\r?\n/);
    const groups: GenerationStyleMessageGroups<T> = { image: [], video: [] };
    let consumed = 0;
    for (const line of lines) {
        const match = line.match(/^\s*(图片|视频)风格\s*[:：]\s*(.*?)\s*$/);
        if (!match) break;
        const generationType = match[1] === "图片" ? "image" : "video";
        const names = match[2].split(/[、,，|]/).map((name) => name.trim()).filter(Boolean);
        if (!names.length) return null;
        const styles = names.map((name) => availableStyles.find((style) => style.generationType === generationType && style.name.trim() === name));
        if (styles.some((style) => !style)) return null;
        groups[generationType].push(...(styles as T[]));
        consumed += 1;
    }
    if (!consumed || (!groups.image.length && !groups.video.length)) return null;
    const styleCount = groups.image.length + groups.video.length;
    const styles = [...groups.image, ...groups.video];
    const styleKeys = styles.map((style) => "id" in style ? String(style.id) : style.name.trim());
    if (styleCount > 3 || new Set(styleKeys).size !== styleCount) return null;
    return { prompt: lines.slice(consumed).join("\n"), groups, styles };
}
