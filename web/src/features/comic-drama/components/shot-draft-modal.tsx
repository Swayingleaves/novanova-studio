"use client";

import { useTranslation } from "@/features/locale/use-translation";

import { useEffect, useMemo, useState } from "react";
import { Alert, App, Button, Drawer, Input, InputNumber, Space, Tag } from "antd";
import { Sparkles, Trash2 } from "lucide-react";

import { useComicDramaStore } from "../stores/use-comic-drama-store";
import type { ComicDramaShotDraft } from "../types";

type ShotDraftModalProps = {
    draft: ComicDramaShotDraft | null;
    open: boolean;
    onClose: () => void;
};

/** 镜头拆分草稿审核与编辑弹窗。 */
export function ShotDraftModal({ draft, open, onClose }: ShotDraftModalProps) {
    const translate = useTranslation();
    const { message, modal } = App.useApp();
    const workspace = useComicDramaStore((state) => state.workspace);
    const confirmShotDraft = useComicDramaStore((state) => state.confirmShotDraft);
    const updateShotDraft = useComicDramaStore((state) => state.updateShotDraft);
    const discardShotDraft = useComicDramaStore((state) => state.discardShotDraft);

    const [draftShots, setDraftShots] = useState<Array<Record<string, unknown>>>([]);
    const [saving, setSaving] = useState(false);
    const [confirming, setConfirming] = useState(false);

    useEffect(() => {
        if (draft && draft.draftData) {
            const rawShots = Array.isArray(draft.draftData.shots) ? draft.draftData.shots : [];
            setDraftShots(rawShots as Array<Record<string, unknown>>);
        } else {
            setDraftShots([]);
        }
    }, [draft]);

    // 计算当前草稿确认生效后将被覆盖替换的原有镜头及已生成媒体数量，与后端替换范围规则保持一致。
    const { replacedShotCount, affectedMediaCount } = useMemo(() => {
        if (!draft || !workspace) return { replacedShotCount: 0, affectedMediaCount: 0 };
        const scopeType = (draft.scopeType || "").trim();
        let scopeId = (draft.scopeId || "").trim();
        if (!scopeId) {
            scopeId = scopeType === "scene"
                ? String(draft.draftData.sourceSceneId || "").trim()
                : scopeType === "episode" ? String(draft.draftData.sourceEpisodeId || "").trim() : "";
        }
        const episodes = workspace.scriptProject.episodes;
        const singleEpisodeProject = episodes.length === 1 && episodes[0].id === scopeId;
        const replacedIds = new Set<string>();
        for (const existing of workspace.shots) {
            const match = scopeType === "scene" && scopeId
                ? (existing.sourceSceneId || "").trim() === scopeId
                : scopeType === "episode" && scopeId
                    ? ((existing.sourceEpisodeId || "").trim() === scopeId
                        || (singleEpisodeProject && !(existing.sourceEpisodeId || "").trim()))
                    : true;
            if (match) replacedIds.add(existing.id);
        }
        if (replacedIds.size === 0) return { replacedShotCount: 0, affectedMediaCount: 0 };
        let mediaCount = 0;
        for (const media of workspace.media) {
            if (media.targetType === "shot" && replacedIds.has(media.targetId)
                && ["queued", "processing", "completed", "needsUpdate"].includes(media.status)) {
                mediaCount++;
            }
        }
        return { replacedShotCount: replacedIds.size, affectedMediaCount: mediaCount };
    }, [draft, workspace]);

    if (!draft) return null;

    const handleFieldChange = (index: number, field: string, value: unknown) => {
        setDraftShots((prev) => {
            const next = [...prev];
            next[index] = { ...next[index], [field]: value };
            return next;
        });
    };

    const handleDeleteDraftShot = (index: number) => {
        if (draftShots.length <= 1) {
            message.warning(translate("comicDrama.keepAtLeastOneShotInTheDraft"));
            return;
        }
        setDraftShots((prev) => prev.filter((_, i) => i !== index));
    };

    const handleSaveEdits = async () => {
        setSaving(true);
        try {
            const updatedData = {
                ...draft.draftData,
                shots: draftShots,
            };
            await updateShotDraft(draft.id, updatedData);
            message.success(translate("comicDrama.shotDraftAdjustmentsSaved"));
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        } finally {
            setSaving(false);
        }
    };

    const executeConfirm = async () => {
        setConfirming(true);
        try {
            const originalShots = Array.isArray(draft.draftData.shots) ? draft.draftData.shots : [];
            if (JSON.stringify(draftShots) !== JSON.stringify(originalShots)) {
                await updateShotDraft(draft.id, { ...draft.draftData, shots: draftShots });
            }
            await confirmShotDraft(draft.id);
            message.success(replacedShotCount > 0
                ? translate("comicDrama.shotDraftReplacedExistingSuccess", { value0: replacedShotCount })
                : translate("comicDrama.shotDraftApprovedAndAppendedToTheShotList"));
            onClose();
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        } finally {
            setConfirming(false);
        }
    };

    const handleConfirm = () => {
        if (affectedMediaCount > 0) {
            modal.confirm({
                title: translate("comicDrama.confirmOverwriteExistingShotsTitle"),
                content: translate("comicDrama.confirmOverwriteExistingShotsContent", {
                    value0: replacedShotCount,
                    value1: draftShots.length,
                    value2: affectedMediaCount,
                }),
                okText: translate("comicDrama.confirmOverwriteAction"),
                cancelText: translate("comicDrama.cancel"),
                okButtonProps: { danger: true },
                onOk: executeConfirm,
            });
            return;
        }
        void executeConfirm();
    };

    const handleDiscard = () => {
        modal.confirm({
            title: translate("comicDrama.discardThisShotBreakdownDraft"),
            content: translate("comicDrama.existingShotsWillRemainUnchangedTheDraftWillBeArchived"),
            okText: translate("comicDrama.confirmDiscard"),
            cancelText: translate("comicDrama.cancel"),
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    await discardShotDraft(draft.id);
                    message.info(translate("comicDrama.shotBreakdownDraftDiscarded"));
                    onClose();
                } catch (error) {
                    if (error instanceof Error) message.error(error.message);
                }
            },
        });
    };

    return (
        <Drawer
            title={
                <div className="flex items-center gap-2">
                    <Sparkles className="size-4 text-purple-500" />
                    <span>{translate("comicDrama.reviewShotBreakdownDraftCountShots_ad2d31", { value0: draftShots.length })}</span>
                </div>
            }
            open={open}
            onClose={onClose}
            size="large"
            extra={
                <Space>
                    <Button danger onClick={handleDiscard}>
                        {translate("comicDrama.discardDraft")}</Button>
                    <Button loading={saving} onClick={handleSaveEdits}>
                        {translate("comicDrama.saveAdjustments")}</Button>
                    <Button type="primary" loading={confirming} onClick={handleConfirm}>
                        {translate("comicDrama.approveAsProductionShots")}</Button>
                </Space>
            }
        >
            <div className="flex flex-col gap-4">
                {replacedShotCount > 0 ? (
                    <Alert
                        type={affectedMediaCount > 0 ? "warning" : "info"}
                        showIcon
                        title={affectedMediaCount > 0
                            ? translate("comicDrama.shotDraftReplaceSummaryWarning", { value0: replacedShotCount, value1: affectedMediaCount })
                            : translate("comicDrama.shotDraftReplaceSummaryInfo", { value0: draftShots.length, value1: replacedShotCount })}
                    />
                ) : null}
                <div className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-3 text-xs text-[var(--studio-muted)]">
                    <p>{translate("comicDrama.instructionsCount_4ef0ac", { value0: draft.instruction })}</p>
                    <p className="mt-1">{translate("comicDrama.modelCountActualCostCountCreditsAwaitingApproval_265d32", { value0: draft.model, value1: draft.chargedCredits })}</p>
                </div>

                <div className="flex flex-col gap-3">
                    {draftShots.map((shot, index) => (
                        <div
                            key={index}
                            className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-4 shadow-sm"
                        >
                            <div className="mb-3 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Tag color="purple">{translate("comicDrama.draftShotCount_c07f34", { value0: index + 1 })}</Tag>
                                    <Input
                                        className="w-24"
                                        size="small"
                                        value={String(shot.shotSize || "中景")}
                                        onChange={(e) => handleFieldChange(index, "shotSize", e.target.value)}
                                        placeholder={translate("comicDrama.shotSize_6867f7")}
                                    />
                                    <span className="text-xs text-[var(--studio-muted)]">{translate("comicDrama.estimatedDurationS")}</span>
                                    <InputNumber
                                        size="small"
                                        min={0.5}
                                        max={60}
                                        step={0.5}
                                        className="w-20"
                                        value={Number(shot.durationSeconds || 3)}
                                        onChange={(val) => handleFieldChange(index, "durationSeconds", val || 3)}
                                    />
                                </div>
                                <Button
                                    type="text"
                                    danger
                                    size="small"
                                    icon={<Trash2 className="size-3.5" />}
                                    onClick={() => handleDeleteDraftShot(index)}
                                />
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2">
                                <div>
                                    <label className="text-xs text-[var(--studio-muted)]">{translate("comicDrama.visualDescription")}</label>
                                    <Input.TextArea
                                        className="mt-1"
                                        rows={2}
                                        value={String(shot.visualDescription || "")}
                                        onChange={(e) => handleFieldChange(index, "visualDescription", e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-[var(--studio-muted)]">{translate("comicDrama.dialogueAndNarration")}</label>
                                    <Input.TextArea
                                        className="mt-1"
                                        rows={2}
                                        value={String(shot.dialogueVoiceover || "")}
                                        onChange={(e) => handleFieldChange(index, "dialogueVoiceover", e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-[var(--studio-muted)]">{translate("comicDrama.cameraMovementAndBlocking")}</label>
                                    <Input
                                        className="mt-1"
                                        value={String(shot.cameraMovement || "")}
                                        onChange={(e) => handleFieldChange(index, "cameraMovement", e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-[var(--studio-muted)]">{translate("comicDrama.lightingAndMood")}</label>
                                    <Input
                                        className="mt-1"
                                        value={String(shot.lightingAtmosphere || "")}
                                        onChange={(e) => handleFieldChange(index, "lightingAtmosphere", e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </Drawer>
    );
}
