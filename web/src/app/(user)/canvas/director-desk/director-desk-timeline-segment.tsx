"use client";
import { useTranslation } from "@/features/locale/use-translation";


import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { Dropdown } from "antd";
import { Trash2 } from "lucide-react";
import { useCanvasTheme } from "@/features/canvas/components/canvas-theme-provider";
import { resizeTimelineSegment, type TimelineInterval } from "./director-desk-timeline-segments";

type Segment = TimelineInterval & { id: string };
type ResizeEdge = "start" | "end";

/** 轨迹与姿势共用的片段交互：右键删除、边缘缩放和键盘逐帧调整。 */
export function DirectorDeskTimelineSegment({ segment, siblings, label, durationMilliseconds, disabled, selected, style, onSelect, onEditingStart, onChange }: {
    segment: Segment; siblings: Segment[]; label: string; durationMilliseconds: number; disabled: boolean; selected?: boolean; style: CSSProperties;
    onSelect: () => void; onEditingStart: () => void; onChange: (interval: TimelineInterval | null) => void;
}) {
    const translate = useTranslation();
    const theme = useCanvasTheme();
    const [preview, setPreview] = useState<TimelineInterval | null>(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const gesture = useRef<{ pointerId: number; edge: ResizeEdge; initialClientX: number; width: number; original: Segment; preview: TimelineInterval } | null>(null);
    const current = preview || segment;
    const rangeLabel = translate("directorDesk.s_44a6da", { value0: (current.startTimeMilliseconds / 1000).toFixed(2), value1: (current.endTimeMilliseconds / 1000).toFixed(2) });
    const resetResize = () => { gesture.current = null; setPreview(null); };

    useEffect(() => {
        if (disabled) { resetResize(); setMenuOpen(false); }
    }, [disabled]);
    useEffect(() => {
        if (!preview) return;
        const cancel = (event: globalThis.KeyboardEvent) => {
            if (event.key === "Escape" && gesture.current) { event.preventDefault(); event.stopPropagation(); resetResize(); }
        };
        window.addEventListener("keydown", cancel, true);
        window.addEventListener("blur", resetResize);
        return () => { window.removeEventListener("keydown", cancel, true); window.removeEventListener("blur", resetResize); };
    }, [Boolean(preview)]);

    /** 以整条时间轨道宽度换算鼠标位移，拖动中只更新本地预览。 */
    const startResize = (event: PointerEvent<HTMLButtonElement>, edge: ResizeEdge) => {
        if (disabled || event.button !== 0) return;
        const track = event.currentTarget.parentElement?.parentElement;
        if (!track) return;
        const width = track.getBoundingClientRect().width;
        if (width <= 0) return;
        event.preventDefault(); event.stopPropagation();
        event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
        gesture.current = { pointerId: event.pointerId, edge, initialClientX: event.clientX, width, original: segment, preview: segment };
        setPreview(segment); setMenuOpen(false); onEditingStart();
    };
    const moveResize = (event: PointerEvent<HTMLButtonElement>) => {
        const active = gesture.current;
        if (!active || active.pointerId !== event.pointerId) return;
        const initialTime = active.edge === "start" ? active.original.startTimeMilliseconds : active.original.endTimeMilliseconds;
        active.preview = resizeTimelineSegment(siblings, segment.id, active.edge, initialTime + (event.clientX - active.initialClientX) / active.width * durationMilliseconds, durationMilliseconds);
        setPreview(active.preview);
    };
    const finishResize = (event: PointerEvent<HTMLButtonElement>) => {
        const active = gesture.current;
        if (!active || active.pointerId !== event.pointerId) return;
        moveResize(event);
        resetResize();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        if (active.preview.startTimeMilliseconds !== active.original.startTimeMilliseconds || active.preview.endTimeMilliseconds !== active.original.endTimeMilliseconds) onChange(active.preview);
    };
    /** 左右箭头每次调整一帧，Shift 每次调整一秒，作为拖动的键盘入口。 */
    const resizeWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>, edge: ResizeEdge) => {
        if (disabled || event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault(); event.stopPropagation();
        const time = edge === "start" ? segment.startTimeMilliseconds : segment.endTimeMilliseconds;
        const interval = resizeTimelineSegment(siblings, segment.id, edge, time + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 1000 : 1000 / 30), durationMilliseconds);
        if (interval.startTimeMilliseconds === segment.startTimeMilliseconds && interval.endTimeMilliseconds === segment.endTimeMilliseconds) return;
        onEditingStart(); onChange(interval);
    };

    return <Dropdown trigger={["contextMenu"]} disabled={disabled || Boolean(preview)} open={menuOpen} onOpenChange={setMenuOpen} menu={{ items: [{ key: "remove", label: translate("directorDesk.deleteClip"), danger: true, icon: <Trash2 className="size-3.5" /> }], onClick: ({ domEvent }) => { domEvent.stopPropagation(); setMenuOpen(false); onEditingStart(); onChange(null); } }}>
        <div className={`group absolute h-6 min-w-px rounded-sm border ${preview ? "z-30" : "z-10"}`} style={{ ...style, left: `${current.startTimeMilliseconds / durationMilliseconds * 100}%`, width: `${(current.endTimeMilliseconds - current.startTimeMilliseconds) / durationMilliseconds * 100}%` }} onContextMenu={(event) => event.stopPropagation()}>
            <button type="button" disabled={disabled} aria-label={translate("directorDesk.rightClickToDeleteDragEdgesToAdjust", { value0: label, value1: rangeLabel })} aria-pressed={selected} title={translate("directorDesk.rightClickToDeleteDragEdgesToAdjust_3d9f64", { value0: label, value1: rangeLabel })} className="block h-full w-full cursor-pointer truncate px-2 text-left text-[10px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--studio-action)]" onClick={onSelect} onKeyDown={(event) => { if (!disabled && event.key === "Delete") { event.preventDefault(); event.stopPropagation(); onEditingStart(); onChange(null); } }}>{label}</button>
            {(["start", "end"] as const).map((edge) => <button key={edge} type="button" role="slider" aria-label={translate("directorDesk.timeArrowKeysAdjustOneFrame", { value0: label, value1: edge === "start" ? translate("directorDesk.start") : translate("directorDesk.end") })} aria-valuemin={0} aria-valuemax={durationMilliseconds / 1000} aria-valuenow={(edge === "start" ? current.startTimeMilliseconds : current.endTimeMilliseconds) / 1000} aria-valuetext={rangeLabel} disabled={disabled} className={`absolute inset-y-0 w-2 max-w-[50%] touch-none cursor-ew-resize select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--studio-action)] ${edge === "start" ? "left-0" : "right-0"}`} onClick={(event) => event.stopPropagation()} onPointerDown={(event) => startResize(event, edge)} onPointerMove={moveResize} onPointerUp={finishResize} onPointerCancel={resetResize} onLostPointerCapture={resetResize} onKeyDown={(event) => resizeWithKeyboard(event, edge)}><span className={`pointer-events-none absolute inset-y-1 ${edge === "start" ? "left-0.5" : "right-0.5"} border-l border-current opacity-40 group-hover:opacity-100`} /></button>)}
            {preview ? <span className="pointer-events-none absolute bottom-full left-0 mb-1 whitespace-nowrap rounded border px-1.5 py-1 text-[10px] tabular-nums" style={{ background: theme.node.panel, color: theme.node.text, borderColor: theme.node.stroke }}>{rangeLabel}</span> : null}
        </div>
    </Dropdown>;
}
