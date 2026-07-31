"use client";

import { ChevronDown, ChevronRight, Brain } from "lucide-react";
import { useState, useEffect } from "react";
import type { ThinkingBlockState } from "./types";

type Props = {
  block: ThinkingBlockState;
  streaming?: boolean;
  appearance?: ThinkingBlockAppearance;
};

export type ThinkingBlockAppearance = {
  text: string;
  muted: string;
  background: string;
  border: string;
};

/**
 * 思考过程折叠组件。
 * streaming 时显示"思考中..."动画；完成后折叠并显示耗时。
 */
export function ThinkingBlock({ block, streaming = false, appearance }: Props) {
  const [collapsed, setCollapsed] = useState(streaming ? false : block.collapsed);

  useEffect(() => {
    setCollapsed(streaming ? false : block.collapsed);
  }, [block.collapsed, block.id, streaming]);

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-[var(--studio-muted)] transition-colors hover:text-[var(--studio-ink)]"
        style={appearance ? { color: appearance.muted } : undefined}
      >
        <Brain className="size-3.5" />
        {streaming ? (
          <span className="animate-pulse">思考中...</span>
        ) : (
          <span>思考过程 ({formatMs(block.durationMs)})</span>
        )}
        {collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
      </button>
      {!collapsed && (
        <div
          className="mt-1.5 whitespace-pre-wrap rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-3 font-mono text-xs leading-relaxed text-[var(--studio-text)]"
          style={appearance ? { color: appearance.text, background: appearance.background, borderColor: appearance.border } : undefined}
        >
          {block.text}
        </div>
      )}
    </div>
  );
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
