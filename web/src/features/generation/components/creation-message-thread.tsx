"use client";

import { Button, Tooltip } from "antd";
import { ArrowRight, Copy } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { useRouter } from "next/navigation";

import { AgentActivityTimeline } from "@/features/generation/components/agent-activity-timeline";
import type { CreationMessageThreadProps } from "@/features/generation/components/creation-workspace-types";
import { ThinkingBlock } from "@/features/chat";
import { useCopyText } from "@/shared/hooks/use-copy-text";
import { storeInitialPromptForNavigation } from "@/shared/lib/initial-prompt";

const AT_BOTTOM_THRESHOLD = 48;

export function CreationMessageThread({ sections, emptyState, onAtBottomChange }: CreationMessageThreadProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const keepPinnedToBottomRef = useRef(true);
    const latestFreshUserRoundIdRef = useRef<string | null>(null);
    const copyText = useCopyText();
    const router = useRouter();

    const isAtBottom = () => {
        const el = scrollRef.current;
        return !el || el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_THRESHOLD;
    };

    const scrollToBottom = () => {
        const el = scrollRef.current;
        if (!el) {
            return;
        }
        el.scrollTop = el.scrollHeight;
    };

    const latestSection = sections[sections.length - 1];
    const latestRound = latestSection?.rounds[latestSection.rounds.length - 1];
    const latestFreshUserRoundId = latestRound?.userText && !latestRound.statusText && !latestRound.assistantText && !latestRound.resultContent ? latestRound.id : null;
    const hasNewFreshUserRound = latestFreshUserRoundId !== null && latestFreshUserRoundId !== latestFreshUserRoundIdRef.current;

    // 内容新增后，如果用户原本就在底部，或首次出现新的用户消息，则自动贴到底部。
    useLayoutEffect(() => {
        if (keepPinnedToBottomRef.current || hasNewFreshUserRound) {
            scrollToBottom();
            keepPinnedToBottomRef.current = true;
            onAtBottomChange?.(true);
        } else {
            onAtBottomChange?.(isAtBottom());
        }
        latestFreshUserRoundIdRef.current = latestFreshUserRoundId;
    }, [hasNewFreshUserRound, latestFreshUserRoundId, onAtBottomChange, sections]);

    const handleScroll = () => {
        const atBottom = isAtBottom();
        keepPinnedToBottomRef.current = atBottom;
        onAtBottomChange?.(atBottom);
    };

    return (
        <div ref={scrollRef} className="thin-scrollbar min-h-0 flex-1 overflow-y-auto" onScroll={handleScroll}>
            {sections.length ? (
                <div className="mx-auto w-full max-w-5xl px-4 pb-64 pt-6 sm:px-6">
                    {sections.map((section) => (
                        <section key={section.id} className="mb-10 last:mb-0">
                            <div className="mb-5 flex items-center gap-3">
                                <h2 className="text-sm font-semibold text-[var(--studio-muted)]">{section.label}</h2>
                                <div className="h-px flex-1 bg-[var(--studio-line)]" />
                            </div>
                            <div className="space-y-8">
                                {section.rounds.map((round) => (
                                    <article key={round.id} className="space-y-4">
                                        {round.userText || round.userAttachments ? (
                                            <div className="flex justify-end">
                                                <div className="group flex w-fit max-w-[92%] flex-col items-end sm:max-w-[82%]">
                                                    {round.userAttachments ? <div className="mb-3">{round.userAttachments}</div> : null}
                                                    {round.userText ? (
                                                        <div className="relative rounded-[28px] bg-[rgba(83,96,116,0.08)] px-5 py-4 pr-14">
                                                            <MessageCopyButton
                                                                side="right"
                                                                placement="inside"
                                                                onClick={() => copyText(round.userCopyText || round.userText, "用户消息已复制")}
                                                            />
                                                            <p className="whitespace-pre-wrap text-sm leading-7 text-[var(--studio-ink)] sm:text-[15px]">{round.userText}</p>
                                                        </div>
                                                    ) : null}
                                                </div>
                                            </div>
                                        ) : null}
                                        <div className="space-y-3">
                                            {round.thinkings?.map((thinking) => (
                                                <ThinkingBlock key={thinking.id} block={thinking} streaming={round.activeThinkingId === thinking.id} />
                                            ))}
                                            {round.activities?.length ? <AgentActivityTimeline activities={round.activities} /> : null}
                                            {round.statusText ? <div className="text-xs font-medium text-[var(--studio-muted)]">{round.statusText}</div> : null}
                                            {round.assistantText ? (
                                                <div className="group inline-flex max-w-3xl items-start gap-2">
                                                    <div className="min-w-0 flex-1">
                                                        <div className="prose prose-sm max-w-none text-sm leading-7 text-[var(--studio-ink)] dark:prose-invert">
                                                            <ReactMarkdown>{round.assistantText}</ReactMarkdown>
                                                        </div>
                                                    </div>
                                                    <MessageCopyButton
                                                        side="right"
                                                        placement="inline"
                                                        onClick={() => copyText(round.assistantText || "", "助手消息已复制")}
                                                    />
                                                </div>
                                            ) : null}
                                            {round.resultContent}
                                            {round.action?.type === "navigate" ? (
                                                <div className="pt-1">
                                                    <Button
                                                        type="primary"
                                                        size="small"
                                                        icon={<ArrowRight className="size-3.5" />}
                                                        onClick={() => {
                                                            const action = round.action;
                                                            if (!action || action.type !== "navigate") return;
                                                            if (action.initialPrompt) storeInitialPromptForNavigation(action.initialPrompt);
                                                            router.push(action.href);
                                                        }}
                                                    >
                                                        {round.action.label}
                                                    </Button>
                                                </div>
                                            ) : null}
                                            {round.actionBar ? <div className="pt-1">{round.actionBar}</div> : null}
                                        </div>
                                    </article>
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
            ) : (
                emptyState
            )}
        </div>
    );
}

function MessageCopyButton({
    onClick,
    side,
    placement = "edge",
}: {
    onClick: () => void;
    side: "left" | "right";
    placement?: "inside" | "edge" | "inline";
}) {
    const positionStyle: CSSProperties | undefined = placement === "inline"
        ? undefined
        : placement === "inside"
        ? (side === "left" ? { top: 8, left: 8 } : { top: 8, right: 8 })
        : (side === "left" ? { top: 0, left: 8, transform: "translateY(-50%)" } : { top: 0, right: 8, transform: "translateY(-50%)" });
    const className = placement === "inline"
        ? "!relative !mt-1 !h-8 !w-8 !min-w-0 !shrink-0 !self-start !rounded-full !border !border-[var(--studio-line)] !bg-[var(--studio-panel-solid)] !p-0 !text-[var(--studio-muted)] opacity-0 pointer-events-none shadow-sm transition group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto hover:!border-[var(--studio-primary-line)] hover:!text-[var(--studio-ink)]"
        : "!absolute z-10 !h-8 !w-8 !min-w-0 !rounded-full !border !border-[var(--studio-line)] !bg-[var(--studio-panel-solid)] !p-0 !text-[var(--studio-muted)] opacity-0 pointer-events-none shadow-sm transition group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto hover:!border-[var(--studio-primary-line)] hover:!text-[var(--studio-ink)]";
    return (
        <Tooltip title="复制消息">
            <Button
                size="small"
                type="text"
                aria-label="复制消息"
                style={positionStyle}
                className={className}
                icon={<Copy className="size-3.5" />}
                onClick={onClick}
            />
        </Tooltip>
    );
}
