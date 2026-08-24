"use client";

import { memo, useState } from "react";
import { NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import { Play, Video } from "lucide-react";
import type { CanvasVideoNode } from "../types";
import { useNodeActions } from "./node-action-context";
import { CanvasConnectionHandles, MediaDownloadHint, NodeError, NodeHoverSurface, NodeLoading } from "./shared";
import { useCanvasTheme } from "../components/canvas-theme-provider";

export const VideoNode = memo(function VideoNode({ data, selected }: NodeProps<Node<CanvasVideoNode>>) {
  const actions = useNodeActions();
  const theme = useCanvasTheme();
  const hasContent = Boolean(data.content.source);
  const isLoading = data.execution.phase === "running";
  const isError = data.execution.phase === "failed";
  const [hovered, setHovered] = useState(false);
  const borderColor = selected ? theme.node.activeStroke : isError ? "#ef4444" : theme.node.stroke;

  return (
    <>
      <NodeResizer minWidth={220} minHeight={160} keepAspectRatio isVisible={selected} lineStyle={{ borderColor: theme.node.activeStroke }} handleStyle={{ borderColor: theme.node.activeStroke, backgroundColor: theme.node.panel }} onResizeEnd={(_, params) => { actions.onResize?.(data.id, params.width, params.height, { x: params.x, y: params.y }); }} />
      <NodeHoverSurface
      nodeId={data.id}
      className="flex select-none flex-col rounded-3xl border-2"
      style={{
        width: "100%",
        height: "100%",
        background: hasContent ? theme.canvas.background : theme.node.fill,
        borderColor,
        boxShadow: selected ? `0 0 0 1px ${theme.node.activeStroke}55` : undefined,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {isLoading ? (
        <NodeLoading />
      ) : isError ? (
        <NodeError node={data} />
      ) : hasContent ? (
        <div className="relative h-full min-h-0 w-full min-w-0 overflow-hidden rounded-[inherit]">
          <video src={data.content.source} className="pointer-events-none block h-full w-full object-contain" data-canvas-no-zoom muted preload="metadata" />
          <MediaDownloadHint />
          {hovered ? (
            <div className="pointer-events-auto absolute inset-0 flex items-center justify-center" style={{ background: "rgba(2,6,23,0.22)" }}>
              <button type="button" className="flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition hover:scale-105" style={{ background: theme.node.panel, color: theme.node.text }} onClick={() => actions.onViewVideo(data)} aria-label="放大播放视频">
                <Play className="size-7 ml-0.5" />
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-sm" style={{ color: theme.node.placeholder }}>
          <Video className="size-7 opacity-35" />
          <span>空视频节点</span>
        </div>
      )}
      <CanvasConnectionHandles />
    </NodeHoverSurface>
    </>
  );
});
