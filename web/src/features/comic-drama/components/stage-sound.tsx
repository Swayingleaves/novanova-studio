"use client";

import { productionParameterLabel } from "../lib/production-labels";

import { translateMessage } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";

import { useMemo, useState } from "react";
import { App, Button, Card, Drawer, Empty, Form, Input, InputNumber, Radio, Select, Space, Tag } from "antd";
import { Mic, Music, Plus, Radio as RadioIcon, Sparkles, Volume2 } from "lucide-react";

import { useComicDramaStore } from "../stores/use-comic-drama-store";
import type { ComicDramaVoiceTrack, ComicDramaVoiceTrackInput } from "../types";

const getTrackTypeConfig = (translate = translateMessage): Record<string, { label: string; color: string; icon: typeof Mic }> => ({
    dialogue: { label: translate("comicDrama.characterDialogue"), color: "blue", icon: Mic },
    narration: { label: translate("comicDrama.voiceOverNarration"), color: "purple", icon: RadioIcon },
    ambient: { label: translate("comicDrama.ambientSound"), color: "green", icon: Volume2 },
    soundEffect: { label: translate("comicDrama.soundEffect"), color: "orange", icon: Volume2 },
    music: { label: translate("comicDrama.backgroundMusic"), color: "magenta", icon: Music },
});

/** 声音轨与对白管理阶段视图。 */
export function StageSound() {
    const translate = useTranslation();
    const { message } = App.useApp();
    const workspace = useComicDramaStore((state) => state.workspace);
    const saveVoiceTrack = useComicDramaStore((state) => state.saveVoiceTrack);

    const [typeFilter, setTypeFilter] = useState<string>("all");
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [editingTrack, setEditingTrack] = useState<ComicDramaVoiceTrack | null>(null);
    const [form] = Form.useForm<ComicDramaVoiceTrackInput>();
    const [saving, setSaving] = useState(false);

    if (!workspace) return null;

    const voiceTracks = workspace.voiceTracks || [];
    const shots = workspace.shots || [];
    const characters = workspace.scriptProject?.characters || [];

    const filteredTracks = useMemo(() => {
        return voiceTracks.filter((t) => {
            if (typeFilter !== "all" && t.trackType !== typeFilter) return false;
            return true;
        });
    }, [voiceTracks, typeFilter]);

    // Open create track
    const openCreateTrack = (trackType: ComicDramaVoiceTrack["trackType"] = "dialogue") => {
        setEditingTrack(null);
        form.resetFields();
        form.setFieldsValue({
            id: `voice_${Date.now()}`,
            trackType,
            shotId: shots[0]?.id || undefined,
            content: "",
            voiceModel: "default_vocal",
            speechRate: 1.0,
            tone: translate("comicDrama.naturalAndSteady"),
            emotion: translate("comicDrama.calm"),
            status: "draft",
            revision: 0,
        });
        setDrawerOpen(true);
    };

    // Open edit track
    const openEditTrack = (track: ComicDramaVoiceTrack) => {
        setEditingTrack(track);
        form.setFieldsValue({
            id: track.id,
            shotId: track.shotId,
            characterId: track.characterId,
            trackType: track.trackType,
            content: track.content,
            voiceModel: track.voiceModel,
            speechRate: track.speechRate,
            tone: track.tone,
            emotion: track.emotion,
            status: track.status,
            revision: track.revision,
        });
        setDrawerOpen(true);
    };

    // Save track
    const handleSaveTrack = async () => {
        try {
            const values = await form.validateFields();
            setSaving(true);
            await saveVoiceTrack({ ...(editingTrack || {}), ...values });
            message.success(editingTrack ? translate("comicDrama.audioEntryUpdated") : translate("comicDrama.audioEntryCreated"));
            setDrawerOpen(false);
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        } finally {
            setSaving(false);
        }
    };

    // Extract dialogues from shots into voice tracks
    const handleExtractFromShots = async () => {
        const shotsWithDialogue = shots.filter((s) => Boolean(s.dialogueVoiceover?.trim()));
        if (shotsWithDialogue.length === 0) {
            message.info(translate("comicDrama.noDialogueOrNarrationFoundInTheCurrentShots"));
            return;
        }

        let addedCount = 0;
        for (const shot of shotsWithDialogue) {
            // Check if track already exists for this shot
            const alreadyExists = voiceTracks.some((t) => t.shotId === shot.id && t.content === shot.dialogueVoiceover);
            if (!alreadyExists) {
                try {
                    await saveVoiceTrack({
                        id: `voice_${Date.now()}_${shot.shotNumber}`,
                        shotId: shot.id,
                        trackType: "dialogue",
                        content: shot.dialogueVoiceover,
                        voiceModel: "default_character",
                        speechRate: 1.0,
                        tone: translate("comicDrama.adjustAutomaticallyToTheStory"),
                        emotion: translate("comicDrama.naturalExpression"),
                        status: "ready",
                        revision: 0,
                    });
                    addedCount++;
                } catch {
                    // Continue with next
                }
            }
        }
        if (addedCount > 0) {
            message.success(translate("comicDrama.extractedCountAudioTracksFromShotDialogue", { value0: addedCount }));
        } else {
            message.info(translate("comicDrama.allShotDialogueAlreadyHasMatchingAudioEntries"));
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <header className="flex flex-col gap-2 border-b border-[var(--studio-line)] pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-[var(--studio-ink)]">{translate("comicDrama.soundAndDialogue_d24e3a")}</h2>
                    <p className="mt-1 text-sm text-[var(--studio-muted)]">
                        {translate("comicDrama.manageDialogueVoicesNarrationAmbientEffectsAndMusicSuggestionsLinked")}</p>
                </div>

                <div className="flex items-center gap-2">
                    <Button icon={<Sparkles className="size-4" />} onClick={handleExtractFromShots}>
                        {translate("comicDrama.extractDialogueFromShots")}</Button>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={() => openCreateTrack("dialogue")}>
                        {translate("comicDrama.addAudioTrack")}</Button>
                </div>
            </header>

            {/* Filter toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <Radio.Group value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} buttonStyle="solid">
                    <Radio.Button value="all">{translate("comicDrama.allAudioCount_5e31b4", { value0: voiceTracks.length })}</Radio.Button>
                    <Radio.Button value="dialogue">{translate("comicDrama.dialogue")}</Radio.Button>
                    <Radio.Button value="narration">{translate("comicDrama.narration")}</Radio.Button>
                    <Radio.Button value="soundEffect">{translate("comicDrama.soundEffects_505e64")}</Radio.Button>
                    <Radio.Button value="ambient">{translate("comicDrama.ambient")}</Radio.Button>
                    <Radio.Button value="music">{translate("comicDrama.music")}</Radio.Button>
                </Radio.Group>
            </div>

            {/* Voice Tracks List */}
            {filteredTracks.length === 0 ? (
                <Empty description={translate("comicDrama.noAudioTracksYet")}>
                    <Space>
                        <Button type="primary" icon={<Sparkles className="size-4" />} onClick={handleExtractFromShots}>
                            {translate("comicDrama.extractDialogueFromShots_27558d")}</Button>
                        <Button icon={<Plus className="size-4" />} onClick={() => openCreateTrack("dialogue")}>
                            {translate("comicDrama.addAudioTrackManually")}</Button>
                    </Space>
                </Empty>
            ) : (
                <div className="grid gap-3">
                    {filteredTracks.map((track) => {
                        const config = getTrackTypeConfig(translate)[track.trackType] || getTrackTypeConfig(translate).dialogue;
                        const Icon = config.icon;
                        const relatedShot = shots.find((s) => s.id === track.shotId);
                        const relatedChar = characters.find((c) => c.id === track.characterId);

                        return (
                            <div
                                key={track.id}
                                className="flex items-start justify-between gap-4 rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-4 shadow-sm transition-all hover:border-[var(--studio-line-strong)]"
                            >
                                <div className="flex items-start gap-3">
                                    <div className="mt-0.5 rounded-lg bg-[var(--studio-line)] p-2">
                                        <Icon className="size-5 text-[var(--studio-ink)]" />
                                    </div>

                                    <div className="flex flex-col gap-1.5">
                                        <div className="flex items-center gap-2">
                                            <Tag color={config.color}>{config.label}</Tag>
                                            {relatedShot && (
                                                <span className="font-mono text-xs font-semibold text-[var(--studio-ink)]">{translate("comicDrama.shotCount_cb9c45", { value0: relatedShot.shotNumber })}</span>
                                            )}
                                            {relatedChar && (
                                                <Tag color="cyan">{translate("comicDrama.characterCount_ea4eee", { value0: relatedChar.name })}</Tag>
                                            )}
                                            <span className="text-xs text-[var(--studio-muted)]">{translate("comicDrama.speechRateCountxToneCountEmotionCount_8acab8", { value0: track.speechRate, value1: track.tone || translate("comicDrama.default"), value2: track.emotion || translate("comicDrama.natural") })}</span>
                                        </div>

                                        <p className="text-sm font-medium text-[var(--studio-ink)]">
                                            “{track.content}”
                                        </p>
                                    </div>
                                </div>

                                <Button size="small" onClick={() => openEditTrack(track)}>
                                    {translate("comicDrama.configure")}</Button>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Edit Drawer */}
            <Drawer
                title={editingTrack ? translate("comicDrama.editAudioEntry") : translate("comicDrama.addAudioEntry")}
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                size="large"
                extra={
                    <Button type="primary" loading={saving} onClick={handleSaveTrack}>
                        {translate("comicDrama.save")}</Button>
                }
            >
                <Form form={form} layout="vertical">
                    <Form.Item name="id" hidden>
                        <Input />
                    </Form.Item>
                    <Form.Item name="revision" hidden>
                        <Input />
                    </Form.Item>

                    <Form.Item
                        name="trackType"
                        label={translate("comicDrama.audioType")}
                        rules={[{ required: true, message: translate("comicDrama.selectAnAudioType") }]}
                    >
                        <Select
                            options={[
                                { value: "dialogue", label: translate("comicDrama.characterDialogue_3ab5f1") },
                                { value: "narration", label: translate("comicDrama.voiceOverNarration_8f399e") },
                                { value: "soundEffect", label: translate("comicDrama.soundEffect_18ecdf") },
                                { value: "ambient", label: translate("comicDrama.ambientSound_5d4c73") },
                                { value: "music", label: translate("comicDrama.backgroundMusic_852179") },
                            ]}
                        />
                    </Form.Item>

                    <Form.Item name="shotId" label={translate("comicDrama.linkedShot")}>
                        <Select
                            allowClear
                            options={shots.map((s) => ({
                                value: s.id,
                                label: translate("comicDrama.shotCountCount", { value0: s.shotNumber, value1: productionParameterLabel(s.shotSize || "", translate) || translate("comicDrama.shotSizeNotSet") }),
                            }))}
                        />
                    </Form.Item>

                    <Form.Item
                        name="content"
                        label={translate("comicDrama.contentOrSoundDescription")}
                        rules={[{ required: true, message: translate("comicDrama.enterDialogueOrASoundDescription") }]}
                    >
                        <Input.TextArea rows={3} placeholder={translate("comicDrama.dialogueTextOrADetailedSoundEffectDescription")} />
                    </Form.Item>

                    <div className="grid grid-cols-2 gap-3">
                        <Form.Item name="tone" label={translate("comicDrama.tone")}>
                            <Input placeholder={translate("comicDrama.forExampleFirmUrgentDeepPlayful")} />
                        </Form.Item>

                        <Form.Item name="emotion" label={translate("comicDrama.emotion_6e8e0c")}>
                            <Input placeholder={translate("comicDrama.forExampleAngrySadHappyCalm")} />
                        </Form.Item>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <Form.Item name="speechRate" label={translate("comicDrama.speechRateMultiplier")}>
                            <InputNumber min={0.5} max={2.0} step={0.1} className="w-full" />
                        </Form.Item>

                        <Form.Item name="voiceModel" label={translate("comicDrama.voiceDubbingModel")}>
                            <Input placeholder={translate("comicDrama.forExampleASteadyYoungMaleVoiceABrightYoung")} />
                        </Form.Item>
                    </div>
                </Form>
            </Drawer>
        </div>
    );
}
