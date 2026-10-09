"use client";

import { useEffect, useState } from "react";
import { App, Alert, Button, Progress, Radio, Select, Tag } from "antd";
import { nanoid } from "nanoid";

import { ModelPicker } from "@/features/settings/components/model-picker";
import { useConfigStore, useEffectiveConfig } from "@/features/settings/stores/use-config-store";
import { cancelEpisodeBodies, episodeBodiesStatus, episodeBodiesUnitPrice, latestEpisodeBodies, quoteEpisodeBodies, retryEpisodeBodies, startEpisodeBodies } from "@/services/api/script";
import { useScriptStore } from "../stores/use-script-store";
import type { EpisodeBodiesJob, EpisodeBodiesMode, NovelAdaptationJobStatus } from "../types";

/** 正文批量任务的进度查询间隔。 */
const JOB_POLL_INTERVAL_MILLISECONDS = 3000;

const JOB_STATUS_LABELS: Record<NovelAdaptationJobStatus, string> = { queued: "排队中", running: "生成中", awaiting: "等待确认", completed: "已完成", failed: "生成失败，未结算积分已退回", canceled: "已取消，已退未完成部分" };
const JOB_STATUS_COLORS: Record<NovelAdaptationJobStatus, string> = { queued: "blue", running: "blue", awaiting: "gold", completed: "green", failed: "red", canceled: "default" };

/** 生成模式的中文名与结果去向，两处文案共用。 */
const MODE_LABELS: Record<EpisodeBodiesMode, string> = { apply: "生成并直接写入正式剧本（推荐）", draft: "只生成待审草稿（在分集卡片里逐集确认应用）" };
const MODE_DETAILS: Record<EpisodeBodiesMode, string> = {
    apply: "每集生成成功后立即合并进正式剧本的场次与正文，可在分集工作台查看；发起前会保存一份修改前版本，随时可以回退。",
    draft: "产出先作为待审草稿暂存，需要在右侧「AI 剧本助手」的「待确认草稿」里逐集预览并确认应用后才写入正式剧本；上百集逐集确认比较费时，只在需要逐集把关时选它。",
};

/**
 * 批量生成分集正文：把已固定的分集一次排队写成场次与正文。
 *
 * @param onJobChange 任务状态变化回调，供上层流程步骤条显示第 8 步「分集正文」的进度
 */
export function EpisodeBodiesPanel({ onJobChange }: { onJobChange?: (job: EpisodeBodiesJob | null) => void }) {
    const { message, modal } = App.useApp();
    const project = useScriptStore((state) => state.project);
    const saveStatus = useScriptStore((state) => state.saveStatus);
    const reloadProject = useScriptStore((state) => state.reloadProject);
    const config = useEffectiveConfig();
    const openConfig = useConfigStore((state) => state.openConfigDialog);
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
            .catch((error: unknown) => { if (active) message.error(error instanceof Error ? error.message : "生成进度加载失败"); });
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
                message.success(`已生成 ${next.processedEpisodes} 集正文`);
                void reloadProject();
            }).catch((error: unknown) => {
                if (notified) return;
                notified = true;
                message.error(error instanceof Error ? error.message : "生成进度刷新失败");
            });
        }, JOB_POLL_INTERVAL_MILLISECONDS);
        return () => window.clearInterval(timer);
    }, [jobId, jobRunning, projectId]);

    if (!project) return null;

    /** 批量生成正文：先按所选分集报价，确认后交给后台逐集排队。 */
    const runBatch = async () => {
        if (!model) return message.warning("请选择文本模型");
        if (!episodeIds.length) return message.warning("请至少选择一集再生成正文");
        if (!["saved", "idle"].includes(saveStatus)) return message.warning("请先保存当前剧本修改再发起生成");
        setJobBusy(true);
        try {
            const clientRequestId = nanoid();
            const quote = await quoteEpisodeBodies({ projectId, expectedRevision: project.revision, model, mode, episodeIds });
            modal.confirm({
                title: `确认为 ${quote.episodes} 集生成正文？`,
                content: (
                    <div className="mt-3 space-y-1 text-sm">
                        <p>将生成：{quote.episodes} 集</p>
                        <p>预计调用：{quote.calls} 次</p>
                        <p className="font-semibold">本次预扣：{quote.credits} 积分</p>
                        <p>模式说明：{MODE_LABELS[mode]}</p>
                        <p>结果去向：{MODE_DETAILS[mode]}</p>
                        <p className="text-xs text-[var(--studio-muted)]">一集一次调用，只结算真正生成成功的分集；取消或失败时未完成部分的积分退回，续跑只重做未完成的分集。</p>
                    </div>
                ),
                okText: `确认并扣除 ${quote.credits} 积分`,
                cancelText: "取消",
                onOk: async () => {
                    const latest = useScriptStore.getState().project;
                    if (!latest || latest.id !== projectId) throw new Error("当前项目已切换，请重新发起");
                    setJob(await startEpisodeBodies({ projectId, expectedRevision: latest.revision, clientRequestId,
                        model, mode, episodeIds, expectedCredits: quote.credits, expectedFingerprint: quote.fingerprint }));
                    message.success(`已提交，后台开始生成 ${quote.episodes} 集正文`);
                },
            });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "发起批量生成失败");
        } finally {
            setJobBusy(false);
        }
    };

    /** 从失败或取消处继续，已完成分集保留，续跑只重做未完成分集且不重复扣费。 */
    const retryJob = () => {
        if (!job) return;
        modal.confirm({
            title: "从缺失分集继续？",
            content: (
                <div className="mt-3 space-y-1 text-sm">
                    <p>已生成的 {job.processedEpisodes} 集保留，只重做剩余的 {job.failedEpisodeIds.length} 集，不重复扣费。</p>
                    <p className="text-xs text-[var(--studio-muted)]">修好失败原因后再点这里：例如改了提示词或模型配置后需要先重启后端。</p>
                </div>
            ),
            okText: "继续生成",
            cancelText: "取消",
            onOk: async () => {
                setJobBusy(true);
                try {
                    setJob(await retryEpisodeBodies(projectId, job.jobId));
                    message.success("已提交，从缺失分集继续生成");
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "继续生成失败");
                    throw error;
                } finally { setJobBusy(false); }
            },
        });
    };

    /** 取消任务并按未完成分集退回预扣积分，已生成的正文保留。 */
    const cancelJob = () => {
        if (!job) return;
        modal.confirm({
            title: "取消批量生成？",
            content: "已生成的正文保留，未完成分集的预扣积分退还。",
            okText: "确认取消",
            cancelText: "继续生成",
            onOk: async () => {
                setJobBusy(true);
                try {
                    setJob(await cancelEpisodeBodies(projectId, job.jobId));
                    message.success("已取消，未完成部分的积分已退还");
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "取消失败");
                } finally { setJobBusy(false); }
            },
        });
    };

    return <div className="mt-3 border-t border-dashed border-[var(--studio-line-strong)] pt-3">
        <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">批量生成分集正文</h3>
            {job ? <Tag color={JOB_STATUS_COLORS[job.status]} className="mr-0">{JOB_STATUS_LABELS[job.status]}</Tag> : null}
            <span className="flex-1" />
            {jobRunning
                ? <Button size="small" danger loading={jobBusy} onClick={cancelJob}>取消任务</Button>
                : <Button type="primary" size="small" loading={jobBusy} disabled={!episodes.length} onClick={() => void runBatch()}>{job ? "重新批量生成" : "批量生成正文"}</Button>}
        </div>
        <p className="mt-1 text-xs text-[var(--studio-muted)]">按已固定的分集逐集生成场次、动作、对白与旁白。集号与分集身份由全书改编固定，这里只决定生成哪几集；一次可以排队上百集，失败或取消后从未完成的分集继续。</p>
        {job ? <div className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--studio-muted)]">
                <span>已生成 {job.processedEpisodes} / {job.totalEpisodes} 集</span>
                <span>本阶段预扣 {job.credits} 积分{job.refundedCredits ? ` · 已退 ${job.refundedCredits}` : ""}</span>
                {job.retryCount ? <span>已续跑 {job.retryCount} 次</span> : null}
            </div>
            {jobRunning ? <Progress percent={job.totalEpisodes ? Math.min(99, Math.round(job.processedEpisodes / job.totalEpisodes * 100)) : 0} size="small" showInfo={false} strokeColor="var(--studio-primary)" /> : null}
            {job.status === "completed" ? <Alert type="success" showIcon title={`已生成 ${job.processedEpisodes} 集正文`} description={job.mode === "draft" ? "剧本数据已刷新：这批量只生成了待审草稿，请在右侧「AI 剧本助手」的「待确认草稿」里逐集确认应用后才会写入正式剧本。" : "剧本数据已刷新：场次与正文已直接写入正式剧本，可在分集工作台查看。"} /> : null}
            {job.errorMessage ? <Alert type="error" showIcon title={job.errorMessage} /> : null}
            {job.status === "failed" || job.status === "canceled" ? <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm">还有 {job.failedEpisodeIds.length} 集未完成，已生成的会保留。</span>
                <span className="flex-1" />
                {job.failedEpisodeIds.length ? <Button type="primary" size="small" loading={jobBusy} onClick={retryJob}>从缺失分集继续</Button> : null}
            </div> : null}
        </div> : null}
        <div className="mt-3 space-y-3 rounded-lg border border-dashed border-[var(--studio-line-strong)] p-3">
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">生成范围</span>
                <span className="text-xs text-[var(--studio-muted)]">已选 {episodeIds.length} / {episodes.length} 集</span>
                <span className="flex-1" />
                <Button size="small" type="link" className="px-0" disabled={!episodes.length} onClick={() => setEpisodeIds(episodes.map((episode) => episode.id))}>全部</Button>
                <Button size="small" type="link" className="px-0" disabled={!episodeIds.length} onClick={() => setEpisodeIds([])}>全部不勾选</Button>
                <Button size="small" type="link" className="px-0" disabled={!episodes.length} onClick={() => setEpisodeIds(episodes.filter((episode) => episode.completionStatus !== "complete").map((episode) => episode.id))}>只选未完成</Button>
            </div>
            {episodes.length
                ? <Select mode="multiple" className="w-full" value={episodeIds} maxTagCount="responsive" showSearch optionFilterProp="label" placeholder="选择要生成正文的分集" options={episodes.map((episode) => ({ value: episode.id, label: `第 ${episode.episodeNumber} 集 · ${episode.title || "未命名分集"}` }))} onChange={(value: string[]) => setEpisodeIds(value)} />
                : <Alert type="warning" showIcon title="请先完成分集规划" description="全书改编确认后才会固定分集的标识与集号，之后才能批量生成正文。" />}
            <div className="space-y-1">
                <p className="text-sm font-medium">生成模式</p>
                <Radio.Group value={mode} onChange={(event) => setMode(event.target.value)} options={[{ value: "apply", label: MODE_LABELS.apply }, { value: "draft", label: MODE_LABELS.draft }]} />
                <p className="text-xs text-[var(--studio-muted)]">{MODE_DETAILS[mode]}</p>
            </div>
            <label className="block text-sm">文本模型<div className="mt-1"><ModelPicker config={config} value={model} onChange={setModel} capability="text" fullWidth onMissingConfig={() => openConfig(true, "models")} /></div></label>
            <Alert type={unitPriceFailed ? "warning" : "info"} showIcon
                title={`文本模型单价：${unitPriceFailed ? "读取失败，请刷新页面重试" : unitPrice === undefined ? "读取中…" : unitPrice === null ? "未配置，请到后台「剧本创作定价 · 分集正文」配置" : `${unitPrice} 积分 / 集`}`}
                description="一集一次调用，按所选分集数量预扣；只结算真正生成成功的分集，取消或失败时未完成部分的积分退回。" />
        </div>
    </div>;
}
