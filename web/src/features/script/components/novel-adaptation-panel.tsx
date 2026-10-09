"use client";

import { useEffect, useState } from "react";
import { App, Alert, Button, InputNumber, Progress, Select, Steps, Tag } from "antd";
import { nanoid } from "nanoid";

import { ModelPicker } from "@/features/settings/components/model-picker";
import { useConfigStore, useEffectiveConfig } from "@/features/settings/stores/use-config-store";
import { advanceWholeBookAdaptation, cancelWholeBookAdaptation, confirmWholeBookAdaptation, listActiveWholeBookAdaptation, quoteWholeBookAdaptation, retryWholeBookAdaptation, startWholeBookAdaptation, wholeBookAdaptationStatus } from "@/services/api/script";
import { useScriptStore } from "../stores/use-script-store";
import type { EpisodeBodiesJob, WholeBookAdaptationJob, WholeBookAdaptationOptions } from "../types";
import { EpisodeBodiesPanel } from "./episode-bodies-panel";

const STAGES = [
    { value: "overview", label: "故事概览" },
    { value: "characters", label: "人物与关系" },
    { value: "world", label: "世界观与地点" },
    { value: "outline", label: "故事大纲" },
    { value: "episodes", label: "分集规划" },
    { value: "episode", label: "单集剧本" },
] as const;

/** 全书改编任务的进度查询间隔。 */
const JOB_POLL_INTERVAL_MILLISECONDS = 3000;

/** 阶段中文名，按阶段取值反查。 */
const STAGE_LABELS: Record<string, string> = Object.fromEntries(STAGES.map((item) => [item.value, item.label]));
const JOB_STATUS_LABELS: Record<WholeBookAdaptationJob["status"], string> = { queued: "排队中", running: "生成中", awaiting: "等待确认", completed: "已完成", failed: "生成失败，未结算积分已退回", canceled: "已取消，按已完成步骤结算" };
const PHASE_LABELS: Record<WholeBookAdaptationJob["phase"], string> = { materials: "素材与策略", planning: "统一规划", drafts: "各集正文" };

/**
 * 改编全流程，与后端实际执行的单元阶段一一对应：
 * 第一步「改编设置」定下形式与节奏，随后七步是全书改编（materials 阶段的 material/strategy，集数确认停点，
 * planning 阶段的 overview→episodePlan，应用停点），第九步「分集正文」是它的延续：
 * 把已应用的分集规划逐集写成场次与正文，产出物从分集规划变成场次和正文块。
 */
const ADAPTATION_FLOW_STEPS: Array<{ title: string; content: string; detail: string }> = [
    { title: "改编设置", content: "形式、节奏与文本模型", detail: "选择改编形式、单集时长、叙事节奏与改编程度，并指定本次使用的文本模型。这些参数决定整条流水线的产出形式与节奏，任务启动后即定格，只能在未开始或已结束时调整，用于下一次启动。" },
    { title: "素材提炼", content: "分批归纳全书素材", detail: "把全部已确认事实按容量分批交给模型归纳，产出每批的简明素材摘要，供下一步归纳策略使用。" },
    { title: "全书策略", content: "主线、结局与故事阶段", detail: "在全部素材之上归纳全书策略：主线、结局、故事阶段划分与压缩取舍，并给出每个阶段的建议集数。" },
    { title: "确认集数", content: "人工确认后固定集号", detail: "由你确认最终集数，服务端按各阶段建议比例用最大余数法分配配额，一次固定全部分集的标识与集号。" },
    { title: "概览与大纲", content: "故事概览、故事大纲", detail: "依据已确认的策略一次生成故事概览与故事大纲，不再由多批分别覆盖。" },
    { title: "人物与地点", content: "人物关系、世界观地点", detail: "按容量分批生成人物与关系、世界观与地点设定，人物关系随人物批一起产出。" },
    { title: "取舍与逐集规划", content: "事件分配与逐集规划", detail: "逐批把事件分配到固定分集，记录每个事件的唯一处理方式与回顾事件，并按分集生成规划。" },
    { title: "应用替换", content: "人工确认后写入正式项目", detail: "由你确认后在一个事务里把统一规划写入正式项目，替换同名的概览、大纲、设定与分集并保存修改前版本。" },
    { title: "分集正文", content: "逐集生成场次与正文", detail: "按已固定的分集逐集生成场次、动作、对白与旁白并写入正式剧本。可以分批长跑，失败或取消后从未完成的分集继续；正文不满意只重跑正文，不必重做全书改编。" },
];

/** 第一步「改编设置」的下标。 */
const ADAPTATION_SETTINGS_STEP_INDEX = 0;

/** 最后一步「分集正文」的下标；前面是改编设置与全书改编七步。 */
const BODIES_STEP_INDEX = ADAPTATION_FLOW_STEPS.length - 1;

/**
 * 由任务阶段反查当前进行到第几步。
 * 返回 -1 表示尚未开始（停在第 1 步「改编设置」），返回步骤总数表示全部走完。
 * 最后一步「分集正文」的状态由正文任务自己决定，所以需要一并传入。
 * 注意：返回值是 ADAPTATION_FLOW_STEPS 的下标，第一步是改编设置，所以下面前七步统一 +1。
 */
function adaptationStepIndex(job: WholeBookAdaptationJob | null, bodiesJob: EpisodeBodiesJob | null) {
    // 旧流程创建的任务没有工作流快照，阶段取值与当前流程不对应，不做步骤高亮。
    if (!job || job.historical) return -1;
    if (job.status === "completed") return bodiesJob?.status === "completed"
            ? ADAPTATION_FLOW_STEPS.length : BODIES_STEP_INDEX;
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
    const { message, modal } = App.useApp();
    const project = useScriptStore((state) => state.project);
    const saveStatus = useScriptStore((state) => state.saveStatus);
    const reloadProject = useScriptStore((state) => state.reloadProject);
    const config = useEffectiveConfig();
    const openConfig = useConfigStore((state) => state.openConfigDialog);
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
            .catch((error: unknown) => { if (active) setLoadError(error instanceof Error ? error.message : "改编任务加载失败"); });
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
        if (!model) return message.warning("请选择文本模型");
        if (!["saved", "idle"].includes(saveStatus)) return message.warning("请先保存当前剧本修改再发起改编");
        setJobBusy(true);
        try {
            const clientRequestId = nanoid();
            const quote = await quoteWholeBookAdaptation({ projectId, expectedRevision: project.revision, model, options: settings });
            modal.confirm({
                title: `确认${startLabel}？`,
                content: (
                    <div className="mt-3 space-y-1 text-sm">
                        <p>输入范围：全部已确认故事事实，默认覆盖全书主线、人物成长与结局</p>
                        <p>本次执行：素材提炼 → 全书策略；完成后暂停，等待你确认集数</p>
                        <p>预计调用：{quote.calls} 次</p>
                        <p className="font-semibold">本阶段预扣：{quote.credits} 积分</p>
                        {job ? <p>这是一次重新改编：会重新生成统一规划，应用时替换同名内容并保存修改前版本。</p> : null}
                        <p className="text-xs text-[var(--studio-muted)]">集数不在这里设定。策略生成后由你确认，服务端据此固定全部分集的标识与集号；取消或失败时未完成部分的积分退回。</p>
                    </div>
                ),
                okText: `确认并扣除 ${quote.credits} 积分`,
                cancelText: "取消",
                onOk: async () => {
                    const latest = useScriptStore.getState().project;
                    if (!latest || latest.id !== projectId) throw new Error("当前项目已切换，请重新发起");
                    setJob(await startWholeBookAdaptation({ projectId, expectedRevision: latest.revision, clientRequestId,
                        model, options: settings, expectedCredits: quote.credits, expectedFingerprint: quote.fingerprint }));
                    message.success("已提交，后台开始提炼素材与归纳全书策略");
                },
            });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "发起全书改编失败");
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
        if (targetCount < arcs) return message.warning(`完整保留当前 ${arcs} 个故事阶段至少需要 ${arcs} 集`);
        modal.confirm({
            title: resumed ? `继续生成 ${targetCount} 集的统一规划？` : `确认为 ${targetCount} 集？`,
            content: (
                <div className="mt-3 space-y-1 text-sm">
                    <p>按各阶段建议比例用最大余数法分配配额，配额之和严格等于 {targetCount}</p>
                    <p>随后生成概览、大纲、人物地点设定与逐集规划，完成后暂停等待你审阅替换</p>
                    <p className="text-xs text-[var(--studio-muted)]">集数一旦用于分配配额就不再变化；需要调整只能重新发起改编。</p>
                </div>
            ),
            okText: resumed ? "继续生成" : "确认集数",
            cancelText: "再看看",
            onOk: async () => {
                setJobBusy(true);
                try {
                    setJob(await advanceWholeBookAdaptation({ projectId, jobId: job.jobId, expectedRevision: job.revision,
                        expectedRetryCount: job.retryCount, episodeCount: targetCount }));
                    message.success("已提交，后台开始生成统一规划");
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "确认集数失败");
                    throw error;
                } finally { setJobBusy(false); }
            },
        });
    };

    /** 统一规划停点应用待审草稿，替换概览、大纲、设定与分集。 */
    const confirmPlanning = () => {
        if (!job) return;
        modal.confirm({
            title: "应用并替换？",
            content: (
                <div className="mt-3 space-y-1 text-sm">
                    <p>将把已生成的概览、大纲、人物地点设定与 {job.lockedEpisodeCount} 集分集规划写入正式项目，替换现有同名内容。</p>
                    <p>应用前会保存修改前版本；分镜、视觉资产与媒体保留并登记影响，不会被删除。</p>
                    <p className="text-xs text-[var(--studio-muted)]">应用在一个事务内完成，失败时不会留下半套内容。</p>
                </div>
            ),
            okText: "应用并继续",
            cancelText: "再看看",
            onOk: async () => {
                setJobBusy(true);
                try {
                    setJob(await confirmWholeBookAdaptation(projectId, job.jobId));
                    await reloadProject();
                    message.success("已应用到正式项目");
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "应用统一规划失败");
                    throw error;
                } finally { setJobBusy(false); }
            },
        });
    };

    /** 从失败处的缺失单元继续，成功单元不会重跑或重复扣费。 */
    const retryJob = () => {
        if (!job) return;
        modal.confirm({
            title: "从失败处继续？",
            content: (
                <div className="mt-3 space-y-1 text-sm">
                    <p>已成功的 {job.processedUnits} 个生成单元会保留，只重跑剩余单元，并按该部分重新预扣积分。</p>
                    <p className="text-xs text-[var(--studio-muted)]">修好失败原因后再点这里：例如改了提示词或配置后需要先重启后端。</p>
                </div>
            ),
            okText: "继续生成",
            cancelText: "取消",
            onOk: async () => {
                setJobBusy(true);
                try {
                    setJob(await retryWholeBookAdaptation(projectId, job.jobId));
                    message.success("已提交，从缺失单元继续生成");
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "继续生成失败");
                    throw error;
                } finally { setJobBusy(false); }
            },
        });
    };

    /** 取消任务并退还未完成单元的积分。 */
    const cancelJob = () => {
        if (!job) return;
        modal.confirm({
            title: "取消全书改编？",
            content: "已生成的素材与策略保留，未完成调用的积分退还。",
            okText: "确认取消",
            cancelText: "继续生成",
            onOk: async () => {
                setJobBusy(true);
                try {
                    setJob(await cancelWholeBookAdaptation(projectId, job.jobId));
                    message.success("已取消，未完成部分的积分已退还");
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "取消失败");
                } finally { setJobBusy(false); }
            },
        });
    };

    const suggestedEpisodes = job?.strategy?.arcs.reduce((total, arc) => total + arc.recommendedEpisodes, 0) || 0;
    // 未开始用 wait 让首步保持灰色，失败与取消落在当前步上报错，第八步也走完才算全部结束。
    const allFinished = job?.status === "completed" && bodiesJob?.status === "completed";
    const flowStep = adaptationStepIndex(job, bodiesJob);
    const flowStatus: "wait" | "process" | "error" | "finish" = !job || job.historical ? "wait"
        : job.status === "failed" || job.status === "canceled" ? "error"
            : allFinished ? "finish" : "process";
    // 集数确认停点：只有这一阶段才显示集数输入与确认按钮。stage 仍是 strategy 的等待态也可能是
    // 已锁定集数但尚未规划的任务（旧任务续跑），所以用 stage 区分两个停点，而不是只看集数是否锁定。
    const atEpisodeStop = job != null && job.status === "awaiting" && job.phase === "planning" && job.stage !== "episodePlan";
    // 参数只属于启动前：任务在跑或停在确认点时参数已经定格，只有未开始或已结束才允许调整下次启动的参数。
    const settingsVisible = job == null || job.status === "completed" || job.status === "failed" || job.status === "canceled";
    // 已有任务时不再说「启动」：完成过的叫重新改编，取消或失败的叫重新开始。
    const startLabel = job == null ? "启动全书改编" : job.status === "completed" ? "重新改编" : "重新开始";
    // 展示哪一步：点选后固定，否则跟随真实进度。完成时 flowStep 等于步骤总数，需要夹回最后一步。
    const detailStep = pinnedStep ?? Math.min(Math.max(0, flowStep), ADAPTATION_FLOW_STEPS.length - 1);
    const stepItems = ADAPTATION_FLOW_STEPS.map((step, index) => ({
        title: index === detailStep ? <span className="text-[var(--studio-action)]">{step.title}</span> : step.title,
        content: step.content,
    }));

    /** 步骤状态：优先反映完成情况，只有真实所在的那一步才带进行中或异常。 */
    const stepState = (index: number): { label: string; color: string } => {
        if (!job || job.historical) return { label: "未开始", color: "default" };
        // 第八步由正文任务自己驱动：全书改编完成只是走到这一步，并不代表正文已经生成。
        if (index === BODIES_STEP_INDEX) {
            if (job.status !== "completed" || !bodiesJob) return { label: "待执行", color: "default" };
            if (bodiesJob.status === "completed") return { label: "已完成", color: "green" };
            if (bodiesJob.status === "failed") return { label: "已失败", color: "red" };
            if (bodiesJob.status === "canceled") return { label: "已取消", color: "default" };
            return { label: "进行中", color: "blue" };
        }
        if (job.status === "completed" || flowStep > index) return { label: "已完成", color: "green" };
        if (flowStep < index) return { label: "待执行", color: "default" };
        if (job.status === "awaiting") return { label: "等待你确认", color: "gold" };
        if (job.status === "failed") return { label: "已失败", color: "red" };
        if (job.status === "canceled") return { label: "已取消", color: "default" };
        return { label: "进行中", color: "blue" };
    };

    /** 选中步骤的产出：第一步与最后一步由详情区单独渲染，全书策略与确认集数共用策略正文。 */
    const stepOutput = (index: number) => {
        // 第一步的内容是改编设置表单、最后一步的内容是分集正文面板，都不是只读产出。
        if (index === ADAPTATION_SETTINGS_STEP_INDEX || index === BODIES_STEP_INDEX) return null;
        if (!job) return <p className="text-xs text-[var(--studio-muted)]">尚未启动，这一步完成后会在这里显示产出。</p>;
        if (index === 2 || index === 3) {
            const strategy = job.strategy;
            return <div className="space-y-2">
                {strategy ? <>
                    <p className="text-sm">{strategy.mainPlot}</p>
                    <p className="text-xs text-[var(--studio-muted)]">结局：{strategy.ending}</p>
                    <p className="text-xs text-[var(--studio-muted)]">集数理由：{strategy.reasoning}</p>
                    <p className="text-xs text-[var(--studio-muted)]">压缩取舍：{strategy.compression}</p>
                    <div className="space-y-1">{strategy.arcs.map((arc, position) => <div key={`${arc.title}-${position}`} className="flex flex-wrap items-baseline gap-2 rounded border border-[var(--studio-line)] px-2 py-1 text-sm"><span className="font-medium">{position + 1}. {arc.title}</span><Tag className="mr-0">建议 {arc.recommendedEpisodes} 集</Tag><span className="text-xs text-[var(--studio-muted)]">{arc.summary}</span></div>)}</div>
                </> : <p className="text-xs text-[var(--studio-muted)]">全书策略尚未生成。</p>}
                {job.lockedEpisodeCount ? <p className="text-xs text-[var(--studio-muted)]">已锁定 {job.lockedEpisodeCount} 集，已固定 {job.lockedEpisodeCount} 个分集身份，集号连续 1 → {job.lockedEpisodeCount}。</p> : null}
            </div>;
        }
        if (index === 1) return <p className="text-xs text-[var(--studio-muted)]">{job.phase === "materials" && jobRunning ? `正在分批归纳素材：${job.processedUnits} / ${job.totalUnits} 次生成。` : "按容量把已确认事实分批交给模型归纳；批次过大时自动拆成更小的批，拆出的子批计入补分析。"}</p>;
        if (index === 7) return <p className="text-xs text-[var(--studio-muted)]">{job.status === "completed" ? "统一规划已写入正式项目，同名的概览、大纲、设定与分集已被替换，修改前的版本已保存。" : "应用后替换同名的概览、大纲、设定与分集并保存修改前版本；分镜、视觉资产与媒体保留并登记影响。"}</p>;
        return <p className="text-xs text-[var(--studio-muted)]">{jobRunning && job.lockedEpisodeCount ? `统一规划整体进度：${job.processedUnits} / ${job.totalUnits} 份。产物先作为待审草稿暂存，在后面的「应用替换」确认后写入正式项目。` : "该步产物先作为待审草稿暂存，在「应用替换」确认后写入正式项目。"}</p>;
    };
    return <section className="min-h-0 overflow-y-auto p-4 sm:p-6"><div className="mx-auto max-w-6xl space-y-5">
        <header><h2 className="text-lg font-semibold text-[var(--studio-ink)]">小说智能改编</h2><p className="mt-1 text-sm text-[var(--studio-muted)]">分批提炼全书素材、归纳统一策略，确认集数后固定分集身份并逐集生成正文。分镜、视觉资产和媒体制作继续在漫剧工作台完成。</p></header>
        {loadError ? <Alert type="error" showIcon title={loadError} action={<Button size="small" onClick={() => setJobLoadKey((value) => value + 1)}>重试</Button>} /> : null}
        <div className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-4">
            <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">全书改编</h3>
                <Tag color="blue" className="mr-0">后台异步</Tag>
                <Tag color="purple" className="mr-0">集数人工确认</Tag>
                <span className="flex-1" />
                {job && (job.status === "queued" || job.status === "running" || job.status === "awaiting")
                    ? <Button size="small" danger loading={jobBusy} onClick={cancelJob}>取消任务</Button>
                    : job?.status === "failed"
                        ? <div className="flex gap-2"><Button size="small" loading={jobBusy} onClick={() => void runWholeBook()}>{startLabel}</Button><Button type="primary" size="small" loading={jobBusy} onClick={retryJob}>从失败处继续</Button></div>
                        : <Button type="primary" loading={jobBusy} onClick={() => void runWholeBook()}>{startLabel}</Button>}
            </div>
            <p className="mt-1 text-xs text-[var(--studio-muted)]">默认覆盖全书主线、人物成长与结局，事实范围为全部已确认条目。先生成素材与全书策略，再由你确认集数；集数确认后服务端固定全部分集的标识与集号，模型只能填写这些分集的内容。</p>
            <Steps className="mt-3" size="small" titlePlacement="vertical" current={Math.max(0, flowStep)} status={flowStatus} items={stepItems} onChange={setPinnedStep} />
            {job ? <div className="mt-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--studio-muted)]">
                    <Tag color={job.status === "completed" ? "green" : job.status === "failed" ? "red" : job.status === "canceled" ? "default" : job.status === "awaiting" ? "gold" : "blue"} className="mr-0">{JOB_STATUS_LABELS[job.status]}</Tag>
                    <span>{PHASE_LABELS[job.phase]} · {STAGE_LABELS[job.stage] || job.stage}</span>
                    <span>{job.processedUnits} / {job.totalUnits} 次生成</span>
                    <span>本阶段预扣 {job.credits} 积分{job.refundedCredits ? ` · 已退 ${job.refundedCredits}` : ""}</span>
                </div>
                {job.status === "queued" || job.status === "running" ? <Progress percent={job.totalUnits ? Math.min(99, Math.round(job.processedUnits / job.totalUnits * 100)) : 0} size="small" showInfo={false} strokeColor="var(--studio-primary)" /> : null}
                {job.errorMessage ? <Alert type="error" showIcon title={job.errorMessage} /> : null}
                {job.historical ? <Alert type="warning" showIcon title="升级前的分阶段任务" description="该任务由旧流程创建，已停止支持新的确认与续跑操作；请重新发起改编。" /> : null}
            </div> : null}
            <div className="mt-3 space-y-2 rounded-lg border border-dashed border-[var(--studio-line-strong)] p-3">
                <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">第 {detailStep + 1} / {ADAPTATION_FLOW_STEPS.length} 步 · {ADAPTATION_FLOW_STEPS[detailStep].title}</p>
                    <Tag color={stepState(detailStep).color} className="mr-0">{stepState(detailStep).label}</Tag>
                    <span className="flex-1" />
                    {pinnedStep != null ? <Button size="small" type="link" className="px-0" onClick={() => setPinnedStep(null)}>回到当前进度</Button> : null}
                </div>
                <p className="text-xs text-[var(--studio-muted)]">{ADAPTATION_FLOW_STEPS[detailStep].detail}</p>
                {stepOutput(detailStep)}
                {detailStep === ADAPTATION_SETTINGS_STEP_INDEX ? (settingsVisible ? <div className="space-y-3">
                    <p className="text-xs text-[var(--studio-muted)]">集数不在这里设定：先生成素材与全书策略，再由你确认最终集数并固定全部集号。</p>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <label className="block text-sm">改编形式<Select className="mt-1 w-full" value={settings.format} options={[{ value: "comicDrama", label: "漫剧" }, { value: "liveActionShort", label: "真人短剧" }, { value: "animation", label: "动画" }, { value: "advertisement", label: "广告" }, { value: "musicVideo", label: "音乐视频" }, { value: "storyShort", label: "故事短片" }]} onChange={(value) => setSettings((current) => ({ ...current, format: value }))} /></label>
                        {/* InputNumber 自带 width:90px，而 Tailwind v4 的 utilities 在 @layer 里压不过 antd 注入的
                            无层样式，w-full 会被覆盖：控件撑不开就会和标签挤在同一行，看着完全没对齐。 */}
                        <label className="block text-sm">单集时长（秒）<InputNumber className="mt-1 w-full!" min={30} max={86400} value={settings.episodeDurationSeconds} onChange={(value) => value && setSettings((current) => ({ ...current, episodeDurationSeconds: value }))} /></label>
                        <label className="block text-sm">叙事节奏<Select className="mt-1 w-full" value={settings.pacing} options={[{ value: "slow", label: "舒缓" }, { value: "balanced", label: "均衡" }, { value: "fast", label: "紧凑" }]} onChange={(value) => setSettings((current) => ({ ...current, pacing: value }))} /></label>
                        <label className="block text-sm">改编程度<Select className="mt-1 w-full" value={settings.adaptationLevel} options={[{ value: "faithful", label: "忠实" }, { value: "balanced", label: "均衡" }, { value: "bold", label: "大胆" }]} onChange={(value) => setSettings((current) => ({ ...current, adaptationLevel: value }))} /></label>
                    </div>
                    <label className="block text-sm">文本模型<div className="mt-1"><ModelPicker config={config} value={model} onChange={setModel} capability="text" fullWidth onMissingConfig={() => openConfig(true, "models")} /></div></label>
                    <Alert type="info" showIcon title={`文本模型单价：${creditCost === undefined ? "未配置" : `${creditCost} 积分 / 次`}`} description="素材与策略、统一规划分批预扣，只结算持久化成功的单元；集数在策略确认后锁定。" />
                </div> : <p className="text-xs text-[var(--studio-muted)]">本次任务的参数在启动时已经定格。任务结束后回到这一步，可以调整下一次启动的参数。</p>) : null}
                {detailStep === BODIES_STEP_INDEX ? <EpisodeBodiesPanel onJobChange={setBodiesJob} /> : null}
            </div>
            {job && atEpisodeStop && job.strategy ? <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-[var(--studio-line-strong)] p-3">
                <label className="text-sm">最终集数<InputNumber className="mt-1 w-32" min={job.strategy.arcs.length} max={1000} value={episodeCount || undefined} placeholder={`≥ ${job.strategy.arcs.length}`} onChange={(value) => setEpisodeCount(value || 0)} /></label>
                <span className="pb-1 text-xs text-[var(--studio-muted)]">建议合计 {suggestedEpisodes} 集 · 完整保留 {job.strategy.arcs.length} 个故事阶段至少 {job.strategy.arcs.length} 集 · 单集 {Math.round(job.options.episodeDurationSeconds / 60)} 分钟，总时长约 {Math.round((episodeCount || 0) * job.options.episodeDurationSeconds / 60)} 分钟</span>
                <span className="flex-1" />
                <Button type="primary" size="small" loading={jobBusy} onClick={confirmEpisodeCount}>{job.lockedEpisodeCount ? "继续生成规划" : "确认集数"}</Button>
            </div> : null}
            {job && job.status === "awaiting" && job.stage === "episodePlan" ? <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-[var(--studio-line-strong)] p-3">
                <span className="text-sm">统一规划已生成 {job.processedUnits} 份待审草稿：概览、大纲、人物地点设定与 {job.lockedEpisodeCount} 集规划。确认后替换正式项目并保存修改前版本。</span>
                <span className="flex-1" />
                <Button type="primary" size="small" loading={jobBusy} onClick={confirmPlanning}>应用并继续</Button>
            </div> : null}
        </div>
    </div></section>;
}
