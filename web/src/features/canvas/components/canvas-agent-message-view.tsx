"use client";

import type { ComponentProps } from "react";
import { Button } from "antd";
import { Bot, CheckCircle2, CircleAlert, LoaderCircle, UserRound, Wrench, XCircle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

import type { LocalUser } from "@/features/auth/stores/use-user-store";
import { canvasThemes } from "@/shared/lib/canvas-theme";
import type { CanvasAgentChatAttachment, CanvasAgentChatMessage } from "../domain/canvas-agent-message";

type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];
type MarkdownComponents = NonNullable<ComponentProps<typeof ReactMarkdown>["components"]>;

export function AgentChatMessage({ item, theme, user, onRejectTool, onApproveTool }: { item: CanvasAgentChatMessage; theme: CanvasTheme; user: LocalUser | null; onRejectTool?: (id: string) => void; onApproveTool?: (id: string) => void }) {
    if (item.role === "system") return <SystemMessage item={item} theme={theme} />;
    if (item.role === "tool") {
        return readToolStatus(item.detail) === "pending"
            ? <AgentPendingToolCard summary={item.text} detail={item.detail} theme={theme} onReject={() => onRejectTool?.(item.id)} onApprove={() => onApproveTool?.(item.id)} />
            : <div className="flex items-start gap-3"><AssistantAvatar theme={theme} /><AgentToolCard title={item.title || "工具调用"} text={item.text} detail={item.detail} theme={theme} /></div>;
    }

    const userMessage = item.role === "user";
    return (
        <div className={`flex items-start gap-3 ${userMessage ? "justify-end" : "justify-start"}`}>
            {!userMessage ? <AssistantAvatar theme={theme} /> : null}
            <div className="min-w-0 max-w-[82%] text-sm leading-6" style={{ color: item.role === "error" ? "#dc2626" : theme.node.text }}>
                {item.role === "assistant" ? <MarkdownMessage text={item.text} theme={theme} /> : <p className="whitespace-pre-wrap break-words">{item.text}</p>}
                {item.attachments?.length ? <MessageAttachments attachments={item.attachments} theme={theme} /> : null}
                {item.meta ? <p className="mt-1 text-[11px] opacity-50">{item.meta}</p> : null}
            </div>
            {userMessage ? <UserAvatar user={user} theme={theme} /> : null}
        </div>
    );
}

export function AgentPendingToolCard({ summary, detail, theme, onReject, onApprove }: { summary: string; detail?: unknown; theme: CanvasTheme; onReject?: () => void; onApprove?: () => void }) {
    return (
        <div className="flex items-start gap-3">
            <AssistantAvatar theme={theme} />
            <section className="min-w-0 flex-1 rounded-xl border p-4" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
                <div className="flex items-center gap-2 text-sm font-medium"><CircleAlert className="size-4 text-amber-500" />等待确认</div>
                <p className="mt-2 text-sm leading-6">{summary}</p>
                <ToolDetail detail={detail} theme={theme} />
                <div className="mt-3 flex justify-end gap-2">
                    <Button size="small" icon={<XCircle className="size-4" />} onClick={onReject}>拒绝</Button>
                    <Button size="small" type="primary" icon={<CheckCircle2 className="size-4" />} onClick={onApprove}>执行</Button>
                </div>
            </section>
        </div>
    );
}

export function AgentToolCard({ title, text, detail, theme }: { title: string; text: string; detail?: unknown; theme: CanvasTheme }) {
    return (
        <section className="min-w-0 flex-1 rounded-xl border p-4" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
            <div className="flex items-center gap-2 text-sm font-medium"><Wrench className="size-4" />{title}</div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{text}</p>
            <ToolDetail detail={detail} theme={theme} />
        </section>
    );
}

export function AgentWorkingMessage({ theme }: { theme: CanvasTheme }) {
    return <div className="flex items-center gap-3 text-sm" style={{ color: theme.node.muted }}><AssistantAvatar theme={theme} /><LoaderCircle className="size-4 animate-spin" />AI 正在处理画布任务…</div>;
}

function SystemMessage({ item, theme }: { item: CanvasAgentChatMessage; theme: CanvasTheme }) {
    return <div className="text-center text-xs" style={{ color: theme.node.muted }}>{item.text}{item.meta ? <span className="ml-2 opacity-60">{item.meta}</span> : null}</div>;
}

function MarkdownMessage({ text, theme }: { text: string; theme: CanvasTheme }) {
    return <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]} components={createMarkdownComponents(theme)}>{text}</ReactMarkdown>;
}

function createMarkdownComponents(theme: CanvasTheme): MarkdownComponents {
    return {
        a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" className="text-blue-500 underline">{children}</a>,
        code: ({ className, children, ...props }) => className
            ? <pre className="my-3 overflow-x-auto rounded-lg p-3 text-[13px]" style={{ background: theme.node.fill }}><code className={className} {...props}>{children}</code></pre>
            : <code className="rounded px-1 py-0.5 text-[13px]" style={{ background: theme.node.fill }} {...props}>{children}</code>,
        table: ({ children }) => <div className="my-3 overflow-x-auto"><table className="w-full border-collapse text-sm">{children}</table></div>,
        th: ({ children }) => <th className="border px-3 py-2 text-left" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>{children}</th>,
        td: ({ children }) => <td className="border px-3 py-2" style={{ borderColor: theme.node.stroke }}>{children}</td>,
        blockquote: ({ children }) => <blockquote className="my-3 border-l-4 py-1 pl-4" style={{ borderColor: theme.node.muted, color: theme.node.muted }}>{children}</blockquote>,
        h1: ({ children }) => <h1 className="my-4 text-xl font-bold">{children}</h1>,
        h2: ({ children }) => <h2 className="my-3 text-lg font-bold">{children}</h2>,
        h3: ({ children }) => <h3 className="my-3 text-base font-semibold">{children}</h3>,
        ul: ({ children }) => <ul className="my-2 list-disc pl-6">{children}</ul>,
        ol: ({ children }) => <ol className="my-2 list-decimal pl-6">{children}</ol>,
        p: ({ children }) => <p className="my-2 leading-6">{children}</p>,
    };
}

function ToolDetail({ detail, theme }: { detail: unknown; theme: CanvasTheme }) {
    if (detail === undefined || detail === null) return null;
    const content = typeof detail === "string" ? detail : JSON.stringify(detail, null, 2);
    return <pre className="mt-3 max-h-48 overflow-auto rounded-lg p-3 text-xs" style={{ background: theme.node.fill, color: theme.node.muted }}>{content}</pre>;
}

function MessageAttachments({ attachments, theme }: { attachments: CanvasAgentChatAttachment[]; theme: CanvasTheme }) {
    return <div className="mt-2 flex flex-wrap gap-2">{attachments.map((attachment) => <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border" style={{ borderColor: theme.node.stroke }} title={attachment.name}><img src={attachment.url} alt={attachment.name} className="size-20 object-cover" /></a>)}</div>;
}

function AssistantAvatar({ theme }: { theme: CanvasTheme }) {
    return <span className="grid size-8 shrink-0 place-items-center rounded-full" style={{ background: theme.node.fill, color: theme.node.text }}><Bot className="size-4" /></span>;
}

function UserAvatar({ user, theme }: { user: LocalUser | null; theme: CanvasTheme }) {
    if (user?.avatarUrl) return <img src={user.avatarUrl} alt={user.displayName || "用户"} className="size-8 shrink-0 rounded-full object-cover" />;
    return <span className="grid size-8 shrink-0 place-items-center rounded-full" style={{ background: theme.node.fill, color: theme.node.text }}><UserRound className="size-4" /></span>;
}

function readToolStatus(detail: unknown): string {
    if (typeof detail !== "object" || detail === null) return "";
    const status = (detail as Record<string, unknown>).status;
    return typeof status === "string" ? status : "";
}
