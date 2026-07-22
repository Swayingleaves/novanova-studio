"use client";

import { memo, useState, useRef, useEffect, useCallback, type MouseEvent as ReactMouseEvent } from "react";
import { NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import type { CanvasTextNode } from "../types";
import { useNodeActions } from "./node-action-context";
import { CanvasConnectionHandles, NodeHoverSurface } from "./shared";
import { useCanvasTheme } from "../components/canvas-theme-provider";

export const TextNode = memo(function TextNode({ data, selected }: NodeProps<Node<CanvasTextNode>>) {
  const actions = useNodeActions();
  const theme = useCanvasTheme();
  const [editing, setEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fontSize = data.content.fontSize;
  const borderColor = selected ? theme.node.activeStroke : theme.node.stroke;
  const [localContent, setLocalContent] = useState(data.content.text);

  // Sync external content changes (when not editing)
  useEffect(() => {
    if (!editing) setLocalContent(data.content.text);
  }, [data.content.text, editing]);

  const handleDoubleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    actions.onEditText(data);
    setEditing(true);
  }, [actions, data]);

  useEffect(() => {
    if (editing) {
      const ta = textareaRef.current;
      ta?.focus();
      ta?.setSelectionRange(ta.value.length, ta.value.length);
    }
  }, [editing]);

  useEffect(() => {
    if (!actions.textEditRequestVersion || actions.textEditingNodeId !== data.id) return;
    setEditing(true);
  }, [actions.textEditingNodeId, actions.textEditRequestVersion, data.id]);

  // Click outside to stop editing
  useEffect(() => {
    if (!editing) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && textareaRef.current?.contains(e.target)) return;
      setEditing(false);
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [editing]);

  const textStyle = {
    fontSize: `${fontSize}px`,
    lineHeight: `${Math.round(fontSize * 1.65)}px`,
    color: theme.node.text,
  };

  return (
    <>
      <NodeResizer minWidth={220} minHeight={80} isVisible={selected} lineStyle={{ borderColor: theme.node.activeStroke }} handleStyle={{ borderColor: theme.node.activeStroke, backgroundColor: theme.node.panel }} onResizeEnd={(_, params) => { actions.onResize?.(data.id, params.width, params.height, { x: params.x, y: params.y }); }} />
      <NodeHoverSurface
      nodeId={data.id}
      className="flex select-none flex-col rounded-3xl border-2"
      style={{
        width: "100%",
        height: "100%",
        background: theme.node.panel,
        borderColor,
        boxShadow: selected ? `0 0 0 1px ${theme.node.activeStroke}55` : undefined,
      }}
      onDoubleClick={handleDoubleClick}
    >
      {editing ? (
        <textarea
          ref={textareaRef}
          className="nodrag nopan nowheel h-full w-full resize-none overflow-y-auto whitespace-pre-wrap break-words border-none bg-transparent p-4 outline-none"
          style={textStyle}
          value={localContent}
          onChange={(e) => {
            const nextContent = e.target.value;
            setLocalContent(nextContent);
            actions.onContentChange?.(data.id, nextContent);
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        />
      ) : (
        <div className="h-full w-full overflow-y-auto whitespace-pre-wrap break-words p-4" style={textStyle} onWheel={(e) => e.stopPropagation()}>
          {localContent || <span style={{ color: theme.node.placeholder }}>双击编辑文字</span>}
        </div>
      )}
      <CanvasConnectionHandles />
    </NodeHoverSurface>
    </>
  );
});
