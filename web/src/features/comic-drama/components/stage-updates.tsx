"use client";

import { translateMessage } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";

import { useMemo, useState } from "react";
import { Alert, App, Button, Empty, Radio, Space, Tag } from "antd";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";

import { useComicDramaStore } from "../stores/use-comic-drama-store";
import type { ComicDramaChangeImpact } from "../types";

/** 上游来源类型的中文名，具体来源会再补上实体名称。 */
const getSourceTypeLabels = (translate = translateMessage): Record<string, string> => ({
    overview: translate("comicDrama.storyOverviewOutlineEpisodeOrder"), versionRestore: translate("comicDrama.scriptVersionRestored"), episode: translate("comicDrama.episode"),
    scene: translate("comicDrama.scene_061e0f"), character: translate("comicDrama.character"), world: translate("comicDrama.worldLocations"), asset: translate("comicDrama.visualAssets"), assetVersion: translate("comicDrama.assetVersion"),
});

/** 下游目标类型的中文名。 */
const getTargetTypeLabels = (translate = translateMessage): Record<string, string> => ({
    shot: translate("comicDrama.shot_c7d192"), asset: translate("comicDrama.visualAssets"), promptVersion: translate("comicDrama.promptVersion"), media: translate("comicDrama.generationResult"), voiceTrack: translate("comicDrama.audioTrack"),
});

const getMediaTypeLabels = (translate = translateMessage): Record<string, string> => ({ image: translate("comicDrama.image"), video: translate("comicDrama.video"), audio: translate("comicDrama.audio"), composite: translate("comicDrama.composition_0bb9bb") });

/** 各类目标在确认更新后需要用户去做的下一步，按类型拼成一句可执行的说明。 */
const getTargetNextSteps = (translate = translateMessage): Record<string, string> => ({
    promptVersion: translate("comicDrama.regenerateInPrompts"), media: translate("comicDrama.regenerateInMedia"),
    shot: translate("comicDrama.adjustTheShotInStoryboard"), asset: translate("comicDrama.regenerateAssetImagesInAssets"),
    voiceTrack: translate("comicDrama.regenerateInSound"),
});

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
    const translate = useTranslation();
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
            return episode ? translate("comicDrama.episodeCountCount_6eae1a", { value0: episode.episodeNumber, value1: episode.title || translate("comicDrama.untitled_355630") }) : translate("comicDrama.anEpisode");
        }
        if (sourceType === "character") {
            const character = project.characters.find((item) => item.id === sourceId);
            return character ? translate("comicDrama.characterCount", { value0: character.name }) : translate("comicDrama.characters_85ae09");
        }
        if (sourceType === "world") {
            const location = project.locations.find((item) => item.id === sourceId);
            return location ? translate("comicDrama.locationCount", { value0: location.name }) : translate("comicDrama.worldLocations");
        }
        return getSourceTypeLabels(translate)[sourceType] || sourceType;
    };

    /** 下游目标的可读名称，解析不到实体时退回类型名。 */
    const targetLabel = (impact: ComicDramaChangeImpact) => {
        if (impact.targetType === "shot") {
            const shot = workspace.shots.find((item) => item.id === impact.targetId);
            return shot ? translate("comicDrama.storyboardCount", { value0: shot.shotNumber }) : translate("comicDrama.aShot");
        }
        if (impact.targetType === "asset") {
            const asset = workspace.assets.find((item) => item.id === impact.targetId);
            return asset ? translate("comicDrama.assetCount", { value0: asset.name || asset.assetType }) : translate("comicDrama.anAsset");
        }
        if (impact.targetType === "promptVersion") {
            const version = workspace.promptVersions.find((item) => item.id === impact.targetId);
            return version ? translate("comicDrama.promptVCount", { value0: version.versionNumber }) : translate("comicDrama.aPromptVersion");
        }
        if (impact.targetType === "media") {
            const media = workspace.media.find((item) => item.id === impact.targetId);
            return media ? translate("comicDrama.countResult", { value0: getMediaTypeLabels(translate)[media.mediaType] || translate("comicDrama.media") }) : translate("comicDrama.aGeneratedResult");
        }
        return getTargetTypeLabels(translate)[impact.targetType] || impact.targetType;
    };

    /** 影响统计，例如「37 个生成结果 · 34 个提示词版本」。 */
    const impactSummary = (counts: Record<string, number>) => Object.entries(counts)
        .map(([type, count]) => translate("comicDrama.countCount", { value0: count, value1: getTargetTypeLabels(translate)[type] || type })).join(" · ");

    /** 确认更新后用户实际要去做的动作，带数量。 */
    const nextStepSummary = (counts: Record<string, number>) => Object.entries(counts)
        .map(([type, count]) => getTargetNextSteps(translate)[type] ? translate("comicDrama.countCount_88af18", { value0: getTargetNextSteps(translate)[type], value1: count }) : null)
        .filter(Boolean).join("；");

    const handleResolve = async (group: ImpactGroup, resolution: "keepOld" | "update") => {
        setOperatingKey(group.key);
        try {
            // 一次上游变更会为每个受影响目标各插一条影响项，这里按来源整组处理，不必逐条点击。
            await confirmUpdate("all", null, resolution, { sourceType: group.sourceType, sourceId: group.sourceId });
            message.success(resolution === "keepOld"
                ? translate("comicDrama.previousResultsRetainedNoRegenerationTriggered")
                : translate("comicDrama.markedForUpdateFollowTheInstructionsBelowInTheCorresponding"));
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        } finally {
            setOperatingKey(null);
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <header className="flex flex-col gap-2 border-b border-[var(--studio-line)] pb-4">
                <h2 className="text-xl font-semibold text-[var(--studio-ink)]">{translate("comicDrama.upstreamChangeManagement")}</h2>
                <p className="mt-1 text-sm text-[var(--studio-muted)]">
                    {translate("comicDrama.trackDownstreamShotsAndAssetsAffectedBySharedScriptCharacter")}</p>
            </header>

            {pendingImpacts.length > 0 ? (
                <Alert
                    type="warning"
                    showIcon
                    title={translate("comicDrama.detectedCountUpstreamChangesAffectingCountDownstreamItems", { value0: groups.length, value1: pendingImpacts.length })}
                    description={translate("comicDrama.needsUpdateMeansTheSourceScriptChangedExistingResultsRemain")}
                />
            ) : (
                <Alert
                    type="success"
                    showIcon
                    title={translate("comicDrama.productionContentIsFullySyncedWithTheSourceScript")}
                    description={translate("comicDrama.allShotsPromptsAndVisualAssetsAreCurrentNoChange")}
                />
            )}

            <div className="flex items-center justify-between">
                <Radio.Group value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} buttonStyle="solid">
                    <Radio.Button value="pending">{translate("comicDrama.pendingImpactsCount_43a840", { value0: pendingImpacts.length })}</Radio.Button>
                    <Radio.Button value="history">{translate("comicDrama.historyCount_9c7085", { value0: impacts.length - pendingImpacts.length })}</Radio.Button>
                </Radio.Group>
            </div>

            {groups.length === 0 ? (
                <Empty description={statusFilter === "pending" ? translate("comicDrama.noPendingUpstreamChanges") : translate("comicDrama.noProcessedChangesYet")} />
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
                                                    {isPending ? translate("comicDrama.pending") : group.status === "accepted" ? translate("comicDrama.updateConfirmed") : translate("comicDrama.previousResultsRetained")}
                                                </Tag>
                                                <span className="font-semibold text-[var(--studio-ink)]">{group.summary || translate("comicDrama.upstreamSettingsChanged")}</span>
                                            </div>
                                            <p className="text-xs text-[var(--studio-muted)]">{translate("comicDrama.sourceCount_e567d9", { value0: sourceLabel(group.sourceType, group.sourceId) })}</p>
                                            <p className="text-xs text-[var(--studio-muted)]">{translate("comicDrama.impactCount_20b1aa", { value0: impactSummary(group.counts) })}</p>
                                            {isPending && nextSteps ? (
                                                <p className="text-xs text-[var(--studio-muted)]">{translate("comicDrama.afterConfirmingUpdateCount_343d7e", { value0: nextSteps })}</p>
                                            ) : null}
                                        </div>
                                    </div>

                                    {isPending ? (
                                        <Space wrap>
                                            <Button size="small" type="link" className="px-0" onClick={() => setExpandedKey(expanded ? null : group.key)}>
                                                {expanded ? translate("comicDrama.hideDetails") : translate("comicDrama.viewDetailsCount", { value0: group.impacts.length })}
                                            </Button>
                                            <Button size="small" loading={isLoading} onClick={() => void handleResolve(group, "keepOld")}>{translate("comicDrama.keepPreviousResults")}</Button>
                                            <Button size="small" type="primary" loading={isLoading} onClick={() => void handleResolve(group, "update")}>{translate("comicDrama.confirmUpdate")}</Button>
                                        </Space>
                                    ) : (
                                        <span className="text-xs text-[var(--studio-faint)]">{translate("comicDrama.processedAtCount_78d6c6", { value0: new Date(group.latestAt || "").toLocaleString(translate.locale) })}</span>
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
                                                <span>· {getTargetTypeLabels(translate)[impact.targetType] || impact.targetType}</span>
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
