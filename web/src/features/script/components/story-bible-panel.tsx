"use client";
import { getWalletBalances } from "@/services/api/team";
import { useTeamStore } from "@/features/team/stores/use-team-store";

import { creditAmount, creditText } from "@/shared/lib/credit-amounts";

import { translateMessage } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";

import { useCallback, useEffect, useRef, useState } from "react";
import { App, Alert, Button, Checkbox, Empty, Input, Pagination, Progress, Segmented, Select, Spin, Tag, TreeSelect } from "antd";
import { Plus, RefreshCw } from "lucide-react";
import { nanoid } from "nanoid";

import { ModelPicker } from "@/features/settings/components/model-picker";
import { useModelConfigurationGuard } from "@/features/settings/hooks/use-model-configuration-guard";
import { modelOptionLabel, selectableModelsByCapability, useEffectiveConfig } from "@/features/settings/stores/use-config-store";
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
import { getItemStatusLabels, getItemTypeLabels, StoryBibleItemDrawer } from "./story-bible-item-drawer";

/** 分析进行中的状态查询间隔。 */
const POLL_INTERVAL_MILLISECONDS = 2500;

/** 列表每页显示条数选项。 */
const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];

const getTypeTabs = (translate = translateMessage): Array<{ value: StoryBibleItemType | "timeline"; label: string }> => ([
    { value: "character", label: translate("script.character") },
    { value: "location", label: translate("script.location") },
    { value: "relationship", label: translate("script.relationship") },
    { value: "event", label: translate("script.event") },
    { value: "storyline", label: translate("script.storyline") },
    { value: "timeline", label: translate("script.timeline") },
]);

const getJobStatusLabels = (translate = translateMessage): Record<StoryBibleJob["status"], string> => ({ queued: translate("script.queued"), running: translate("script.analyzing"), retryable: translate("script.interruptedCanResume"), completed: translate("script.completed"), partial: translate("script.partiallyCompleted"), failed: translate("script.failedRefunded"), canceled: translate("script.canceledChargedByBatch") });
const getStageLabels = (translate = translateMessage): Record<string, string> => ({ extract: translate("script.batchExtraction"), book: translate("script.storylineSynthesis"), done: translate("script.completed") });

/** 故事知识库：分析任务、条目列表、时间线与条目详情。 */
export function StoryBiblePanel({ onOpenSource }: { onOpenSource: (start: number, end: number) => void }) {
    const translate = useTranslation();
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
            if (requestSequence === listRequestSequence.current) setListError(error instanceof Error ? error.message : translate("script.couldNotLoadTheEntry"));
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
            title: translate("script.confirmCountSelectedStoryBibleEntries", { value0: selectedPendingIds.length }),
            content: translate("script.confirmedEntriesAreLockedPendingSuggestionsAreMergedIntoTheir"),
            okText: translate("script.confirmSelected"),
            cancelText: translate("script.cancel"),
            onOk: async () => {
                try {
                    await confirmStoryBibleItems(projectId, selectedPendingIds.map((itemId) => {
                        const item = data?.items.find((entry) => entry.id === itemId);
                        return { itemId, expectedRevision: item?.revision ?? -1 };
                    }));
                    message.success(translate("script.confirmedCountEntries", { value0: selectedPendingIds.length }));
                    setSelectedItemIds([]);
                    refresh();
                } catch (requestError) {
                    message.error(requestError instanceof Error ? requestError.message : translate("script.couldNotConfirmSelectedEntriesRefreshAndTryAgain"));
                    throw requestError;
                }
            },
        });
    };

    const confirmAllPending = () => {
        const itemType: StoryBibleItemType = tab === "timeline" ? "event" : tab;
        modal.confirm({
            title: translate("script.confirmAllPendingContentUnderCount", { value0: getItemTypeLabels(translate)[itemType] }),
            content: translate("script.includesAllPendingEntriesInThisCategoryRegardlessOfPagination"),
            okText: translate("script.confirmAll"),
            cancelText: translate("script.cancel"),
            onOk: async () => {
                try {
                    const result = await confirmAllStoryBibleItems(projectId, itemType);
                    if (!result.confirmedCount) {
                        message.info(translate("script.thisCategoryHasNoPendingContent"));
                        return;
                    }
                    message.success(translate("script.confirmedCountEntries", { value0: result.confirmedCount }));
                    setSelectedItemIds([]);
                    refresh();
                } catch (requestError) {
                    message.error(requestError instanceof Error ? requestError.message : translate("script.couldNotConfirmAllEntriesRefreshAndTryAgain"));
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
                <Segmented value={tab} options={getTypeTabs(translate)} onChange={(value) => { setTab(value as typeof tab); setPage(1); }} />
                {tab === "timeline" ? <Segmented value={timelineOrder} options={[{ value: "narrative", label: translate("script.narrativeOrder") }, { value: "story", label: translate("script.storyTime") }]} onChange={(value) => { setTimelineOrder(value as typeof timelineOrder); setPage(1); }} /> : null}
                <Select className="w-28" value={status} onChange={(value) => { setStatus(value); setPage(1); }} options={[{ value: "", label: translate("script.allActive") }, { value: "pending", label: translate("script.pendingApproval") }, { value: "confirmed", label: translate("script.confirmed") }, { value: "rejected", label: translate("script.rejected") }]} />
                <Input.Search className="max-w-56" allowClear placeholder={translate("script.searchNamesOrAliases")} onSearch={(value) => { setKeyword(value); setPage(1); }} />
                <span className="flex-1" />
                {pendingItems.length ? <Checkbox checked={allPendingSelected} indeterminate={selectedPendingIds.length > 0 && !allPendingSelected} onChange={(event) => toggleAllPending(event.target.checked)}>{translate("script.selectPendingOnThisPage")}</Checkbox> : null}
                <Button size="small" type="primary" disabled={!selectedPendingIds.length} onClick={confirmSelected}>{translate("script.confirmSelectedCount_be301e", { value0: selectedPendingIds.length ? `（${selectedPendingIds.length}）` : "" })}</Button>
                {data && data.total ? <Button size="small" onClick={confirmAllPending}>{translate("script.confirmAll")}</Button> : null}
                <Button size="small" icon={<RefreshCw className="size-3.5" />} onClick={refresh}>{translate("script.refresh")}</Button>
                <Button size="small" icon={<Plus className="size-3.5" />} onClick={() => setCreating(tab === "timeline" ? "event" : tab)}>{translate("script.createCount_8187fe", { value0: getItemTypeLabels(translate)[tab === "timeline" ? "event" : tab] })}</Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
                {listError ? <Alert type="error" showIcon title={listError} action={<Button size="small" onClick={refresh}>{translate("script.retry")}</Button>} /> : null}
                {loading && !data ? <div className="flex justify-center p-6"><Spin /></div> : null}
                {data && !data.items.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={translate("script.noEntriesYetAnalyzeTheSourceOrCreateOneManually")} /> : null}
                {(tab === "character" || tab === "location") && data?.items.length ? <p className="mb-3 text-xs text-[var(--studio-muted)]">{translate("script.cardShadingReflectsTheEvidenceCountOnThisPageMore")}</p> : null}
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
                onOpenSource={(start, end) => { onOpenSource(start, end); message.info(translate("script.openedTheSourcePosition")); }}
            />
        </section>
    );
}

/** 以卡片展示人物或地点，保留详情与原文两个独立操作。 */
function ItemCard({ item, maximumEvidenceCount, selected, onToggle, onOpen, onEvidence }: { item: StoryBibleItem; maximumEvidenceCount: number; selected: boolean; onToggle: (itemId: string, checked: boolean) => void; onOpen: () => void; onEvidence?: () => void }) {
    const translate = useTranslation();
    const aliases = item.aliases.filter((alias) => alias !== item.name);
    // 以当前页最高证据数为参照，控制着色强度以保持文字在明暗主题下都清晰可读。
    const colorStrength = item.evidenceCount > 0 ? 8 + item.evidenceCount / maximumEvidenceCount * 20 : 0;
    return (
        <article className="relative flex min-w-0 flex-col rounded-lg border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] transition-colors hover:border-[var(--studio-primary-line)] focus-within:border-[var(--studio-primary-line)]" style={colorStrength ? { background: `linear-gradient(135deg, color-mix(in srgb, var(--studio-action) ${colorStrength}%, var(--studio-panel-solid)), color-mix(in srgb, var(--studio-action) ${colorStrength / 2}%, var(--studio-panel-solid)))` } : undefined}>
            {item.status === "pending" ? <div className="absolute left-3 top-3 z-10" onClick={(event) => event.stopPropagation()}><Checkbox aria-label={translate("script.selectCount_501c10", { value0: item.name })} checked={selected} onChange={(event) => onToggle(item.id, event.target.checked)} /></div> : null}
            <button type="button" className="flex min-h-36 w-full min-w-0 flex-1 flex-col items-start px-4 py-3 pl-10 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--studio-action)]" onClick={onOpen} aria-label={translate("script.viewCountDetailsCount", { value0: getItemTypeLabels(translate)[item.itemType], value1: item.name })}>
                <div className="flex w-full min-w-0 items-start justify-between gap-2">
                    <span className="min-w-0 line-clamp-2 break-all text-sm font-semibold text-[var(--studio-ink)]">{item.name}</span>
                    <Tag color={item.status === "confirmed" ? "green" : item.status === "rejected" ? "default" : "gold"} className="mr-0 shrink-0">{getItemStatusLabels(translate)[item.status]}</Tag>
                </div>
                {aliases.length ? <span className="mt-2 w-full truncate text-xs text-[var(--studio-muted)]" title={aliases.join("、")}>{translate("script.aliasesCount_d5c2fb", { value0: aliases.join("、") })}</span> : null}
                <span className="mt-2 line-clamp-3 break-words text-xs leading-5 text-[var(--studio-text)]">{item.summary || translate("script.noSummaryYet")}</span>
                <div className="mt-auto flex flex-wrap gap-1 pt-3">
                    {item.origin === "manual" ? <Tag className="mr-0">{translate("script.manual_80212d")}</Tag> : null}
                    {item.locked ? <Tag className="mr-0">{translate("script.locked")}</Tag> : null}
                    {item.attributes?.uncertain === true ? <Tag color="orange" className="mr-0">{translate("script.mergePending")}</Tag> : null}
                    {item.suggestionCount ? <Tag color="blue" className="mr-0">{translate("script.countNewSuggestions_67aa2b", { value0: item.suggestionCount })}</Tag> : null}
                </div>
            </button>
            <div className="flex min-h-10 items-center justify-between border-t border-[var(--studio-line)] px-4 py-1 text-xs text-[var(--studio-faint)]">
                <span>{translate("script.countEvidenceItems_47b230", { value0: item.evidenceCount })}</span>
                {onEvidence ? <Button size="small" type="link" className="px-0" onClick={onEvidence}>{translate("script.viewSource")}</Button> : null}
            </div>
        </article>
    );
}

function ItemRow({ item, index, selected, onToggle, onOpen, onEvidence }: { item: StoryBibleItem; index: number | null; selected: boolean; onToggle: (itemId: string, checked: boolean) => void; onOpen: () => void; onEvidence?: () => void }) {
    const translate = useTranslation();
    const uncertain = item.attributes?.uncertain === true;
    return (
        <div className="flex items-start gap-3 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] px-3 py-2">
            {item.status === "pending" ? <div className="pt-0.5" onClick={(event) => event.stopPropagation()}><Checkbox aria-label={translate("script.selectCount_501c10", { value0: item.name })} checked={selected} onChange={(event) => onToggle(item.id, event.target.checked)} /></div> : null}
            {index != null ? <span className="w-8 shrink-0 pt-0.5 text-right text-xs text-[var(--studio-faint)]">{index}</span> : null}
            <button type="button" className="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-[var(--studio-action)]" onClick={onOpen}>
                <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-[var(--studio-ink)]">{item.name}</span>
                    <Tag color={item.status === "confirmed" ? "green" : item.status === "rejected" ? "default" : "gold"} className="mr-0">{getItemStatusLabels(translate)[item.status]}</Tag>
                    {item.origin === "manual" ? <Tag className="mr-0">{translate("script.manual_80212d")}</Tag> : null}
                    {item.locked ? <Tag className="mr-0">{translate("script.locked")}</Tag> : null}
                    {uncertain ? <Tag color="orange" className="mr-0">{translate("script.mergePending")}</Tag> : null}
                    {item.suggestionCount ? <Tag color="blue" className="mr-0">{translate("script.countNewSuggestions_67aa2b", { value0: item.suggestionCount })}</Tag> : null}
                    {item.itemType === "event" ? <span className="text-xs text-[var(--studio-muted)]">{item.storyTimeStatus === "known" ? item.storyTime : translate("script.timeUnconfirmed")}</span> : null}
                </div>
                {item.aliases.length > 1 ? <p className="mt-1 truncate text-xs text-[var(--studio-muted)]">{translate("script.aliasesCount_d5c2fb", { value0: item.aliases.filter((alias) => alias !== item.name).join("、") })}</p> : null}
                {item.summary ? <p className="mt-1 line-clamp-2 text-xs text-[var(--studio-text)]">{item.summary}</p> : null}
            </button>
            <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-[var(--studio-faint)]">
                <span>{translate("script.countEvidenceItems_47b230", { value0: item.evidenceCount })}</span>
                {onEvidence ? <Button size="small" type="link" className="px-0" onClick={onEvidence}>{translate("script.source")}</Button> : null}
            </div>
        </div>
    );
}

/** 分析报价、启动、进度、续跑与取消。 */
function AnalysisBar({ projectId, onCompleted }: { projectId: string; onCompleted: () => void }) {
    const translate = useTranslation();
    const { message, modal } = App.useApp();
    const config = useEffectiveConfig();
    const ensureModelConfiguration = useModelConfigurationGuard();
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
            setTreeError(error instanceof Error ? error.message : translate("script.couldNotLoadTheSourceDirectory"));
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
        if (next.creditBalance != null) void getWalletBalances().then((wallets) => { useTeamStore.getState().setWallets(wallets); setCreditBalance(wallets.platformBalance); }).catch((error) => message.error(error instanceof Error ? error.message : "读取积分钱包失败"));
    };

    const start = async () => {
        if (!ensureModelConfiguration("text", model)) return;
        setBusy(true);
        try {
            const quote = await quoteStoryBibleAnalysis(projectId, model, sectionIds);
            const clientRequestId = nanoid();
            modal.confirm({
                title: translate("script.startStoryBibleAnalysis"),
                content: (
                    <div className="mt-3 space-y-1 text-sm">
                        <p>{translate("script.modelCount_d0ad77", { value0: modelOptionLabel(config, quote.model) })}</p>
                        <p>{translate("script.scopeCount_cdf959", { value0: sectionIds.length ? translate("script.countChaptersOrScenesSelected", { value0: sectionIds.length }) : translate("script.entireBook") })}</p>
                        <p>{translate("script.billableCharactersCountExcludingSpacesAndLineBreaks_b7f4a6", { value0: quote.billableChars.toLocaleString(translate.locale) })}</p>
                        <p>{translate("script.pricingTierCountCountCharacters_2c25fa", { value0: quote.tierMinChars.toLocaleString(translate.locale), value1: quote.tierMaxChars == null ? translate("script.unlimited") : quote.tierMaxChars.toLocaleString(translate.locale) })}</p>
                        <p className="font-semibold">{translate("script.creditsReservedCount_573516", { value0: quote.credits })}</p>
                        <p>{translate("script.estimatedInitialBatchesCountUpToCountAdditionalAnalyses_30dc54", { value0: quote.estimatedBatches, value1: quote.quickConfiguration.maximumSupplementCalls })}</p>
                        <p className="text-xs text-[var(--studio-muted)]">{translate("script.creditsAreReservedBySourceLengthCancellationChargesOnlySuccessful")}</p>
                    </div>
                ),
                okText: translate("script.confirmAndChargeCredits"),
                cancelText: translate("script.cancel"),
                onOk: async () => {
                    try {
                        applyJob(await startStoryBibleAnalysis({ projectId, model, sectionIds, clientRequestId, expectedCredits: quote.credits, expectedSourceRevision: quote.sourceRevision, expectedPricingRevision: quote.pricingRevision }));
                        message.success(translate("script.analysisStarted"));
                    } catch (error) {
                        message.error(error instanceof Error ? error.message : translate("script.couldNotStartAnalysis"));
                    }
                },
            });
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("script.couldNotGetAQuote"));
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
            message.success(cancellation ? translate("script.canceledRefundedCountCreditsCompletedContentIsRetained", { value0: next.refundedCredits }) : done);
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("script.operationFailed"));
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
            {treeError ? <Alert type="info" showIcon className="mb-2" title={treeError.includes("没有") ? translate("script.thisProjectHasNoImportedSourceStoryBibleAnalysisRequires") : treeError} /> : null}
            {tree && !confirmed ? <Alert type="warning" showIcon className="mb-2" title={translate("script.reviewAndConfirmChaptersAndScenesInSourceBeforeStarting")} /> : null}
            <div className="flex flex-wrap items-center gap-2">
                <div className="w-60"><ModelPicker config={config} value={model} onChange={setModel} capability="text" fullWidth /></div>
                <TreeSelect className="min-w-56 flex-1" treeData={treeData} value={sectionIds} onChange={setSectionIds} treeCheckable showCheckedStrategy={TreeSelect.SHOW_PARENT} placeholder={translate("script.analysisScopeEntireBookSelectChaptersOrScenesToReanalyze")} allowClear maxTagCount={3} disabled={!tree} />
                <Button type="primary" loading={busy && !active} disabled={!confirmed || active} onClick={() => void start()}>{translate("script.getQuoteAndAnalyze")}</Button>
            </div>
            {job ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--studio-muted)]">
                    <Tag color={job.status === "completed" ? "green" : job.status === "failed" || job.status === "canceled" ? "default" : job.status === "retryable" || job.status === "partial" ? "orange" : "blue"} className="mr-0">{cancellationPending ? translate("script.canceling") : getJobStatusLabels(translate)[job.status]}</Tag>
                    {active ? <span>{getStageLabels(translate)[job.stage] || job.stage} · {job.processedUnits} / {job.totalUnits || "?"}</span> : null}
                    {active ? <Progress percent={percent} size="small" className="w-40" showInfo={false} strokeColor="var(--studio-primary)" /> : null}
                    <span>{translate("script.countCharactersCountCreditsReservedCount_50129a", { value0: job.billableChars.toLocaleString(translate.locale), value1: job.credits, value2: job.sectionIds.length ? translate("script.partial") : translate("script.entireBook") })}</span>
                    {job.status === "canceled" || job.status === "failed" ? <span>{translate("script.refundedCountCreditsChargedCountCredits_83e127", { value0: job.refundedCredits, value1: creditAmount(job.credits).minus(job.refundedCredits).toFixed() })}</span> : null}
                    {job.errorMessage ? <span className="text-[var(--studio-danger)]">{job.errorMessage}</span> : null}
                    {job.status === "retryable" ? <Button size="small" type="primary" loading={busy} onClick={() => void act(() => retryStoryBibleAnalysis(projectId, job.jobId), translate("script.analysisResumed"))}>{translate("script.resume")}</Button> : null}
                    {active ? <Button size="small" danger loading={busy} onClick={() => modal.confirm({ title: translate("script.cancelAnalysis"), content: translate("script.onlySuccessfulInitialBatchesAreChargedOtherCreditsAreRefunded"), okText: translate("script.confirmCancellation"), cancelText: translate("script.continueAnalysis"), onOk: () => act(() => cancelStoryBibleAnalysis(projectId, job.jobId), translate("script.canceledCompletedContentIsRetained"), true) })}>{translate("script.cancel")}</Button> : null}
                </div>
            ) : null}
            {job?.gaps?.length ? <Alert type="warning" showIcon className="mt-2" title={translate("script.countUncoveredSections", { value0: job.gaps.length })} description={job.gaps.map((gap) => gap.title).filter((title, index, titles) => titles.indexOf(title) === index).join("、")} /> : null}
        </div>
    );
}
