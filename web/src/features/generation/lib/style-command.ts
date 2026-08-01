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
