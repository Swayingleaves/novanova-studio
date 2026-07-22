"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Modal } from "antd";
import { Check, Lock, LockOpen, X } from "lucide-react";

import { readImageMeta } from "@/features/generation/lib/image-utils";

/** 裁剪区域（归一化坐标，对外契约保持稳定） */
export type CanvasImageCropRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

type DragIntent = "translate" | "scale";
type EdgeAnchor = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";

interface CropDialogProps {
    dataUrl: string;
    open: boolean;
    loading: boolean;
    onClose: () => void;
    onConfirm: (crop: CanvasImageCropRect) => void;
}

interface SourceShape {
    width: number;
    height: number;
}

interface DragBaseline {
    pointerX: number;
    pointerY: number;
    origin: CanvasImageCropRect;
}

const EDGE_ANCHORS: EdgeAnchor[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const MIN_EDGE = 0.06;
const INITIAL_RECT: CanvasImageCropRect = { x: 0.12, y: 0.12, width: 0.76, height: 0.76 };

export function CanvasNodeCropDialog({ dataUrl, open, loading, onClose, onConfirm }: CropDialogProps) {
    const stageRef = useRef<HTMLDivElement>(null);
    const [rect, setRect] = useState<CanvasImageCropRect>(INITIAL_RECT);
    const [aspectLocked, setAspectLocked] = useState(false);
    const [shape, setShape] = useState<SourceShape | null>(null);
    const measuredPixels = shape ? rectToPixels(rect, shape) : null;

    useEffect(() => {
        if (open) {
            setRect(INITIAL_RECT);
            setShape(null);
        }
    }, [dataUrl, open]);

    useEffect(() => {
        if (!open) return;
        void readImageMeta(dataUrl).then(setShape);
    }, [dataUrl, open]);

    // 开始拖拽：记录起点坐标与初始裁剪框，监听全局 pointer 事件到松手
    const beginDrag = (intent: DragIntent, event: ReactPointerEvent, anchor?: EdgeAnchor) => {
        if (loading) return;
        const stage = stageRef.current?.getBoundingClientRect();
        if (!stage) return;
        event.preventDefault();
        event.stopPropagation();
        const baseline: DragBaseline = { pointerX: event.clientX, pointerY: event.clientY, origin: rect };
        const onMove = (event: PointerEvent) => {
            const deltaX = (event.clientX - baseline.pointerX) / stage.width;
            const deltaY = (event.clientY - baseline.pointerY) / stage.height;
            const updated = intent === "translate" ? translateRect(baseline.origin, deltaX, deltaY) : scaleRect(baseline.origin, deltaX, deltaY, anchor ?? "se", aspectLocked, stage);
            setRect(updated);
        };
        const onRelease = () => {
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onRelease);
        };
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onRelease);
    };

    return (
        <Modal title="裁剪图片" open={open && Boolean(dataUrl)} onCancel={loading ? undefined : onClose} footer={null} width={780} centered destroyOnHidden mask={{ closable: !loading }} keyboard={!loading} closable={!loading}>
            <div className="space-y-4">
                <div className={`flex justify-center ${loading ? "pointer-events-none opacity-70" : ""}`}>
                    <div ref={stageRef} className="relative inline-block max-w-full overflow-hidden rounded-lg bg-black select-none">
                        <img src={dataUrl} alt="" className="block max-h-[62vh] max-w-full opacity-90" draggable={false} />
                        <DimOverlay rect={rect} />
                        <div className="absolute cursor-move border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.3),0_0_28px_rgba(0,0,0,.28)]" style={rectToCss(rect)} onPointerDown={(event) => beginDrag("translate", event)}>
                            <div className="pointer-events-none absolute inset-x-0 top-1/3 border-t border-white/50" />
                            <div className="pointer-events-none absolute inset-x-0 top-2/3 border-t border-white/50" />
                            <div className="pointer-events-none absolute inset-y-0 left-1/3 border-l border-white/50" />
                            <div className="pointer-events-none absolute inset-y-0 left-2/3 border-l border-white/50" />
                            {EDGE_ANCHORS.map((anchor) => (
                                <button
                                    key={anchor}
                                    type="button"
                                    className="absolute size-3 rounded-full border border-[var(--studio-ink)] bg-[var(--studio-primary)] shadow-[0_0_0_1px_rgba(15,23,42,0.18)]"
                                    style={anchorOffset(anchor)}
                                    onPointerDown={(event) => beginDrag("scale", event, anchor)}
                                    aria-label="调整裁剪框"
                                />
                            ))}
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2">
                    <div className="flex flex-wrap items-center gap-3 text-sm opacity-80">
                        <span>裁剪尺寸 {measuredPixels ? `${measuredPixels.width} x ${measuredPixels.height}` : "未知"}</span>
                        <span>比例 {measuredPixels ? reduceRatio(measuredPixels.width, measuredPixels.height) : "未知"}</span>
                        {shape ? (
                            <span>
                                原图 {shape.width} x {shape.height}
                            </span>
                        ) : null}
                    </div>
                    <Button icon={aspectLocked ? <Lock className="size-4" /> : <LockOpen className="size-4" />} disabled={loading} onClick={() => setAspectLocked((value) => !value)}>
                        {aspectLocked ? "锁定比例" : "自由比例"}
                    </Button>
                </div>

                <div className="flex items-center justify-end gap-2">
                    <Button disabled={loading} onClick={() => setRect(INITIAL_RECT)}>重置</Button>
                    <Button icon={<X className="size-4" />} disabled={loading} onClick={onClose}>
                        取消
                    </Button>
                    <Button type="primary" icon={<Check className="size-4" />} loading={loading} onClick={() => onConfirm(rect)}>
                        {loading ? "正在处理" : "确认裁剪"}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

/** 裁剪框外侧的半透明遮罩，遮住非选中区域 */
function DimOverlay({ rect }: { rect: CanvasImageCropRect }) {
    return (
        <>
            <div className="absolute inset-x-0 top-0 bg-black/55" style={{ height: `${rect.y * 100}%` }} />
            <div className="absolute inset-x-0 bottom-0 bg-black/55" style={{ height: `${(1 - rect.y - rect.height) * 100}%` }} />
            <div className="absolute bg-black/55" style={{ left: 0, top: `${rect.y * 100}%`, width: `${rect.x * 100}%`, height: `${rect.height * 100}%` }} />
            <div className="absolute bg-black/55" style={{ right: 0, top: `${rect.y * 100}%`, width: `${(1 - rect.x - rect.width) * 100}%`, height: `${rect.height * 100}%` }} />
        </>
    );
}

/** 归一化裁剪框转像素尺寸，最少 1 像素 */
function rectToPixels(rect: CanvasImageCropRect, shape: SourceShape) {
    return {
        width: Math.max(1, Math.round(rect.width * shape.width)),
        height: Math.max(1, Math.round(rect.height * shape.height)),
    };
}

/** 平移裁剪框，限制在图像范围内 */
function translateRect(origin: CanvasImageCropRect, deltaX: number, deltaY: number): CanvasImageCropRect {
    return { ...origin, x: clamp01(origin.x + deltaX, 0, 1 - origin.width), y: clamp01(origin.y + deltaY, 0, 1 - origin.height) };
}

/** 按拖拽手柄缩放裁剪框，可锁定宽高比 */
function scaleRect(origin: CanvasImageCropRect, deltaX: number, deltaY: number, anchor: EdgeAnchor, locked: boolean, stage: DOMRect): CanvasImageCropRect {
    const draft = { ...origin };
    if (anchor.includes("e")) draft.width = origin.width + deltaX;
    if (anchor.includes("s")) draft.height = origin.height + deltaY;
    if (anchor.includes("w")) {
        draft.x = origin.x + deltaX;
        draft.width = origin.width - deltaX;
    }
    if (anchor.includes("n")) {
        draft.y = origin.y + deltaY;
        draft.height = origin.height - deltaY;
    }
    // 锁定比例时按较长边等比缩放，并回拉起点保持对侧不动
    if (locked) {
        const longest = Math.max(draft.width * stage.width, draft.height * stage.height);
        draft.width = longest / stage.width;
        draft.height = longest / stage.height;
        if (anchor.includes("w")) draft.x = origin.x + origin.width - draft.width;
        if (anchor.includes("n")) draft.y = origin.y + origin.height - draft.height;
    }
    draft.width = clamp01(draft.width, MIN_EDGE, 1);
    draft.height = clamp01(draft.height, MIN_EDGE, 1);
    draft.x = clamp01(draft.x, 0, 1 - draft.width);
    draft.y = clamp01(draft.y, 0, 1 - draft.height);
    return draft;
}

function rectToCss(rect: CanvasImageCropRect) {
    return { left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` };
}

/** 八向手柄在裁剪框上的定位与对应 resize 光标 */
function anchorOffset(anchor: EdgeAnchor) {
    const top = anchor.includes("n") ? "-6px" : anchor.includes("s") ? "calc(100% - 6px)" : "calc(50% - 6px)";
    const left = anchor.includes("w") ? "-6px" : anchor.includes("e") ? "calc(100% - 6px)" : "calc(50% - 6px)";
    return { top, left, cursor: `${anchor}-resize` };
}

function clamp01(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

/** 用最大公约数把像素尺寸化简为可读比例，如 1280x720 → 16:9 */
function reduceRatio(width: number, height: number) {
    const factor = greatestCommonDivisor(width, height);
    const w = Math.round(width / factor);
    const h = Math.round(height / factor);
    return `${w}:${h}`;
}

function greatestCommonDivisor(a: number, b: number): number {
    return b ? greatestCommonDivisor(b, a % b) : Math.max(1, a);
}
