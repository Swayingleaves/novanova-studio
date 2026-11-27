"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Spin } from "antd";
import { ArrowUp, AtSign, CheckCircle2, Plus, Sparkles, X } from "lucide-react";

import { useTranslation } from "@/features/locale/use-translation";
import { ModelPicker } from "@/features/settings/components/model-picker";
import { useEffectiveConfig } from "@/features/settings/stores/use-config-store";
import { chatComicDramaAgent, getComicDramaAgentHistory, resetComicDramaAgentSession } from "@/services/api/comic-drama";
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

/** 漫剧工作台右侧 AI 制片助手对话面板。 */
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
    const [draft, setDraft] = useState("");
    const [model, setModel] = useState("");
    const [showModelPicker, setShowModelPicker] = useState(false);
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

    useEffect(() => {
        const container = scrollRef.current;
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }, [messages, sending]);

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

    const handleSend = async (overrideText?: string) => {
        if (!projectId || sending) return;
        const text = (typeof overrideText === "string" ? overrideText : draft).trim();
        if (!text) return;
        if (typeof overrideText !== "string") setDraft("");

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
            onClearMentions();
            message.success(`已开启新的${assistantName}对话`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "重置会话失败");
        }
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--studio-surface)]">
            {/* 上下文感知条 */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--studio-line)] px-3.5 py-2 text-xs text-[var(--studio-muted)]">
                <div className="min-w-0 truncate">
                    <span>上下文：</span>
                    <strong className="font-medium text-[var(--studio-ink)]">{episodeTitle}</strong>
                    {selectedShot ? (
                        <span className="ml-1.5 text-[var(--studio-ink)]">· #{selectedShot.shotNumber}</span>
                    ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <button
                        type="button"
                        onClick={() => setShowModelPicker((prev) => !prev)}
                        className="cursor-pointer rounded px-1.5 py-0.5 text-xs! text-[var(--studio-muted)]! hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]!"
                        title="切换对话模型"
                    >
                        模型
                    </button>
                    <button
                        type="button"
                        onClick={() => void handleReset()}
                        className="inline-flex size-6 cursor-pointer items-center justify-center rounded text-[var(--studio-muted)]! hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]!"
                        title="新建对话"
                        aria-label="新建对话"
                    >
                        <Plus className="size-3.5" />
                    </button>
                </div>
            </div>

            {showModelPicker ? (
                <div className="shrink-0 border-b border-[var(--studio-line)] bg-[var(--studio-surface-raised)] px-3.5 py-2">
                    <label className="mb-1 block text-xs text-[var(--studio-muted)]">{assistantName}文本模型</label>
                    <ModelPicker config={config} capability="text" value={model} onChange={setModel} fullWidth />
                </div>
            ) : null}

            {/* 对话消息流 */}
            <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3.5">
                {loadingHistory ? (
                    <div className="flex items-center justify-center py-10">
                        <Spin size="small" />
                    </div>
                ) : messages.length === 0 ? (
                    <div className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-page)] p-3.5 text-xs leading-5 text-[var(--studio-muted)]">
                        <div className="mb-1 flex items-center gap-1.5 font-semibold text-[var(--studio-ink)]">
                            <Sparkles className="size-3.5 text-[var(--studio-action)]" />
                            <span>{assistantName}已就绪</span>
                        </div>
                        <p>
                            你可以直接让我改某个镜头的画面、景别、对白或最终视频提示词（改完立即生效）；涉及拆镜头、补资产图、批量生视频或一键出集时，我会给出动作卡片并在确认预算后执行。
                        </p>
                    </div>
                ) : (
                    messages.map((item) => {
                        if (item.role === "user") {
                            return (
                                <div key={item.id} className="flex justify-end">
                                    <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-lg border border-[var(--studio-line-strong)] bg-[var(--studio-surface-raised)] px-3 py-2 text-xs leading-5 text-[var(--studio-ink)]">
                                        {item.text}
                                    </div>
                                </div>
                            );
                        }
                        const meta = parseMeta(item.meta);
                        const edits = meta.appliedEdits || [];
                        const suggestions = meta.suggestions || [];
                        return (
                            <div key={item.id} className="space-y-1.5">
                                <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--studio-ink)]">
                                    <span
                                        className="flex size-5 items-center justify-center rounded text-[11px] font-semibold"
                                        style={{ background: "var(--studio-action)", color: "var(--studio-action-foreground)" }}
                                    >
                                        AI
                                    </span>
                                    <span>{assistantName}</span>
                                </div>
                                <div className="space-y-2.5 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-page)] p-3 text-xs leading-5 text-[var(--studio-text)]">
                                    <div className="whitespace-pre-wrap break-words">{item.text}</div>

                                    {edits.length > 0 ? (
                                        <div className="space-y-1 rounded-md border border-[var(--studio-line)] bg-[var(--studio-surface)] p-2">
                                            <div className="text-[11px] font-semibold text-[var(--studio-success)]">已直接生效的修改</div>
                                            {edits.map((edit) => (
                                                <div key={`${edit.shotId}-${edit.shotNumber}`} className="flex items-center gap-1.5 text-xs text-[var(--studio-ink)]">
                                                    <CheckCircle2 className="size-3.5 shrink-0 text-[var(--studio-success)]" />
                                                    <span>
                                                        镜头 #{edit.shotNumber}：{edit.updatedFields.join("、")}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : null}

                                    {suggestions.length > 0 ? (
                                        <div className="space-y-1.5 border-t border-[var(--studio-line)] pt-2">
                                            {suggestions.map((suggestion, index) => (
                                                <div
                                                    key={`${suggestion.actionType}-${index}`}
                                                    className="flex items-center justify-between gap-2 rounded-md border border-[var(--studio-line)] bg-[var(--studio-surface)] px-2.5 py-2"
                                                >
                                                    <div className="min-w-0">
                                                        <div className="truncate text-xs font-medium text-[var(--studio-ink)]">{suggestion.label}</div>
                                                        {suggestion.description ? (
                                                            <div className="truncate text-[11px] text-[var(--studio-muted)]">{suggestion.description}</div>
                                                        ) : null}
                                                    </div>
                                                    <Button
                                                        size="small"
                                                        type={suggestion.actionType === "oneClickEpisode" ? "primary" : "default"}
                                                        onClick={() => onExecuteSuggestion(suggestion)}
                                                    >
                                                        去确认
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        );
                    })
                )}

                {sending ? (
                    <div className="flex items-center gap-2 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-page)] px-3 py-2 text-xs text-[var(--studio-muted)]">
                        <Spin size="small" />
                        <span>{assistantName}正在分析当前分集并生成修改...</span>
                    </div>
                ) : null}
            </div>

            {/* 快捷指令 + 输入区 */}
            <div className="shrink-0 border-t border-[var(--studio-line)] bg-[var(--studio-rail)] p-3">
                <div className="mb-2 flex flex-wrap gap-1.5">
                    {quickPrompts.map((prompt) => (
                        <button
                            key={prompt}
                            type="button"
                            disabled={sending}
                            onClick={() => void handleSend(prompt)}
                            className="max-w-full cursor-pointer truncate rounded-md border border-[var(--studio-line)] bg-[var(--studio-surface)] px-2 py-1 text-xs! text-[var(--studio-muted)]! transition-colors hover:border-[var(--studio-line-strong)] hover:text-[var(--studio-ink)]! disabled:opacity-50"
                            title={prompt}
                        >
                            {prompt}
                        </button>
                    ))}
                </div>

                <div className="rounded-lg border border-[var(--studio-line-strong)] bg-[var(--studio-surface)] p-2 focus-within:border-[var(--studio-action)]">
                    {mentionedShotIds.length > 0 ? (
                        <div className="mb-1.5 flex flex-wrap items-center gap-1">
                            {mentionedShotIds.map((shotId) => {
                                const shot = episodeShots.find((item) => item.id === shotId);
                                if (!shot) return null;
                                return (
                                    <span
                                        key={shotId}
                                        className="inline-flex items-center gap-1 rounded border border-[var(--studio-line-strong)] bg-[var(--studio-surface-raised)] px-1.5 py-0.5 text-xs font-medium text-[var(--studio-ink)]"
                                    >
                                        <span>@#{shot.shotNumber}</span>
                                        <button
                                            type="button"
                                            onClick={() => onRemoveMention(shotId)}
                                            className="cursor-pointer text-[var(--studio-muted)]! hover:text-[var(--studio-ink)]!"
                                            aria-label={`移除引用镜头 #${shot.shotNumber}`}
                                        >
                                            <X className="size-3" />
                                        </button>
                                    </span>
                                );
                            })}
                        </div>
                    ) : null}

                    <textarea
                        rows={2}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey) {
                                event.preventDefault();
                                void handleSend();
                            }
                        }}
                        placeholder={`告诉${assistantName}如何修改镜头、重写提示词或规划本集出片…（Enter 发送）`}
                        className="w-full resize-none bg-transparent text-xs leading-5 text-[var(--studio-ink)] outline-none placeholder:text-[var(--studio-faint)]"
                    />

                    <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-[var(--studio-line)] pt-1.5">
                        <button
                            type="button"
                            onClick={onAttachCurrentShot}
                            disabled={!selectedShot}
                            className="inline-flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs! text-[var(--studio-muted)]! hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]! disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            <AtSign className="size-3.5" />
                            <span>引用当前镜</span>
                        </button>

                        <button
                            type="button"
                            disabled={sending || !draft.trim()}
                            onClick={() => void handleSend()}
                            style={{ background: "var(--studio-action)", color: "var(--studio-action-foreground)" }}
                            className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-3 text-xs! font-semibold text-[var(--studio-action-foreground)]! transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                            <span>发送</span>
                            <ArrowUp className="size-3.5" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
