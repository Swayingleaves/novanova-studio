import type { ReferenceImage } from "@/features/generation/types/image";

/**
 * 生成参考图编号标签（从 1 开始计数）。
 *
 * @param index 从 0 起的索引
 * @return 如 "图片1"、"图片2"
 */
export function imageReferenceLabel(index: number): string {
    return `图片${index + 1}`;
}

/**
 * 在提示词前追加参考图编号说明，使模型能理解提示词中的图片引用编号。
 * <p>
 * 无参考图时原样返回（仅 trim）；有参考图时在开头插入编号清单与说明，再拼接原提示词。
 *
 * @param prompt 用户提示词
 * @param references 参考图数组
 * @return 拼接后的提示词
 */
export function buildImageReferencePromptText(prompt: string, references: ReferenceImage[]): string {
    const text = prompt.trim();
    if (references.length === 0) {
        return text;
    }
    const labels = references.map((_, index) => imageReferenceLabel(index));
    return `参考图片编号：${labels.join("、")}。请按这些编号理解提示词中的图片引用。\n\n${text}`;
}
