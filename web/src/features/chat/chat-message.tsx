"use client";

import ReactMarkdown from "react-markdown";
import type { ChatMessageItem, ToolCallState } from "./types";

type Props = {
  item: ChatMessageItem;
  userAvatar?: string;
  /** 工具调用卡片的渲染函数，由各页面自行决定如何展示 */
  renderToolResult?: (call: ToolCallState) => React.ReactNode;
};

/**
 * 通用聊天消息气泡。
 * user 消息右对齐，assistant 用 Markdown，tool 委托给 renderToolResult。
 */
export function ChatMessage({ item, userAvatar, renderToolResult }: Props) {
  const isUser = item.role === "user";
  const isSystem = item.role === "system";
  const isTool = item.role === "tool";

  if (isSystem) {
    return (
      <div className="flex justify-center py-1 text-xs text-gray-400">
        {item.text}
        {item.meta ? <span className="ml-2 opacity-60">{item.meta}</span> : null}
      </div>
    );
  }

  return (
    <div className={`mb-4 flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-indigo-100 text-xs font-medium text-indigo-600 dark:bg-indigo-900 dark:text-indigo-300">
          AI
        </span>
      )}
      <div className={`min-w-0 max-w-[82%] ${isUser ? "text-right" : "text-left"}`}>
        {isTool && renderToolResult ? (
          renderToolResult(item.detail as ToolCallState)
        ) : item.role === "assistant" ? (
          <div className="prose prose-sm max-w-none text-sm leading-6 dark:prose-invert">
            <ReactMarkdown>{item.text}</ReactMarkdown>
          </div>
        ) : (
          <div className="whitespace-pre-wrap break-words text-sm leading-6">{item.text}</div>
        )}
        {item.meta && !isSystem && <div className="mt-1 text-[11px] opacity-45">{item.meta}</div>}
      </div>
      {isUser && (
        <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-gray-200 text-xs text-gray-600">
          {userAvatar ? (
            <img src={userAvatar} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            "Me"
          )}
        </span>
      )}
    </div>
  );
}
