import type { ReactNode } from "react";

import type { ToolCallState } from "@/features/chat/types";
import { PendingGenerationField } from "@/features/generation/components/pending-generation-field";

const PENDING_PREVIEW_BASE_HEIGHT = 240;
const PENDING_PREVIEW_MIN_WIDTH = 180;
const PENDING_PREVIEW_MAX_WIDTH = 420;

/**
 * 判断当前工具调用是否应展示图片生成中的占位卡片。
 *
 * @param call ToolCallState 工具调用状态
 * @return boolean 是否展示图片生成占位卡片
 */
export function isPendingImageToolCall(call: ToolCallState): boolean {
    return call.name === "generate_image" || call.name === "edit_image";
}

/**
 * 为图片工具调用生成执行中的占位卡片。
 *
 * @param call ToolCallState 工具调用状态
 * @return ReactNode 图片工具返回动画卡片，其余工具返回 null
 */
export function renderPendingImageToolCall(call: ToolCallState): ReactNode {
    if (!isPendingImageToolCall(call)) {
        return null;
    }
    return <ImageGeneratingCard size={readToolCallSize(call)} />;
}

/**
 * 图片生成中的本地动画卡片。
 *
 * @param size string 当前生图尺寸配置
 * @return ReactNode 执行中占位卡片
 */
export function ImageGeneratingCard({ size }: { size?: string }) {
    const previewAspectRatio = parseImageAspectRatio(size);
    const previewWidth = buildPendingPreviewWidth(previewAspectRatio);
    return (
        <div
            data-pending-image-card="true"
            className="w-full sm:w-auto"
            style={{
                width: `min(100%, ${previewWidth}px)`,
                aspectRatio: `${previewAspectRatio}`,
            }}
        >
            <PendingGenerationField variant="image" />
        </div>
    );
}

/**
 * 读取图片工具调用中的尺寸配置。
 *
 * @param call ToolCallState 工具调用状态
 * @return string | undefined 尺寸配置
 */
function readToolCallSize(call: ToolCallState): string | undefined {
    const size = call.arguments.size;
    return typeof size === "string" && size.trim() ? size.trim() : undefined;
}

/**
 * 解析尺寸字符串为图片宽高比。
 *
 * @param size string | undefined 尺寸配置
 * @return number 宽高比
 */
function parseImageAspectRatio(size?: string): number {
    if (!size) {
        return 1;
    }
    const ratioMatch = size.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
    if (ratioMatch) {
        const width = Number(ratioMatch[1]);
        const height = Number(ratioMatch[2]);
        if (width > 0 && height > 0) {
            return width / height;
        }
    }
    const pixelMatch = size.match(/^(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)$/);
    if (pixelMatch) {
        const width = Number(pixelMatch[1]);
        const height = Number(pixelMatch[2]);
        if (width > 0 && height > 0) {
            return width / height;
        }
    }
    return 1;
}

/**
 * 根据图片宽高比计算生成中卡片的预览宽度。
 *
 * @param aspectRatio number 宽高比
 * @return number 预览宽度
 */
function buildPendingPreviewWidth(aspectRatio: number): number {
    const safeAspectRatio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
    return Math.round(Math.min(PENDING_PREVIEW_MAX_WIDTH, Math.max(PENDING_PREVIEW_MIN_WIDTH, PENDING_PREVIEW_BASE_HEIGHT * safeAspectRatio)));
}
