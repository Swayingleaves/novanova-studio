"use client";

import { translateMessage } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";

import { useEffect, useState } from "react";
import { App, Alert, Button, Progress, Radio, Select, Tag } from "antd";
import { nanoid } from "nanoid";

import { ModelPicker } from "@/features/settings/components/model-picker";
import { useModelConfigurationGuard } from "@/features/settings/hooks/use-model-configuration-guard";
import { useEffectiveConfig } from "@/features/settings/stores/use-config-store";
import { cancelEpisodeBodies, episodeBodiesStatus, episodeBodiesUnitPrice, latestEpisodeBodies, quoteEpisodeBodies, retryEpisodeBodies, startEpisodeBodies } from "@/services/api/script";
import { useScriptStore } from "../stores/use-script-store";
import type { EpisodeBodiesJob, EpisodeBodiesMode, NovelAdaptationJobStatus } from "../types";

/** 正文批量任务的进度查询间隔。 */
const JOB_POLL_INTERVAL_MILLISECONDS = 3000;

const getJobStatusLabels = (translate = translateMessage): Record<NovelAdaptationJobStatus, string> => ({ queued: translate("script.queued"), running: translate("script.generating"), awaiting: translate("script.awaitingConfirmation"), completed: translate("script.completed"), failed: translate("script.generationFailedUnusedCreditsHaveBeenRefunded"), canceled: translate("script.canceledCreditsForUnfinishedWorkHaveBeenRefunded") });
const JOB_STATUS_COLORS: Record<NovelAdaptationJobStatus, string> = { queued: "blue", running: "blue", awaiting: "gold", completed: "green", failed: "red", canceled: "default" };

/** 生成模式的中文名与结果去向，两处文案共用。 */
const getModeLabels = (translate = translateMessage): Record<EpisodeBodiesMode, string> => ({ apply: translate("script.generateDirectlyIntoTheScriptRecommended"), draft: translate("script.generateDraftsForReviewApproveEachEpisodeIndividually") });
const getModeDetails = (translate = translateMessage): Record<EpisodeBodiesMode, string> => ({
    apply: translate("script.eachCompletedEpisodeIsImmediatelySavedIntoTheScriptAs"),
    draft: translate("script.resultsAreSavedAsDraftsPreviewAndApproveEachEpisode"),
});

/**
 * 批量生成分集正文：把已固定的分集一次排队写成场次与正文。
 *
 * @param onJobChange 任务状态变化回调，供上层流程步骤条显示第 8 步「分集正文」的进度
 */
export function EpisodeBodiesPanel({ onJobChange }: { onJobChange?: (job: EpisodeBodiesJob | null) => void }) {
    const translate = useTranslation();
    const { message, modal } = App.useApp();
    const project = useScriptStore((state) => state.project);
    const saveStatus = useScriptStore((state) => state.saveStatus);
    const reloadProject = useScriptStore((state) => state.reloadProject);
    const config = useEffectiveConfig();
    const ensureModelConfiguration = useModelConfigurationGuard();
    const [model, setModel] = useState("");
    const [mode, setMode] = useState<EpisodeBodiesMode>("apply");
    const [episodeIds, setEpisodeIds] = useState<string[]>([]);
    const [job, setJob] = useState<EpisodeBodiesJob | null>(null);
    const [jobBusy, setJobBusy] = useState(false);
    // 每集积分来自后台的分集正文定价：undefined 表示还在读取，null 表示该模型尚未定价。
    const [unitPrice, setUnitPrice] = useState<number | null | undefined>(undefined);
    // 读取失败必须和「未定价」分开：接口不可用时若提示去后台配置，会把人引去反复检查一个本来没错的配置。
    const [unitPriceFailed, setUnitPriceFailed] = useState(false);
    const projectId = project?.id || "";
    const episodes = project?.episodes || [];
    // completionStatus 只反映分集规划的进度，判断不了一集有没有场次，所以默认范围取全部分集。
    const episodeKey = episodes.map((episode) => episode.id).join(",");

    useEffect(() => { if (!model && config.textModel) setModel(config.textModel); }, [config.textModel, model]);
    // 单价随模型变化重新读取，不能取模型自身的 creditCost：那与后台配置是两套值，会显示不一致。
    useEffect(() => {
        if (!model) return setUnitPrice(undefined);
        let active = true;
        setUnitPrice(undefined);
        setUnitPriceFailed(false);
        void episodeBodiesUnitPrice(model)
            .then((result) => { if (active) setUnitPrice(result.unitPrice); })
            .catch(() => { if (active) setUnitPriceFailed(true); });
        return () => { active = false; };
    }, [model]);
    // 上层流程步骤条的第 8 步依赖这里的状态，任务一变就上报。
    useEffect(() => { onJobChange?.(job); }, [job, onJobChange]);
    useEffect(() => { setEpisodeIds(episodes.map((episode) => episode.id)); }, [episodeKey]);
    // 刷新后恢复最近一次任务，避免用户失去续跑入口；项目还没有任务时不显示任务区。
    useEffect(() => {
        if (!projectId) return;
        let active = true;
        setJob(null);
        void latestEpisodeBodies(projectId)
            .then((latest) => { if (active) setJob(latest || null); })
            .catch((error: unknown) => { if (active) message.error(error instanceof Error ? error.message : translate("script.couldNotLoadGenerationProgress")); });
        return () => { active = false; };
    }, [projectId]);

    const jobId = job?.jobId || "";
    const jobRunning = job != null && (job.status === "queued" || job.status === "running");
    useEffect(() => {
        if (!jobRunning || !jobId) return;
        // 轮询失败只在第一次提示，否则每 3 秒都会弹一次。
        let notified = false;
        const timer = window.setInterval(() => {
            void episodeBodiesStatus(projectId, jobId).then((next) => {
                notified = false;
                setJob(next);
                if (next.status !== "completed") return;
                message.success(translate("script.generatedBodyTextForCountEpisodes", { value0: next.processedEpisodes }));
                void reloadProject();
            }).catch((error: unknown) => {
                if (notified) return;
                notified = true;
                message.error(error instanceof Error ? error.message : translate("script.couldNotRefreshGenerationProgress"));
            });
        }, JOB_POLL_INTERVAL_MILLISECONDS);
        return () => window.clearInterval(timer);
    }, [jobId, jobRunning, projectId]);

    if (!project) return null;

    /** 批量生成正文：先按所选分集报价，确认后交给后台逐集排队。 */
    const runBatch = async () => {
        if (!ensureModelConfiguration("text", model)) return;
        if (!episodeIds.length) return message.warning(translate("script.selectAtLeastOneEpisodeToGenerate"));
        if (!["saved", "idle"].includes(saveStatus)) return message.warning(translate("script.saveYourScriptChangesBeforeGenerating"));
        setJobBusy(true);
        try {
            const clientRequestId = nanoid();
            const quote = await quoteEpisodeBodies({ projectId, expectedRevision: project.revision, model, mode, episodeIds });
            modal.confirm({
                title: translate("script.generateBodyTextForCountEpisodes", { value0: quote.episodes }),
                content: (
                    <div className="mt-3 space-y-1 text-sm">
                        <p>{translate("script.episodesToGenerateCount_346622", { value0: quote.episodes })}</p>
                        <p>{translate("script.estimatedCallsCount_21cb78", { value0: quote.calls })}</p>
                        <p className="font-semibold">{translate("script.creditsReservedCount_731bdd", { value0: quote.credits })}</p>
                        <p>{translate("script.modeCount_ed9352", { value0: getModeLabels(translate)[mode] })}</p>
                        <p>{translate("script.outputCount_e5df42", { value0: getModeDetails(translate)[mode] })}</p>
                        <p className="text-xs text-[var(--studio-muted)]">{translate("script.eachEpisodeUsesOneCallOnlySuccessfulEpisodesAreCharged")}</p>
                    </div>
                ),
                okText: translate("script.confirmAndChargeCountCredits", { value0: quote.credits }),
                cancelText: translate("script.cancel"),
                onOk: async () => {
                    const latest = useScriptStore.getState().project;
                    if (!latest || latest.id !== projectId) throw new Error(translate("script.theCurrentProjectHasChangedStartAgain"));
                    setJob(await startEpisodeBodies({ projectId, expectedRevision: latest.revision, clientRequestId,
                        model, mode, episodeIds, expectedCredits: quote.credits, expectedFingerprint: quote.fingerprint }));
                    message.success(translate("script.submittedGeneratingBodyTextForCountEpisodesInTheBackground", { value0: quote.episodes }));
                },
            });
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("script.couldNotStartBatchGeneration"));
        } finally {
            setJobBusy(false);
        }
    };

    /** 从失败或取消处继续，已完成分集保留，续跑只重做未完成分集且不重复扣费。 */
    const retryJob = () => {
        if (!job) return;
        modal.confirm({
            title: translate("script.resumeUnfinishedEpisodes"),
            content: (
                <div className="mt-3 space-y-1 text-sm">
                    <p>{translate("script.keepCountCompletedEpisodesAndRegenerateOnlyTheRemaining_137560", { value0: job.processedEpisodes, value1: job.failedEpisodeIds.length })}</p>
                    <p className="text-xs text-[var(--studio-muted)]">{translate("script.resolveTheCauseOfTheFailureFirstForExampleRestart")}</p>
                </div>
            ),
            okText: translate("script.continueGenerating"),
            cancelText: translate("script.cancel"),
            onOk: async () => {
                setJobBusy(true);
                try {
                    setJob(await retryEpisodeBodies(projectId, job.jobId));
                    message.success(translate("script.submittedResumingUnfinishedEpisodes"));
                } catch (error) {
                    message.error(error instanceof Error ? error.message : translate("script.couldNotResumeGeneration"));
                    throw error;
                } finally { setJobBusy(false); }
            },
        });
    };

    /** 取消任务并按未完成分集退回预扣积分，已生成的正文保留。 */
    const cancelJob = () => {
        if (!job) return;
        modal.confirm({
            title: translate("script.cancelBatchGeneration"),
            content: translate("script.completedBodyTextWillBeKeptReservedCreditsForUnfinished"),
            okText: translate("script.confirmCancellation"),
            cancelText: translate("script.continueGenerating"),
            onOk: async () => {
                setJobBusy(true);
                try {
                    setJob(await cancelEpisodeBodies(projectId, job.jobId));
                    message.success(translate("script.canceledCreditsForUnfinishedWorkHaveBeenRefunded_f9127e"));
                } catch (error) {
                    message.error(error instanceof Error ? error.message : translate("script.couldNotCancel"));
                } finally { setJobBusy(false); }
            },
        });
    };

    return <div className="mt-3 border-t border-dashed border-[var(--studio-line-strong)] pt-3">
        <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{translate("script.batchEpisodeGeneration")}</h3>
            {job ? <Tag color={JOB_STATUS_COLORS[job.status]} className="mr-0">{getJobStatusLabels(translate)[job.status]}</Tag> : null}
            <span className="flex-1" />
            {jobRunning
                ? <Button size="small" danger loading={jobBusy} onClick={cancelJob}>{translate("script.cancelTask")}</Button>
                : <Button type="primary" size="small" loading={jobBusy} disabled={!episodes.length} onClick={() => void runBatch()}>{job ? translate("script.regenerateInBatch") : translate("script.generateEpisodeTextInBatch")}</Button>}
        </div>
        <p className="mt-1 text-xs text-[var(--studio-muted)]">{translate("script.generateScenesActionDialogueAndNarrationForTheFixedEpisode")}</p>
        {job ? <div className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--studio-muted)]">
                <span>{translate("script.generatedCountCountEpisodes_b69cb7", { value0: job.processedEpisodes, value1: job.totalEpisodes })}</span>
                <span>{translate("script.creditsReservedForThisStageCountcount_3ba93d", { value0: job.credits, value1: job.refundedCredits ? translate("script.refundedCount", { value0: job.refundedCredits }) : "" })}</span>
                {job.retryCount ? <span>{translate("script.resumedCountTimes_a627b9", { value0: job.retryCount })}</span> : null}
            </div>
            {jobRunning ? <Progress percent={job.totalEpisodes ? Math.min(99, Math.round(job.processedEpisodes / job.totalEpisodes * 100)) : 0} size="small" showInfo={false} strokeColor="var(--studio-primary)" /> : null}
            {job.status === "completed" ? <Alert type="success" showIcon title={translate("script.generatedBodyTextForCountEpisodes", { value0: job.processedEpisodes })} description={job.mode === "draft" ? translate("script.scriptDataRefreshedThisBatchProducedReviewDraftsApproveEach") : translate("script.scriptDataRefreshedScenesAndBodyTextHaveBeenAdded")} /> : null}
            {job.errorMessage ? <Alert type="error" showIcon title={job.errorMessage} /> : null}
            {job.status === "failed" || job.status === "canceled" ? <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm">{translate("script.countEpisodesRemainUnfinishedCompletedEpisodesWillBeKept_cfd86b", { value0: job.failedEpisodeIds.length })}</span>
                <span className="flex-1" />
                {job.failedEpisodeIds.length ? <Button type="primary" size="small" loading={jobBusy} onClick={retryJob}>{translate("script.resumeUnfinishedEpisodes_039066")}</Button> : null}
            </div> : null}
        </div> : null}
        <div className="mt-3 space-y-3 rounded-lg border border-dashed border-[var(--studio-line-strong)] p-3">
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{translate("script.generationRange")}</span>
                <span className="text-xs text-[var(--studio-muted)]">{translate("script.selectedCountCountEpisodes_638d82", { value0: episodeIds.length, value1: episodes.length })}</span>
                <span className="flex-1" />
                <Button size="small" type="link" className="px-0" disabled={!episodes.length} onClick={() => setEpisodeIds(episodes.map((episode) => episode.id))}>{translate("script.all")}</Button>
                <Button size="small" type="link" className="px-0" disabled={!episodeIds.length} onClick={() => setEpisodeIds([])}>{translate("script.deselectAll")}</Button>
                <Button size="small" type="link" className="px-0" disabled={!episodes.length} onClick={() => setEpisodeIds(episodes.filter((episode) => episode.completionStatus !== "complete").map((episode) => episode.id))}>{translate("script.selectUnfinishedOnly")}</Button>
            </div>
            {episodes.length
                ? <Select mode="multiple" className="w-full" value={episodeIds} maxTagCount="responsive" showSearch optionFilterProp="label" placeholder={translate("script.selectEpisodesToGenerate")} options={episodes.map((episode) => ({ value: episode.id, label: translate("script.episodeCountCount", { value0: episode.episodeNumber, value1: episode.title || translate("script.untitledEpisode") }) }))} onChange={(value: string[]) => setEpisodeIds(value)} />
                : <Alert type="warning" showIcon title={translate("script.completeTheEpisodePlanFirst")} description={translate("script.fullBookAdaptationFixesEpisodeIdentitiesAndNumbersBeforeBatch")} />}
            <div className="space-y-1">
                <p className="text-sm font-medium">{translate("script.generationMode")}</p>
                <Radio.Group value={mode} onChange={(event) => setMode(event.target.value)} options={[{ value: "apply", label: getModeLabels(translate).apply }, { value: "draft", label: getModeLabels(translate).draft }]} />
                <p className="text-xs text-[var(--studio-muted)]">{getModeDetails(translate)[mode]}</p>
            </div>
            <label className="block text-sm">{translate("script.textModel")}<div className="mt-1"><ModelPicker config={config} value={model} onChange={setModel} capability="text" fullWidth /></div></label>
            <Alert type={unitPriceFailed ? "warning" : "info"} showIcon
                title={translate("script.textModelPriceCount", { value0: unitPriceFailed ? translate("script.couldNotLoadRefreshThePageAndTryAgain") : unitPrice === undefined ? translate("script.loading") : unitPrice === null ? translate("script.notConfiguredSetThePriceUnderScriptPricingEpisodeText") : translate("script.countCreditsEpisode", { value0: unitPrice }) })}
                description={translate("script.oneCallPerEpisodeCreditsAreReservedForTheSelected")} />
        </div>
    </div>;
}
