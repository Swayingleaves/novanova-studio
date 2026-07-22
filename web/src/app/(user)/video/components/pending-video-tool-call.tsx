import type { ReactNode } from "react";

import type { ToolCallState } from "@/features/chat/types";
import { PendingGenerationField } from "@/features/generation/components/pending-generation-field";

const PENDING_VIDEO_BASE_HEIGHT = 220;
const PENDING_VIDEO_MIN_WIDTH = 180;
const PENDING_VIDEO_MAX_WIDTH = 460;

/**
 * 判断当前工具调用是否应展示视频生成中的占位卡片。
 *
 * @param call ToolCallState 工具调用状态
 * @return boolean 是否展示视频生成占位卡片
 */
export function isPendingVideoToolCall(call: ToolCallState): boolean {
    return call.name === "generate_video" || call.name === "edit_video";
}

/**
 * 绑定本次视频生成时前端已选择的尺寸。
 *
 * @param call ToolCallState 视频工具调用状态
 * @param size string 用户在视频设置中选择的尺寸
 * @return ToolCallState 使用前端选择尺寸后的工具调用状态
 */
export function bindPendingVideoSize(call: ToolCallState, size: string): ToolCallState {
    return { ...call, arguments: { ...call.arguments, size } };
}

/**
 * 为视频工具调用生成执行中的占位卡片。
 *
 * @param call ToolCallState 工具调用状态
 * @return ReactNode 视频工具返回动画卡片，其余工具返回 null
 */
export function renderPendingVideoToolCall(call: ToolCallState): ReactNode {
    if (!isPendingVideoToolCall(call)) {
        return null;
    }
    return <VideoGeneratingCard size={readStringArgument(call, "size")} resolution={readStringArgument(call, "resolution")} seconds={readStringArgument(call, "seconds")} progress={call.progress} />;
}

/**
 * 视频生成中的本地动画卡片。
 *
 * @param size string | undefined 视频尺寸配置
 * @param resolution string | undefined 视频分辨率配置
 * @param seconds string | undefined 视频时长配置
 * @param progress number | undefined 当前进度
 * @return ReactNode 执行中占位卡片
 */
export function VideoGeneratingCard({ size }: { size?: string; resolution?: string; seconds?: string; progress?: number }) {
    const previewAspectRatio = parseVideoAspectRatio(size);
    const previewWidth = buildPendingPreviewWidth(previewAspectRatio);

    return (
        <div
            data-pending-video-card="true"
            className="w-full sm:w-auto"
            style={{
                width: `min(100%, ${previewWidth}px)`,
                aspectRatio: `${previewAspectRatio}`,
            }}
        >
            <PendingGenerationField variant="video" />
        </div>
    );
}

/**
 * 读取工具调用中的字符串参数。
 *
 * @param call ToolCallState 工具调用状态
 * @param key string 参数名称
 * @return string | undefined 参数值
 */
function readStringArgument(call: ToolCallState, key: string): string | undefined {
    const value = call.arguments[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * 解析视频尺寸字符串为宽高比。
 *
 * @param size string | undefined 尺寸配置
 * @return number 宽高比
 */
function parseVideoAspectRatio(size?: string): number {
    if (!size) {
        return 16 / 9;
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
    return 16 / 9;
}

/**
 * 根据视频宽高比计算生成中卡片的预览宽度。
 *
 * @param aspectRatio number 宽高比
 * @return number 预览宽度
 */
function buildPendingPreviewWidth(aspectRatio: number): number {
    const safeAspectRatio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 16 / 9;
    return Math.round(Math.min(PENDING_VIDEO_MAX_WIDTH, Math.max(PENDING_VIDEO_MIN_WIDTH, PENDING_VIDEO_BASE_HEIGHT * safeAspectRatio)));
}
