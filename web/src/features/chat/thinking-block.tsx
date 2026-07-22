"use client";

import { ChevronDown, ChevronRight, Brain } from "lucide-react";
import { useState, useEffect } from "react";
import type { ThinkingBlockState } from "./types";

type Props = {
  block: ThinkingBlockState;
  streaming?: boolean;
};

/**
 * 思考过程折叠组件。
 * streaming 时显示"思考中..."动画；完成后折叠并显示耗时。
 */
export function ThinkingBlock({ block, streaming }: Props) {
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    if (!streaming) setCollapsed(true);
  }, [streaming]);

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-500 transition-colors"
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
        <div className="mt-1.5 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs leading-relaxed text-gray-500 whitespace-pre-wrap font-mono dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
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
