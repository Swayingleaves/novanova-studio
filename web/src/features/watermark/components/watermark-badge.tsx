"use client";
import { useTranslation } from "@/features/locale/use-translation";

/**
 * 图片左上角的 “AI生成” 视觉标识（即梦风格磨砂玻璃）。
 * <p>
 * 只是展示层覆盖，不参与下载；下载时由 canvas 把同样的标识画进文件像素。
 */
export function WatermarkBadge({ className = "" }: { className?: string }) {
    const translate = useTranslation();
    return (
        <span aria-hidden="true" className={`pointer-events-none absolute left-2 top-2 z-10 inline-flex select-none items-center gap-1 rounded-lg border border-white/55 bg-white/15 px-2 py-1 text-[11px] font-medium leading-none text-white/95 shadow-sm backdrop-blur-sm ${className}`}>
            <span className="size-2 rounded-full border border-white/90" />
            {translate("common.aiWatermarkBadge")}
        </span>
    );
}
