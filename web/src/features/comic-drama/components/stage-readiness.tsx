"use client";

import { readinessItemText } from "@/features/script/lib/script-localization";

import { translateMessage } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";

import { useRouter } from "@/shared/lib/team-navigation";
import { Alert, Button, Card, Tag } from "antd";
import { ArrowRight, CheckCircle2, CircleAlert, ExternalLink, Sparkles, XCircle } from "lucide-react";

import { useComicDramaStore } from "../stores/use-comic-drama-store";

const getStatusConfig = (translate = translateMessage) => ({
    ready: { label: translate("comicDrama.available"), color: "success", icon: CheckCircle2, className: "text-emerald-500" },
    suggested: { label: translate("comicDrama.suggestedAdditions"), color: "warning", icon: CircleAlert, className: "text-amber-500" },
    missing: { label: translate("comicDrama.missingItems_0b35b8"), color: "error", icon: XCircle, className: "text-rose-500" },
});

/** 生产准备度检查阶段视图。 */
export function StageReadiness() {
    const translate = useTranslation();
    const router = useRouter();
    const workspace = useComicDramaStore((state) => state.workspace);
    const setActiveStage = useComicDramaStore((state) => state.setActiveStage);

    if (!workspace) return null;

    const { readiness, scriptProjectId, scriptProject } = workspace;
    const readyCount = readiness.items.filter((item) => item.status === "ready").length;
    const attentionCount = readiness.items.filter((item) => item.status === "suggested").length;
    const missingCount = readiness.items.filter((item) => item.status === "missing").length;

    const openScript = () => {
        router.push(`/script/${encodeURIComponent(scriptProjectId)}`);
    };

    return (
        <div className="flex flex-col gap-6">
            <header className="flex flex-col gap-2 border-b border-[var(--studio-line)] pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-[var(--studio-ink)]">{translate("comicDrama.scriptProductionReadiness")}</h2>
                    <p className="mt-1 text-sm text-[var(--studio-muted)]">
                        {translate("comicDrama.checkTheSharedScriptMainCharactersScenesAndEpisodeText")}</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button icon={<ExternalLink className="size-4" />} onClick={openScript}>
                        {translate("comicDrama.openScriptWorkspace")}</Button>
                    <Button
                        type="primary"
                        icon={<Sparkles className="size-4" />}
                        onClick={() => setActiveStage(workspace.shots.length > 0 ? "shots" : "settings")}
                    >
                        {translate("comicDrama.continueProduction")}</Button>
                </div>
            </header>

            {readiness.ready ? (
                <Alert
                    type="success"
                    showIcon
                    title={translate("comicDrama.scriptIsReadyForProduction")}
                    description={translate("comicDrama.synopsisMainCharactersEpisodesAndSceneTextAreSufficientlyComplete")}
                />
            ) : missingCount > 0 ? (
                <Alert
                    type="error"
                    showIcon
                    title={translate("comicDrama.countRequiredProductionItemsMissing", { value0: missingCount })}
                    description={translate("comicDrama.coreContentSuchAsEpisodeTextOrCharactersIsIncomplete")}
                    action={
                        <Button size="small" type="primary" onClick={openScript}>
                            {translate("comicDrama.completeContent")}</Button>
                    }
                />
            ) : (
                <Alert
                    type="warning"
                    showIcon
                    title={translate("comicDrama.countSuggestedSettingsToAdd", { value0: attentionCount })}
                    description={translate("comicDrama.theBasicStoryIsAvailableDetailedSettingsHelpKeepShots")}
                />
            )}

            <div className="grid grid-cols-3 gap-4">
                <div className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-4 text-center">
                    <p className="text-2xl font-bold text-emerald-500">{readyCount}</p>
                    <p className="mt-1 text-xs text-[var(--studio-muted)]">{translate("comicDrama.availableItems")}</p>
                </div>
                <div className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-4 text-center">
                    <p className="text-2xl font-bold text-amber-500">{attentionCount}</p>
                    <p className="mt-1 text-xs text-[var(--studio-muted)]">{translate("comicDrama.suggestedAdditions")}</p>
                </div>
                <div className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-4 text-center">
                    <p className="text-2xl font-bold text-rose-500">{missingCount}</p>
                    <p className="mt-1 text-xs text-[var(--studio-muted)]">{translate("comicDrama.missingProductionItems")}</p>
                </div>
            </div>

            <div className="flex flex-col gap-3">
                <h3 className="text-base font-medium text-[var(--studio-ink)]">{translate("comicDrama.checkDetails")}</h3>
                <div className="grid gap-3">
                    {readiness.items.map((item) => {
                        const config = getStatusConfig(translate)[item.status];
                        const Icon = config.icon;
                        return (
                            <div
                                key={item.key}
                                className="flex items-start justify-between gap-4 rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-4 transition-colors hover:border-[var(--studio-line-strong)]"
                            >
                                <div className="flex items-start gap-3">
                                    <Icon className={`mt-0.5 size-5 shrink-0 ${config.className}`} />
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-[var(--studio-ink)]">{readinessItemText(item, translate).title}</span>
                                            <Tag color={config.color}>{config.label}</Tag>
                                        </div>
                                        <p className="mt-1 text-sm text-[var(--studio-muted)]">{readinessItemText(item, translate).description}</p>
                                    </div>
                                </div>
                                <Button
                                    size="small"
                                    type="link"
                                    icon={<ArrowRight className="size-3.5" />}
                                    onClick={openScript}
                                >
                                    {translate("comicDrama.editScript")}</Button>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="mt-4 flex items-center justify-between rounded-xl border border-dashed border-[var(--studio-line)] p-4">
                <div>
                    <h4 className="text-sm font-semibold text-[var(--studio-ink)]">{translate("comicDrama.linkedScriptCount_1bee45", { value0: scriptProject.overview.title })}</h4>
                    <p className="text-xs text-[var(--studio-muted)]">{translate("comicDrama.countPlannedEpisodesRevisionCountSharedSingleSourceOf_2c8c68", { value0: scriptProject.episodes.length, value1: workspace.revision })}</p>
                </div>
                <Button type="primary" onClick={() => setActiveStage("settings")}>
                    {translate("comicDrama.openProductionSettings")}</Button>
            </div>
        </div>
    );
}
