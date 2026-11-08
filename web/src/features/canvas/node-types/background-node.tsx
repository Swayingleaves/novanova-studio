"use client";
import { useTranslation } from "@/features/locale/use-translation";


import { memo, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { NodeResizer, useViewport, type Node, type NodeProps } from "@xyflow/react";
import { Minus, Plus, Trash2 } from "lucide-react";

import { CANVAS_BACKGROUND_LABEL_COLORS, CANVAS_BACKGROUND_LABEL_FONT_STEP, CANVAS_BACKGROUND_LABEL_MAX_FONT_SIZE, CANVAS_BACKGROUND_LABEL_MIN_FONT_SIZE, CANVAS_BACKGROUND_LABEL_PADDING, CANVAS_BACKGROUND_MIN_HEIGHT, CANVAS_BACKGROUND_MIN_WIDTH } from "../constants";
import { clampBackgroundLabelFontSize, clampBackgroundLabelPoint, resolveBackgroundLabelColor } from "../domain/canvas-page-node";
import type { CanvasBackgroundLabel, CanvasBackgroundNode } from "../types";
import { useCanvasTheme } from "../components/canvas-theme-provider";
import { useNodeActions } from "./node-action-context";
import { CanvasNodeTitle } from "./shared";

/** 画布背景板节点，负责呈现容器层、标题和限制在板内的文字描述。 */
export const BackgroundNode = memo(function BackgroundNode({ data, selected }: NodeProps<Node<any>>) {
    const translate = useTranslation();
    const board = data as CanvasBackgroundNode;
    const theme = useCanvasTheme();
    const actions = useNodeActions();
    const borderColor = selected ? theme.node.activeStroke : theme.node.stroke;
    const labels = board.labels ?? [];
    const selection = actions.selectedBackgroundLabel?.boardId === board.id ? actions.selectedBackgroundLabel : null;
    const selectionRef = useRef(selection);
    selectionRef.current = selection;

    const changeLabels = (nextLabels: CanvasBackgroundLabel[]) => {
        actions.onBackgroundLabelsChange?.(board.id, nextLabels);
    };
    const selectLabel = (labelId: string, editing: boolean) => {
        const next = { boardId: board.id, labelId, editing };
        selectionRef.current = next;
        actions.onSelectBackgroundLabel?.(next);
    };
    const clearSelection = () => {
        selectionRef.current = null;
        actions.onSelectBackgroundLabel?.(null);
    };
    const finishEditing = (labelId: string) => {
        const current = selectionRef.current;
        if (current?.boardId !== board.id || current.labelId !== labelId) return;
        const next = { ...current, editing: false };
        selectionRef.current = next;
        actions.onSelectBackgroundLabel?.(next);
    };

    return (
        <>
            <NodeResizer
                minWidth={CANVAS_BACKGROUND_MIN_WIDTH}
                minHeight={CANVAS_BACKGROUND_MIN_HEIGHT}
                isVisible={selected}
                lineStyle={{ borderColor: theme.node.activeStroke }}
                handleStyle={{ borderColor: theme.node.activeStroke, backgroundColor: theme.node.panel }}
                onResizeEnd={(_, params) => actions.onResize?.(board.id, params.width, params.height, { x: params.x, y: params.y })}
            />
            <div
                className="relative h-full w-full select-none overflow-visible rounded-lg border outline-none focus-visible:outline-2"
                role="group"
                tabIndex={0}
                aria-label={translate("canvas.containingNodes", { value0: board.title || translate("canvas.background"), value1: board.memberNodeIds.length })}
                style={{ borderColor, outlineColor: theme.node.activeStroke, boxShadow: selected ? `0 0 0 1px ${theme.node.activeStroke}55` : undefined }}
                onPointerDown={(event) => {
                    const target = event.target;
                    if (target instanceof Element && target.closest("[data-background-label]")) return;
                    clearSelection();
                }}
            >
                <div className="pointer-events-none absolute inset-0 rounded-[inherit]" style={{ background: board.backgroundColor, opacity: 0.72 }} />
                <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-[inherit]">
                    {labels.map((label) => (
                        <BackgroundLabel
                            key={label.id}
                            label={label}
                            boardWidth={board.frame.width}
                            boardHeight={board.frame.height}
                            selected={selection?.labelId === label.id}
                            editing={selection?.labelId === label.id && selection.editing}
                            onSelect={(editing) => selectLabel(label.id, editing)}
                            onFinishEditing={() => finishEditing(label.id)}
                            onChange={(next) => changeLabels(labels.map((item) => (item.id === next.id ? next : item)))}
                            onDelete={() => {
                                changeLabels(labels.filter((item) => item.id !== label.id));
                                if (selectionRef.current?.labelId === label.id) clearSelection();
                            }}
                        />
                    ))}
                </div>
                <CanvasNodeTitle nodeId={board.id} title={board.title} defaultTitle={translate("canvas.background")} onTitleChange={actions.onTitleChange} />
                <span className="pointer-events-none absolute left-3 top-3 z-10 text-xs" style={{ color: theme.node.text }}>
                    {board.memberNodeIds.length} {translate("canvas.nodes")}</span>
            </div>
        </>
    );
});

function BackgroundLabel({ label, boardWidth, boardHeight, selected, editing, onSelect, onFinishEditing, onChange, onDelete }: { label: CanvasBackgroundLabel; boardWidth: number; boardHeight: number; selected: boolean; editing: boolean; onSelect: (editing: boolean) => void; onFinishEditing: () => void; onChange: (label: CanvasBackgroundLabel) => void; onDelete: () => void }) {
    const translate = useTranslation();
    const theme = useCanvasTheme();
    const { zoom } = useViewport();
    const zoomRef = useRef(zoom);
    zoomRef.current = zoom;
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const dragRef = useRef<{ pointerId: number; startClientX: number; startClientY: number; originX: number; originY: number; x: number; y: number; moved: boolean } | null>(null);
    const [dragPoint, setDragPoint] = useState<{ x: number; y: number } | null>(null);
    const [draft, setDraft] = useState(label.text);
    const point = dragPoint ?? { x: label.x, y: label.y };
    const fontSize = label.fontSize;
    const lineHeight = Math.round(fontSize * 1.4);
    const color = resolveBackgroundLabelColor(label.color);
    const toolbarWidth = 272;
    const toolbarLeft = Math.max(CANVAS_BACKGROUND_LABEL_PADDING, Math.min(point.x, boardWidth - toolbarWidth - CANVAS_BACKGROUND_LABEL_PADDING));
    const toolbarTop = point.y >= 40 ? point.y - 36 : Math.min(point.y + 4, Math.max(CANVAS_BACKGROUND_LABEL_PADDING, boardHeight - 36));

    useEffect(() => {
        if (!editing) setDraft(label.text);
    }, [editing, label.text]);

    useEffect(() => {
        if (!editing) return;
        const field = textareaRef.current;
        field?.focus();
        field?.select();
    }, [editing]);

    const stopCanvasDrag = (event: { stopPropagation: () => void }) => {
        event.stopPropagation();
    };

    const commitPoint = (nextPoint: { x: number; y: number }) => {
        const clamped = clampBackgroundLabelPoint(nextPoint.x, nextPoint.y, boardWidth, boardHeight);
        if (clamped.x === label.x && clamped.y === label.y) return;
        onChange({ ...label, ...clamped });
    };

    const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        stopCanvasDrag(event);
        if (editing) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY, originX: label.x, originY: label.y, x: label.x, y: label.y, moved: false };
        onSelect(false);
    };

    const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const scale = zoomRef.current || 1;
        const offsetX = (event.clientX - drag.startClientX) / scale;
        const offsetY = (event.clientY - drag.startClientY) / scale;
        if (Math.abs(offsetX) > 3 || Math.abs(offsetY) > 3) drag.moved = true;
        const nextPoint = clampBackgroundLabelPoint(drag.originX + offsetX, drag.originY + offsetY, boardWidth, boardHeight);
        drag.x = nextPoint.x;
        drag.y = nextPoint.y;
        if (drag.moved) setDragPoint(nextPoint);
    };

    const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        dragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        if (!drag.moved) {
            setDragPoint(null);
            return;
        }
        setDragPoint(null);
        commitPoint({ x: drag.x, y: drag.y });
    };

    const changeFontSize = (delta: number) => {
        const fontSize = clampBackgroundLabelFontSize(label.fontSize + delta);
        if (fontSize !== label.fontSize) onChange({ ...label, fontSize });
    };

    return (
        <>
            {selected && !editing ? (
                <div
                    data-background-label
                    data-background-label-toolbar
                    className="nodrag nopan nowheel pointer-events-auto absolute z-20 flex max-w-full flex-wrap items-center gap-1 rounded-md border px-1 py-1 shadow-sm"
                    style={{ left: toolbarLeft, top: toolbarTop, maxWidth: `calc(100% - ${toolbarLeft + CANVAS_BACKGROUND_LABEL_PADDING}px)`, background: theme.node.panel, borderColor: theme.toolbar.border }}
                    onPointerDown={stopCanvasDrag}
                    onDoubleClick={stopCanvasDrag}
                >
                    {CANVAS_BACKGROUND_LABEL_COLORS.map((swatch) => {
                        const colorLabel = translate("canvas.setBackgroundDescriptionColor", { value0: swatch });
                        const active = color === swatch;
                        return (
                            <button key={swatch} type="button" aria-label={colorLabel} className="size-4 rounded-full border" style={{ background: swatch, borderColor: active ? theme.node.activeStroke : theme.toolbar.border, outline: active ? `2px solid ${theme.node.activeStroke}` : undefined }} onClick={() => onChange({ ...label, color: swatch })} />
                        );
                    })}
                    <button type="button" aria-label={translate("canvas.decreaseBackgroundDescriptionSize")} className="grid size-5 place-items-center rounded disabled:opacity-40" style={{ color: theme.node.text }} disabled={fontSize <= CANVAS_BACKGROUND_LABEL_MIN_FONT_SIZE} onClick={() => changeFontSize(-CANVAS_BACKGROUND_LABEL_FONT_STEP)}><Minus className="size-3" /></button>
                    <span className="min-w-5 text-center text-[11px]" style={{ color: theme.node.text }}>{fontSize}</span>
                    <button type="button" aria-label={translate("canvas.increaseBackgroundDescriptionSize")} className="grid size-5 place-items-center rounded disabled:opacity-40" style={{ color: theme.node.text }} disabled={fontSize >= CANVAS_BACKGROUND_LABEL_MAX_FONT_SIZE} onClick={() => changeFontSize(CANVAS_BACKGROUND_LABEL_FONT_STEP)}><Plus className="size-3" /></button>
                    <button type="button" aria-label={translate("canvas.deleteBackgroundDescription")} className="grid size-5 place-items-center rounded text-red-500" onClick={onDelete}><Trash2 className="size-3" /></button>
                </div>
            ) : null}
            <div
                data-background-label
                className="nodrag nopan nowheel pointer-events-auto absolute overflow-hidden"
                style={{ left: point.x, top: point.y, maxWidth: `calc(100% - ${point.x + CANVAS_BACKGROUND_LABEL_PADDING}px)`, maxHeight: `calc(100% - ${point.y + CANVAS_BACKGROUND_LABEL_PADDING}px)`, cursor: editing ? "text" : "move", outline: selected ? `1px solid ${theme.node.activeStroke}` : undefined, borderRadius: 4 }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onDoubleClick={(event) => {
                    stopCanvasDrag(event);
                    if (dragRef.current?.moved) return;
                    onSelect(true);
                }}
            >
                {editing ? (
                    <textarea
                        ref={textareaRef}
                        aria-label={translate("canvas.backgroundDescription")}
                        className="nodrag nopan nowheel block w-full resize-none select-text overflow-auto bg-transparent outline-none"
                        style={{ color, fontSize, lineHeight: `${lineHeight}px`, minHeight: lineHeight }}
                        value={draft}
                        onChange={(event) => {
                            const text = event.target.value;
                            setDraft(text);
                            if (text !== label.text) onChange({ ...label, text });
                        }}
                        onBlur={onFinishEditing}
                        onKeyDown={(event) => {
                            event.stopPropagation();
                            if (event.key === "Escape") {
                                event.preventDefault();
                                onFinishEditing();
                            }
                        }}
                        onPointerDown={stopCanvasDrag}
                    />
                ) : (
                    <div className="whitespace-pre-wrap break-words" style={{ color: label.text ? color : theme.node.placeholder, fontSize, lineHeight: `${lineHeight}px` }} title={translate("canvas.clickToEditBackgroundDescription")}>
                        {label.text || translate("canvas.clickToEditBackgroundDescription")}
                    </div>
                )}
            </div>
        </>
    );
}
