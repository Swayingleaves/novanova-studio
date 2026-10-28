"use client";

import { creditAmount, creditText } from "@/shared/lib/credit-amounts";

import { productionParameterLabel } from "../lib/production-labels";

import { useTranslation } from "@/features/locale/use-translation";

import { useEffect, useMemo, useState } from "react";
import { Alert, App, Button, Card, Empty, Input, Modal, Select, Space, Tag } from "antd";
import { Check, Copy, History, Sparkles } from "lucide-react";

import { ModelPicker } from "@/features/settings/components/model-picker";
import { useEffectiveConfig } from "@/features/settings/stores/use-config-store";
import { useComicDramaStore } from "../stores/use-comic-drama-store";
import type { ComicDramaPromptVersion, ComicDramaShot } from "../types";
import { fullPromptWithBody, readPromptBody } from "../lib/prompt-references";
import { PromptReferenceInstructions } from "./prompt-reference-instructions";

/** 镜头提示词制作与版本管理阶段视图。 */
export function StagePrompts() {
    const translate = useTranslation();
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
    const [editorSource, setEditorSource] = useState<ComicDramaPromptVersion | null>(null);
    const [composing, setComposing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [aiModel, setAiModel] = useState<string>("");

    // 仅在镜头或最新版本切换时重置，后台刷新不能覆盖未保存正文及已选择的历史来源。
    useEffect(() => {
        setEditorSource(latestVersion);
        if (latestVersion) {
            setEditorText(readPromptBody(latestVersion));
        } else if (activeShot) {
            setEditorText(
                `${activeShot.visualDescription || ""}，${activeShot.shotSize || translate("comicDrama.mediumShot")}，${activeShot.cameraMovement || translate("comicDrama.staticCamera")}。${workspace?.settings.visualStyle || ""}`
            );
        } else {
            setEditorText("");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [latestVersion?.id, activeShot?.id]);

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
            message.warning(translate("comicDrama.selectAnAiPromptModel"));
            return;
        }
        setComposing(true);
        try {
            const prompt = await composePrompt(activeShot.id, aiModel);
            setEditorSource(prompt);
            setEditorText(readPromptBody(prompt));
            message.success(translate("comicDrama.shotCountPromptGeneratedVCount", { value0: activeShot.shotNumber, value1: prompt.versionNumber }));
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
            message.warning(translate("comicDrama.promptCannotBeEmpty"));
            return;
        }
        setSaving(true);
        try {
            const prompt = await savePrompt(activeShot.id, editorText.trim(), latestVersion?.versionNumber, editorSource?.id);
            message.success(translate("comicDrama.savedAsNewVersionVCount", { value0: prompt.versionNumber }));
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        } finally {
            setSaving(false);
        }
    };

    const copyPrompt = () => {
        if (!editorText) return;
        navigator.clipboard.writeText(fullPromptWithBody(editorText, editorSource));
        message.success(translate("comicDrama.promptCopiedToClipboard"));
    };

    return (
        <div className="flex flex-col gap-6">
            <header className="flex flex-col gap-2 border-b border-[var(--studio-line)] pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-[var(--studio-ink)]">{translate("comicDrama.shotPromptStudio")}</h2>
                    <p className="mt-1 text-sm text-[var(--studio-muted)]">
                        {translate("comicDrama.generateAndRefineStructuredImageAndVideoPromptsFromScript")}</p>
                </div>
            </header>

            {shots.length === 0 ? (
                <Empty description={translate("comicDrama.noShotsYetCompleteShotBreakdownFirst")} />
            ) : (
                <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
                    {/* Left: Shot Selector Sidebar */}
                    <div className="flex flex-col gap-2 rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-3">
                        <div className="text-xs font-semibold text-[var(--studio-muted)]">{translate("comicDrama.selectShot")}</div>
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
                                            <span className="truncate max-w-[120px]">{productionParameterLabel(shot.shotSize || "", translate) || translate("comicDrama.shot_c7d192")}</span>
                                        </div>
                                        <Tag
                                            className={`text-[10px] ${isSelected ? "!border-none !bg-black/20 !text-[var(--studio-action-foreground)] font-medium" : ""}`}
                                            color={isSelected ? undefined : hasPrompt ? "green" : "default"}
                                        >
                                            {hasPrompt ? translate("comicDrama.generated") : translate("comicDrama.notCreated")}
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
                                        <span className="rounded bg-[var(--studio-line)] px-2 py-0.5 font-mono text-sm font-bold text-[var(--studio-ink)]">{translate("comicDrama.shotCount_cb9c45", { value0: activeShot.shotNumber })}</span>
                                        <Tag color="cyan">{productionParameterLabel(activeShot.shotSize || "", translate) || translate("comicDrama.shotSizeNotSet")}</Tag>
                                        <Tag color="geekblue">{productionParameterLabel(activeShot.cameraMovement || "", translate) || translate("comicDrama.staticCamera")}</Tag>
                                        <span className="text-xs text-[var(--studio-muted)]">{translate("comicDrama.estimatedCounts_448e10", { value0: activeShot.durationSeconds })}</span>
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
                                            {translate("comicDrama.generatePromptWithAi")}</Button>
                                    </div>
                                </div>

                                <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
                                    <div>
                                        <span className="text-[var(--studio-muted)]">{translate("comicDrama.visualDescription_a089fd")}</span>
                                        <p className="mt-0.5 text-[var(--studio-text)]">
                                            {activeShot.visualDescription || translate("comicDrama.noDescription")}
                                        </p>
                                    </div>
                                    <div>
                                        <span className="text-[var(--studio-muted)]">{translate("comicDrama.dialogueNarration")}</span>
                                        <p className="mt-0.5 italic text-[var(--studio-text)]">
                                            {activeShot.dialogueVoiceover || translate("comicDrama.none")}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Prompt Text Editor */}
                            <div className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-4">
                                <div className="mb-2 flex items-center justify-between">
                                    <span className="text-sm font-semibold text-[var(--studio-ink)]">
                                        {translate("comicDrama.finalStructuredPrompt")}</span>
                                    <Space size="small">
                                        <Button size="small" icon={<Copy className="size-3.5" />} onClick={copyPrompt}>
                                            {translate("comicDrama.copy")}</Button>
                                        <Button
                                            size="small"
                                            type="primary"
                                            loading={saving}
                                            icon={<Check className="size-3.5" />}
                                            onClick={handleSaveManual}
                                        >
                                            {translate("comicDrama.saveAsNewVersion")}</Button>
                                    </Space>
                                </div>

                                <Input.TextArea
                                    rows={6}
                                    value={editorText}
                                    onChange={(e) => setEditorText(e.target.value)}
                                    placeholder={translate("comicDrama.editTheStructuredPromptForImageOrVideoGeneration")}
                                />
                                <PromptReferenceInstructions version={editorSource} />

                                <div className="mt-2 text-xs text-[var(--studio-muted)]">
                                    {translate("comicDrama.regenerationAndManualEditsCreateImmutableVersionsAutomaticallyPreservingPrevious")}</div>
                            </div>

                            {/* Version History List */}
                            {activeShotVersions.length > 0 && (
                                <div className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-4">
                                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--studio-ink)]">
                                        <History className="size-4" />
                                        <span>{translate("comicDrama.versionHistoryCount_51cb6c", { value0: activeShotVersions.length })}</span>
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
                                                            {v.sourceType === "ai" ? translate("comicDrama.aiGenerated") : translate("comicDrama.manuallySaved")}
                                                        </span>
                                                        {v.model && <Tag>{v.model}</Tag>}
                                                        {creditAmount(v.chargedCredits).greaterThan(0) && (
                                                            <span className="text-[var(--studio-muted)]">{translate("comicDrama.costCountCredits_ef657d", { value0: v.chargedCredits })}</span>
                                                        )}
                                                    </div>
                                                    <p className="line-clamp-2 text-[var(--studio-text)]">
                                                        {v.prompt}
                                                    </p>
                                                </div>

                                                <Button
                                                    size="small"
                                                    onClick={() => { setEditorSource(v); setEditorText(readPromptBody(v)); }}
                                                >
                                                    {translate("comicDrama.loadIntoEditor")}</Button>
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
