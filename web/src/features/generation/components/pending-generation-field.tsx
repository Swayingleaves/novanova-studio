"use client";

import { useTranslation } from "@/features/locale/use-translation";

export type PendingGenerationVariant = "image" | "video";

type PendingGenerationFieldProps = {
    variant: PendingGenerationVariant;
    progress?: number;
    className?: string;
};

/**
 * 展示图片或视频任务执行中的统一骨架屏与进度角标。
 *
 * @param props PendingGenerationFieldProps 媒体类型、进度与外层布局样式
 * @return JSX.Element 生成中的媒体状态界面
 */
export function PendingGenerationField({ variant, progress, className = "" }: PendingGenerationFieldProps) {
    const translate = useTranslation();
    const isVideo = variant === "video";
    const statusLabel = isVideo ? translate("generation.generatingVideo") : translate("generation.generatingImage");
    const normalizedProgress = typeof progress === "number" && Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress))) : 0;
    const showProgress = normalizedProgress > 0;

    return (
        <div
            data-pending-generation-field="true"
            data-pending-generation-variant={variant}
            className={`pending-generation-field relative h-full w-full overflow-hidden rounded-lg ${className}`}
            role="status"
            aria-live="polite"
            aria-label={showProgress ? `${statusLabel} ${normalizedProgress}%` : statusLabel}
        >
            <div className="studio-skeleton studio-skeleton-media h-full w-full" aria-hidden="true" />
            {showProgress ? (
                <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white">
                    {normalizedProgress}%
                </span>
            ) : null}
        </div>
    );
}
