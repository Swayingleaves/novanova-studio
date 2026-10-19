"use client";

import { creditAmount, creditText } from "@/shared/lib/credit-amounts";

import type { CreditAmount } from "@/shared/lib/credit-amounts";
import { translateMessage as translate } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";


import { useMemo, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import dayjs, { type Dayjs } from "dayjs";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, DatePicker, Empty, Pagination, Segmented, Select, Skeleton, Table, type TableProps } from "antd";
import { Zap } from "lucide-react";

import { useUserStore } from "@/features/auth/stores/use-user-store";
import {
    getCreditOverview,
    listCreditTransactions,
    type ServerCreditDirection,
    type ServerCreditSource,
    type ServerUserCreditTransaction,
} from "@/services/api/server";

import { createCreditDirectionOptions, createCreditSourceOptions, CREDIT_TRANSACTION_PAGE_SIZE, creditTransactionDetail, creditTransactionIcon, creditTransactionTypeLabel, formatCreditChange, formatCredits, formatCreditTime, normalizeGenerationDistribution, normalizeModelDistribution } from "./credit-page-utils";

const CreditChart = dynamic(() => import("./components/credit-chart").then((module) => module.CreditChart), {
    ssr: false,
    loading: () => <Skeleton active className="px-5 py-6" paragraph={{ rows: 7 }} />,
});

type GenerationTypeFilter = "all" | "image" | "video";
type TrendUnit = "day" | "month";

const createCreditTransactionColumns = (translator: typeof translate = translate): TableProps<ServerUserCreditTransaction>["columns"] => ([
    {
        get title() { return translator("credits.type"); },
        dataIndex: "transactionType",
        width: 132,
        render: (transactionType: ServerUserCreditTransaction["transactionType"], record) => {
            const Icon = creditTransactionIcon(record);
            return <span className="inline-flex items-center gap-2 text-[var(--studio-text)]"><Icon className="size-4 text-[var(--studio-primary)]" />{creditTransactionTypeLabel(transactionType)}</span>;
        },
    },
    {
        get title() { return translator("credits.details"); },
        dataIndex: "reason",
        ellipsis: true,
        render: (_, record) => <span className="text-[var(--studio-muted)]">{creditTransactionDetail(record.transactionType, record.generationType, record.model, record.reason)}</span>,
    },
    {
        get title() { return translator("credits.creditChange"); },
        dataIndex: "changeAmount",
        width: 128,
        align: "right",
        render: (changeAmount: CreditAmount) => <span className={`font-medium tabular-nums ${creditAmount(changeAmount).greaterThan(0) ? "text-[var(--studio-primary)]" : "text-[var(--studio-ink)]"}`}>{formatCreditChange(changeAmount)}</span>,
    },
    {
        get title() { return translator("credits.balanceSnapshot"); },
        dataIndex: "balanceAfter",
        width: 128,
        align: "right",
        render: (balanceAfter: CreditAmount) => <span className="tabular-nums text-[var(--studio-muted)]">{formatCredits(balanceAfter)}</span>,
    },
    {
        get title() { return translator("credits.time"); },
        dataIndex: "createdAt",
        width: 176,
        render: (createdAt: string) => <span className="tabular-nums text-[var(--studio-muted)]">{formatCreditTime(createdAt)}</span>,
    },
]);

/**
 * 渲染用户积分消耗统计页面。
 *
 * @return 积分统计页面
 */
export default function CreditsPage() {
    const translate = useTranslation();
    const user = useUserStore((state) => state.user);
    const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>(() => [dayjs().subtract(29, "day").startOf("day"), dayjs().endOf("day")]);
    const [generationType, setGenerationType] = useState<GenerationTypeFilter>("all");
    const [trendUnit, setTrendUnit] = useState<TrendUnit>("day");
    const [detailDateRange, setDetailDateRange] = useState<[Dayjs, Dayjs]>(() => [dayjs().subtract(29, "day").startOf("day"), dayjs().endOf("day")]);
    const [detailDirection, setDetailDirection] = useState<"all" | ServerCreditDirection>("all");
    const [detailSource, setDetailSource] = useState<"all" | ServerCreditSource>("all");
    const [page, setPage] = useState(1);

    const filters = useMemo(() => ({
        startDate: dateRange[0].format("YYYY-MM-DD"),
        endDate: dateRange[1].format("YYYY-MM-DD"),
        generationType: generationType === "all" ? undefined : generationType,
    }), [dateRange, generationType, translate.locale]);

    const detailFilters = useMemo(() => ({
        startDate: detailDateRange[0].format("YYYY-MM-DD"),
        endDate: detailDateRange[1].format("YYYY-MM-DD"),
        direction: detailDirection === "all" ? undefined : detailDirection,
        source: detailSource === "all" ? undefined : detailSource,
    }), [detailDateRange, detailDirection, detailSource, translate.locale]);

    const overviewQuery = useQuery({
        queryKey: ["credit-overview", filters.startDate, filters.endDate, filters.generationType, trendUnit],
        queryFn: () => getCreditOverview({ ...filters, trendUnit }),
    });
    const transactionsQuery = useQuery({
        queryKey: ["credit-transactions", detailFilters.startDate, detailFilters.endDate, detailFilters.direction, detailFilters.source, page],
        queryFn: () => listCreditTransactions({ ...detailFilters, page, pageSize: CREDIT_TRANSACTION_PAGE_SIZE }),
    });

    const overview = overviewQuery.data;
    const transactions = transactionsQuery.data;
    const generationDistribution = useMemo(() => normalizeGenerationDistribution(overview?.generationTypeDistribution || []), [overview?.generationTypeDistribution, translate.locale]);
    const modelDistribution = useMemo(() => normalizeModelDistribution(overview?.modelDistribution || []), [overview?.modelDistribution, translate.locale]);
    const trend = useMemo(() => (overview?.trend || []).map((item) => ({ name: item.period, value: Number(item.consumedCredits) })), [overview?.trend, translate.locale]);
    const totalConsumed = trend.reduce<CreditAmount>((total, item) => creditAmount(total).plus(item.value).toFixed(), 0);
    const hasOverviewError = overviewQuery.isError || transactionsQuery.isError;

    return (
        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-6 lg:px-8">
            <header className="flex flex-col gap-5 border-b border-[var(--studio-line)] pb-5 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <h1 className="text-2xl font-semibold text-[var(--studio-ink)]">{translate("credits.credits_10939f")}</h1>
                    <div className="mt-2 inline-flex items-center gap-2 text-sm text-[var(--studio-muted)]">
                        <Zap className="size-4 fill-current text-[var(--studio-primary)]" />
                        <span>{translate("credits.availableCredits")}</span>
                        <strong className="font-semibold tabular-nums text-[var(--studio-ink)]">{formatCredits(user?.creditBalance || 0)}</strong>
                    </div>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
                    <DatePicker.RangePicker
                        value={dateRange}
                        allowClear={false}
                        disabledDate={(date) => date.isAfter(dayjs(), "day")}
                        presets={[
                            { label: translate("credits.today"), value: [dayjs().startOf("day"), dayjs().endOf("day")] },
                            { label: translate("credits.last7Days"), value: [dayjs().subtract(6, "day"), dayjs()] },
                            { label: translate("credits.last30Days"), value: [dayjs().subtract(29, "day"), dayjs()] },
                            { label: translate("credits.thisMonth"), value: [dayjs().startOf("month"), dayjs()] },
                        ]}
                        onChange={(nextDateRange) => {
                            if (!nextDateRange?.[0] || !nextDateRange[1]) return;
                            setDateRange([nextDateRange[0], nextDateRange[1]]);
                            setPage(1);
                        }}
                    />
                    <Segmented
                        value={generationType}
                        options={[
                            { label: translate("credits.all"), value: "all" },
                            { label: translate("credits.generateImage"), value: "image" },
                            { label: translate("credits.generateVideo"), value: "video" },
                        ]}
                        onChange={(value) => {
                            setGenerationType(value as GenerationTypeFilter);
                            setPage(1);
                        }}
                    />
                </div>
            </header>

            {hasOverviewError ? (
                <Alert
                    className="mt-5"
                    type="error"
                    showIcon
                    title={translate("credits.failedToLoadCreditData")}
                    action={<Button size="small" onClick={() => { void overviewQuery.refetch(); void transactionsQuery.refetch(); }}>{translate("credits.reload")}</Button>}
                />
            ) : null}

            <section className="mt-7" aria-labelledby="credit-statistics-title">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 id="credit-statistics-title" className="text-base font-semibold text-[var(--studio-ink)]">{translate("credits.usageStatistics")}</h2>
                        <p className="mt-1 text-sm text-[var(--studio-muted)]">{translate("credits.totalUsageThisPeriod")}{formatCredits(totalConsumed)} {translate("credits.credits_10939f")}</p>
                    </div>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                    <ChartPanel title={translate("credits.imageVsVideoUsage")} loading={overviewQuery.isLoading} empty={!generationDistribution.length}>
                        <CreditChart type="pie" data={generationDistribution} ariaLabel={translate("credits.imageAndVideoCreditUsageChart")} />
                    </ChartPanel>
                    <ChartPanel title={translate("credits.usageByModel")} loading={overviewQuery.isLoading} empty={!modelDistribution.length}>
                        <CreditChart type="pie" data={modelDistribution} ariaLabel={translate("credits.creditUsageByModel")} />
                    </ChartPanel>
                    <ChartPanel
                        className="lg:col-span-2"
                        title={translate("credits.creditUsageTrend")}
                        loading={overviewQuery.isLoading}
                        empty={!trend.some((item) => creditAmount(item.value).greaterThan(0))}
                        extra={<Segmented value={trendUnit} size="small" options={[{ label: translate("credits.daily"), value: "day" }, { label: translate("credits.monthly"), value: "month" }]} onChange={(value) => setTrendUnit(value as TrendUnit)} />}
                    >
                        <CreditChart type="bar" data={trend} ariaLabel={translate("credits.creditUsageBarChart")} />
                    </ChartPanel>
                </div>
            </section>

            <section className="mt-8 border-t border-[var(--studio-line)] pt-6" aria-labelledby="credit-transactions-title">
                <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h2 id="credit-transactions-title" className="text-base font-semibold text-[var(--studio-ink)]">{translate("credits.creditDetails")}</h2>
                        <p className="mt-1 text-sm text-[var(--studio-muted)]">{translate("credits.includesCreditGrantsAndUsageFiltersAreIndependentOf")}</p>
                    </div>
                    <span className="text-sm tabular-nums text-[var(--studio-muted)]">{transactions?.total || 0} {translate("credits.records")}</span>
                </div>

                <div className="mb-4 flex flex-wrap items-center gap-3">
                    <DatePicker.RangePicker
                        value={detailDateRange}
                        allowClear={false}
                        disabledDate={(date) => date.isAfter(dayjs(), "day")}
                        onChange={(nextDateRange) => {
                            if (!nextDateRange?.[0] || !nextDateRange[1]) return;
                            setDetailDateRange([nextDateRange[0], nextDateRange[1]]);
                            setPage(1);
                        }}
                    />
                    <Segmented
                        value={detailDirection}
                        options={createCreditDirectionOptions(translate)}
                        onChange={(value) => {
                            setDetailDirection(value as "all" | ServerCreditDirection);
                            setPage(1);
                        }}
                    />
                    <Select
                        value={detailSource}
                        options={createCreditSourceOptions(translate)}
                        className="w-40"
                        onChange={(value) => {
                            setDetailSource(value as "all" | ServerCreditSource);
                            setPage(1);
                        }}
                    />
                </div>

                <div className="hidden md:block">
                    <Table<ServerUserCreditTransaction>
                        rowKey="id"
                        columns={createCreditTransactionColumns(translate)}
                        dataSource={transactions?.transactions || []}
                        loading={transactionsQuery.isLoading}
                        pagination={false}
                        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={translate("credits.noTransactionsInThisPeriod")} /> }}
                    />
                </div>
                <div className="md:hidden">
                    {transactionsQuery.isLoading ? <Skeleton active paragraph={{ rows: 8 }} /> : null}
                    {!transactionsQuery.isLoading && !transactions?.transactions.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={translate("credits.noTransactionsInThisPeriod")} /> : null}
                    {transactions?.transactions.map((transaction) => {
                        const Icon = creditTransactionIcon(transaction);
                        return (
                            <article key={transaction.id} className="border-b border-[var(--studio-line)] py-4">
                                <div className="flex items-start justify-between gap-3">
                                    <span className="inline-flex min-w-0 items-center gap-2 text-sm font-medium text-[var(--studio-ink)]"><Icon className="size-4 shrink-0 text-[var(--studio-primary)]" />{creditTransactionTypeLabel(transaction.transactionType)}</span>
                                    <span className={`shrink-0 text-sm font-semibold tabular-nums ${creditAmount(transaction.changeAmount).greaterThan(0) ? "text-[var(--studio-primary)]" : "text-[var(--studio-ink)]"}`}>{formatCreditChange(transaction.changeAmount)}</span>
                                </div>
                                <div className="mt-2 grid gap-1 text-xs text-[var(--studio-muted)]">
                                    <span className="truncate">{creditTransactionDetail(transaction.transactionType, transaction.generationType, transaction.model, transaction.reason)}</span>
                                    <span className="tabular-nums">{translate("credits.balance")}{formatCredits(transaction.balanceAfter)} · {formatCreditTime(transaction.createdAt)}</span>
                                </div>
                            </article>
                        );
                    })}
                </div>
                {transactions && transactions.total > CREDIT_TRANSACTION_PAGE_SIZE ? (
                    <div className="mt-5 flex justify-end">
                        <Pagination current={page} pageSize={CREDIT_TRANSACTION_PAGE_SIZE} total={transactions.total} showSizeChanger={false} onChange={setPage} />
                    </div>
                ) : null}
            </section>
        </main>
    );
}

/**
 * 渲染单个积分图表面板。
 *
 * @param props 标题、加载、空状态和图表内容
 * @return 图表面板
 */
function ChartPanel({ title, loading, empty, extra, className, children }: { title: string; loading: boolean; empty: boolean; extra?: ReactNode; className?: string; children: ReactNode }) {
    const translate = useTranslation();
    return (
        <section className={`min-w-0 border border-[var(--studio-line)] bg-[var(--studio-surface)] p-4 md:p-5 ${className || ""}`}>
            <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-[var(--studio-ink)]">{title}</h3>
                {extra}
            </div>
            <div className="mt-2">
                {loading ? <Skeleton active className="py-5" paragraph={{ rows: 6 }} /> : null}
                {!loading && empty ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={translate("credits.noUsageDataInThisPeriod")} className="py-9" /> : null}
                {!loading && !empty ? children : null}
            </div>
        </section>
    );
}
