import { LoaderCircle } from "lucide-react";

export type PendingGenerationVariant = "image" | "video";

type PendingGenerationFieldProps = {
    variant: PendingGenerationVariant;
    className?: string;
};

/**
 * 展示图片或视频任务执行中的统一进度状态。
 *
 * @param props PendingGenerationFieldProps 媒体类型与外层布局样式
 * @return JSX.Element 生成中的媒体状态界面
 */
export function PendingGenerationField({ variant, className = "" }: PendingGenerationFieldProps) {
    const isVideo = variant === "video";
    const statusLabel = isVideo ? "正在生成视频" : "正在生成图片";

    return (
        <div data-pending-generation-field="true" data-pending-generation-variant={variant} className={`pending-generation-field relative h-full w-full overflow-hidden rounded-lg ${className}`} role="status" aria-live="polite" aria-label={statusLabel}>
            <div className="flex h-full items-center justify-center">
                <LoaderCircle className="size-7 animate-spin text-[var(--studio-action)] motion-reduce:animate-none" strokeWidth={2} aria-hidden="true" />
            </div>
        </div>
    );
}
