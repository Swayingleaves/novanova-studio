"use client";

import { useEffect, useState } from "react";
import { App, Button, Drawer, Empty, Input, InputNumber, Modal, Select, Space, Table, Tag } from "antd";
import { Check, Edit, Sparkles, Trash2, X } from "lucide-react";

import { useComicDramaStore } from "../stores/use-comic-drama-store";
import type { ComicDramaShotDraft } from "../types";

type ShotDraftModalProps = {
    draft: ComicDramaShotDraft | null;
    open: boolean;
    onClose: () => void;
};

/** 镜头拆分草稿审核与编辑弹窗。 */
export function ShotDraftModal({ draft, open, onClose }: ShotDraftModalProps) {
    const { message } = App.useApp();
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
            message.warning("镜头草稿至少需要保留一个镜头");
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
            message.success("镜头草稿微调已保存");
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        } finally {
            setSaving(false);
        }
    };

    const handleConfirm = async () => {
        setConfirming(true);
        try {
            await confirmShotDraft(draft.id);
            message.success("镜头草稿已确认生效，已正式追加至镜头清单");
            onClose();
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        } finally {
            setConfirming(false);
        }
    };

    const handleDiscard = async () => {
        Modal.confirm({
            title: "确定放弃此拆分草稿？",
            content: "放弃后不会影响现有正式镜头，历史记录将存档。",
            okText: "确认放弃",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    await discardShotDraft(draft.id);
                    message.info("已放弃拆分草稿");
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
                    <span>审核镜头拆分草稿（共 {draftShots.length} 个镜头）</span>
                </div>
            }
            open={open}
            onClose={onClose}
            size="large"
            extra={
                <Space>
                    <Button danger onClick={handleDiscard}>
                        放弃草稿
                    </Button>
                    <Button loading={saving} onClick={handleSaveEdits}>
                        保存微调
                    </Button>
                    <Button type="primary" loading={confirming} onClick={handleConfirm}>
                        确认生效为正式镜头
                    </Button>
                </Space>
            }
        >
            <div className="flex flex-col gap-4">
                <div className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-3 text-xs text-[var(--studio-muted)]">
                    <p>指令要求：{draft.instruction}</p>
                    <p className="mt-1">
                        模型：{draft.model} · 实际消耗：{draft.chargedCredits} 积分 · 状态：待确认
                    </p>
                </div>

                <div className="flex flex-col gap-3">
                    {draftShots.map((shot, index) => (
                        <div
                            key={index}
                            className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-4 shadow-sm"
                        >
                            <div className="mb-3 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Tag color="purple">草稿镜头 #{index + 1}</Tag>
                                    <Input
                                        className="w-24"
                                        size="small"
                                        value={String(shot.shotSize || "中景")}
                                        onChange={(e) => handleFieldChange(index, "shotSize", e.target.value)}
                                        placeholder="景别"
                                    />
                                    <span className="text-xs text-[var(--studio-muted)]">预计时长(s):</span>
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
                                    <label className="text-xs text-[var(--studio-muted)]">画面描述</label>
                                    <Input.TextArea
                                        className="mt-1"
                                        rows={2}
                                        value={String(shot.visualDescription || "")}
                                        onChange={(e) => handleFieldChange(index, "visualDescription", e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-[var(--studio-muted)]">对白与旁白</label>
                                    <Input.TextArea
                                        className="mt-1"
                                        rows={2}
                                        value={String(shot.dialogueVoiceover || "")}
                                        onChange={(e) => handleFieldChange(index, "dialogueVoiceover", e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-[var(--studio-muted)]">运镜与调度</label>
                                    <Input
                                        className="mt-1"
                                        value={String(shot.cameraMovement || "")}
                                        onChange={(e) => handleFieldChange(index, "cameraMovement", e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-[var(--studio-muted)]">光线与情绪氛围</label>
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
