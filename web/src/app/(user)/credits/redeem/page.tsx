"use client";

import { useMemo, useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { Alert, App, Button, DatePicker, Empty, Input, Pagination, Table, Tag, type TableProps } from "antd";
import { ArrowLeft, CheckCircle2, Search, Ticket, Zap } from "lucide-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { useUserStore } from "@/features/auth/stores/use-user-store";
import { listRedemptionRecords, redeemCredits, type ServerRedemptionRecord } from "@/services/api/server";
import { isCreditCardCode, normalizeCreditCardCode } from "../credit-card-utils";

const REDEMPTION_PAGE_SIZE = 20;

const REDEMPTION_COLUMNS: TableProps<ServerRedemptionRecord>["columns"] = [
    {
        title: "卡密",
        dataIndex: "cardCode",
        render: (value: string) => <span className="font-mono text-xs text-[var(--studio-text)]">{value}</span>,
    },
    {
        title: "兑换积分",
        dataIndex: "credits",
        width: 130,
        render: (value: number) => <span className="font-semibold tabular-nums text-[var(--studio-ink)]">+{value.toLocaleString("zh-CN")}</span>,
    },
    {
        title: "兑换后余额",
        dataIndex: "balanceAfter",
        width: 140,
        render: (value: number) => <span className="tabular-nums text-[var(--studio-text)]">{value.toLocaleString("zh-CN")}</span>,
    },
    {
        title: "兑换时间",
        dataIndex: "redeemedAt",
        width: 190,
        render: (value: string) => <span className="tabular-nums text-[var(--studio-muted)]">{value ? new Date(value).toLocaleString("zh-CN") : "-"}</span>,
    },
];

/**
 * 渲染积分兑换页。
 *
 * @returns 卡密兑换与本人记录页面
 */
export default function CreditRedeemPage() {
    const { message } = App.useApp();
    const user = useUserStore((state) => state.user);
    const setCreditBalance = useUserStore((state) => state.setCreditBalance);
    const [cardCode, setCardCode] = useState("");
    const [searchCardCodeInput, setSearchCardCodeInput] = useState("");
    const [searchCardCode, setSearchCardCode] = useState("");
    const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>(() => [dayjs().subtract(29, "day").startOf("day"), dayjs().endOf("day")]);
    const [page, setPage] = useState(1);
    const [redeeming, setRedeeming] = useState(false);
    const [redeemResult, setRedeemResult] = useState<{ credits: number; balance: number } | null>(null);

    const filters = useMemo(() => ({
        startDate: dateRange[0].format("YYYY-MM-DD"),
        endDate: dateRange[1].format("YYYY-MM-DD"),
        cardCode: searchCardCode.trim() || undefined,
    }), [dateRange, searchCardCode]);
    const recordsQuery = useQuery({
        queryKey: ["credit-redemption-records", filters.startDate, filters.endDate, filters.cardCode, page],
        queryFn: () => listRedemptionRecords({ ...filters, page, pageSize: REDEMPTION_PAGE_SIZE }),
    });

    const submitRedeem = async () => {
        const normalized = normalizeCreditCardCode(cardCode);
        if (!isCreditCardCode(normalized)) {
            message.warning("请输入20位积分卡密");
            return;
        }
        setRedeeming(true);
        try {
            const result = await redeemCredits(normalized);
            setCreditBalance(result.creditBalance);
            setRedeemResult({ credits: result.credits, balance: result.creditBalance });
            setCardCode("");
            message.success(`兑换成功，已到账 ${result.credits.toLocaleString("zh-CN")} 积分`);
            setPage(1);
            await recordsQuery.refetch();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "兑换失败");
        } finally {
            setRedeeming(false);
        }
    };

    return (
        <main className="studio-page h-full overflow-auto">
            <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 lg:px-8">
                <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--studio-line)] pb-5">
                    <div className="flex items-start gap-3">
                        <Link href="/credits" className="mt-0.5 grid size-9 place-items-center rounded-md text-[var(--studio-muted)] transition hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]" aria-label="返回积分" title="返回积分">
                            <ArrowLeft className="size-4" />
                        </Link>
                        <div>
                            <h1 className="flex items-center gap-2 text-xl font-semibold text-[var(--studio-ink)]"><Ticket className="size-5 text-[var(--studio-primary)]" />兑换积分</h1>
                            <p className="mt-1 text-sm text-[var(--studio-muted)]">输入购买获得的卡密，积分会立即到账</p>
                        </div>
                    </div>
                    <div className="inline-flex items-center gap-2 text-sm text-[var(--studio-muted)]">
                        <Zap className="size-4 fill-current text-[var(--studio-primary)]" />
                        <span>当前余额</span>
                        <strong className="tabular-nums text-[var(--studio-ink)]">{(user?.creditBalance || 0).toLocaleString("zh-CN")}</strong>
                    </div>
                </header>

                <section className="mt-6 border border-[var(--studio-line)] bg-[var(--studio-surface)] p-5 sm:p-7" aria-labelledby="redeem-card-title">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <h2 id="redeem-card-title" className="text-base font-semibold text-[var(--studio-ink)]">输入卡密</h2>
                            <p className="mt-1 text-sm text-[var(--studio-muted)]">卡密只能兑换一次，请确认账号无误</p>
                        </div>
                        {redeemResult ? <Tag color="green" icon={<CheckCircle2 className="size-3.5" />}>已到账 {redeemResult.credits.toLocaleString("zh-CN")} 积分</Tag> : null}
                    </div>
                    <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                        <Input
                            value={cardCode}
                            maxLength={24}
                            onChange={(event) => setCardCode(event.target.value)}
                            onPressEnter={() => void submitRedeem()}
                            placeholder="输入20位卡密"
                            className="h-11 font-mono uppercase"
                            autoComplete="off"
                        />
                        <Button type="primary" loading={redeeming} onClick={() => void submitRedeem()} className="h-11 sm:w-32">立即兑换</Button>
                    </div>
                </section>

                <section className="mt-8 border-t border-[var(--studio-line)] pt-6" aria-labelledby="redemption-records-title">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <h2 id="redemption-records-title" className="text-base font-semibold text-[var(--studio-ink)]">兑换记录</h2>
                            <p className="mt-1 text-sm text-[var(--studio-muted)]">仅展示当前账号的卡密兑换流水</p>
                        </div>
                        <div className="flex flex-col gap-3 sm:flex-row">
                            <DatePicker.RangePicker
                                value={dateRange}
                                allowClear={false}
                                disabledDate={(date) => date.isAfter(dayjs(), "day")}
                                onChange={(next) => {
                                    if (!next?.[0] || !next[1]) return;
                                    setDateRange([next[0], next[1]]);
                                    setPage(1);
                                }}
                            />
                            <Input.Search
                                value={searchCardCodeInput}
                                onChange={(event) => { const value = event.target.value; setSearchCardCodeInput(value); if (!value) { setSearchCardCode(""); setPage(1); } }}
                                onSearch={() => { setSearchCardCode(searchCardCodeInput); setPage(1); }}
                                allowClear
                                placeholder="完整卡密或末四位"
                                prefix={<Search className="size-3.5 text-[var(--studio-faint)]" />}
                                className="sm:w-56"
                            />
                        </div>
                    </div>
                    {recordsQuery.isError ? <Alert className="mt-5" type="error" showIcon message="兑换记录加载失败" action={<Button size="small" onClick={() => void recordsQuery.refetch()}>重新加载</Button>} /> : null}
                    <div className="mt-5 overflow-x-auto">
                        <Table<ServerRedemptionRecord>
                            rowKey="id"
                            columns={REDEMPTION_COLUMNS}
                            dataSource={recordsQuery.data?.records || []}
                            loading={recordsQuery.isLoading}
                            pagination={false}
                            scroll={{ x: 680 }}
                            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="所选范围暂无兑换记录" /> }}
                        />
                    </div>
                    {recordsQuery.data && recordsQuery.data.total > REDEMPTION_PAGE_SIZE ? <div className="mt-5 flex justify-end"><Pagination current={page} pageSize={REDEMPTION_PAGE_SIZE} total={recordsQuery.data.total} showSizeChanger={false} onChange={setPage} /></div> : null}
                </section>
            </div>
        </main>
    );
}
