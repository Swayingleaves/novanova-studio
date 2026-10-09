"use client";

import { useMemo, useState } from "react";
import { Alert, App, Button, Empty, Radio, Space, Tag } from "antd";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";

import { useComicDramaStore } from "../stores/use-comic-drama-store";
import type { ComicDramaChangeImpact } from "../types";

/** 上游来源类型的中文名，具体来源会再补上实体名称。 */
const SOURCE_TYPE_LABELS: Record<string, string> = {
    overview: "故事概览 / 大纲 / 分集顺序", versionRestore: "剧本版本回退", episode: "分集",
    scene: "场次", character: "人物", world: "世界观 / 地点", asset: "视觉资产", assetVersion: "资产版本",
};

/** 下游目标类型的中文名。 */
const TARGET_TYPE_LABELS: Record<string, string> = {
    shot: "镜头", asset: "视觉资产", promptVersion: "提示词版本", media: "生成结果", voiceTrack: "声音轨",
};

const MEDIA_TYPE_LABELS: Record<string, string> = { image: "图片", video: "视频", audio: "音频", composite: "合成" };

/** 各类目标在确认更新后需要用户去做的下一步，按类型拼成一句可执行的说明。 */
const TARGET_NEXT_STEPS: Record<string, string> = {
    promptVersion: "到「提示词」阶段重新合成", media: "到「生成」阶段重新生成",
    shot: "到「分镜」阶段调整镜头", asset: "到「资产」阶段重新生成资产图",
    voiceTrack: "到「配音」阶段重新合成",
};

/** 按上游来源聚合的一组变更：一次变更会影响很多下游目标，逐条列出只会得到一长串标识。 */
type ImpactGroup = {
    key: string;
    sourceType: string;
    sourceId: string;
    summary: string;
    status: ComicDramaChangeImpact["status"];
    impacts: ComicDramaChangeImpact[];
    counts: Record<string, number>;
    latestAt: string;
};

/** 上游变更联动与影响确认阶段视图。 */
export function StageUpdates() {
    const { message } = App.useApp();
    const workspace = useComicDramaStore((state) => state.workspace);
    const confirmUpdate = useComicDramaStore((state) => state.confirmUpdate);

    const [statusFilter, setStatusFilter] = useState<string>("pending");
    const [operatingKey, setOperatingKey] = useState<string | null>(null);
    const [expandedKey, setExpandedKey] = useState<string | null>(null);

    const impacts = useMemo(() => workspace?.impacts || [], [workspace]);
    const pendingImpacts = useMemo(() => impacts.filter((item) => item.status === "pending"), [impacts]);
    const filteredImpacts = useMemo(
        () => (statusFilter === "pending" ? pendingImpacts : impacts.filter((item) => item.status !== "pending")),
        [impacts, statusFilter, pendingImpacts]
    );
    // 同一来源、同一摘要、同一处理状态归为一组：用户关心的是「哪一次改动、影响了多少东西」，
    // 而不是逐条的去重行。分组键带上状态，历史视图里同源但处理结果不同的项不会被并到一起。
    const groups = useMemo(() => {
        const map = new Map<string, ImpactGroup>();
        for (const impact of filteredImpacts) {
            const sourceId = impact.sourceId || "";
            const key = `${impact.sourceType}|${sourceId}|${impact.changeSummary}|${impact.status}`;
            const group = map.get(key) || { key, sourceType: impact.sourceType, sourceId, summary: impact.changeSummary, status: impact.status, impacts: [], counts: {}, latestAt: impact.createdAt || "" };
            group.impacts.push(impact);
            group.counts[impact.targetType] = (group.counts[impact.targetType] || 0) + 1;
            if ((impact.createdAt || "") > group.latestAt) group.latestAt = impact.createdAt || "";
            map.set(key, group);
        }
        return [...map.values()].sort((left, right) => (right.latestAt || "").localeCompare(left.latestAt || ""));
    }, [filteredImpacts]);

    if (!workspace) return null;

    /** 上游来源的可读名称，解析不到实体时退回类型名。 */
    const sourceLabel = (sourceType: string, sourceId: string) => {
        const project = workspace.scriptProject;
        if (sourceType === "episode") {
            const episode = project.episodes.find((item) => item.id === sourceId);
            return episode ? `第 ${episode.episodeNumber} 集《${episode.title || "未命名"}》` : "某个分集";
        }
        if (sourceType === "character") {
            const character = project.characters.find((item) => item.id === sourceId);
            return character ? `人物「${character.name}」` : "人物设定";
        }
        if (sourceType === "world") {
            const location = project.locations.find((item) => item.id === sourceId);
            return location ? `地点「${location.name}」` : "世界观 / 地点";
        }
        return SOURCE_TYPE_LABELS[sourceType] || sourceType;
    };

    /** 下游目标的可读名称，解析不到实体时退回类型名。 */
    const targetLabel = (impact: ComicDramaChangeImpact) => {
        if (impact.targetType === "shot") {
            const shot = workspace.shots.find((item) => item.id === impact.targetId);
            return shot ? `分镜 #${shot.shotNumber}` : "某个镜头";
        }
        if (impact.targetType === "asset") {
            const asset = workspace.assets.find((item) => item.id === impact.targetId);
            return asset ? `资产「${asset.name || asset.assetType}」` : "某个资产";
        }
        if (impact.targetType === "promptVersion") {
            const version = workspace.promptVersions.find((item) => item.id === impact.targetId);
            return version ? `提示词 v${version.versionNumber}` : "某个提示词版本";
        }
        if (impact.targetType === "media") {
            const media = workspace.media.find((item) => item.id === impact.targetId);
            return media ? `${MEDIA_TYPE_LABELS[media.mediaType] || "媒体"}结果` : "某个生成结果";
        }
        return TARGET_TYPE_LABELS[impact.targetType] || impact.targetType;
    };

    /** 影响统计，例如「37 个生成结果 · 34 个提示词版本」。 */
    const impactSummary = (counts: Record<string, number>) => Object.entries(counts)
        .map(([type, count]) => `${count} 个${TARGET_TYPE_LABELS[type] || type}`).join(" · ");

    /** 确认更新后用户实际要去做的动作，带数量。 */
    const nextStepSummary = (counts: Record<string, number>) => Object.entries(counts)
        .map(([type, count]) => TARGET_NEXT_STEPS[type] ? `${TARGET_NEXT_STEPS[type]}（${count} 个）` : null)
        .filter(Boolean).join("；");

    const handleResolve = async (group: ImpactGroup, resolution: "keepOld" | "update") => {
        setOperatingKey(group.key);
        try {
            // 一次上游变更会为每个受影响目标各插一条影响项，这里按来源整组处理，不必逐条点击。
            await confirmUpdate("all", null, resolution, { sourceType: group.sourceType, sourceId: group.sourceId });
            message.success(resolution === "keepOld"
                ? "已确认保留旧结果，不触发重新生成"
                : "已标记需要更新，按下面的说明到对应阶段重新制作即可");
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        } finally {
            setOperatingKey(null);
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <header className="flex flex-col gap-2 border-b border-[var(--studio-line)] pb-4">
                <h2 className="text-xl font-semibold text-[var(--studio-ink)]">上游变更联动管理</h2>
                <p className="mt-1 text-sm text-[var(--studio-muted)]">
                    当共享剧本、人物设定或场景描述修改后，系统精准追踪受影响的下游镜头与资产，并保留全部既有生成成果。未经您的明确确认，绝不自动覆盖或重复扣费。
                </p>
            </header>

            {pendingImpacts.length > 0 ? (
                <Alert
                    type="warning"
                    showIcon
                    title={`检测到 ${groups.length} 次上游变更，共影响 ${pendingImpacts.length} 个下游内容`}
                    description="“需要更新”只表示剧本来源变了，不代表历史生成结果失效。您可以整组「保留旧结果」继续用现有内容，或「确认更新」后按新剧本重新制作。"
                />
            ) : (
                <Alert
                    type="success"
                    showIcon
                    title="当前下游生产内容与上游剧本保持完全同步"
                    description="所有镜头、提示词与视觉资产均为最新状态，暂无待确认的变更影响项。"
                />
            )}

            <div className="flex items-center justify-between">
                <Radio.Group value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} buttonStyle="solid">
                    <Radio.Button value="pending">待处理影响 ({pendingImpacts.length})</Radio.Button>
                    <Radio.Button value="history">已处理历史 ({impacts.length - pendingImpacts.length})</Radio.Button>
                </Radio.Group>
            </div>

            {groups.length === 0 ? (
                <Empty description={statusFilter === "pending" ? "暂无待处理的上游变更" : "暂无历史处理记录"} />
            ) : (
                <div className="grid gap-3">
                    {groups.map((group) => {
                        const isPending = group.status === "pending";
                        const isLoading = operatingKey === group.key;
                        const expanded = expandedKey === group.key;
                        const nextSteps = nextStepSummary(group.counts);

                        return (
                            <div key={group.key} className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-4 shadow-sm">
                                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                                    <div className="flex items-start gap-3">
                                        <div className="mt-0.5 rounded-lg bg-[var(--studio-line)] p-2">
                                            {isPending
                                                ? <AlertTriangle className="size-5 text-amber-500" />
                                                : <CheckCircle2 className="size-5 text-emerald-500" />}
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <Tag color={isPending ? "warning" : "default"}>
                                                    {isPending ? "待处理" : group.status === "accepted" ? "已确认更新" : "已保留旧成果"}
                                                </Tag>
                                                <span className="font-semibold text-[var(--studio-ink)]">{group.summary || "上游设定发生变动"}</span>
                                            </div>
                                            <p className="text-xs text-[var(--studio-muted)]">
                                                来源：{sourceLabel(group.sourceType, group.sourceId)}
                                            </p>
                                            <p className="text-xs text-[var(--studio-muted)]">
                                                影响：{impactSummary(group.counts)}
                                            </p>
                                            {isPending && nextSteps ? (
                                                <p className="text-xs text-[var(--studio-muted)]">确认更新后：{nextSteps}</p>
                                            ) : null}
                                        </div>
                                    </div>

                                    {isPending ? (
                                        <Space wrap>
                                            <Button size="small" type="link" className="px-0" onClick={() => setExpandedKey(expanded ? null : group.key)}>
                                                {expanded ? "收起明细" : `查看明细 (${group.impacts.length})`}
                                            </Button>
                                            <Button size="small" loading={isLoading} onClick={() => void handleResolve(group, "keepOld")}>保留旧结果</Button>
                                            <Button size="small" type="primary" loading={isLoading} onClick={() => void handleResolve(group, "update")}>确认更新</Button>
                                        </Space>
                                    ) : (
                                        <span className="text-xs text-[var(--studio-faint)]">
                                            处理时间：{new Date(group.latestAt || "").toLocaleString("zh-CN")}
                                        </span>
                                    )}
                                </div>

                                {expanded ? (
                                    <div className="mt-3 space-y-1 border-t border-dashed border-[var(--studio-line)] pt-3">
                                        {group.impacts.map((impact) => (
                                            <div key={impact.id} className="flex items-center gap-2 text-xs text-[var(--studio-muted)]">
                                                {impact.status === "pending"
                                                    ? <ChevronRight className="size-3.5" />
                                                    : <ChevronDown className="size-3.5" />}
                                                <span className="text-[var(--studio-text)]">{targetLabel(impact)}</span>
                                                <span>· {TARGET_TYPE_LABELS[impact.targetType] || impact.targetType}</span>
                                            </div>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
