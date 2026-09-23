"use client";

import { useMemo, useState } from "react";
import { App, Button, Card, Drawer, Empty, Form, Input, InputNumber, Radio, Select, Space, Tag } from "antd";
import { Mic, Music, Plus, Radio as RadioIcon, Sparkles, Volume2 } from "lucide-react";

import { useComicDramaStore } from "../stores/use-comic-drama-store";
import type { ComicDramaVoiceTrack, ComicDramaVoiceTrackInput } from "../types";

const TRACK_TYPE_CONFIG: Record<string, { label: string; color: string; icon: typeof Mic }> = {
    dialogue: { label: "角色对白", color: "blue", icon: Mic },
    narration: { label: "旁白解说", color: "purple", icon: RadioIcon },
    ambient: { label: "环境底噪", color: "green", icon: Volume2 },
    soundEffect: { label: "关键音效", color: "orange", icon: Volume2 },
    music: { label: "配乐氛围", color: "magenta", icon: Music },
};

/** 声音轨与对白管理阶段视图。 */
export function StageSound() {
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
            tone: "自然沉稳",
            emotion: "平静",
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
            await saveVoiceTrack(values);
            message.success(editingTrack ? "声音条目已更新" : "声音条目已创建");
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
            message.info("现有镜头中没有检测到对白或旁白文本");
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
                        tone: "根据剧情自动调节",
                        emotion: "自然流露",
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
            message.success(`已从镜头对白中提取 ${addedCount} 条声音轨`);
        } else {
            message.info("所有镜头对白均已存在对应声音条目");
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <header className="flex flex-col gap-2 border-b border-[var(--studio-line)] pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-[var(--studio-ink)]">声音与对白编排 (Audio Tracks)</h2>
                    <p className="mt-1 text-sm text-[var(--studio-muted)]">
                        结构化管理角色对白、配音音色、旁白解说、环境音效与背景音乐建议，支持与剧本正文及镜头对白深度联动。
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <Button icon={<Sparkles className="size-4" />} onClick={handleExtractFromShots}>
                        从镜头提取对白
                    </Button>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={() => openCreateTrack("dialogue")}>
                        添加声音轨
                    </Button>
                </div>
            </header>

            {/* Filter toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <Radio.Group value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} buttonStyle="solid">
                    <Radio.Button value="all">全部声音 ({voiceTracks.length})</Radio.Button>
                    <Radio.Button value="dialogue">对白</Radio.Button>
                    <Radio.Button value="narration">旁白</Radio.Button>
                    <Radio.Button value="soundEffect">音效</Radio.Button>
                    <Radio.Button value="ambient">环境</Radio.Button>
                    <Radio.Button value="music">配乐</Radio.Button>
                </Radio.Group>
            </div>

            {/* Voice Tracks List */}
            {filteredTracks.length === 0 ? (
                <Empty description="暂无声音轨道数据">
                    <Space>
                        <Button type="primary" icon={<Sparkles className="size-4" />} onClick={handleExtractFromShots}>
                            一键从镜头提取对白
                        </Button>
                        <Button icon={<Plus className="size-4" />} onClick={() => openCreateTrack("dialogue")}>
                            手动添加声音轨
                        </Button>
                    </Space>
                </Empty>
            ) : (
                <div className="grid gap-3">
                    {filteredTracks.map((track) => {
                        const config = TRACK_TYPE_CONFIG[track.trackType] || TRACK_TYPE_CONFIG.dialogue;
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
                                                <span className="font-mono text-xs font-semibold text-[var(--studio-ink)]">
                                                    镜头 #{relatedShot.shotNumber}
                                                </span>
                                            )}
                                            {relatedChar && (
                                                <Tag color="cyan">角色：{relatedChar.name}</Tag>
                                            )}
                                            <span className="text-xs text-[var(--studio-muted)]">
                                                语速：{track.speechRate}x · 语气：{track.tone || "默认"} · 情绪：{track.emotion || "自然"}
                                            </span>
                                        </div>

                                        <p className="text-sm font-medium text-[var(--studio-ink)]">
                                            “{track.content}”
                                        </p>
                                    </div>
                                </div>

                                <Button size="small" onClick={() => openEditTrack(track)}>
                                    配置
                                </Button>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Edit Drawer */}
            <Drawer
                title={editingTrack ? "编辑声音条目" : "添加声音条目"}
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                size="large"
                extra={
                    <Button type="primary" loading={saving} onClick={handleSaveTrack}>
                        保存
                    </Button>
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
                        label="声音类型"
                        rules={[{ required: true, message: "请选择声音类型" }]}
                    >
                        <Select
                            options={[
                                { value: "dialogue", label: "角色对白 (Dialogue)" },
                                { value: "narration", label: "旁白解说 (Narration)" },
                                { value: "soundEffect", label: "关键音效 (Sound Effect)" },
                                { value: "ambient", label: "环境声 (Ambient)" },
                                { value: "music", label: "背景音乐 (Music)" },
                            ]}
                        />
                    </Form.Item>

                    <Form.Item name="shotId" label="关联镜头">
                        <Select
                            allowClear
                            options={shots.map((s) => ({
                                value: s.id,
                                label: `镜头 #${s.shotNumber} (${s.shotSize || "未定景别"})`,
                            }))}
                        />
                    </Form.Item>

                    <Form.Item
                        name="content"
                        label="内容或声音描述"
                        rules={[{ required: true, message: "请输入对白或声音描述" }]}
                    >
                        <Input.TextArea rows={3} placeholder="台词正文，或声音特效具体描述..." />
                    </Form.Item>

                    <div className="grid grid-cols-2 gap-3">
                        <Form.Item name="tone" label="语气">
                            <Input placeholder="例如：坚定、急促、低沉、轻佻" />
                        </Form.Item>

                        <Form.Item name="emotion" label="情绪">
                            <Input placeholder="例如：愤怒、悲伤、欣喜、平静" />
                        </Form.Item>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <Form.Item name="speechRate" label="语速倍率">
                            <InputNumber min={0.5} max={2.0} step={0.1} className="w-full" />
                        </Form.Item>

                        <Form.Item name="voiceModel" label="音色/配音模型">
                            <Input placeholder="例如：沉稳青年男音、清脆少女音" />
                        </Form.Item>
                    </div>
                </Form>
            </Drawer>
        </div>
    );
}
