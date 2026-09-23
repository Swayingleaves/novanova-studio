"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, App, Button, Card, Empty, Input, Modal, Select, Space, Tag } from "antd";
import { Check, Copy, History, Sparkles } from "lucide-react";

import { ModelPicker } from "@/features/settings/components/model-picker";
import { useEffectiveConfig } from "@/features/settings/stores/use-config-store";
import { useComicDramaStore } from "../stores/use-comic-drama-store";
import type { ComicDramaPromptVersion, ComicDramaShot } from "../types";

/** 镜头提示词制作与版本管理阶段视图。 */
export function StagePrompts() {
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const workspace = useComicDramaStore((state) => state.workspace);
    const composePrompt = useComicDramaStore((state) => state.composePrompt);
    const savePrompt = useComicDramaStore((state) => state.savePrompt);
    const selectedShotId = useComicDramaStore((state) => state.selectedShotId);
    const setSelectedShotId = useComicDramaStore((state) => state.setSelectedShotId);

    const shots = workspace?.shots || [];
    const promptVersions = workspace?.promptVersions || [];

    // Current active shot for prompt crafting
    const activeShot = useMemo(() => {
        if (selectedShotId) {
            return shots.find((s) => s.id === selectedShotId) || shots[0] || null;
        }
        return shots[0] || null;
    }, [shots, selectedShotId]);

    // Versions for active shot
    const activeShotVersions = useMemo(() => {
        if (!activeShot) return [];
        return promptVersions
            .filter((p) => p.shotId === activeShot.id)
            .sort((a, b) => b.versionNumber - a.versionNumber);
    }, [promptVersions, activeShot]);

    const latestVersion = activeShotVersions[0] || null;

    // Local editor prompt text
    const [editorText, setEditorText] = useState<string>("");
    const [composing, setComposing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [aiModel, setAiModel] = useState<string>("");

    // Sync editor text with latest version or shot description
    useEffect(() => {
        if (latestVersion) {
            setEditorText(latestVersion.prompt);
        } else if (activeShot) {
            setEditorText(
                `${activeShot.visualDescription || ""}，${activeShot.shotSize || "中景"}，${activeShot.cameraMovement || "固定镜头"}。${workspace?.settings.visualStyle || ""}`
            );
        } else {
            setEditorText("");
        }
    }, [latestVersion, activeShot, workspace?.settings.visualStyle]);

    useEffect(() => {
        if (!aiModel && config.textModel) {
            setAiModel(config.textModel);
        }
    }, [config.textModel, aiModel]);

    if (!workspace) return null;

    // AI Compose Prompt
    const handleCompose = async () => {
        if (!activeShot) return;
        if (!aiModel) {
            message.warning("请选择 AI 合成模型");
            return;
        }
        setComposing(true);
        try {
            const prompt = await composePrompt(activeShot.id, aiModel);
            setEditorText(prompt.prompt);
            message.success(`镜头 #${activeShot.shotNumber} 提示词已合成 (版本 v${prompt.versionNumber})`);
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        } finally {
            setComposing(false);
        }
    };

    // Save prompt manually as a new version
    const handleSaveManual = async () => {
        if (!activeShot) return;
        if (!editorText.trim()) {
            message.warning("提示词内容不能为空");
            return;
        }
        setSaving(true);
        try {
            const prompt = await savePrompt(activeShot.id, editorText.trim());
            message.success(`已保存为新版本 v${prompt.versionNumber}`);
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        } finally {
            setSaving(false);
        }
    };

    const copyPrompt = () => {
        if (!editorText) return;
        navigator.clipboard.writeText(editorText);
        message.success("提示词已复制到剪贴板");
    };

    return (
        <div className="flex flex-col gap-6">
            <header className="flex flex-col gap-2 border-b border-[var(--studio-line)] pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-[var(--studio-ink)]">镜头提示词制作 (Prompt Studio)</h2>
                    <p className="mt-1 text-sm text-[var(--studio-muted)]">
                        根据剧本片段、构图景别、动作调度、角色设定与项目视觉风格，自动合成并调优面向生图与生视频模型的结构化提示词。
                    </p>
                </div>
            </header>

            {shots.length === 0 ? (
                <Empty description="暂无镜头，请先完成镜头拆分" />
            ) : (
                <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
                    {/* Left: Shot Selector Sidebar */}
                    <div className="flex flex-col gap-2 rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-3">
                        <div className="text-xs font-semibold text-[var(--studio-muted)]">选择镜头</div>
                        <div className="flex max-h-[600px] flex-col gap-1.5 overflow-y-auto pr-1">
                            {shots.map((shot) => {
                                const hasPrompt = promptVersions.some((p) => p.shotId === shot.id);
                                const isSelected = activeShot?.id === shot.id;
                                return (
                                    <button
                                        key={shot.id}
                                        type="button"
                                        className={`flex items-center justify-between rounded-lg p-2.5 text-left text-xs transition-colors ${
                                            isSelected
                                                ? "bg-[var(--studio-primary)] font-semibold text-[var(--studio-action-foreground)] shadow-sm"
                                                : "text-[var(--studio-ink)] hover:bg-[var(--studio-line)]"
                                        }`}
                                        onClick={() => setSelectedShotId(shot.id)}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="font-mono font-bold">#{shot.shotNumber}</span>
                                            <span className="truncate max-w-[120px]">{shot.shotSize || "镜头"}</span>
                                        </div>
                                        <Tag
                                            className={`text-[10px] ${isSelected ? "!border-none !bg-black/20 !text-[var(--studio-action-foreground)] font-medium" : ""}`}
                                            color={isSelected ? undefined : hasPrompt ? "green" : "default"}
                                        >
                                            {hasPrompt ? "已合成" : "未制作"}
                                        </Tag>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Right: Active Shot Prompt Editor & Version History */}
                    {activeShot ? (
                        <div className="flex flex-col gap-5">
                            {/* Shot Context Summary */}
                            <div className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        <span className="rounded bg-[var(--studio-line)] px-2 py-0.5 font-mono text-sm font-bold text-[var(--studio-ink)]">
                                            镜头 #{activeShot.shotNumber}
                                        </span>
                                        <Tag color="cyan">{activeShot.shotSize || "未定景别"}</Tag>
                                        <Tag color="geekblue">{activeShot.cameraMovement || "固定镜头"}</Tag>
                                        <span className="text-xs text-[var(--studio-muted)]">
                                            预计 {activeShot.durationSeconds}s
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        <div className="w-44">
                                            <ModelPicker
                                                config={config}
                                                capability="text"
                                                value={aiModel}
                                                onChange={setAiModel}
                                                fullWidth
                                            />
                                        </div>
                                        <Button
                                            type="primary"
                                            loading={composing}
                                            icon={<Sparkles className="size-4" />}
                                            onClick={handleCompose}
                                        >
                                            AI 合成提示词
                                        </Button>
                                    </div>
                                </div>

                                <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
                                    <div>
                                        <span className="text-[var(--studio-muted)]">画面描述：</span>
                                        <p className="mt-0.5 text-[var(--studio-text)]">
                                            {activeShot.visualDescription || "暂无描述"}
                                        </p>
                                    </div>
                                    <div>
                                        <span className="text-[var(--studio-muted)]">对白旁白：</span>
                                        <p className="mt-0.5 italic text-[var(--studio-text)]">
                                            {activeShot.dialogueVoiceover || "无"}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Prompt Text Editor */}
                            <div className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-4">
                                <div className="mb-2 flex items-center justify-between">
                                    <span className="text-sm font-semibold text-[var(--studio-ink)]">
                                        最终结构化提示词
                                    </span>
                                    <Space size="small">
                                        <Button size="small" icon={<Copy className="size-3.5" />} onClick={copyPrompt}>
                                            复制
                                        </Button>
                                        <Button
                                            size="small"
                                            type="primary"
                                            loading={saving}
                                            icon={<Check className="size-3.5" />}
                                            onClick={handleSaveManual}
                                        >
                                            保存为新版本
                                        </Button>
                                    </Space>
                                </div>

                                <Input.TextArea
                                    rows={6}
                                    value={editorText}
                                    onChange={(e) => setEditorText(e.target.value)}
                                    placeholder="在此编辑用于生图或生视频模型的结构化提示词..."
                                />

                                <div className="mt-2 text-xs text-[var(--studio-muted)]">
                                    提示：重新合成或手动修改后均会自动保存不可变历史版本，避免误覆盖已有成果。
                                </div>
                            </div>

                            {/* Version History List */}
                            {activeShotVersions.length > 0 && (
                                <div className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-4">
                                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--studio-ink)]">
                                        <History className="size-4" />
                                        <span>历史版本记录 ({activeShotVersions.length})</span>
                                    </div>

                                    <div className="flex flex-col gap-2">
                                        {activeShotVersions.map((v) => (
                                            <div
                                                key={v.id}
                                                className="flex items-start justify-between gap-4 rounded-lg border border-[var(--studio-line)] p-3 text-xs transition-colors hover:border-[var(--studio-line-strong)]"
                                            >
                                                <div className="flex flex-col gap-1">
                                                    <div className="flex items-center gap-2">
                                                        <Tag color="purple">v{v.versionNumber}</Tag>
                                                        <span className="font-semibold text-[var(--studio-ink)]">
                                                            {v.sourceType === "ai" ? "AI 智能合成" : "人工编辑保存"}
                                                        </span>
                                                        {v.model && <Tag>{v.model}</Tag>}
                                                        {v.chargedCredits > 0 && (
                                                            <span className="text-[var(--studio-muted)]">
                                                                消耗 {v.chargedCredits} 积分
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="line-clamp-2 text-[var(--studio-text)]">
                                                        {v.prompt}
                                                    </p>
                                                </div>

                                                <Button
                                                    size="small"
                                                    onClick={() => setEditorText(v.prompt)}
                                                >
                                                    回填至编辑器
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : null}
                </div>
            )}
        </div>
    );
}
