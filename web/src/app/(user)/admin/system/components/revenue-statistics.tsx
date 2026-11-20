"use client";

import { creditAmount } from "@/shared/lib/credit-amounts";
import { currentLanguageTag } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Empty, Pagination, Skeleton, Table, Tag, type TableProps } from "antd";

import { getAdminRevenueOverview, listAdminRevenueRecords, type ServerAdminRevenueRecord } from "@/services/api/server";
import { CREDIT_TRANSACTION_PAGE_SIZE, formatCreditChange, formatCredits, formatCreditTime } from "@/app/(user)/credits/credit-page-utils";

const CreditChart = dynamic(() => import("@/app/(user)/credits/components/credit-chart").then((module) => module.CreditChart), {
    ssr: false,
    loading: () => <Skeleton active className="px-5 py-6" paragraph={{ rows: 7 }} />,
});

/** 收入金额提示文案，元为单位保留两位小数。 */
function formatRevenueTooltip(value: number) {
    return `¥ ${value.toLocaleString(currentLanguageTag(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 支付方式展示文案。 */
function paymentMethodLabel(paymentMethod: string, translate: ReturnType<typeof useTranslation>) {
    if (paymentMethod === "alipay") return translate("credits.alipay");
    if (paymentMethod === "wechat") return translate("credits.wechat");
    return paymentMethod;
}

/**
 * 将支付方式转换为图表数据。
 *
 * @param items 后端支付方式收入分布
 * @param translate 翻译函数
 * @return 图表数据
 */
function normalizePaymentDistribution(items: { name: string; revenueAmount: string }[], translate: ReturnType<typeof useTranslation>) {
    return items
        .map((item) => ({ name: paymentMethodLabel(item.name, translate), value: Number(item.revenueAmount) }))
        .filter((item) => item.value > 0);
}

type RevenueStatisticsProps = {
    /** 当前选中的用户，为空表示全部用户。 */
    userId?: number;
    /** 页面级筛选起始日期。 */
    startDate: string;
    /** 页面级筛选结束日期。 */
    endDate: string;
};

/**
 * 渲染管理员收入统计与收入明细。
 *
 * @param props 用户与日期筛选
 * @return 收入统计内容
 */
export function RevenueStatistics({ userId, startDate, endDate }: RevenueStatisticsProps) {
    const translate = useTranslation();
    const [page, setPage] = useState(1);

    // 页面筛选变化后回到第一页，避免停留在旧范围的空页。
    useEffect(() => {
        setPage(1);
    }, [userId, startDate, endDate]);

    const overviewQuery = useQuery({
        queryKey: ["admin-revenue-overview", userId ?? null, startDate, endDate],
        queryFn: () => getAdminRevenueOverview({ userId, startDate, endDate }),
    });
    const recordsQuery = useQuery({
        queryKey: ["admin-revenue-records", userId ?? null, startDate, endDate, page],
        queryFn: () => listAdminRevenueRecords({ userId, startDate, endDate, page, pageSize: CREDIT_TRANSACTION_PAGE_SIZE }),
    });

    const overview = overviewQuery.data;
    const records = recordsQuery.data;
    const paymentDistribution = useMemo(
        () => normalizePaymentDistribution(overview?.paymentMethodDistribution || [], translate),
        [overview?.paymentMethodDistribution, translate.locale],
    );
    const trend = useMemo(() => (overview?.trend || []).map((item) => ({ name: item.period, value: Number(item.revenueAmount) })), [overview?.trend, translate.locale]);

    const columns: TableProps<ServerAdminRevenueRecord>["columns"] = [
        {
            title: translate("administration.username"),
            dataIndex: "username",
            width: 150,
            render: (username: string, record) => (
                <div className="w-0 min-w-full overflow-hidden">
                    <div className="truncate font-medium text-[var(--studio-ink)]">{username || "-"}</div>
                    {record.nickname ? <div className="truncate text-xs text-[var(--studio-muted)]">{record.nickname}</div> : null}
                </div>
            ),
        },
        {
            title: translate("administration.userEmailOnly"),
            dataIndex: "email",
            width: 210,
            ellipsis: true,
            render: (email: string) => <span className="text-xs text-[var(--studio-muted)]">{email || "-"}</span>,
        },
        {
            title: translate("administration.purchaseType"),
            key: "purchaseType",
            dataIndex: "baseCredits",
            width: 170,
            render: (baseCredits: ServerAdminRevenueRecord["baseCredits"], record) => {
                const productBonus = creditAmount(record.credits).minus(baseCredits).max(0);
                const firstPurchase = creditAmount(record.changeAmount).greaterThan(record.credits);
                return (
                    <div>
                        <div className="flex items-center gap-1.5 text-[var(--studio-ink)]">
                            <span className="truncate">{translate("administration.creditPackage", { value0: formatCredits(baseCredits) })}</span>
                            {firstPurchase ? <Tag className="m-0" color="gold">{translate("administration.firstPurchaseOrder")}</Tag> : null}
                        </div>
                        {productBonus.greaterThan(0) ? <div className="text-xs text-[var(--studio-muted)]">{translate("administration.creditPackageBonus", { value0: formatCredits(productBonus.toFixed()) })}</div> : null}
                    </div>
                );
            },
        },
        {
            title: translate("administration.paymentChannel"),
            dataIndex: "paymentMethod",
            width: 120,
            render: (paymentMethod: string) => <span className="text-[var(--studio-muted)]">{paymentMethodLabel(paymentMethod, translate)}</span>,
        },
        {
            title: translate("administration.orderNumber"),
            dataIndex: "orderNo",
            width: 240,
            ellipsis: true,
            render: (orderNo: string) => <span className="font-mono text-xs text-[var(--studio-muted)]">{orderNo}</span>,
        },
        {
            title: translate("administration.purchasedCredits"),
            key: "credits",
            dataIndex: "credits",
            width: 128,
            align: "right",
            render: (credits: ServerAdminRevenueRecord["credits"]) => <span className="tabular-nums text-[var(--studio-ink)]">{formatCredits(credits)}</span>,
        },
        {
            title: translate("administration.creditChange"),
            dataIndex: "changeAmount",
            width: 128,
            align: "right",
            render: (changeAmount: ServerAdminRevenueRecord["changeAmount"]) => <span className="font-medium tabular-nums text-[var(--studio-primary)]">{formatCreditChange(changeAmount)}</span>,
        },
        {
            title: translate("administration.balanceSnapshot"),
            dataIndex: "balanceAfter",
            width: 128,
            align: "right",
            render: (balanceAfter: ServerAdminRevenueRecord["balanceAfter"]) => <span className="tabular-nums text-[var(--studio-muted)]">{balanceAfter == null ? "-" : formatCredits(balanceAfter)}</span>,
        },
        {
            title: translate("administration.time"),
            dataIndex: "paidAt",
            width: 176,
            render: (paidAt: string) => <span className="tabular-nums text-[var(--studio-muted)]">{formatCreditTime(paidAt)}</span>,
        },
    ];

    const hasError = overviewQuery.isError || recordsQuery.isError;

    return (
        <div className="flex flex-col gap-4">
            <p className="text-sm text-[var(--studio-muted)]">{translate("administration.revenueOverviewHint")}</p>

            {hasError ? (
                <Alert
                    type="error"
                    showIcon
                    title={translate("administration.failedToLoadRevenueData")}
                    action={
                        <Button size="small" onClick={() => { void overviewQuery.refetch(); void recordsQuery.refetch(); }}>
                            {translate("administration.reload")}
                        </Button>
                    }
                />
            ) : null}

            <div className="grid gap-4 sm:grid-cols-3">
                <RevenueStat label={translate("administration.totalRevenue")} loading={overviewQuery.isLoading} value={formatRevenueTooltip(Number(overview?.totalRevenue || 0))} highlight />
                <RevenueStat label={translate("administration.paidOrders")} loading={overviewQuery.isLoading} value={`${overview?.orderCount || 0} ${translate("administration.ordersUnit")}`} />
                <RevenueStat label={translate("administration.soldCredits")} loading={overviewQuery.isLoading} value={formatCredits(overview?.totalCredits || 0)} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                <RevenuePanel title={translate("administration.revenueByPaymentMethod")} loading={overviewQuery.isLoading} empty={!paymentDistribution.length}>
                    <CreditChart type="pie" data={paymentDistribution} ariaLabel={translate("administration.adminRevenueByPaymentMethodChart")} formatValue={formatRevenueTooltip} />
                </RevenuePanel>
                <RevenuePanel title={translate("administration.revenueTrendByMonth")} loading={overviewQuery.isLoading} empty={!overview?.orderCount}>
                    <CreditChart type="line" data={trend} ariaLabel={translate("administration.adminRevenueTrendLineChart")} formatValue={formatRevenueTooltip} />
                </RevenuePanel>
            </div>

            <div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-medium text-[var(--studio-ink)]">{translate("administration.revenueDetails")}</h3>
                    <span className="text-sm tabular-nums text-[var(--studio-muted)]">{records?.total || 0} {translate("administration.records")}</span>
                </div>
                <Table<ServerAdminRevenueRecord>
                    rowKey="orderId"
                    tableLayout="fixed"
                    columns={columns}
                    dataSource={records?.records || []}
                    loading={recordsQuery.isLoading}
                    pagination={false}
                    scroll={{ x: 1_450 }}
                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={translate("administration.noRevenueRecordsInThisPeriod")} /> }}
                />
                {records && records.total > CREDIT_TRANSACTION_PAGE_SIZE ? (
                    <div className="mt-5 flex justify-end">
                        <Pagination current={page} pageSize={CREDIT_TRANSACTION_PAGE_SIZE} total={records.total} showSizeChanger={false} onChange={setPage} />
                    </div>
                ) : null}
            </div>
        </div>
    );
}

/**
 * 渲染收入数字统计块。
 *
 * @param props 标题、数值、加载状态和强调样式
 * @return 统计块
 */
function RevenueStat({ label, value, loading, highlight }: { label: string; value: string; loading: boolean; highlight?: boolean }) {
    return (
        <div className="min-w-0 border border-[var(--studio-line)] bg-[var(--studio-surface)] p-4 md:p-5">
            <div className="text-sm text-[var(--studio-muted)]">{label}</div>
            {loading ? <Skeleton active title={{ width: "60%" }} paragraph={false} className="mt-2" /> : (
                <div className={`mt-2 truncate text-2xl font-semibold tabular-nums ${highlight ? "text-[var(--studio-primary)]" : "text-[var(--studio-ink)]"}`}>{value}</div>
            )}
        </div>
    );
}

/**
 * 渲染单个收入图表面板。
 *
 * @param props 标题、加载、空状态和图表内容
 * @return 图表面板
 */
function RevenuePanel({ title, loading, empty, children }: { title: string; loading: boolean; empty: boolean; children: ReactNode }) {
    const translate = useTranslation();
    return (
        <section className="min-w-0 border border-[var(--studio-line)] bg-[var(--studio-surface)] p-4 md:p-5">
            <h3 className="text-sm font-medium text-[var(--studio-ink)]">{title}</h3>
            <div className="mt-2">
                {loading ? <Skeleton active className="py-5" paragraph={{ rows: 6 }} /> : null}
                {!loading && empty ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={translate("administration.noRevenueDataInThisPeriod")} className="py-9" /> : null}
                {!loading && !empty ? children : null}
            </div>
        </section>
    );
}
