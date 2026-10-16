"use client";
import { currentLanguageTag } from "@/features/locale/translate";

import { translateMessage as translate } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";


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

const createRedemptionColumns = (translator: typeof translate = translate): TableProps<ServerRedemptionRecord>["columns"] => ([
    {
        get title() { return translator("credits.redemptionCode"); },
        dataIndex: "cardCode",
        render: (value: string) => <span className="font-mono text-xs text-[var(--studio-text)]">{value}</span>,
    },
    {
        get title() { return translator("credits.redeemCredits"); },
        dataIndex: "credits",
        width: 130,
        render: (value: number) => <span className="font-semibold tabular-nums text-[var(--studio-ink)]">+{value.toLocaleString(currentLanguageTag())}</span>,
    },
    {
        get title() { return translator("credits.balanceAfterRedemption"); },
        dataIndex: "balanceAfter",
        width: 140,
        render: (value: number) => <span className="tabular-nums text-[var(--studio-text)]">{value.toLocaleString(currentLanguageTag())}</span>,
    },
    {
        get title() { return translator("credits.redeemedAt"); },
        dataIndex: "redeemedAt",
        width: 190,
        render: (value: string) => <span className="tabular-nums text-[var(--studio-muted)]">{value ? new Date(value).toLocaleString(currentLanguageTag()) : "-"}</span>,
    },
]);

/**
 * 渲染积分兑换页。
 *
 * @returns 卡密兑换与本人记录页面
 */
export default function CreditRedeemPage() {
    const translate = useTranslation();
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
    }), [dateRange, searchCardCode, translate.locale]);
    const recordsQuery = useQuery({
        queryKey: ["credit-redemption-records", filters.startDate, filters.endDate, filters.cardCode, page],
        queryFn: () => listRedemptionRecords({ ...filters, page, pageSize: REDEMPTION_PAGE_SIZE }),
    });

    const submitRedeem = async () => {
        const normalized = normalizeCreditCardCode(cardCode);
        if (!isCreditCardCode(normalized)) {
            message.warning(translate("credits.enter20CharacterCreditCode"));
            return;
        }
        setRedeeming(true);
        try {
            const result = await redeemCredits(normalized);
            setCreditBalance(result.creditBalance);
            setRedeemResult({ credits: result.credits, balance: result.creditBalance });
            setCardCode("");
            message.success(translate("credits.redeemedSuccessfullyCreditsAdded", { value0: result.credits.toLocaleString(currentLanguageTag()) }));
            setPage(1);
            await recordsQuery.refetch();
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("credits.redemptionFailed"));
        } finally {
            setRedeeming(false);
        }
    };

    return (
        <main className="studio-page h-full overflow-auto">
            <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 lg:px-8">
                <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--studio-line)] pb-5">
                    <div className="flex items-start gap-3">
                        <Link href="/credits" className="mt-0.5 grid size-9 place-items-center rounded-md text-[var(--studio-muted)] transition hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]" aria-label={translate("credits.backToCredits")} title={translate("credits.backToCredits")}>
                            <ArrowLeft className="size-4" />
                        </Link>
                        <div>
                            <h1 className="flex items-center gap-2 text-xl font-semibold text-[var(--studio-ink)]"><Ticket className="size-5 text-[var(--studio-primary)]" />{translate("credits.redeemCredits")}</h1>
                            <p className="mt-1 text-sm text-[var(--studio-muted)]">{translate("credits.enterAPurchasedCodeToReceiveCreditsInstantly")}</p>
                        </div>
                    </div>
                    <div className="inline-flex items-center gap-2 text-sm text-[var(--studio-muted)]">
                        <Zap className="size-4 fill-current text-[var(--studio-primary)]" />
                        <span>{translate("credits.currentBalance")}</span>
                        <strong className="tabular-nums text-[var(--studio-ink)]">{(user?.creditBalance || 0).toLocaleString(currentLanguageTag())}</strong>
                    </div>
                </header>

                <section className="mt-6 border border-[var(--studio-line)] bg-[var(--studio-surface)] p-5 sm:p-7" aria-labelledby="redeem-card-title">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <h2 id="redeem-card-title" className="text-base font-semibold text-[var(--studio-ink)]">{translate("credits.enterRedemptionCode")}</h2>
                            <p className="mt-1 text-sm text-[var(--studio-muted)]">{translate("credits.codesAreSingleUseCheckYourAccount")}</p>
                        </div>
                        {redeemResult ? <Tag color="green" icon={<CheckCircle2 className="size-3.5" />}>{translate("credits.credited")}{redeemResult.credits.toLocaleString(currentLanguageTag())} {translate("credits.credits_10939f")}</Tag> : null}
                    </div>
                    <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                        <Input
                            value={cardCode}
                            maxLength={24}
                            onChange={(event) => setCardCode(event.target.value)}
                            onPressEnter={() => void submitRedeem()}
                            placeholder={translate("credits.enter20CharacterCode")}
                            className="h-11 font-mono uppercase"
                            autoComplete="off"
                        />
                        <Button type="primary" loading={redeeming} onClick={() => void submitRedeem()} className="h-11 sm:w-32">{translate("credits.redeemNow")}</Button>
                    </div>
                </section>

                <section className="mt-8 border-t border-[var(--studio-line)] pt-6" aria-labelledby="redemption-records-title">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <h2 id="redemption-records-title" className="text-base font-semibold text-[var(--studio-ink)]">{translate("credits.redemptionHistory")}</h2>
                            <p className="mt-1 text-sm text-[var(--studio-muted)]">{translate("credits.onlyThisAccountSCodeRedemptionsAreShown")}</p>
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
                                placeholder={translate("credits.fullCodeOrLast4Characters")}
                                prefix={<Search className="size-3.5 text-[var(--studio-faint)]" />}
                                className="sm:w-56"
                            />
                        </div>
                    </div>
                    {recordsQuery.isError ? <Alert className="mt-5" type="error" showIcon title={translate("credits.failedToLoadRedemptions")} action={<Button size="small" onClick={() => void recordsQuery.refetch()}>{translate("credits.reload")}</Button>} /> : null}
                    <div className="mt-5 overflow-x-auto">
                        <Table<ServerRedemptionRecord>
                            rowKey="id"
                            columns={createRedemptionColumns(translate)}
                            dataSource={recordsQuery.data?.records || []}
                            loading={recordsQuery.isLoading}
                            pagination={false}
                            scroll={{ x: 680 }}
                            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={translate("credits.noRedemptionsInThisPeriod")} /> }}
                        />
                    </div>
                    {recordsQuery.data && recordsQuery.data.total > REDEMPTION_PAGE_SIZE ? <div className="mt-5 flex justify-end"><Pagination current={page} pageSize={REDEMPTION_PAGE_SIZE} total={recordsQuery.data.total} showSizeChanger={false} onChange={setPage} /></div> : null}
                </section>
            </div>
        </main>
    );
}
