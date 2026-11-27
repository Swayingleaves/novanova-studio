"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Popover, Spin, Tooltip } from "antd";
import { AtSign, Clapperboard, MessageSquarePlus, Sparkles, X } from "lucide-react";

import { useTranslation } from "@/features/locale/use-translation";
import { ModelPicker } from "@/features/settings/components/model-picker";
import { useEffectiveConfig } from "@/features/settings/stores/use-config-store";
import { chatComicDramaAgent, getComicDramaAgentHistory, resetComicDramaAgentSession } from "@/services/api/comic-drama";
import {
    NanaApprovalCard,
    NanaChatBubble,
    NanaComposerShell,
    NanaHeaderStatus,
    NanaTaskTimeline,
    NanaThinkingRow,
} from "@/shared/components/nana-agent-ui";
import { useComicDramaStore } from "../stores/use-comic-drama-store";
import type {
    ComicDramaAgentActionSuggestion,
    ComicDramaAgentAppliedEdit,
    ComicDramaAgentHistoryMessage,
    ComicDramaShot,
} from "../types";

type ParsedMessageMeta = {
    appliedEdits?: ComicDramaAgentAppliedEdit[];
    suggestions?: ComicDramaAgentActionSuggestion[];
};

function parseMeta(raw?: string | null): ParsedMessageMeta {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw) as ParsedMessageMeta;
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

type ComicDramaAgentPanelProps = {
    /** 当前全局选中的分集标识（具体分集ID或 all）。 */
    episodeId: string;
    /** 当前分集下的镜头列表。 */
    episodeShots: ComicDramaShot[];
    /** 当前选中的镜头ID。 */
    selectedShotId: string | null;
    /** 被外部通过「@AI」引用的镜头ID列表。 */
    mentionedShotIds: string[];
    /** 移除某个引用镜头芯片。 */
    onRemoveMention: (shotId: string) => void;
    /** 清空全部引用镜头芯片。 */
    onClearMentions: () => void;
    /** 引用当前选中镜头。 */
    onAttachCurrentShot: () => void;
    /** 点击助手建议的动作卡片（打开对应确认弹窗或直接执行）。 */
    onExecuteSuggestion: (suggestion: ComicDramaAgentActionSuggestion) => void;
};

/** 漫剧工作台右侧 Nana助手对话面板（与画布 Nana助手保持一致的视觉、任务卡片与弹簧对话动效）。 */
export function ComicDramaAgentPanel({
    episodeId,
    episodeShots,
    selectedShotId,
    mentionedShotIds,
    onRemoveMention,
    onClearMentions,
    onAttachCurrentShot,
    onExecuteSuggestion,
}: ComicDramaAgentPanelProps) {
    const translate = useTranslation();
    const assistantName = translate("comicDrama.nanaAgent");
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const workspace = useComicDramaStore((state) => state.workspace);
    const reloadWorkspace = useComicDramaStore((state) => state.reloadWorkspace);

    const [messages, setMessages] = useState<ComicDramaAgentHistoryMessage[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [sending, setSending] = useState(false);
    const [animatingMsgId, setAnimatingMsgId] = useState<string | null>(null);
    const [draft, setDraft] = useState("");
    const [model, setModel] = useState("");
    const [quickMenuOpen, setQuickMenuOpen] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    const projectId = workspace?.projectId;

    useEffect(() => {
        if (!model && config.textModel) {
            setModel(config.textModel);
        }
    }, [config.textModel, model]);

    useEffect(() => {
        if (!projectId) return;
        let cancelled = false;
        setLoadingHistory(true);
        setAnimatingMsgId(null);
        getComicDramaAgentHistory(projectId)
            .then((res) => {
                if (!cancelled) setMessages(res.messages || []);
            })
            .catch(() => {
                if (!cancelled) setMessages([]);
            })
            .finally(() => {
                if (!cancelled) setLoadingHistory(false);
            });
        return () => {
            cancelled = true;
        };
    }, [projectId]);

    const scrollToBottom = useCallback(() => {
        const container = scrollRef.current;
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [messages, sending, scrollToBottom]);

    const selectedShot = useMemo(
        () => episodeShots.find((shot) => shot.id === selectedShotId) || null,
        [episodeShots, selectedShotId],
    );

    const episodeTitle = useMemo(() => {
        if (!workspace || !episodeId || episodeId === "all") return "全部分集";
        const ep = workspace.scriptProject.episodes.find((item) => item.id === episodeId);
        return ep ? `第${ep.episodeNumber}集${ep.title ? ` · ${ep.title}` : ""}` : "当前分集";
    }, [workspace, episodeId]);

    const quickPrompts = useMemo(() => {
        if (episodeShots.length === 0) {
            return [
                "帮我诊断这一集剧本，规划分镜节奏并建议出集方案",
                "按紧凑爽感短剧节奏，帮我拆分本集镜头",
            ];
        }
        const items: string[] = [];
        if (selectedShot) {
            items.push(`优化镜头 #${selectedShot.shotNumber} 的最终视频提示词，强化电影质感`);
            items.push(`把镜头 #${selectedShot.shotNumber} 的画面和对白改得更有戏剧张力`);
        }
        items.push("诊断本集还缺哪些资产、提示词和视频，给出一键补齐建议");
        return items.slice(0, 3);
    }, [episodeShots.length, selectedShot]);

    // 估算当前漫剧会话与本集分镜上下文的占用百分比（与画布 Nana助手口径一致：按 32k 窗口折算）。
    const contextUsagePercent = useMemo(() => {
        const recentHistoryChars = messages.slice(-12).reduce((sum, item) => sum + Math.min(item.text.length, 800), 0);
        const shotContextChars = episodeShots.length * 220 + mentionedShotIds.length * 160;
        const totalChars = recentHistoryChars + shotContextChars;
        if (totalChars === 0) return 0;
        return Math.min(99, Math.max(1, Math.round((totalChars / 2 / 32000) * 100)));
    }, [episodeShots.length, mentionedShotIds.length, messages]);

    const handleSend = async (overrideText?: string) => {
        if (!projectId || sending) return;
        const text = (typeof overrideText === "string" ? overrideText : draft).trim();
        if (!text) return;
        if (typeof overrideText !== "string") setDraft("");
        setQuickMenuOpen(false);

        const optimisticUser: ComicDramaAgentHistoryMessage = {
            id: `local_u_${Date.now()}`,
            role: "user",
            text,
            createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, optimisticUser]);
        const currentMentions = [...mentionedShotIds];
        onClearMentions();
        setSending(true);
        try {
            const response = await chatComicDramaAgent({
                projectId,
                episodeId: episodeId === "all" ? undefined : episodeId,
                selectedShotId: selectedShotId || undefined,
                mentionedShotIds: currentMentions.length > 0 ? currentMentions : undefined,
                message: text,
                model: model || config.textModel || undefined,
            });
            const meta = JSON.stringify({
                appliedEdits: response.appliedEdits,
                suggestions: response.suggestions,
            });
            setAnimatingMsgId(response.messageId);
            setMessages((prev) => [
                ...prev,
                {
                    id: response.messageId,
                    role: "assistant",
                    text: response.reply,
                    meta,
                    createdAt: new Date().toISOString(),
                },
            ]);
            if (response.workspaceChanged) {
                await reloadWorkspace();
                message.success(`已自动应用 ${response.appliedEdits.length} 个镜头的修改`);
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : `${assistantName}请求失败`);
        } finally {
            setSending(false);
        }
    };

    const handleReset = async () => {
        if (!projectId || sending) return;
        try {
            await resetComicDramaAgentSession(projectId);
            setMessages([]);
            setAnimatingMsgId(null);
            onClearMentions();
            message.success(`已开启新的${assistantName}对话`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "重置会话失败");
        }
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--studio-panel-solid)]">
            {/* 精简状态栏（与画布 Nana助手标题栏风格一致） */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--studio-line)] px-3.5 py-2 text-xs">
                <div className="flex min-w-0 items-center gap-1.5 text-[var(--studio-muted)]">
                    <span className="grid size-5 shrink-0 place-items-center rounded-md bg-[color-mix(in_srgb,var(--studio-ink)_8%,transparent)] text-[var(--studio-muted)]">
                        <Clapperboard className="size-3" />
                    </span>
                    <span className="truncate font-medium text-[var(--studio-ink)]">{episodeTitle}</span>
                    {selectedShot ? (
                        <span className="shrink-0 text-[var(--studio-muted)]">· #{selectedShot.shotNumber}</span>
                    ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <NanaHeaderStatus active={sending} />
                    <Tooltip title={translate("canvas.newConversation")}>
                        <button
                            type="button"
                            onClick={() => void handleReset()}
                            disabled={sending}
                            className="grid size-7 cursor-pointer place-items-center rounded-lg text-[var(--studio-muted)]! opacity-70 transition hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]! hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
                            aria-label={translate("canvas.newConversation")}
                        >
                            <MessageSquarePlus className="size-4" />
                        </button>
                    </Tooltip>
                </div>
            </div>

            {/* 对话消息流 */}
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                <div className="flex flex-col gap-3">
                    {loadingHistory ? (
                        <div className="flex items-center justify-center py-12">
                            <Spin size="small" />
                        </div>
                    ) : messages.length === 0 && !sending ? (
                        <div className="space-y-4 py-6">
                            <div className="text-center">
                                <div className="text-sm font-medium text-[var(--studio-ink)]">{assistantName}已就绪</div>
                                <p className="mt-1.5 text-xs leading-5 text-[var(--studio-muted)]">
                                    可以直接让我修改镜头画面、景别、对白或最终视频提示词（改完立即生效）；涉及拆镜头、补资产图、批量生视频或一键出集时，我会输出确认任务卡片。
                                </p>
                            </div>
                            <div className="space-y-1.5">
                                {quickPrompts.map((prompt) => (
                                    <button
                                        key={prompt}
                                        type="button"
                                        disabled={sending}
                                        onClick={() => void handleSend(prompt)}
                                        className="block w-full cursor-pointer rounded-xl border border-[var(--studio-line)] bg-[color-mix(in_srgb,var(--studio-ink)_3%,var(--studio-panel-solid))] px-3 py-2 text-left text-xs! leading-5 text-[var(--studio-text)]! transition-colors hover:border-[var(--studio-primary-line)] hover:text-[var(--studio-ink)]! disabled:opacity-50"
                                    >
                                        {prompt}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        messages.map((item) => {
                            if (item.role === "user") {
                                return <NanaChatBubble key={item.id} role="user" text={item.text} />;
                            }
                            const meta = parseMeta(item.meta);
                            const edits = meta.appliedEdits || [];
                            const suggestions = meta.suggestions || [];
                            return (
                                <div key={item.id} className="space-y-2">
                                    {edits.length > 0 ? (
                                        <NanaThinkingRow
                                            title="执行步骤"
                                            preview={`已修订 ${edits.length} 个镜头`}
                                            steps={edits.map((edit) => ({
                                                id: `${edit.shotId}-${edit.shotNumber}`,
                                                label: `更新镜头 #${edit.shotNumber}：${edit.updatedFields.join("、")}`,
                                                status: "done",
                                            }))}
                                        />
                                    ) : null}

                                    <NanaChatBubble
                                        role="assistant"
                                        text={item.text}
                                        animated={item.id === animatingMsgId}
                                        onHeightChange={scrollToBottom}
                                    />

                                    {edits.length > 0 ? (
                                        <NanaTaskTimeline
                                            title={`已自动生效 ${edits.length} 项镜头修订`}
                                            status="done"
                                            summary="已落库"
                                            defaultExpanded={item.id === animatingMsgId}
                                            items={edits.map((edit) => ({
                                                id: `${edit.shotId}-${edit.shotNumber}`,
                                                name: `镜头 #${edit.shotNumber}`,
                                                meta: edit.updatedFields.join("、"),
                                                status: "done",
                                                statusText: "已生效",
                                            }))}
                                        />
                                    ) : null}

                                    {suggestions.map((suggestion, index) => (
                                        <NanaApprovalCard
                                            key={`${suggestion.actionType}-${index}`}
                                            title={`待确认操作 · ${suggestion.label}`}
                                            description={suggestion.description}
                                            actions={
                                                <Button
                                                    size="small"
                                                    type={suggestion.actionType === "oneClickEpisode" ? "primary" : "default"}
                                                    onClick={() => onExecuteSuggestion(suggestion)}
                                                >
                                                    批准并确认预算
                                                </Button>
                                            }
                                        />
                                    ))}
                                </div>
                            );
                        })
                    )}

                    {sending ? (
                        <NanaThinkingRow
                            active
                            showBubble
                            preview={`分析 ${episodeTitle}${selectedShot ? ` · 镜头 #${selectedShot.shotNumber}` : ""} 上下文…`}
                            thinkingLabel={translate("chat.thinking")}
                        />
                    ) : null}
                </div>
            </div>

            {/* 底部圆角输入卡片（与画布 AgentChatComposer 结构一致） */}
            <NanaComposerShell
                value={draft}
                disabled={sending}
                sending={sending}
                canSubmit={Boolean(draft.trim())}
                placeholder={`告诉${assistantName}如何修改镜头、重写提示词或规划本集出片…（Enter 发送）`}
                onChange={setDraft}
                onSubmit={() => void handleSend()}
                topBar={
                    <>
                        <span className="inline-flex max-w-[180px] items-center gap-1 rounded-md border border-[var(--studio-line)] bg-[color-mix(in_srgb,var(--studio-ink)_6%,transparent)] px-2 py-0.5 text-[11px] text-[var(--studio-ink)]">
                            <Clapperboard className="size-3 shrink-0 opacity-70" />
                            <span className="truncate">{episodeTitle}</span>
                        </span>
                        {mentionedShotIds.map((shotId) => {
                            const shot = episodeShots.find((item) => item.id === shotId);
                            if (!shot) return null;
                            return (
                                <span
                                    key={shotId}
                                    className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px]"
                                    style={{
                                        background: "color-mix(in srgb, #f59e0b 16%, transparent)",
                                        color: "#f59e0b",
                                    }}
                                >
                                    <span>@#{shot.shotNumber}</span>
                                    <button
                                        type="button"
                                        onClick={() => onRemoveMention(shotId)}
                                        className="cursor-pointer opacity-75 hover:opacity-100"
                                        aria-label={`移除引用镜头 #${shot.shotNumber}`}
                                    >
                                        <X className="size-3" />
                                    </button>
                                </span>
                            );
                        })}
                    </>
                }
                leftControls={
                    <>
                        <button
                            type="button"
                            onClick={onAttachCurrentShot}
                            disabled={!selectedShot}
                            className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-full px-2 text-xs! text-[var(--studio-muted)]! opacity-85 transition hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]! hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-35"
                        >
                            <AtSign className="size-3.5" />
                            <span>引用当前镜</span>
                        </button>

                        <Popover
                            open={quickMenuOpen}
                            onOpenChange={setQuickMenuOpen}
                            trigger="click"
                            placement="topLeft"
                            content={
                                <div className="w-72 space-y-1">
                                    <div className="mb-1 text-[11px] font-semibold text-[var(--studio-muted)]">快捷指令</div>
                                    {quickPrompts.map((prompt) => (
                                        <button
                                            key={prompt}
                                            type="button"
                                            onClick={() => void handleSend(prompt)}
                                            className="block w-full cursor-pointer rounded-md px-2.5 py-1.5 text-left text-xs! leading-5 text-[var(--studio-ink)]! transition-colors hover:bg-[var(--studio-surface-hover)]"
                                        >
                                            {prompt}
                                        </button>
                                    ))}
                                </div>
                            }
                        >
                            <button
                                type="button"
                                className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-full px-2 text-xs! text-[var(--studio-muted)]! opacity-85 transition hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]! hover:opacity-100"
                            >
                                <Sparkles className="size-3.5" />
                                <span>快捷指令</span>
                            </button>
                        </Popover>
                    </>
                }
                contextUsagePercent={contextUsagePercent}
                rightControls={
                    <ModelPicker
                        config={config}
                        value={model}
                        onChange={setModel}
                        capability="text"
                        showChannel={false}
                        className="h-7 max-w-[156px]"
                        placeholder={translate("canvas.selectTextModel")}
                    />
                }
            />
        </div>
    );
}
