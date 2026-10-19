"use client";

import { translateMessage, translateMessage as translate } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";

import { useEffect, useState } from "react";
import { App, Alert, Button, InputNumber, Progress, Select, Steps, Tag } from "antd";
import { nanoid } from "nanoid";

import { ModelPicker } from "@/features/settings/components/model-picker";
import { useModelConfigurationGuard } from "@/features/settings/hooks/use-model-configuration-guard";
import { useEffectiveConfig } from "@/features/settings/stores/use-config-store";
import { advanceWholeBookAdaptation, cancelWholeBookAdaptation, confirmWholeBookAdaptation, listActiveWholeBookAdaptation, quoteWholeBookAdaptation, retryWholeBookAdaptation, startWholeBookAdaptation, wholeBookAdaptationStatus } from "@/services/api/script";
import { useScriptStore } from "../stores/use-script-store";
import type { EpisodeBodiesJob, WholeBookAdaptationJob, WholeBookAdaptationOptions } from "../types";
import { EpisodeBodiesPanel } from "./episode-bodies-panel";

const getStages = (translate = translateMessage) => ([
    { value: "overview", label: translate("script.storyOverview") },
    { value: "characters", label: translate("script.charactersAndRelationships") },
    { value: "world", label: translate("script.worldAndLocations") },
    { value: "outline", label: translate("script.storyOutline") },
    { value: "episodes", label: translate("script.episodePlanning") },
    { value: "episode", label: translate("script.episodeScript") },
] as const);

/** 全书改编任务的进度查询间隔。 */
const JOB_POLL_INTERVAL_MILLISECONDS = 3000;

/** 阶段中文名，按阶段取值反查。 */
const STAGE_LABELS: Record<string, string> = Object.fromEntries(getStages(translate).map((item) => [item.value, item.label]));
const getJobStatusLabels = (translate = translateMessage): Record<WholeBookAdaptationJob["status"], string> => ({ queued: translate("script.queued"), running: translate("script.generating"), awaiting: translate("script.awaitingConfirmation"), completed: translate("script.completed"), failed: translate("script.generationFailedUnusedCreditsHaveBeenRefunded"), canceled: translate("script.canceledCompletedStepsHaveBeenCharged") });
const getPhaseLabels = (translate = translateMessage): Record<WholeBookAdaptationJob["phase"], string> => ({ materials: translate("script.sourceAndStrategy"), planning: translate("script.unifiedPlanning"), drafts: translate("script.episodeText") });

/**
 * 改编全流程，与后端实际执行的单元阶段一一对应：
 * 第一步「改编设置」定下形式与节奏，随后七步是全书改编（materials 阶段的 material/strategy，集数确认停点，
 * planning 阶段的 overview→episodePlan，应用停点），第九步「分集正文」是它的延续：
 * 把已应用的分集规划逐集写成场次与正文，产出物从分集规划变成场次和正文块。
 */
const getAdaptationFlowSteps = (translate = translateMessage): Array<{ title: string; content: string; detail: string }> => ([
    { title: translate("script.adaptationSettings"), content: translate("script.formatPacingAndTextModel"), detail: translate("script.chooseTheAdaptationFormatEpisodeDurationPacingAdaptationApproachAnd") },
    { title: translate("script.sourceSynthesis"), content: translate("script.summarizeTheBookInBatches"), detail: translate("script.summarizeAllConfirmedFactsInBatchesSizedForTheModel") },
    { title: translate("script.bookStrategy"), content: translate("script.mainPlotEndingAndStoryArcs"), detail: translate("script.createAStrategyFromTheFullSourceMainPlotEnding") },
    { title: translate("script.confirmEpisodeCount"), content: translate("script.fixEpisodeNumbersAfterConfirmation"), detail: translate("script.confirmTheFinalEpisodeCountTheServerAllocatesEpisodesProportionally") },
    { title: translate("script.overviewAndOutline"), content: translate("script.storyOverviewAndOutline"), detail: translate("script.generateTheOverviewAndOutlineTogetherFromTheConfirmedStrategy") },
    { title: translate("script.charactersAndLocations"), content: translate("script.relationshipsWorldAndLocations"), detail: translate("script.generateCharactersRelationshipsWorldSettingsAndLocationsInCapacityBased") },
    { title: translate("script.selectionAndEpisodePlanning"), content: translate("script.eventAllocationAndEpisodePlans"), detail: translate("script.allocateEventsToTheFixedEpisodesInBatchesRecordEach") },
    { title: translate("script.applyReplacement"), content: translate("script.saveToTheProjectAfterApproval"), detail: translate("script.afterYourConfirmationApplyTheUnifiedPlanInOneTransaction") },
    { title: translate("script.episodeBodyText"), content: translate("script.generateScenesAndEpisodeText"), detail: translate("script.generateScenesActionDialogueAndNarrationIntoTheScriptUsing") },
]);

/** 第一步「改编设置」的下标。 */
const ADAPTATION_SETTINGS_STEP_INDEX = 0;

/** 最后一步「分集正文」的下标；前面是改编设置与全书改编七步。 */
const BODIES_STEP_INDEX = getAdaptationFlowSteps(translate).length - 1;

/**
 * 由任务阶段反查当前进行到第几步。
 * 返回 -1 表示尚未开始（停在第 1 步「改编设置」），返回步骤总数表示全部走完。
 * 最后一步「分集正文」的状态由正文任务自己决定，所以需要一并传入。
 * 注意：返回值是 ADAPTATION_FLOW_STEPS 的下标，第一步是改编设置，所以下面前七步统一 +1。
 */
function adaptationStepIndex(job: WholeBookAdaptationJob | null, bodiesJob: EpisodeBodiesJob | null, translate = translateMessage) {
    // 旧流程创建的任务没有工作流快照，阶段取值与当前流程不对应，不做步骤高亮。
    if (!job || job.historical) return -1;
    if (job.status === "completed") return bodiesJob?.status === "completed"
            ? getAdaptationFlowSteps(translate).length : BODIES_STEP_INDEX;
    if (job.phase === "materials") return job.stage === "strategy" ? 2 : 1;
    // 集数一旦锁定（已分配分集身份）就说明集数确认停点已经过去，两个停点的阶段取值相同。
    if (!job.lockedEpisodeCount) return 3;
    if (job.status === "awaiting" && job.stage === "episodePlan") return 7;
    if (job.stage === "characters" || job.stage === "locations") return 5;
    if (job.stage === "assignment" || job.stage === "episodePlan") return 6;
    return 4;
}

/** 全书改编：设置改编参数、启动后台任务，并在集数与应用两个停点确认。 */
export function NovelAdaptationPanel() {
    const translate = useTranslation();
    const { message, modal } = App.useApp();
    const project = useScriptStore((state) => state.project);
    const saveStatus = useScriptStore((state) => state.saveStatus);
    const reloadProject = useScriptStore((state) => state.reloadProject);
    const config = useEffectiveConfig();
    const ensureModelConfiguration = useModelConfigurationGuard();
    const [model, setModel] = useState("");
    const [settings, setSettings] = useState<WholeBookAdaptationOptions>({ format: "comicDrama", episodeDurationSeconds: 180, pacing: "balanced", adaptationLevel: "balanced" });
    const [loadError, setLoadError] = useState("");
    const [jobLoadKey, setJobLoadKey] = useState(0);
    const projectId = project?.id || "";
    const creditCost = config.modelCosts.find((item) => item.taskType === "text" && item.model === model)?.credits;
    const [job, setJob] = useState<WholeBookAdaptationJob | null>(null);
    const [jobBusy, setJobBusy] = useState(false);
    // 第八步「分集正文」由内嵌的分集正文面板执行，这里只接收它的任务状态，用于步骤条的进度与状态。
    const [bodiesJob, setBodiesJob] = useState<EpisodeBodiesJob | null>(null);
    const [episodeCount, setEpisodeCount] = useState(0);
    // 点选步骤后固定查看该步，为空时跟随真实进度。
    const [pinnedStep, setPinnedStep] = useState<number | null>(null);

    useEffect(() => { if (!model && config.textModel) setModel(config.textModel); }, [config.textModel, model]);
    useEffect(() => { if (project) setSettings((current) => ({ ...current, format: project.overview.contentType, episodeDurationSeconds: project.overview.targetDurationSeconds || 180 })); }, [project?.id]);
    // 页面刷新后恢复进行中或最近失败的任务，避免用户失去续跑入口；失败时可手动重试。
    useEffect(() => {
        if (!projectId) return;
        let active = true;
        setJob(null);
        setLoadError("");
        void listActiveWholeBookAdaptation(projectId)
            .then((jobs) => { if (active) setJob(jobs[0] || null); })
            .catch((error: unknown) => { if (active) setLoadError(error instanceof Error ? error.message : translate("script.couldNotLoadAdaptationTasks")); });
        return () => { active = false; };
    }, [jobLoadKey, projectId]);

    const jobId = job?.jobId || "";
    const jobRunning = job != null && (job.status === "queued" || job.status === "running");
    useEffect(() => {
        if (!jobRunning || !jobId) return;
        const timer = window.setInterval(() => {
            void wholeBookAdaptationStatus(projectId, jobId).then(setJob).catch(() => undefined);
        }, JOB_POLL_INTERVAL_MILLISECONDS);
        return () => window.clearInterval(timer);
    }, [jobId, jobRunning, projectId]);

    if (!project) return null;

    /** 全书改编：先用全部已确认事实报价素材与策略阶段，确认后交给后台异步执行。 */
    const runWholeBook = async () => {
        if (!ensureModelConfiguration("text", model)) return;
        if (!["saved", "idle"].includes(saveStatus)) return message.warning(translate("script.saveScriptChangesBeforeStartingAdaptation"));
        setJobBusy(true);
        try {
            const clientRequestId = nanoid();
            const quote = await quoteWholeBookAdaptation({ projectId, expectedRevision: project.revision, model, options: settings });
            modal.confirm({
                title: translate("script.confirmCount", { value0: startLabel }),
                content: (
                    <div className="mt-3 space-y-1 text-sm">
                        <p>{translate("script.inputAllConfirmedStoryFactsIncludingTheMainPlotCharacter")}</p>
                        <p>{translate("script.thisRunSourceSynthesisBookStrategyThenPauseForEpisode")}</p>
                        <p>{translate("script.estimatedCallsCount_21cb78", { value0: quote.calls })}</p>
                        <p className="font-semibold">{translate("script.creditsReservedForThisStageCount_824b16", { value0: quote.credits })}</p>
                        {job ? <p>{translate("script.thisIsANewAdaptationRunItCreatesANew")}</p> : null}
                        <p className="text-xs text-[var(--studio-muted)]">{translate("script.episodeCountIsConfirmedAfterStrategyGenerationTheServerThen")}</p>
                    </div>
                ),
                okText: translate("script.confirmAndChargeCountCredits", { value0: quote.credits }),
                cancelText: translate("script.cancel"),
                onOk: async () => {
                    const latest = useScriptStore.getState().project;
                    if (!latest || latest.id !== projectId) throw new Error(translate("script.theCurrentProjectHasChangedStartAgain"));
                    setJob(await startWholeBookAdaptation({ projectId, expectedRevision: latest.revision, clientRequestId,
                        model, options: settings, expectedCredits: quote.credits, expectedFingerprint: quote.fingerprint }));
                    message.success(translate("script.submittedSynthesizingSourcesAndCreatingTheBookStrategyInThe"));
                },
            });
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("script.couldNotStartFullBookAdaptation"));
        } finally {
            setJobBusy(false);
        }
    };

    /** 策略停点确认最终集数，服务端按故事阶段配额固定全部分集身份并继续生成统一规划。 */
    const confirmEpisodeCount = () => {
        if (!job || !job.strategy) return;
        const arcs = job.strategy.arcs.length;
        // 只锁定过集数、尚未生成规划的任务重新进入这里时沿用已锁定集数，避免再次要求输入。
        const targetCount = episodeCount || job.lockedEpisodeCount;
        const resumed = job.lockedEpisodeCount > 0;
        if (targetCount < arcs) return message.warning(translate("script.keepingAllCountStoryArcsRequiresAtLeastCountEpisodes", { value0: arcs, value1: arcs }));
        modal.confirm({
            title: resumed ? translate("script.continueGeneratingAUnifiedPlanForCountEpisodes", { value0: targetCount }) : translate("script.confirmCountEpisodes", { value0: targetCount }),
            content: (
                <div className="mt-3 space-y-1 text-sm">
                    <p>{translate("script.allocateEpisodesProportionallyAcrossArcsUsingTheLargestRemainder_28bc3c", { value0: targetCount })}</p>
                    <p>{translate("script.nextGenerateTheOverviewOutlineCharacterAndLocationSettingsAnd")}</p>
                    <p className="text-xs text-[var(--studio-muted)]">{translate("script.onceUsedForAllocationTheEpisodeCountIsFixedStart")}</p>
                </div>
            ),
            okText: resumed ? translate("script.continueGenerating") : translate("script.confirmEpisodeCount"),
            cancelText: translate("script.reviewAgain"),
            onOk: async () => {
                setJobBusy(true);
                try {
                    setJob(await advanceWholeBookAdaptation({ projectId, jobId: job.jobId, expectedRevision: job.revision,
                        expectedRetryCount: job.retryCount, episodeCount: targetCount }));
                    message.success(translate("script.submittedGeneratingTheUnifiedPlanInTheBackground"));
                } catch (error) {
                    message.error(error instanceof Error ? error.message : translate("script.couldNotConfirmTheEpisodeCount"));
                    throw error;
                } finally { setJobBusy(false); }
            },
        });
    };

    /** 统一规划停点应用待审草稿，替换概览、大纲、设定与分集。 */
    const confirmPlanning = () => {
        if (!job) return;
        modal.confirm({
            title: translate("script.applyAndReplace"),
            content: (
                <div className="mt-3 space-y-1 text-sm">
                    <p>{translate("script.saveTheGeneratedOverviewOutlineCharacterAndLocationSettings_ddb44e", { value0: job.lockedEpisodeCount })}</p>
                    <p>{translate("script.aPreviousVersionWillBeSavedStoryboardsVisualAssetsAnd")}</p>
                    <p className="text-xs text-[var(--studio-muted)]">{translate("script.applicationIsTransactionalAFailureLeavesNoPartiallyAppliedContent")}</p>
                </div>
            ),
            okText: translate("script.applyAndContinue"),
            cancelText: translate("script.reviewAgain"),
            onOk: async () => {
                setJobBusy(true);
                try {
                    setJob(await confirmWholeBookAdaptation(projectId, job.jobId));
                    await reloadProject();
                    message.success(translate("script.appliedToTheProject"));
                } catch (error) {
                    message.error(error instanceof Error ? error.message : translate("script.couldNotApplyTheUnifiedPlan"));
                    throw error;
                } finally { setJobBusy(false); }
            },
        });
    };

    /** 从失败处的缺失单元继续，成功单元不会重跑或重复扣费。 */
    const retryJob = () => {
        if (!job) return;
        modal.confirm({
            title: translate("script.resumeFromTheFailure"),
            content: (
                <div className="mt-3 space-y-1 text-sm">
                    <p>{translate("script.keepCountSuccessfulGenerationUnitsAndRerunOnlyThe_b86bf2", { value0: job.processedUnits })}</p>
                    <p className="text-xs text-[var(--studio-muted)]">{translate("script.resolveTheFailureFirstForExampleRestartTheBackendAfter")}</p>
                </div>
            ),
            okText: translate("script.continueGenerating"),
            cancelText: translate("script.cancel"),
            onOk: async () => {
                setJobBusy(true);
                try {
                    setJob(await retryWholeBookAdaptation(projectId, job.jobId));
                    message.success(translate("script.submittedResumingUnfinishedGenerationUnits"));
                } catch (error) {
                    message.error(error instanceof Error ? error.message : translate("script.couldNotResumeGeneration"));
                    throw error;
                } finally { setJobBusy(false); }
            },
        });
    };

    /** 取消任务并退还未完成单元的积分。 */
    const cancelJob = () => {
        if (!job) return;
        modal.confirm({
            title: translate("script.cancelFullBookAdaptation"),
            content: translate("script.generatedSourceSummariesAndStrategyWillBeKeptUnusedCall"),
            okText: translate("script.confirmCancellation"),
            cancelText: translate("script.continueGenerating"),
            onOk: async () => {
                setJobBusy(true);
                try {
                    setJob(await cancelWholeBookAdaptation(projectId, job.jobId));
                    message.success(translate("script.canceledCreditsForUnfinishedWorkHaveBeenRefunded_f9127e"));
                } catch (error) {
                    message.error(error instanceof Error ? error.message : translate("script.couldNotCancel"));
                } finally { setJobBusy(false); }
            },
        });
    };

    const suggestedEpisodes = job?.strategy?.arcs.reduce((total, arc) => total + arc.recommendedEpisodes, 0) || 0;
    // 未开始用 wait 让首步保持灰色，失败与取消落在当前步上报错，第八步也走完才算全部结束。
    const allFinished = job?.status === "completed" && bodiesJob?.status === "completed";
    const flowStep = adaptationStepIndex(job, bodiesJob, translate);
    const flowStatus: "wait" | "process" | "error" | "finish" = !job || job.historical ? "wait"
        : job.status === "failed" || job.status === "canceled" ? "error"
            : allFinished ? "finish" : "process";
    // 集数确认停点：只有这一阶段才显示集数输入与确认按钮。stage 仍是 strategy 的等待态也可能是
    // 已锁定集数但尚未规划的任务（旧任务续跑），所以用 stage 区分两个停点，而不是只看集数是否锁定。
    const atEpisodeStop = job != null && job.status === "awaiting" && job.phase === "planning" && job.stage !== "episodePlan";
    // 参数只属于启动前：任务在跑或停在确认点时参数已经定格，只有未开始或已结束才允许调整下次启动的参数。
    const settingsVisible = job == null || job.status === "completed" || job.status === "failed" || job.status === "canceled";
    // 已有任务时不再说「启动」：完成过的叫重新改编，取消或失败的叫重新开始。
    const startLabel = job == null ? translate("script.startFullBookAdaptation") : job.status === "completed" ? translate("script.readapt") : translate("script.startOver");
    // 展示哪一步：点选后固定，否则跟随真实进度。完成时 flowStep 等于步骤总数，需要夹回最后一步。
    const detailStep = pinnedStep ?? Math.min(Math.max(0, flowStep), getAdaptationFlowSteps(translate).length - 1);
    const stepItems = getAdaptationFlowSteps(translate).map((step, index) => ({
        title: index === detailStep ? <span className="text-[var(--studio-action)]">{step.title}</span> : step.title,
        content: step.content,
    }));

    /** 步骤状态：优先反映完成情况，只有真实所在的那一步才带进行中或异常。 */
    const stepState = (index: number): { label: string; color: string } => {
        if (!job || job.historical) return { label: translate("script.notStarted"), color: "default" };
        // 第八步由正文任务自己驱动：全书改编完成只是走到这一步，并不代表正文已经生成。
        if (index === BODIES_STEP_INDEX) {
            if (job.status !== "completed" || !bodiesJob) return { label: translate("script.pending"), color: "default" };
            if (bodiesJob.status === "completed") return { label: translate("script.completed"), color: "green" };
            if (bodiesJob.status === "failed") return { label: translate("script.failed"), color: "red" };
            if (bodiesJob.status === "canceled") return { label: translate("script.canceled"), color: "default" };
            return { label: translate("script.inProgress"), color: "blue" };
        }
        if (job.status === "completed" || flowStep > index) return { label: translate("script.completed"), color: "green" };
        if (flowStep < index) return { label: translate("script.pending"), color: "default" };
        if (job.status === "awaiting") return { label: translate("script.awaitingYourConfirmation"), color: "gold" };
        if (job.status === "failed") return { label: translate("script.failed"), color: "red" };
        if (job.status === "canceled") return { label: translate("script.canceled"), color: "default" };
        return { label: translate("script.inProgress"), color: "blue" };
    };

    /** 选中步骤的产出：第一步与最后一步由详情区单独渲染，全书策略与确认集数共用策略正文。 */
    const stepOutput = (index: number) => {
        // 第一步的内容是改编设置表单、最后一步的内容是分集正文面板，都不是只读产出。
        if (index === ADAPTATION_SETTINGS_STEP_INDEX || index === BODIES_STEP_INDEX) return null;
        if (!job) return <p className="text-xs text-[var(--studio-muted)]">{translate("script.notStartedResultsWillAppearHereAfterThisStepCompletes")}</p>;
        if (index === 2 || index === 3) {
            const strategy = job.strategy;
            return <div className="space-y-2">
                {strategy ? <>
                    <p className="text-sm">{strategy.mainPlot}</p>
                    <p className="text-xs text-[var(--studio-muted)]">{translate("script.endingCount_5b727d", { value0: strategy.ending })}</p>
                    <p className="text-xs text-[var(--studio-muted)]">{translate("script.episodeCountRationaleCount_4e0067", { value0: strategy.reasoning })}</p>
                    <p className="text-xs text-[var(--studio-muted)]">{translate("script.compressionChoicesCount_150acd", { value0: strategy.compression })}</p>
                    <div className="space-y-1">{strategy.arcs.map((arc, position) => <div key={`${arc.title}-${position}`} className="flex flex-wrap items-baseline gap-2 rounded border border-[var(--studio-line)] px-2 py-1 text-sm"><span className="font-medium">{position + 1}. {arc.title}</span><Tag className="mr-0">{translate("script.suggestedCountEpisodes_b94533", { value0: arc.recommendedEpisodes })}</Tag><span className="text-xs text-[var(--studio-muted)]">{arc.summary}</span></div>)}</div>
                </> : <p className="text-xs text-[var(--studio-muted)]">{translate("script.theBookStrategyHasNotBeenGeneratedYet")}</p>}
                {job.lockedEpisodeCount ? <p className="text-xs text-[var(--studio-muted)]">{translate("script.lockedCountEpisodesWithCountFixedIdentitiesNumbered1_b01802", { value0: job.lockedEpisodeCount, value1: job.lockedEpisodeCount, value2: job.lockedEpisodeCount })}</p> : null}
            </div>;
        }
        if (index === 1) return <p className="text-xs text-[var(--studio-muted)]">{job.phase === "materials" && jobRunning ? translate("script.summarizingSourcesInBatchesCountCountCalls", { value0: job.processedUnits, value1: job.totalUnits }) : translate("script.summarizeConfirmedFactsInCapacityBasedBatchesOversizedBatchesAre")}</p>;
        if (index === 7) return <p className="text-xs text-[var(--studio-muted)]">{job.status === "completed" ? translate("script.theUnifiedPlanHasBeenAppliedCorrespondingOverviewOutlineSettings") : translate("script.applyingReplacesTheCorrespondingOverviewOutlineSettingsAndEpisodesAnd")}</p>;
        return <p className="text-xs text-[var(--studio-muted)]">{jobRunning && job.lockedEpisodeCount ? translate("script.unifiedPlanningProgressCountCountResultsOutputsRemainReviewDrafts", { value0: job.processedUnits, value1: job.totalUnits }) : translate("script.thisOutputIsSavedAsAReviewDraftAndWill")}</p>;
    };
    return <section className="min-h-0 overflow-y-auto p-4 sm:p-6"><div className="mx-auto max-w-6xl space-y-5">
        <header><h2 className="text-lg font-semibold text-[var(--studio-ink)]">{translate("script.novelAdaptation")}</h2><p className="mt-1 text-sm text-[var(--studio-muted)]">{translate("script.synthesizeTheBookCreateAUnifiedStrategyConfirmTheEpisode")}</p></header>
        {loadError ? <Alert type="error" showIcon title={loadError} action={<Button size="small" onClick={() => setJobLoadKey((value) => value + 1)}>{translate("script.retry")}</Button>} /> : null}
        <div className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-4">
            <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">{translate("script.fullBookAdaptation")}</h3>
                <Tag color="blue" className="mr-0">{translate("script.backgroundTask")}</Tag>
                <Tag color="purple" className="mr-0">{translate("script.manualEpisodeCountConfirmation")}</Tag>
                <span className="flex-1" />
                {job && (job.status === "queued" || job.status === "running" || job.status === "awaiting")
                    ? <Button size="small" danger loading={jobBusy} onClick={cancelJob}>{translate("script.cancelTask")}</Button>
                    : job?.status === "failed"
                        ? <div className="flex gap-2"><Button size="small" loading={jobBusy} onClick={() => void runWholeBook()}>{startLabel}</Button><Button type="primary" size="small" loading={jobBusy} onClick={retryJob}>{translate("script.resumeFromFailure")}</Button></div>
                        : <Button type="primary" loading={jobBusy} onClick={() => void runWholeBook()}>{startLabel}</Button>}
            </div>
            <p className="mt-1 text-xs text-[var(--studio-muted)]">{translate("script.usesAllConfirmedFactsCoveringTheMainPlotCharacterDevelopment")}</p>
            <Steps className="mt-3" size="small" titlePlacement="vertical" current={Math.max(0, flowStep)} status={flowStatus} items={stepItems} onChange={setPinnedStep} />
            {job ? <div className="mt-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--studio-muted)]">
                    <Tag color={job.status === "completed" ? "green" : job.status === "failed" ? "red" : job.status === "canceled" ? "default" : job.status === "awaiting" ? "gold" : "blue"} className="mr-0">{getJobStatusLabels(translate)[job.status]}</Tag>
                    <span>{getPhaseLabels(translate)[job.phase]} · {STAGE_LABELS[job.stage] || job.stage}</span>
                    <span>{translate("script.countCountGenerationCalls_57e638", { value0: job.processedUnits, value1: job.totalUnits })}</span>
                    <span>{translate("script.creditsReservedForThisStageCountcount_3ba93d", { value0: job.credits, value1: job.refundedCredits ? translate("script.refundedCount", { value0: job.refundedCredits }) : "" })}</span>
                </div>
                {job.status === "queued" || job.status === "running" ? <Progress percent={job.totalUnits ? Math.min(99, Math.round(job.processedUnits / job.totalUnits * 100)) : 0} size="small" showInfo={false} strokeColor="var(--studio-primary)" /> : null}
                {job.errorMessage ? <Alert type="error" showIcon title={job.errorMessage} /> : null}
                {job.historical ? <Alert type="warning" showIcon title={translate("script.taskFromThePreviousStagedWorkflow")} description={translate("script.thisTaskWasCreatedByAPreviousWorkflowAndNo")} /> : null}
            </div> : null}
            <div className="mt-3 space-y-2 rounded-lg border border-dashed border-[var(--studio-line-strong)] p-3">
                <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{translate("script.stepCountCountCount_7363d1", { value0: detailStep + 1, value1: getAdaptationFlowSteps(translate).length, value2: getAdaptationFlowSteps(translate)[detailStep].title })}</p>
                    <Tag color={stepState(detailStep).color} className="mr-0">{stepState(detailStep).label}</Tag>
                    <span className="flex-1" />
                    {pinnedStep != null ? <Button size="small" type="link" className="px-0" onClick={() => setPinnedStep(null)}>{translate("script.returnToCurrentProgress")}</Button> : null}
                </div>
                <p className="text-xs text-[var(--studio-muted)]">{getAdaptationFlowSteps(translate)[detailStep].detail}</p>
                {stepOutput(detailStep)}
                {detailStep === ADAPTATION_SETTINGS_STEP_INDEX ? (settingsVisible ? <div className="space-y-3">
                    <p className="text-xs text-[var(--studio-muted)]">{translate("script.episodeCountIsSetAfterSourceSynthesisAndStrategyGeneration")}</p>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <label className="block text-sm">{translate("script.adaptationFormat")}<Select className="mt-1 w-full" value={settings.format} options={[{ value: "comicDrama", label: translate("script.comicDrama") }, { value: "liveActionShort", label: translate("script.liveActionShortDrama") }, { value: "animation", label: translate("script.animation") }, { value: "advertisement", label: translate("script.advertisement") }, { value: "musicVideo", label: translate("script.musicVideo") }, { value: "storyShort", label: translate("script.shortFilm") }]} onChange={(value) => setSettings((current) => ({ ...current, format: value }))} /></label>
                        {/* InputNumber 自带 width:90px，而 Tailwind v4 的 utilities 在 @layer 里压不过 antd 注入的
                            无层样式，w-full 会被覆盖：控件撑不开就会和标签挤在同一行，看着完全没对齐。 */}
                        <label className="block text-sm">{translate("script.episodeDurationSeconds")}<InputNumber className="mt-1 w-full!" min={30} max={86400} value={settings.episodeDurationSeconds} onChange={(value) => value && setSettings((current) => ({ ...current, episodeDurationSeconds: value }))} /></label>
                        <label className="block text-sm">{translate("script.narrativePacing")}<Select className="mt-1 w-full" value={settings.pacing} options={[{ value: "slow", label: translate("script.relaxed") }, { value: "balanced", label: translate("script.balanced") }, { value: "fast", label: translate("script.fastPaced") }]} onChange={(value) => setSettings((current) => ({ ...current, pacing: value }))} /></label>
                        <label className="block text-sm">{translate("script.adaptationApproach")}<Select className="mt-1 w-full" value={settings.adaptationLevel} options={[{ value: "faithful", label: translate("script.faithful") }, { value: "balanced", label: translate("script.balanced") }, { value: "bold", label: translate("script.bold") }]} onChange={(value) => setSettings((current) => ({ ...current, adaptationLevel: value }))} /></label>
                    </div>
                    <label className="block text-sm">{translate("script.textModel")}<div className="mt-1"><ModelPicker config={config} value={model} onChange={setModel} capability="text" fullWidth /></div></label>
                    <Alert type="info" showIcon title={translate("script.textModelPriceCount", { value0: creditCost === undefined ? translate("script.notConfigured") : translate("script.countCreditsCall", { value0: creditCost }) })} description={translate("script.creditsAreReservedInBatchesForSourceStrategyAndPlanning")} />
                </div> : <p className="text-xs text-[var(--studio-muted)]">{translate("script.theCurrentTaskSettingsWereFixedAtLaunchReturnHere")}</p>) : null}
                {detailStep === BODIES_STEP_INDEX ? <EpisodeBodiesPanel onJobChange={setBodiesJob} /> : null}
            </div>
            {job && atEpisodeStop && job.strategy ? <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-[var(--studio-line-strong)] p-3">
                <label className="text-sm">{translate("script.finalEpisodeCount")}<InputNumber className="mt-1 w-32" min={job.strategy.arcs.length} max={1000} value={episodeCount || undefined} placeholder={`≥ ${job.strategy.arcs.length}`} onChange={(value) => setEpisodeCount(value || 0)} /></label>
                <span className="pb-1 text-xs text-[var(--studio-muted)]">{translate("script.suggestedTotalCountEpisodesKeepingAllCountArcsRequires_6f722e", { value0: suggestedEpisodes, value1: job.strategy.arcs.length, value2: job.strategy.arcs.length, value3: Math.round(job.options.episodeDurationSeconds / 60), value4: Math.round((episodeCount || 0) * job.options.episodeDurationSeconds / 60) })}</span>
                <span className="flex-1" />
                <Button type="primary" size="small" loading={jobBusy} onClick={confirmEpisodeCount}>{job.lockedEpisodeCount ? translate("script.continuePlanning") : translate("script.confirmEpisodeCount")}</Button>
            </div> : null}
            {job && job.status === "awaiting" && job.stage === "episodePlan" ? <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-[var(--studio-line-strong)] p-3">
                <span className="text-sm">{translate("script.generatedCountReviewDraftsCoveringTheOverviewOutlineCharacter_51cfbc", { value0: job.processedUnits, value1: job.lockedEpisodeCount })}</span>
                <span className="flex-1" />
                <Button type="primary" size="small" loading={jobBusy} onClick={confirmPlanning}>{translate("script.applyAndContinue")}</Button>
            </div> : null}
        </div>
    </div></section>;
}
