"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button, InputNumber, Modal } from "antd";
import { Grid2x2 } from "lucide-react";

import { readImageMeta } from "@/features/generation/lib/image-utils";
import type { ImageSplitParams } from "../utils/canvas-image-data";

export type CanvasImageSplitParams = ImageSplitParams;

/** 切分对话框外部契约：源图、显隐、回写结果 */
interface SplitDialogProps {
    dataUrl: string;
    open: boolean;
    loading: boolean;
    onClose: () => void;
    onConfirm: (params: CanvasImageSplitParams) => void;
}

interface SourceImageShape {
    width: number;
    height: number;
}

/** 单个行列输入区所需的字段 */
interface GridDimensionInputProps {
    caption: string;
    value: number;
    onValueChange: (next: string | number | null) => void;
}

interface SplitMetrics {
    sliceCount: number;
    sourceLabel: string;
    tileLabel: string;
}

const GRID_LOWER_BOUND = 1;
const GRID_UPPER_BOUND = 12;
const INITIAL_GRID: CanvasImageSplitParams = { rows: 2, columns: 2 };

export function CanvasNodeSplitDialog({ dataUrl, open, loading, onClose, onConfirm }: SplitDialogProps) {
    const [grid, setGrid] = useState<CanvasImageSplitParams>(INITIAL_GRID);
    const [sourceShape, setSourceShape] = useState<SourceImageShape | null>(null);
    const metrics = buildSplitMetrics(sourceShape, grid);

    // 打开弹窗时重置行列与图像信息，避免上一次残留
    useEffect(() => {
        if (!open) return;
        setGrid(INITIAL_GRID);
        setSourceShape(null);
    }, [dataUrl, open]);

    // 读取源图宽高，用于估算单块输出尺寸
    useEffect(() => {
        if (!open) return;
        let disposed = false;
        void readImageMeta(dataUrl).then((shape) => {
            if (!disposed) setSourceShape(shape);
        });
        return () => {
            disposed = true;
        };
    }, [dataUrl, open]);

    // 修改行列后做 1–12 的范围归一化
    const adjustDimension = (field: keyof CanvasImageSplitParams, next: string | number | null) => {
        setGrid((current) => applyGridDimensionChange(current, field, next));
    };

    return (
        <Modal title={null} open={open && Boolean(dataUrl)} onCancel={loading ? undefined : onClose} footer={null} width={780} centered destroyOnHidden mask={{ closable: !loading }} keyboard={!loading} closable={!loading}>
            <div className="space-y-5">
                <SplitDialogHeading sliceCount={metrics.sliceCount} />
                <div className="grid gap-6 md:grid-cols-[minmax(260px,1fr)_280px]">
                    <SplitPreviewCard dataUrl={dataUrl} grid={grid} sourceLabel={metrics.sourceLabel} />
                    <SplitControlPanel
                        grid={grid}
                        sliceCount={metrics.sliceCount}
                        tileLabel={metrics.tileLabel}
                        onRowsChange={(value) => adjustDimension("rows", value)}
                        onColumnsChange={(value) => adjustDimension("columns", value)}
                        loading={loading}
                        onConfirm={() => onConfirm(grid)}
                    />
                </div>
            </div>
        </Modal>
    );
}

function SplitDialogHeading({ sliceCount }: { sliceCount: number }) {
    return (
        <div>
            <h2 className="text-xl font-semibold">切分图片</h2>
            <p className="mt-1 text-sm opacity-60">生成 {sliceCount} 个图片子节点，并按原图网格排列到画布右侧</p>
        </div>
    );
}

function SplitPreviewCard({ dataUrl, grid, sourceLabel }: { dataUrl: string; grid: CanvasImageSplitParams; sourceLabel: string }) {
    return (
        <div className="rounded-xl border p-4">
            <div className="grid min-h-[300px] place-items-center rounded-lg bg-black/5">
                <div className="relative inline-block max-w-full overflow-hidden rounded-lg bg-black shadow-xl">
                    <img src={dataUrl} alt="" className="block max-h-[340px] max-w-full object-contain opacity-95" draggable={false} />
                    <GridOverlay rows={grid.rows} columns={grid.columns} />
                </div>
            </div>
            <div className="mt-3 flex items-center justify-between text-sm">
                <span className="opacity-60">原图</span>
                <span className="font-semibold">{sourceLabel}</span>
            </div>
        </div>
    );
}

function SplitControlPanel({
    grid,
    sliceCount,
    tileLabel,
    onRowsChange,
    onColumnsChange,
    loading,
    onConfirm,
}: {
    grid: CanvasImageSplitParams;
    sliceCount: number;
    tileLabel: string;
    onRowsChange: (next: string | number | null) => void;
    onColumnsChange: (next: string | number | null) => void;
    loading: boolean;
    onConfirm: () => void;
}) {
    return (
        <div className="space-y-5 py-2">
            <DimensionField caption="行数" value={grid.rows} disabled={loading} onValueChange={onRowsChange} />
            <DimensionField caption="列数" value={grid.columns} disabled={loading} onValueChange={onColumnsChange} />
            <div className="rounded-xl border px-4 py-3 text-sm">
                <SplitMetricRow label="子节点" value={`${sliceCount} 个`} />
                <SplitMetricRow label="单块约" value={tileLabel} className="mt-2" />
            </div>
            <Button type="primary" size="large" className="w-full" icon={<Grid2x2 className="size-4" />} loading={loading} onClick={onConfirm}>
                {loading ? "正在处理" : "生成子节点"}
            </Button>
        </div>
    );
}

function SplitMetricRow({ label, value, className }: { label: string; value: string; className?: string }) {
    return (
        <div className={`flex items-center justify-between ${className ?? ""}`.trim()}>
            <span className="opacity-60">{label}</span>
            <span className="font-semibold">{value}</span>
        </div>
    );
}

function DimensionField({ caption, value, disabled, onValueChange }: GridDimensionInputProps & { disabled: boolean }) {
    return (
        <label className="block space-y-2">
            <span className="font-medium opacity-75">{caption}</span>
            <InputNumber className="w-full" min={GRID_LOWER_BOUND} max={GRID_UPPER_BOUND} precision={0} value={value} disabled={disabled} onChange={onValueChange} />
        </label>
    );
}

/** 叠加在源图上的网格分隔线，按行列数等分绘制 */
function GridOverlay({ rows, columns }: CanvasImageSplitParams): ReactNode {
    const verticals = createGridSteps(columns);
    const horizontals = createGridSteps(rows);
    return (
        <div className="pointer-events-none absolute inset-0">
            {verticals.map((n) => (
                <div key={`v${n}`} className="absolute inset-y-0 border-l border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,.35)]" style={{ left: `${(n / columns) * 100}%` }} />
            ))}
            {horizontals.map((n) => (
                <div key={`h${n}`} className="absolute inset-x-0 border-t border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,.35)]" style={{ top: `${(n / rows) * 100}%` }} />
            ))}
        </div>
    );
}

function buildSplitMetrics(shape: SourceImageShape | null, grid: CanvasImageSplitParams): SplitMetrics {
    const sliceCount = grid.rows * grid.columns;
    const estimatedTile = shape ? computeTileDimensions(shape, grid) : null;
    return {
        sliceCount,
        sourceLabel: shape ? `${shape.width} x ${shape.height} px` : "读取中",
        tileLabel: estimatedTile ? `${estimatedTile.width} x ${estimatedTile.height}` : "未知",
    };
}

/** 根据源图与网格估算单块输出像素 */
function computeTileDimensions(shape: SourceImageShape, grid: CanvasImageSplitParams) {
    return {
        width: Math.max(1, Math.floor(shape.width / grid.columns)),
        height: Math.max(1, Math.floor(shape.height / grid.rows)),
    };
}

function applyGridDimensionChange(grid: CanvasImageSplitParams, field: keyof CanvasImageSplitParams, next: string | number | null): CanvasImageSplitParams {
    return { ...grid, [field]: normalizeGridValue(next ?? grid[field]) };
}

function createGridSteps(count: number) {
    return Array.from({ length: Math.max(0, count - 1) }, (_, index) => index + 1);
}

/** 将任意输入归一化为 1–12 的整数 */
function normalizeGridValue(raw: string | number) {
    const parsed = Number(raw);
    const safe = Number.isFinite(parsed) ? parsed : GRID_LOWER_BOUND;
    return Math.min(GRID_UPPER_BOUND, Math.max(GRID_LOWER_BOUND, Math.round(safe)));
}
