
import { translateMessage as translate } from "@/features/locale/translate";
import type { ReferenceImage } from "@/features/generation/types/image";

/**
 * 生成参考图编号标签（从 1 开始计数）。
 *
 * @param index 从 0 起的索引
 * @return 如 "图片1"、"图片2"
 */
export function imageReferenceLabel(index: number): string {
    return translate("generation.image_062894", { value0: index + 1 });
}

/**
 * 透传用户原始提示词，不再自动拼接参考图编号前缀。
 *
 * @param prompt 用户提示词
 * @param _references 参考图数组
 * @return 去除首尾空白后的原始提示词
 */
export function buildImageReferencePromptText(prompt: string, _references: ReferenceImage[]): string {
    return prompt.trim();
}
