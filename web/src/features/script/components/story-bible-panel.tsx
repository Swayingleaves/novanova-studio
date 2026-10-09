"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { App, Alert, Button, Checkbox, Empty, Input, Pagination, Progress, Segmented, Select, Spin, Tag, TreeSelect } from "antd";
import { Plus, RefreshCw } from "lucide-react";
import { nanoid } from "nanoid";

import { ModelPicker } from "@/features/settings/components/model-picker";
import { modelOptionLabel, selectableModelsByCapability, useConfigStore, useEffectiveConfig } from "@/features/settings/stores/use-config-store";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import {
    cancelStoryBibleAnalysis,
    confirmAllStoryBibleItems,
    confirmStoryBibleItems,
    getScriptSourceTree,
    getStoryBibleAnalysisStatus,
    listStoryBibleItems,
    quoteStoryBibleAnalysis,
    retryStoryBibleAnalysis,
    startStoryBibleAnalysis,
} from "@/services/api/script";
import { useScriptStore } from "../stores/use-script-store";
import type { ScriptSourceTree, StoryBibleItem, StoryBibleItemPage, StoryBibleItemStatus, StoryBibleItemType, StoryBibleJob } from "../types";
import { ITEM_STATUS_LABELS, ITEM_TYPE_LABELS, StoryBibleItemDrawer } from "./story-bible-item-drawer";

/** 分析进行中的状态查询间隔。 */
const POLL_INTERVAL_MILLISECONDS = 2500;

/** 列表每页显示条数选项。 */
const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];

const TYPE_TABS: Array<{ value: StoryBibleItemType | "timeline"; label: string }> = [
    { value: "character", label: "人物" },
    { value: "location", label: "地点" },
    { value: "relationship", label: "关系" },
    { value: "event", label: "事件" },
    { value: "storyline", label: "故事线" },
    { value: "timeline", label: "时间线" },
];

const JOB_STATUS_LABELS: Record<StoryBibleJob["status"], string> = { queued: "排队中", running: "分析中", retryable: "已中断，可续跑", completed: "已完成", partial: "部分完成", failed: "失败，已退款", canceled: "已取消，按批次结算" };
const STAGE_LABELS: Record<string, string> = { extract: "分批提取", book: "故事线归纳", done: "已完成" };

/** 故事知识库：分析任务、条目列表、时间线与条目详情。 */
export function StoryBiblePanel({ onOpenSource }: { onOpenSource: (start: number, end: number) => void }) {
    const projectId = useScriptStore((state) => state.project?.id || "");
    const { message, modal } = App.useApp();
    const [tab, setTab] = useState<StoryBibleItemType | "timeline">("character");
    const [timelineOrder, setTimelineOrder] = useState<"narrative" | "story">("narrative");
    const [status, setStatus] = useState<StoryBibleItemStatus | "">("");
    const [keyword, setKeyword] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [data, setData] = useState<StoryBibleItemPage | null>(null);
    const [loading, setLoading] = useState(false);
    const [listError, setListError] = useState("");
    const [openItemId, setOpenItemId] = useState<string | null>(null);
    const [creating, setCreating] = useState<StoryBibleItemType | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);
    const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
    const listRequestSequence = useRef(0);

    const load = useCallback(async () => {
        if (!projectId) return;
        const requestSequence = ++listRequestSequence.current;
        setLoading(true);
        setData(null);
        setListError("");
        try {
            const itemType: StoryBibleItemType = tab === "timeline" ? "event" : tab;
            const next = await listStoryBibleItems({ projectId, itemType, status: status || undefined, keyword: keyword.trim() || undefined, order: tab === "timeline" ? timelineOrder : "narrative", page, pageSize });
            if (requestSequence === listRequestSequence.current) setData(next);
        } catch (error) {
            if (requestSequence === listRequestSequence.current) setListError(error instanceof Error ? error.message : "条目加载失败");
        } finally {
            if (requestSequence === listRequestSequence.current) setLoading(false);
        }
    }, [keyword, page, pageSize, projectId, status, tab, timelineOrder]);

    useEffect(() => { void load(); }, [load, refreshKey]);
    const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);
    const maximumEvidenceCount = Math.max(0, ...(data?.items.map((item) => item.evidenceCount) || []));
    const pendingItems = !loading && !listError ? data?.items.filter((item) => item.status === "pending") || [] : [];
    const selectedPendingIds = selectedItemIds.filter((id) => pendingItems.some((item) => item.id === id));
    const allPendingSelected = pendingItems.length > 0 && pendingItems.every((item) => selectedItemIds.includes(item.id));
    const toggleItem = (itemId: string, checked: boolean) => setSelectedItemIds((current) => checked ? [...new Set([...current, itemId])] : current.filter((id) => id !== itemId));
    const toggleAllPending = (checked: boolean) => setSelectedItemIds(checked ? pendingItems.map((item) => item.id) : []);
    const confirmSelected = () => {
        if (!selectedPendingIds.length) return;
        modal.confirm({
            title: `确认选中的 ${selectedPendingIds.length} 条知识库内容？`,
            content: "确认后条目会锁定；待审建议会合并到对应条目。此操作会校验每条内容的最新修订号。",
            okText: "批量确认",
            cancelText: "取消",
            onOk: async () => {
                try {
                    await confirmStoryBibleItems(projectId, selectedPendingIds.map((itemId) => {
                        const item = data?.items.find((entry) => entry.id === itemId);
                        return { itemId, expectedRevision: item?.revision ?? -1 };
                    }));
                    message.success(`已确认 ${selectedPendingIds.length} 条内容`);
                    setSelectedItemIds([]);
                    refresh();
                } catch (requestError) {
                    message.error(requestError instanceof Error ? requestError.message : "批量确认失败，请刷新后重试");
                    throw requestError;
                }
            },
        });
    };

    const confirmAllPending = () => {
        const itemType: StoryBibleItemType = tab === "timeline" ? "event" : tab;
        modal.confirm({
            title: `全量确认「${ITEM_TYPE_LABELS[itemType]}」下的全部待确认内容？`,
            content: "范围是当前分类下所有待确认条目，不受分页、搜索与状态筛选影响。确认后条目会锁定，待审建议会合并到对应条目。",
            okText: "全量确认",
            cancelText: "取消",
            onOk: async () => {
                try {
                    const result = await confirmAllStoryBibleItems(projectId, itemType);
                    if (!result.confirmedCount) {
                        message.info("当前分类没有待确认的内容");
                        return;
                    }
                    message.success(`已确认 ${result.confirmedCount} 条内容`);
                    setSelectedItemIds([]);
                    refresh();
                } catch (requestError) {
                    message.error(requestError instanceof Error ? requestError.message : "全量确认失败，请刷新后重试");
                    throw requestError;
                }
            },
        });
    };

    useEffect(() => {
        setSelectedItemIds([]);
    }, [keyword, page, pageSize, projectId, refreshKey, status, tab, timelineOrder]);

    if (!projectId) return null;

    return (
        <section className="flex min-h-0 flex-col">
            <AnalysisBar key={projectId} projectId={projectId} onCompleted={refresh} />
            <div className="flex flex-wrap items-center gap-2 border-b border-[var(--studio-line)] px-4 py-3 sm:px-6">
                <Segmented value={tab} options={TYPE_TABS} onChange={(value) => { setTab(value as typeof tab); setPage(1); }} />
                {tab === "timeline" ? <Segmented value={timelineOrder} options={[{ value: "narrative", label: "叙事顺序" }, { value: "story", label: "故事时间" }]} onChange={(value) => { setTimelineOrder(value as typeof timelineOrder); setPage(1); }} /> : null}
                <Select className="w-28" value={status} onChange={(value) => { setStatus(value); setPage(1); }} options={[{ value: "", label: "全部有效" }, { value: "pending", label: "待确认" }, { value: "confirmed", label: "已确认" }, { value: "rejected", label: "已拒绝" }]} />
                <Input.Search className="max-w-56" allowClear placeholder="搜索名称或别名" onSearch={(value) => { setKeyword(value); setPage(1); }} />
                <span className="flex-1" />
                {pendingItems.length ? <Checkbox checked={allPendingSelected} indeterminate={selectedPendingIds.length > 0 && !allPendingSelected} onChange={(event) => toggleAllPending(event.target.checked)}>本页待确认全选</Checkbox> : null}
                <Button size="small" type="primary" disabled={!selectedPendingIds.length} onClick={confirmSelected}>批量确认{selectedPendingIds.length ? `（${selectedPendingIds.length}）` : ""}</Button>
                {data && data.total ? <Button size="small" onClick={confirmAllPending}>全量确认</Button> : null}
                <Button size="small" icon={<RefreshCw className="size-3.5" />} onClick={refresh}>刷新</Button>
                <Button size="small" icon={<Plus className="size-3.5" />} onClick={() => setCreating(tab === "timeline" ? "event" : tab)}>新建{ITEM_TYPE_LABELS[tab === "timeline" ? "event" : tab]}</Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
                {listError ? <Alert type="error" showIcon title={listError} action={<Button size="small" onClick={refresh}>重试</Button>} /> : null}
                {loading && !data ? <div className="flex justify-center p-6"><Spin /></div> : null}
                {data && !data.items.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无条目，完成分析或手动新建后显示在这里" /> : null}
                {(tab === "character" || tab === "location") && data?.items.length ? <p className="mb-3 text-xs text-[var(--studio-muted)]">卡片背景深浅按当前页证据条数展示，条数越多颜色越深</p> : null}
                <div className={tab === "character" || tab === "location" ? "grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,18rem),1fr))]" : "flex flex-col gap-2"}>
                    {data?.items.map((item, index) => {
                        const onOpen = () => setOpenItemId(item.id);
                        const onEvidence = item.narrativeOffset != null ? () => onOpenSource(item.narrativeOffset as number, (item.narrativeOffset as number) + 1) : undefined;
                        return tab === "character" || tab === "location"
                            ? <ItemCard key={item.id} item={item} maximumEvidenceCount={maximumEvidenceCount} selected={selectedItemIds.includes(item.id)} onToggle={toggleItem} onOpen={onOpen} onEvidence={onEvidence} />
                            : <ItemRow key={item.id} item={item} index={tab === "timeline" ? (data.page - 1) * data.pageSize + index + 1 : null} selected={selectedItemIds.includes(item.id)} onToggle={toggleItem} onOpen={onOpen} onEvidence={onEvidence} />;
                    })}
                </div>
                {data && data.total ? <Pagination className="mt-4" size="small" current={data.page} pageSize={data.pageSize} pageSizeOptions={PAGE_SIZE_OPTIONS} total={data.total} showSizeChanger onChange={(nextPage, nextPageSize) => { if (nextPageSize !== pageSize) { setPageSize(nextPageSize); setPage(1); } else setPage(nextPage); }} /> : null}
            </div>
            <StoryBibleItemDrawer
                projectId={projectId}
                itemId={openItemId}
                createType={creating}
                onClose={() => { setOpenItemId(null); setCreating(null); }}
                onChanged={(nextId) => { if (nextId) { setCreating(null); setOpenItemId(nextId); } refresh(); }}
                onOpenSource={(start, end) => { onOpenSource(start, end); message.info("已跳转到原文位置"); }}
            />
        </section>
    );
}

/** 以卡片展示人物或地点，保留详情与原文两个独立操作。 */
function ItemCard({ item, maximumEvidenceCount, selected, onToggle, onOpen, onEvidence }: { item: StoryBibleItem; maximumEvidenceCount: number; selected: boolean; onToggle: (itemId: string, checked: boolean) => void; onOpen: () => void; onEvidence?: () => void }) {
    const aliases = item.aliases.filter((alias) => alias !== item.name);
    // 以当前页最高证据数为参照，控制着色强度以保持文字在明暗主题下都清晰可读。
    const colorStrength = item.evidenceCount > 0 ? 8 + item.evidenceCount / maximumEvidenceCount * 20 : 0;
    return (
        <article className="relative flex min-w-0 flex-col rounded-lg border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] transition-colors hover:border-[var(--studio-primary-line)] focus-within:border-[var(--studio-primary-line)]" style={colorStrength ? { background: `linear-gradient(135deg, color-mix(in srgb, var(--studio-action) ${colorStrength}%, var(--studio-panel-solid)), color-mix(in srgb, var(--studio-action) ${colorStrength / 2}%, var(--studio-panel-solid)))` } : undefined}>
            {item.status === "pending" ? <div className="absolute left-3 top-3 z-10" onClick={(event) => event.stopPropagation()}><Checkbox aria-label={`选择${item.name}`} checked={selected} onChange={(event) => onToggle(item.id, event.target.checked)} /></div> : null}
            <button type="button" className="flex min-h-36 w-full min-w-0 flex-1 flex-col items-start px-4 py-3 pl-10 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--studio-action)]" onClick={onOpen} aria-label={`查看${ITEM_TYPE_LABELS[item.itemType]}详情：${item.name}`}>
                <div className="flex w-full min-w-0 items-start justify-between gap-2">
                    <span className="min-w-0 line-clamp-2 break-all text-sm font-semibold text-[var(--studio-ink)]">{item.name}</span>
                    <Tag color={item.status === "confirmed" ? "green" : item.status === "rejected" ? "default" : "gold"} className="mr-0 shrink-0">{ITEM_STATUS_LABELS[item.status]}</Tag>
                </div>
                {aliases.length ? <span className="mt-2 w-full truncate text-xs text-[var(--studio-muted)]" title={aliases.join("、")}>别名：{aliases.join("、")}</span> : null}
                <span className="mt-2 line-clamp-3 break-words text-xs leading-5 text-[var(--studio-text)]">{item.summary || "暂无简介"}</span>
                <div className="mt-auto flex flex-wrap gap-1 pt-3">
                    {item.origin === "manual" ? <Tag className="mr-0">人工</Tag> : null}
                    {item.locked ? <Tag className="mr-0">已锁定</Tag> : null}
                    {item.attributes?.uncertain === true ? <Tag color="orange" className="mr-0">归并待确认</Tag> : null}
                    {item.suggestionCount ? <Tag color="blue" className="mr-0">{item.suggestionCount} 条新建议</Tag> : null}
                </div>
            </button>
            <div className="flex min-h-10 items-center justify-between border-t border-[var(--studio-line)] px-4 py-1 text-xs text-[var(--studio-faint)]">
                <span>{item.evidenceCount} 条证据</span>
                {onEvidence ? <Button size="small" type="link" className="px-0" onClick={onEvidence}>查看原文</Button> : null}
            </div>
        </article>
    );
}

function ItemRow({ item, index, selected, onToggle, onOpen, onEvidence }: { item: StoryBibleItem; index: number | null; selected: boolean; onToggle: (itemId: string, checked: boolean) => void; onOpen: () => void; onEvidence?: () => void }) {
    const uncertain = item.attributes?.uncertain === true;
    return (
        <div className="flex items-start gap-3 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] px-3 py-2">
            {item.status === "pending" ? <div className="pt-0.5" onClick={(event) => event.stopPropagation()}><Checkbox aria-label={`选择${item.name}`} checked={selected} onChange={(event) => onToggle(item.id, event.target.checked)} /></div> : null}
            {index != null ? <span className="w-8 shrink-0 pt-0.5 text-right text-xs text-[var(--studio-faint)]">{index}</span> : null}
            <button type="button" className="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-[var(--studio-action)]" onClick={onOpen}>
                <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-[var(--studio-ink)]">{item.name}</span>
                    <Tag color={item.status === "confirmed" ? "green" : item.status === "rejected" ? "default" : "gold"} className="mr-0">{ITEM_STATUS_LABELS[item.status]}</Tag>
                    {item.origin === "manual" ? <Tag className="mr-0">人工</Tag> : null}
                    {item.locked ? <Tag className="mr-0">已锁定</Tag> : null}
                    {uncertain ? <Tag color="orange" className="mr-0">归并待确认</Tag> : null}
                    {item.suggestionCount ? <Tag color="blue" className="mr-0">{item.suggestionCount} 条新建议</Tag> : null}
                    {item.itemType === "event" ? <span className="text-xs text-[var(--studio-muted)]">{item.storyTimeStatus === "known" ? item.storyTime : "时间待确认"}</span> : null}
                </div>
                {item.aliases.length > 1 ? <p className="mt-1 truncate text-xs text-[var(--studio-muted)]">别名：{item.aliases.filter((alias) => alias !== item.name).join("、")}</p> : null}
                {item.summary ? <p className="mt-1 line-clamp-2 text-xs text-[var(--studio-text)]">{item.summary}</p> : null}
            </button>
            <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-[var(--studio-faint)]">
                <span>{item.evidenceCount} 条证据</span>
                {onEvidence ? <Button size="small" type="link" className="px-0" onClick={onEvidence}>原文</Button> : null}
            </div>
        </div>
    );
}

/** 分析报价、启动、进度、续跑与取消。 */
function AnalysisBar({ projectId, onCompleted }: { projectId: string; onCompleted: () => void }) {
    const { message, modal } = App.useApp();
    const config = useEffectiveConfig();
    const openConfig = useConfigStore((state) => state.openConfigDialog);
    const setCreditBalance = useUserStore((state) => state.setCreditBalance);
    const [model, setModel] = useState("");
    const [sectionIds, setSectionIds] = useState<string[]>([]);
    const [tree, setTree] = useState<ScriptSourceTree | null>(null);
    const [treeError, setTreeError] = useState("");
    const [job, setJob] = useState<StoryBibleJob | null>(null);
    const [jobLoaded, setJobLoaded] = useState(false);
    const [busy, setBusy] = useState(false);
    const [cancellationPending, setCancellationPending] = useState(false);
    const jobRef = useRef<StoryBibleJob | null>(null);
    const jobUpdateVersionRef = useRef(0);
    const jobMutationInProgressRef = useRef(false);

    useEffect(() => {
        // 回显最近一次分析任务的模型，但模型可能已被管理员改名或重建：必须以当前模型目录校验，
        // 否则会把失效的模型串发给服务端，报价只会报「所选文本模型不可用」。轮询不覆盖用户仍然有效的选择。
        if (!jobLoaded) return;
        const options = selectableModelsByCapability(config, "text");
        setModel((current) => {
            if (options.includes(current)) return current;
            return job?.model && options.includes(job.model) ? job.model : config.textModel;
        });
    }, [config, job?.model, jobLoaded]);

    const loadTree = useCallback(async () => {
        try {
            setTree(await getScriptSourceTree(projectId));
            setTreeError("");
        } catch (error) {
            setTreeError(error instanceof Error ? error.message : "原文目录加载失败");
        }
    }, [projectId]);

    const loadJob = useCallback(async () => {
        if (jobMutationInProgressRef.current) return;
        const requestVersion = jobUpdateVersionRef.current;
        try {
            const next = await getStoryBibleAnalysisStatus(projectId);
            // 取消或续跑请求完成后，丢弃此前发出的状态查询，避免旧状态覆盖最新结果。
            if (requestVersion !== jobUpdateVersionRef.current || jobMutationInProgressRef.current) return;
            const previous = jobRef.current;
            jobRef.current = next;
            setJob(next);
            setJobLoaded(true);
            if (previous && next && previous.jobId === next.jobId
                && (previous.processedUnits !== next.processedUnits || previous.status !== next.status)) onCompleted();
        } catch {
            /* 状态查询失败时保留上次结果，下一轮继续查询。 */
        }
    }, [onCompleted, projectId]);

    useEffect(() => {
        void loadTree();
        void loadJob();
        const timer = window.setInterval(() => {
            const current = jobRef.current;
            if (current && (current.status === "queued" || current.status === "running")) void loadJob();
        }, POLL_INTERVAL_MILLISECONDS);
        return () => window.clearInterval(timer);
    }, [loadJob, loadTree]);

    const applyJob = (next: StoryBibleJob) => {
        jobUpdateVersionRef.current += 1;
        jobRef.current = next;
        setJob(next);
        if (next.creditBalance != null) setCreditBalance(next.creditBalance);
    };

    const start = async () => {
        if (!model) {
            message.warning("请选择文本模型");
            return;
        }
        setBusy(true);
        try {
            const quote = await quoteStoryBibleAnalysis(projectId, model, sectionIds);
            const clientRequestId = nanoid();
            modal.confirm({
                title: "确认启动故事知识库分析",
                content: (
                    <div className="mt-3 space-y-1 text-sm">
                        <p>模型：{modelOptionLabel(config, quote.model)}</p>
                        <p>范围：{sectionIds.length ? `已选 ${sectionIds.length} 个章节或场次` : "全书"}</p>
                        <p>计费字数：{quote.billableChars.toLocaleString("zh-CN")} 字（不含空格与换行）</p>
                        <p>价格档位：{quote.tierMinChars.toLocaleString("zh-CN")} – {quote.tierMaxChars == null ? "不限" : quote.tierMaxChars.toLocaleString("zh-CN")} 字</p>
                        <p className="font-semibold">预扣积分：{quote.credits}</p>
                        <p>预计初始 {quote.estimatedBatches} 批 · 最多补分析 {quote.quickConfiguration.maximumSupplementCalls} 次 · 同时最多 2 批</p>
                        <p className="text-xs text-[var(--studio-muted)]">按原文字数档位预扣；取消时仅扣成功完成的初始批次积分，其余退款（退款向下取整），已完成内容保留。拆分批次全部完成才计成功，补分析不额外收费。模型最终失败全额退款。人工确认或修改的条目不会被覆盖。</p>
                    </div>
                ),
                okText: "确认并扣除积分",
                cancelText: "取消",
                onOk: async () => {
                    try {
                        applyJob(await startStoryBibleAnalysis({ projectId, model, sectionIds, clientRequestId, expectedCredits: quote.credits, expectedSourceRevision: quote.sourceRevision, expectedPricingRevision: quote.pricingRevision }));
                        message.success("分析已开始");
                    } catch (error) {
                        message.error(error instanceof Error ? error.message : "启动分析失败");
                    }
                },
            });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "报价失败");
        } finally {
            setBusy(false);
        }
    };

    const act = async (action: () => Promise<StoryBibleJob>, done: string, cancellation = false) => {
        jobMutationInProgressRef.current = true;
        jobUpdateVersionRef.current += 1;
        setBusy(true);
        setCancellationPending(cancellation);
        try {
            const next = await action();
            applyJob(next);
            onCompleted();
            message.success(cancellation ? `已取消，已退还 ${next.refundedCredits} 积分，已完成内容保留` : done);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "操作失败");
        } finally {
            jobMutationInProgressRef.current = false;
            setCancellationPending(false);
            setBusy(false);
            void loadJob();
        }
    };

    const active = job != null && ["queued", "running", "retryable"].includes(job.status);
    const percent = job && job.totalUnits ? Math.min(99, Math.round((job.processedUnits / job.totalUnits) * 100)) : 0;
    const confirmed = tree != null && tree.confirmedRevision === tree.revision;
    const treeData = (tree?.sections || []).filter((section) => !section.parentId).map((section) => ({
        value: section.id,
        title: section.title,
        children: tree?.sections.filter((child) => child.parentId === section.id).map((child) => ({ value: child.id, title: child.title })),
    }));

    return (
        <div className="border-b border-[var(--studio-line)] px-4 py-3 sm:px-6">
            {treeError ? <Alert type="info" showIcon className="mb-2" title={treeError.includes("没有") ? "该项目还没有导入原文，故事知识库需要基于导入的小说或剧本分析" : treeError} /> : null}
            {tree && !confirmed ? <Alert type="warning" showIcon className="mb-2" title="请先在“原文”中核对并确认当前章节与场次结构，确认后才能分析" /> : null}
            <div className="flex flex-wrap items-center gap-2">
                <div className="w-60"><ModelPicker config={config} value={model} onChange={setModel} capability="text" fullWidth onMissingConfig={() => openConfig(true, "models")} /></div>
                <TreeSelect className="min-w-56 flex-1" treeData={treeData} value={sectionIds} onChange={setSectionIds} treeCheckable showCheckedStrategy={TreeSelect.SHOW_PARENT} placeholder="分析范围：全书（可选择章节或场次局部重分析）" allowClear maxTagCount={3} disabled={!tree} />
                <Button type="primary" loading={busy && !active} disabled={!confirmed || active} onClick={() => void start()}>报价并分析</Button>
            </div>
            {job ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--studio-muted)]">
                    <Tag color={job.status === "completed" ? "green" : job.status === "failed" || job.status === "canceled" ? "default" : job.status === "retryable" || job.status === "partial" ? "orange" : "blue"} className="mr-0">{cancellationPending ? "取消中" : JOB_STATUS_LABELS[job.status]}</Tag>
                    {active ? <span>{STAGE_LABELS[job.stage] || job.stage} · {job.processedUnits} / {job.totalUnits || "?"}</span> : null}
                    {active ? <Progress percent={percent} size="small" className="w-40" showInfo={false} strokeColor="var(--studio-primary)" /> : null}
                    <span>{job.billableChars.toLocaleString("zh-CN")} 字 · 预扣 {job.credits} 积分 · {job.sectionIds.length ? "局部" : "全书"}</span>
                    {job.status === "canceled" || job.status === "failed" ? <span>已退 {job.refundedCredits} 积分 · 实扣 {job.credits - job.refundedCredits} 积分</span> : null}
                    {job.errorMessage ? <span className="text-[var(--studio-danger)]">{job.errorMessage}</span> : null}
                    {job.status === "retryable" ? <Button size="small" type="primary" loading={busy} onClick={() => void act(() => retryStoryBibleAnalysis(projectId, job.jobId), "已继续分析")}>续跑</Button> : null}
                    {active ? <Button size="small" danger loading={busy} onClick={() => modal.confirm({ title: "取消分析？", content: "仅按成功完成的初始批次分摊扣费，其余积分退还（退款向下取整）。正在处理的批次也退款；拆分批次全部完成才计成功，补分析不额外收费。已完成内容保留，取消后返回的结果丢弃。", okText: "确认取消", cancelText: "继续分析", onOk: () => act(() => cancelStoryBibleAnalysis(projectId, job.jobId), "已取消，已完成内容保留", true) })}>取消</Button> : null}
                </div>
            ) : null}
            {job?.gaps?.length ? <Alert type="warning" showIcon className="mt-2" title={`有 ${job.gaps.length} 处未覆盖内容`} description={job.gaps.map((gap) => gap.title).filter((title, index, titles) => titles.indexOf(title) === index).join("、")} /> : null}
        </div>
    );
}
