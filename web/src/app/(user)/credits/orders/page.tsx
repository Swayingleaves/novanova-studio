"use client";

import { creditText } from "@/shared/lib/credit-amounts";

import { useTranslation } from "@/features/locale/use-translation";

import { Alert, Button, Empty, Segmented, Table, Tag, type TableProps } from "antd";
import { ArrowLeft, ReceiptText, ShoppingCart } from "lucide-react";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { listCreditOrders, type ServerCreditOrderItem } from "@/services/api/server";
import Link from "@/shared/lib/team-navigation";

import { formatCreditTime } from "../credit-page-utils";

/** 订单状态筛选值。 */
type OrderFilter = "all" | "pending" | "paid" | "closed" | "cancelled";

/** 订单数量上限，与后端 MAX_ORDER_PAGE_SIZE 保持一致。 */
const ORDER_LIMIT = 30;

/**
 * 返回订单状态对应的标签颜色和文案键。
 *
 * @param status 订单状态
 * @returns 标签颜色和文案键
 */
function orderStatusMeta(status: ServerCreditOrderItem["status"]) {
    if (status === "paid") return { color: "success", labelKey: "credits.paymentSuccess" };
    if (status === "processing") return { color: "processing", labelKey: "credits.paymentProcessing" };
    if (status === "closed") return { color: "default", labelKey: "credits.paymentExpired" };
    if (status === "cancelled") return { color: "default", labelKey: "credits.orderCancelled" };
    return { color: "warning", labelKey: "credits.orderPending" };
}

/**
 * 渲染当前用户的积分购买订单列表。
 *
 * @returns 订单列表页面
 */
export default function CreditOrdersPage() {
    const translate = useTranslation();
    const [filter, setFilter] = useState<OrderFilter>("all");
    const ordersQuery = useQuery({
        queryKey: ["credit-orders"],
        queryFn: () => listCreditOrders(ORDER_LIMIT),
        staleTime: 10_000,
    });

    const orders = useMemo(() => {
        const list = ordersQuery.data?.orders || [];
        return filter === "all" ? list : list.filter((order) => order.status === filter);
    }, [ordersQuery.data, filter]);

    const columns: TableProps<ServerCreditOrderItem>["columns"] = [
        {
            title: translate("credits.time"),
            dataIndex: "createdAt",
            width: 176,
            render: (createdAt: string) => <span className="tabular-nums text-[var(--studio-muted)]">{formatCreditTime(createdAt)}</span>,
        },
        {
            title: translate("credits.orderNumber"),
            dataIndex: "orderNo",
            ellipsis: true,
            render: (orderNo: string) => (
                <span className="font-mono text-xs text-[var(--studio-muted)]" title={orderNo}>
                    {orderNo}
                </span>
            ),
        },
        {
            title: translate("credits.creditsUnit"),
            dataIndex: "credits",
            width: 120,
            align: "right",
            render: (credits: ServerCreditOrderItem["credits"]) => <span className="font-medium tabular-nums text-[var(--studio-ink)]">{creditText(credits)}</span>,
        },
        {
            title: translate("credits.price"),
            dataIndex: "priceAmount",
            width: 120,
            align: "right",
            render: (priceAmount: string) => <span className="tabular-nums text-[var(--studio-ink)]">¥ {priceAmount}</span>,
        },
        {
            title: translate("credits.paymentMethod"),
            dataIndex: "paymentMethod",
            width: 120,
            render: (paymentMethod: string) => <span className="text-[var(--studio-muted)]">{paymentMethod === "alipay" ? translate("credits.alipay") : paymentMethod}</span>,
        },
        {
            title: translate("credits.status"),
            dataIndex: "status",
            width: 132,
            render: (status: ServerCreditOrderItem["status"]) => {
                const meta = orderStatusMeta(status);
                return <Tag color={meta.color}>{translate(meta.labelKey)}</Tag>;
            },
        },
        {
            title: translate("credits.actions"),
            key: "actions",
            width: 120,
            render: (_, order) =>
                order.status === "pending" ? (
                    <Link href={`/credits/purchase?orderNo=${encodeURIComponent(order.orderNo)}`}>
                        <Button size="small" type="link" className="px-0">
                            {translate("credits.continuePayment")}
                        </Button>
                    </Link>
                ) : null,
        },
    ];

    return (
        <main className="studio-page h-full overflow-auto">
            <div className="mx-auto w-full max-w-[1200px] px-4 py-5 sm:px-6 lg:px-8">
                <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--studio-line)] pb-5">
                    <div className="flex items-center gap-3">
                        <Link
                            href="/credits"
                            className="grid size-10 place-items-center rounded-md text-[var(--studio-muted)] transition hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--studio-action)]"
                            aria-label={translate("credits.backToCredits")}
                            title={translate("credits.backToCredits")}
                        >
                            <ArrowLeft className="size-4" />
                        </Link>
                        <div>
                            <h1 className="flex items-center gap-2 text-xl font-semibold text-[var(--studio-ink)]">
                                <ReceiptText className="size-5 text-[var(--studio-primary)]" />
                                {translate("credits.myOrders")}
                            </h1>
                            <p className="mt-1 text-sm text-[var(--studio-muted)]">{translate("credits.ordersDescription", { value0: ORDER_LIMIT })}</p>
                        </div>
                    </div>
                    <Link href="/credits/purchase">
                        <Button icon={<ShoppingCart className="size-4" />}>{translate("credits.buyCredits")}</Button>
                    </Link>
                </header>

                {ordersQuery.isError ? (
                    <Alert
                        className="mt-5"
                        type="error"
                        showIcon
                        title={translate("credits.failedToLoadOrders")}
                        action={
                            <Button size="small" onClick={() => void ordersQuery.refetch()}>
                                {translate("credits.reload")}
                            </Button>
                        }
                    />
                ) : null}

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                    <Segmented
                        value={filter}
                        onChange={(value) => setFilter(value as OrderFilter)}
                        options={[
                            { label: translate("credits.all"), value: "all" },
                            { label: translate("credits.orderPending"), value: "pending" },
                            { label: translate("credits.paymentSuccess"), value: "paid" },
                            { label: translate("credits.paymentExpired"), value: "closed" },
                            { label: translate("credits.orderCancelled"), value: "cancelled" },
                        ]}
                    />
                    <span className="text-sm tabular-nums text-[var(--studio-muted)]">
                        {orders.length} {translate("credits.records")}
                    </span>
                </div>

                <Table<ServerCreditOrderItem>
                    className="mt-3"
                    rowKey="orderNo"
                    size="middle"
                    columns={columns}
                    dataSource={orders}
                    loading={ordersQuery.isLoading}
                    pagination={false}
                    scroll={{ x: 880 }}
                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={translate("credits.noOrders")} /> }}
                />
            </div>
        </main>
    );
}
