"use client";

import { memo } from "react";
import { NodeResizer, type Node, type NodeProps } from "@xyflow/react";
import { Frame } from "lucide-react";

import { CANVAS_BACKGROUND_MIN_HEIGHT, CANVAS_BACKGROUND_MIN_WIDTH } from "../constants";
import type { CanvasBackgroundNode } from "../types";
import { useCanvasTheme } from "../components/canvas-theme-provider";
import { useNodeActions } from "./node-action-context";

/** 画布背景板节点，负责呈现容器层和标题，不承载业务连线。 */
export const BackgroundNode = memo(function BackgroundNode({ data, selected }: NodeProps<Node<any>>) {
    const board = data as CanvasBackgroundNode;
    const theme = useCanvasTheme();
    const actions = useNodeActions();
    const borderColor = selected ? theme.node.activeStroke : theme.node.stroke;

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
                aria-label={`${board.title || "背景板"}，包含 ${board.memberNodeIds.length} 个节点`}
                style={{ borderColor, outlineColor: theme.node.activeStroke, boxShadow: selected ? `0 0 0 1px ${theme.node.activeStroke}55` : undefined }}
            >
                <div className="pointer-events-none absolute inset-0 rounded-[inherit]" style={{ background: board.backgroundColor, opacity: 0.72 }} />
                <div className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] items-center gap-1.5 text-xs font-medium" style={{ color: theme.node.text }}>
                    <Frame className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{board.title || "背景板"}</span>
                    <span className="shrink-0 opacity-65">{board.memberNodeIds.length}</span>
                </div>
            </div>
        </>
    );
});
