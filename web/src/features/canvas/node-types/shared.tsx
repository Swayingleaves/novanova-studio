"use client";

import { Handle, Position } from "@xyflow/react";
import { LoaderCircle, AlertTriangle, TriangleAlert } from "lucide-react";
import { forwardRef, type CSSProperties, type MouseEventHandler, type ReactNode } from "react";
import { CANVAS_CONNECTION_HANDLE_SIZE } from "../constants";
import type { CanvasNode } from "../types";
import { useNodeActions } from "./node-action-context";
import { useCanvasTheme } from "../components/canvas-theme-provider";

/** 共享加载状态组件 */
export function NodeLoading() {
  const t = useCanvasTheme();
  return (
    <div className="flex h-full w-full items-center justify-center gap-2" style={{ color: t.node.muted }}>
      <LoaderCircle className="size-5 animate-spin" />
      <span className="text-sm">生成中...</span>
    </div>
  );
}

/** 共享错误状态组件 */
export function NodeError({
  node,
  onRetry,
}: {
  node: CanvasNode;
  onRetry?: (node: CanvasNode) => void;
}) {
  const t = useCanvasTheme();
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center" style={{ color: t.node.muted }}>
      <AlertTriangle className="size-6 text-red-400" />
      <span className="text-xs text-red-400">{node.execution.errorMessage || "生成失败"}</span>
      {onRetry ? (
        <button
          type="button"
          className="mt-1 rounded-full border border-red-400/40 px-3 py-0.5 text-xs text-red-400 transition hover:bg-red-400/10"
          onClick={() => onRetry(node)}
        >
          重试
        </button>
      ) : null}
    </div>
  );
}

/** 媒体节点下载提示：生成结果有时效，超时将无法下载 */
export function MediaDownloadHint() {
  return (
    <div
      className="pointer-events-none absolute bottom-2 left-2 z-10 flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-full px-2.5 py-1 text-[11px]"
      style={{ background: "rgba(0,0,0,0.55)", color: "#fbbf24" }}
    >
      <TriangleAlert className="size-3 shrink-0" />
      <span className="truncate">请尽快下载生成结果，超时将无法下载</span>
    </div>
  );
}

/** 节点默认最小尺寸 */
export const NODE_MIN_WIDTH = 220;
export const NODE_MIN_HEIGHT = 160;

export const selectionBlue = "#8b5cf6";

const connectionHandlePositions = [Position.Left, Position.Right] as const;
const connectionHandleIds: Record<(typeof connectionHandlePositions)[number], string> = {
  [Position.Left]: "left",
  [Position.Right]: "right",
};

/**
 * 画布节点左右两侧通用连接点。
 * <p>
 * 配合 React Flow 的 Loose 连接模式，每侧都可以发起或接收连线。
 *
 * @return React.ReactElement 节点连接点元素
 */
export function CanvasConnectionHandles() {
  const theme = useCanvasTheme();
  const connectionHandleStyle = {
    width: CANVAS_CONNECTION_HANDLE_SIZE,
    height: CANVAS_CONNECTION_HANDLE_SIZE,
    background: theme.node.panel,
    border: `2px solid ${theme.node.activeStroke}`,
  };

  return (
    <>
      {connectionHandlePositions.map((position) => (
        <Handle
          key={position}
          id={connectionHandleIds[position]}
          type="source"
          position={position}
          className="!opacity-0 transition-opacity duration-150 group-hover:!opacity-100 motion-reduce:transition-none"
          style={connectionHandleStyle}
        />
      ))}
    </>
  );
}

/**
 * React Flow 节点的 hover 热区，用于恢复页面级节点快捷工具栏。
 */
type NodeHoverSurfaceProps = {
  nodeId: string;
  className?: string;
  style?: CSSProperties;
  onMouseEnter?: MouseEventHandler<HTMLDivElement>;
  onMouseLeave?: MouseEventHandler<HTMLDivElement>;
  onDoubleClick?: MouseEventHandler<HTMLDivElement>;
  children: ReactNode;
};

export const NodeHoverSurface = forwardRef<HTMLDivElement, NodeHoverSurfaceProps>(function NodeHoverSurface({
  nodeId,
  className,
  style,
  onMouseEnter,
  onMouseLeave,
  onDoubleClick,
  children,
}, ref) {
  const actions = useNodeActions();

  return (
    <div
      ref={ref}
      className={`group ${className ?? ""}`}
      style={style}
      onMouseEnter={(event) => {
        actions.onKeepToolbar?.(nodeId);
        onMouseEnter?.(event);
      }}
      onMouseLeave={(event) => {
        actions.onHideToolbar?.();
        onMouseLeave?.(event);
      }}
      onDoubleClick={onDoubleClick}
    >
      {children}
    </div>
  );
});
