import type { ScriptAiDraft, ScriptBlock } from "../types";

/** 替换指定正文块并保持其他正文块引用不变。 */
export function replaceScriptBlock(blocks: ScriptBlock[], replacement: ScriptBlock) {
    return blocks.map((block) => block.id === replacement.id ? replacement : block);
}

/** 删除指定正文块并重新生成从零开始的连续排序。 */
export function removeScriptBlock(blocks: ScriptBlock[], blockId: string) {
    return blocks.filter((block) => block.id !== blockId)
        .map((block, sortOrder) => ({ ...block, sortOrder }));
}

/** 使用键盘按钮语义移动正文块并重新生成连续排序。 */
export function moveScriptBlock(blocks: ScriptBlock[], index: number, direction: -1 | 1) {
    const target = index + direction;
    if (index < 0 || index >= blocks.length || target < 0 || target >= blocks.length) return blocks;
    const next = [...blocks];
    [next[index], next[target]] = [next[target], next[index]];
    return next.map((block, sortOrder) => ({ ...block, sortOrder }));
}

/** 移除出场人物后，把失效对白改绑到当前首位人物；无人出场时清空引用。 */
export function synchronizeDialogueCharacters(blocks: ScriptBlock[], characterIds: string[]) {
    return blocks.map((block) => block.blockType === "dialogue" && !characterIds.includes(block.characterId || "")
        ? { ...block, characterId: characterIds[0] || null }
        : block);
}

/** 判断AI草稿是否基于当前项目修订号生成。 */
export function isScriptAiDraftStale(draft: Pick<ScriptAiDraft, "baseRevision">, currentRevision: number) {
    return draft.baseRevision !== currentRevision;
}
