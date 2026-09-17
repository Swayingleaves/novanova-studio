"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Skeleton } from "antd";
import { CalendarCheck, Check, ChevronLeft, ChevronRight, Coins, Gift } from "lucide-react";
import dayjs from "dayjs";

import { useUserStore } from "@/features/auth/stores/use-user-store";
import { getCheckInStatus, submitCheckIn } from "@/services/api/server";

const CHECK_IN_STATUS_QUERY_KEY = "check-in-status";
const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

/**
 * 格式化积分数值。
 *
 * @param credits 积分数量
 * @return 带千分位的积分文本
 */
function formatCredits(credits: number | null | undefined) {
    return (credits ?? 0).toLocaleString("zh-CN");
}

/**
 * 渲染每日签到页面。
 *
 * @return 签到页面
 */
export default function CheckInPage() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const setCreditBalance = useUserStore((state) => state.setCreditBalance);
    const [month, setMonth] = useState(() => dayjs().format("YYYY-MM"));
    const [rewardBurst, setRewardBurst] = useState<{ id: number; credits: number } | null>(null);

    const statusQuery = useQuery({
        queryKey: [CHECK_IN_STATUS_QUERY_KEY, month],
        queryFn: () => getCheckInStatus(month),
    });
    const status = statusQuery.data;

    const checkInMutation = useMutation({
        mutationFn: () => submitCheckIn(),
        onSuccess: (result) => {
            setCreditBalance(result.creditBalance);
            setRewardBurst({ id: Date.now(), credits: result.earnedCredits });
            setMonth(dayjs(result.checkInDate).format("YYYY-MM"));
            void queryClient.invalidateQueries({ queryKey: [CHECK_IN_STATUS_QUERY_KEY] });
            message.success(result.earnedCredits === 0 ? "签到成功" : `签到成功，获得 ${formatCredits(result.earnedCredits)} 积分`);
        },
        onError: (error) => {
            void queryClient.invalidateQueries({ queryKey: [CHECK_IN_STATUS_QUERY_KEY] });
            message.error(error instanceof Error ? error.message : "签到失败，请稍后重试");
        },
    });

    const monthStart = useMemo(() => dayjs(`${month}-01`), [month]);
    const monthCells = useMemo(() => {
        const leadingBlanks = (monthStart.day() + 6) % 7;
        return [
            ...Array.from({ length: leadingBlanks }, () => null),
            ...Array.from({ length: monthStart.daysInMonth() }, (_, index) => index + 1),
        ];
    }, [monthStart]);

    const checkedDates = useMemo(() => new Set(status?.monthCheckedDates || []), [status?.monthCheckedDates]);
    const checkedInToday = Boolean(status?.checkedInToday);
    const canSwitchNextMonth = Boolean(status && monthStart.isBefore(dayjs(status.today).startOf("month")));

    const handleCheckIn = () => {
        if (checkInMutation.isPending || checkedInToday) return;
        checkInMutation.mutate();
    };

    return (
        <main className="mx-auto w-full max-w-[1200px] px-4 py-6 md:px-6 lg:px-8">
            <header className="relative overflow-hidden rounded-2xl border border-[var(--studio-line)] p-6 md:p-7" style={{ background: "linear-gradient(135deg, var(--studio-primary-soft), transparent 58%, var(--studio-accent-soft))" }}>
                <div className="relative z-10 min-w-0">
                    <h1 className="text-2xl font-semibold text-[var(--studio-ink)]">每日签到</h1>
                    <p className="mt-2 text-sm leading-6 text-[var(--studio-muted)]">每天签到一次即可领取积分，签到积分自签到起 24 小时内有效</p>
                </div>
                <GiftIllustration />
            </header>

            {statusQuery.isError ? (
                <Alert
                    className="mt-5"
                    type="error"
                    showIcon
                    message="签到信息加载失败"
                    action={<Button size="small" onClick={() => void statusQuery.refetch()}>重新加载</Button>}
                />
            ) : null}

            <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_336px]">
                <section className="min-w-0 rounded-2xl border border-[var(--studio-line)] bg-[var(--studio-surface)] p-5 md:p-6" aria-labelledby="check-in-calendar-title">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                className="inline-flex size-8 items-center justify-center rounded-lg text-[var(--studio-muted)] transition hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)] disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() => setMonth(monthStart.subtract(1, "month").format("YYYY-MM"))}
                                aria-label="上一个月"
                            >
                                <ChevronLeft className="size-4" />
                            </button>
                            <h2 id="check-in-calendar-title" className="min-w-[7.5rem] text-center text-base font-semibold tabular-nums text-[var(--studio-ink)]">
                                {monthStart.format("YYYY年M月")}
                            </h2>
                            <button
                                type="button"
                                className="inline-flex size-8 items-center justify-center rounded-lg text-[var(--studio-muted)] transition hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)] disabled:cursor-not-allowed disabled:opacity-40"
                                disabled={!canSwitchNextMonth}
                                onClick={() => setMonth(monthStart.add(1, "month").format("YYYY-MM"))}
                                aria-label="下一个月"
                            >
                                <ChevronRight className="size-4" />
                            </button>
                        </div>
                        <div className="inline-flex items-center gap-2 rounded-full border border-[var(--studio-primary-line)] bg-[var(--studio-primary-soft)] px-3 py-1 text-xs font-medium text-[var(--studio-ink)]">
                            <CalendarCheck className="size-3.5 text-[var(--studio-primary)]" aria-hidden />
                            <span>本月已签到</span>
                            <strong className="tabular-nums">{status?.monthCheckedCount ?? 0}</strong>
                            <span>天</span>
                        </div>
                    </div>

                    <div className="mt-5 grid grid-cols-7 gap-1.5 text-center text-xs text-[var(--studio-faint)] md:gap-2">
                        {WEEKDAY_LABELS.map((label) => (
                            <span key={label}>{label}</span>
                        ))}
                    </div>

                    {statusQuery.isLoading ? (
                        <Skeleton active className="mt-3" paragraph={{ rows: 5 }} />
                    ) : (
                        <div className="mt-2 grid grid-cols-7 gap-1.5 md:gap-2">
                            {monthCells.map((day, index) => {
                                if (day === null) return <span key={`blank-${index}`} />;
                                const date = monthStart.date(day);
                                const dateText = date.format("YYYY-MM-DD");
                                const isCheckedIn = checkedDates.has(dateText);
                                const isToday = dateText === status?.today;
                                const claimable = isToday && !checkedInToday;
                                const isFuture = status ? date.isAfter(dayjs(status.today), "day") : false;
                                return (
                                    <button
                                        key={dateText}
                                        type="button"
                                        disabled={!claimable || checkInMutation.isPending}
                                        onClick={handleCheckIn}
                                        aria-label={claimable ? `签到领取${date.format("M月D日")}积分` : dateText}
                                        className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 transition ${
                                            isCheckedIn
                                                ? "text-[var(--studio-success)]"
                                                : claimable
                                                  ? "cursor-pointer text-[var(--studio-primary)] hover:border-[var(--studio-primary)] hover:bg-[var(--studio-primary-soft)]"
                                                  : "border-[var(--studio-line)] bg-[var(--studio-surface-soft)] text-[var(--studio-faint)]"
                                        } ${isFuture ? "opacity-60" : ""}`}
                                        style={
                                            isCheckedIn
                                                ? { background: "color-mix(in srgb, var(--studio-success) 10%, transparent)", borderColor: "color-mix(in srgb, var(--studio-success) 28%, transparent)" }
                                                : claimable
                                                  ? { borderColor: "var(--studio-primary)", background: "var(--studio-primary-soft)" }
                                                  : undefined
                                        }
                                    >
                                        {claimable ? (
                                            <Gift className={`size-4 ${checkInMutation.isPending ? "animate-bounce" : ""}`} aria-hidden />
                                        ) : isCheckedIn ? (
                                            <Check className="size-4" strokeWidth={3} aria-hidden />
                                        ) : null}
                                        <span className={`text-[13px] font-medium tabular-nums ${isToday ? "text-[var(--studio-ink)]" : ""}`}>{day}</span>
                                        {isToday ? <span className="text-[10px] leading-3 text-[var(--studio-muted)]">{claimable ? "点击领取" : "今天"}</span> : null}
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    <p className="mt-4 text-xs leading-5 text-[var(--studio-muted)]">签到积分自签到起 24 小时内有效，到期未使用的部分自动作废。</p>
                </section>

                <div className="flex min-w-0 flex-col gap-5 lg:grid lg:grid-rows-2">
                    <section className="rounded-2xl border border-[var(--studio-line)] bg-[var(--studio-surface)] p-5 lg:flex lg:flex-col lg:justify-center" aria-labelledby="check-in-reward-title">
                        <h2 id="check-in-reward-title" className="text-base font-semibold text-[var(--studio-ink)]">签到奖励</h2>
                        <p className="mt-1.5 text-xs leading-5 text-[var(--studio-muted)]">每天签到一次即可获得，签到积分自签到起 24 小时内有效：</p>
                        <ul className="mt-4 flex flex-col gap-3">
                            <RewardRow icon={<Coins className="size-4" />} label="每日签到" value={status ? `创作积分 +${formatCredits(status.dailyCredits)}` : "—"} />
                        </ul>
                    </section>

                    <section className="studio-glass relative flex flex-col overflow-hidden rounded-2xl p-5 lg:justify-center" aria-labelledby="check-in-today-title">
                        {rewardBurst && rewardBurst.credits > 0 ? <RewardBurst key={rewardBurst.id} credits={rewardBurst.credits} /> : null}
                        <div className="flex items-center gap-2">
                            <Gift className="size-4 text-[var(--studio-primary)]" aria-hidden />
                            <h2 id="check-in-today-title" className="text-base font-semibold text-[var(--studio-ink)]">今日签到</h2>
                        </div>
                        {statusQuery.isLoading ? (
                            <Skeleton active className="mt-4" paragraph={{ rows: 3 }} />
                        ) : checkedInToday ? (
                            <div className="mt-4">
                                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--studio-success)]">
                                    <Check className="size-4" strokeWidth={3} aria-hidden />
                                    今日已签到
                                </div>
                                <div className="mt-3 text-sm text-[var(--studio-text)]">
                                    获得创作积分 <strong className="font-semibold tabular-nums text-[var(--studio-ink)]">+{formatCredits(status?.todayCredits ?? 0)}</strong>
                                </div>
                                <p className="mt-2 text-xs leading-5 text-[var(--studio-muted)]">明天继续签到，领取更多奖励</p>
                            </div>
                        ) : (
                            <div className="mt-4">
                                <div className="text-xs text-[var(--studio-muted)]">今日奖励</div>
                                <div className="mt-2 flex items-center gap-2 text-sm text-[var(--studio-text)]">
                                    <Coins className="size-4 text-[var(--studio-primary)]" aria-hidden />
                                    创作积分
                                    <strong className="font-semibold tabular-nums text-[var(--studio-ink)]">+{formatCredits(status?.dailyCredits ?? 0)}</strong>
                                </div>
                                <Button
                                    type="primary"
                                    size="large"
                                    block
                                    className="mt-5"
                                    loading={checkInMutation.isPending}
                                    icon={<Gift className="size-4" />}
                                    onClick={handleCheckIn}
                                >
                                    立即签到
                                </Button>
                                <p className="mt-2 text-center text-xs leading-5 text-[var(--studio-muted)]">签到积分自签到起 24 小时内有效，到期自动作废</p>
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </main>
    );
}

/**
 * 渲染单条签到奖励说明。
 *
 * @param props 图标、奖励名称与奖励内容
 * @return 奖励说明行
 */
function RewardRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
    return (
        <li className="flex items-center gap-3">
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] text-[var(--studio-primary)]" aria-hidden>
                {icon}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block text-sm text-[var(--studio-ink)]">{label}</span>
                <span className="block text-xs text-[var(--studio-muted)]">{value}</span>
            </span>
        </li>
    );
}

/**
 * 渲染签到成功后向上飘出的积分提示。
 *
 * @param props 本次获得的积分
 * @return 积分飘出动效元素
 */
function RewardBurst({ credits }: { credits: number }) {
    const [flying, setFlying] = useState(false);

    useEffect(() => {
        const frame = window.requestAnimationFrame(() => setFlying(true));
        return () => window.cancelAnimationFrame(frame);
    }, []);

    return (
        <span
            aria-hidden
            className={`pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 text-sm font-semibold tabular-nums text-[var(--studio-primary)] transition-all duration-1000 ease-out ${flying ? "-translate-y-6 opacity-0" : "translate-y-0 opacity-100"}`}
        >
            +{formatCredits(credits)}
        </span>
    );
}

/**
 * 渲染顶部横幅的轻量礼物插画。
 *
 * @return 礼物插画
 */
function GiftIllustration() {
    return (
        <svg viewBox="0 0 160 120" className="pointer-events-none absolute -right-2 bottom-0 hidden h-32 w-40 sm:block" aria-hidden>
            <ellipse cx="80" cy="104" rx="46" ry="8" fill="var(--studio-primary-soft)" />
            <rect x="34" y="52" width="92" height="50" rx="8" fill="var(--studio-surface)" stroke="var(--studio-primary-line)" strokeWidth="2" />
            <rect x="28" y="40" width="104" height="20" rx="6" fill="var(--studio-surface)" stroke="var(--studio-primary-line)" strokeWidth="2" />
            <rect x="74" y="40" width="12" height="62" fill="var(--studio-primary-soft)" />
            <path d="M80 40c-8-3-18-8-18-15 0-6 8-8 12-4 4 3 6 10 6 19Z" fill="var(--studio-accent-soft)" stroke="var(--studio-accent)" strokeWidth="2" />
            <path d="M80 40c8-3 18-8 18-15 0-6-8-8-12-4-4 3-6 10-6 19Z" fill="var(--studio-accent-soft)" stroke="var(--studio-accent)" strokeWidth="2" />
        </svg>
    );
}
