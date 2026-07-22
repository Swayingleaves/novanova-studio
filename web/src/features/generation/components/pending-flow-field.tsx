import { PendingGenerationField, type PendingGenerationVariant } from "./pending-generation-field";

type PendingFlowVariant = PendingGenerationVariant;

/**
 * 生成执行中卡片的共享占位层。
 *
 * @param aspectRatio number 当前预览区域宽高比
 * @param variant PendingFlowVariant 动画用于图片还是视频
 * @return JSX.Element 共享占位内容
 */
export function PendingFlowField({ variant }: { aspectRatio: number; variant: PendingFlowVariant }) {
    return (
        <div className="pointer-events-none h-full w-full" aria-hidden="true">
            <PendingGenerationField variant={variant} />
        </div>
    );
}
