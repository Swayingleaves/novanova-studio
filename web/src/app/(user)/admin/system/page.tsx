"use client";
import { listTeams } from "@/services/api/team";

import { creditAmount, creditText } from "@/shared/lib/credit-amounts";

import type { CreditAmount } from "@/shared/lib/credit-amounts";
import { currentLanguageTag } from "@/features/locale/translate";

import { translateMessage as translate } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";


import { type Key, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import dayjs, { type Dayjs } from "dayjs";
import { useQuery } from "@tanstack/react-query";
import { Alert, App, Button, Checkbox, DatePicker, Empty, Form, Input, InputNumber, Modal, Pagination, Segmented, Select, Skeleton, Space, Table, Tabs, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Edit, Image as ImageIcon, Plus, Power, Search, Send, Sparkles, Trash2, Upload, Video } from "lucide-react";

import {
    adjustServerUserCredits,
    getServerUserStatistics,
    unlockServerUserPassword,
    listServerUsers,
    updateServerUserRole,
    updateServerUserStatus,
    adminCreateUser,
    listAdminNotifications,
    createAdminNotification,
    publishAdminNotification,
    updateAdminNotification,
    listAdminPrompts,
    createAdminPrompt,
    updateAdminPrompt,
    updateAdminPromptStatus,
    deleteAdminPrompts,
    listAdminGenerationStyles,
    createAdminGenerationStyle,
    updateAdminGenerationStyle,
    updateAdminGenerationStyleStatus,
    deleteAdminGenerationStyles,
    listAdminSkills,
    createAdminSkill,
    updateAdminSkill,
    updateAdminSkillStatus,
    deleteAdminSkills,
    listAdminHomepageShowcases,
    createAdminHomepageShowcase,
    updateAdminHomepageShowcase,
    updateAdminHomepageShowcaseStatus,
    deleteAdminHomepageShowcases,
    getAdminCreditOverview,
    listAdminCreditTransactions,
    type HomepageShowcase,
    type ServerAdminCreditTransaction,
    type ServerPrompt,
    type ServerGenerationStyle,
    type ServerSkill,
    type SystemNotification,
} from "@/services/api/server";
import { canManageCurrentSpace, useTeamStore } from "@/features/team/stores/use-team-store";
import { useUserStore, type ServerUserProfile, type ServerUserRole } from "@/features/auth/stores/use-user-store";
import { getHomepageTargetPath } from "@/features/homepage/api/homepage-showcases";
import { adminCreditFilterKey, adminCreditUserLabel } from "./admin-credit-utils";
import { TeamContentScope } from "./components/team-content-scope";
import { TeamManagement, CurrentTeamManagement } from "./components/team-management";
import { ResetAccountPasswordModal } from "./components/reset-account-password-modal";
import { StorageBillingManagement } from "./components/storage-billing-management";
import { CreditCardManagement } from "./components/credit-card-management";
import { ApiLogsManagement } from "./components/api-logs-management";
import { StoryBiblePricingManagement } from "./components/story-bible-pricing-management";
import { EpisodeBodiesPricingManagement } from "./components/episode-bodies-pricing-management";
import { GenerationStyleCover } from "@/features/generation/components/generation-style-picker";
import { uploadImage } from "@/features/storage/services/image-storage";
import { CREDIT_TRANSACTION_PAGE_SIZE, creditTransactionDetail, creditTransactionIcon, creditTransactionTypeLabel, formatCreditChange, formatCredits, formatCreditTime, normalizeGenerationDistribution, normalizeModelDistribution } from "@/app/(user)/credits/credit-page-utils";

const PAGE_SIZE = 20;

const CreditChart = dynamic(() => import("@/app/(user)/credits/components/credit-chart").then((module) => module.CreditChart), {
    ssr: false,
    loading: () => <Skeleton active className="px-5 py-6" paragraph={{ rows: 7 }} />,
});

type GenerationTypeFilter = "all" | "image" | "video";
type TrendUnit = "day" | "month";

export default function AdminSystemPage() {
    const translate = useTranslation();
    const { message, modal } = App.useApp();
    const currentUser = useUserStore((state) => state.user);
    const isAdmin = canManageCurrentSpace();
    const team = useTeamStore((state) => state.team);

    if (!isAdmin) {
        return (
            <main className="studio-page h-full overflow-auto">
                <div className="mx-auto flex min-h-[420px] max-w-4xl flex-col items-center justify-center px-6 text-center">
                    <h1 className="studio-title text-2xl font-semibold">{translate("administration.administratorAccessRequired")}</h1>
                    <p className="studio-subtitle mt-3 text-sm">{translate("administration.thisAccountCannotAccessAdministration")}</p>
                </div>
            </main>
        );
    }

    return (
        <main className="studio-page h-full overflow-auto">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6">
                <header className="border-b border-[var(--studio-line)] pb-5">
                    <h1 className="studio-title text-2xl font-semibold">{translate("administration.systemManagement")}</h1>
                    <p className="studio-subtitle mt-2 text-sm">{translate("administration.operationsConsoleForUsersAnnouncementsAndPrompts")}</p>
                </header>
                <Tabs
                    defaultActiveKey={team ? "team" : "teams"}
                    items={[
                        ...(team ? [{ key: "team", label: "团队管理", children: <CurrentTeamManagement /> }] : [{ key: "teams", label: "团队管理", children: <TeamManagement /> }, { key: "users", label: translate("administration.userManagement"), children: <UserManagement /> }]),
                        ...(!team ? [{ key: "credits", label: translate("administration.creditDetails"), children: <CreditConsumptionManagement /> }] : []),
                        ...(!team ? [{ key: "creditCards", label: translate("administration.redemptionCodes"), children: <CreditCardManagement /> }] : []),
                        { key: "notifications", label: translate("administration.messageManagement"), children: <TeamContentScope moduleName="notifications"><NotificationManagement /></TeamContentScope> },
                        { key: "prompts", label: translate("administration.promptLibrary"), children: <TeamContentScope moduleName="prompts"><PromptManagement /></TeamContentScope> },
                        { key: "styles", label: translate("administration.styleManagement"), children: <TeamContentScope moduleName="styles"><GenerationStyleManagement /></TeamContentScope> },
                        { key: "skills", label: translate("administration.skillManagement"), children: <TeamContentScope moduleName="skills"><SkillManagement /></TeamContentScope> },
                        { key: "homepage", label: translate("administration.homepageShowcase"), children: <TeamContentScope moduleName="homepage"><HomepageShowcaseManagement /></TeamContentScope> },
                        {
                            key: "scriptPricing", label: translate("administration.scriptCreationPricing"), children: <Tabs
                                items={[
                                    { key: "storyBible", label: translate("administration.storyBiblePricing"), children: <StoryBiblePricingManagement /> },
                                    { key: "episodeBodies", label: translate("administration.episodeBodies"), children: <EpisodeBodiesPricingManagement /> },
                                ]}
                            />,
                        },
                        { key: "storageBilling", label: "存储计费", children: <StorageBillingManagement /> },
                        ...(!team ? [{ key: "apiLogs", label: translate("administration.aPIRecords"), children: <ApiLogsManagement /> }] : []),
                    ]}
                />
            </div>
        </main>
    );
}

const createAdminCreditColumns = (translator: typeof translate = translate): ColumnsType<ServerAdminCreditTransaction> => ([
    {
        get title() { return translator("administration.user"); },
        width: 220,
        render: (_, transaction) => (
            <div className="min-w-0">
                <div className="truncate font-medium text-[var(--studio-ink)]">{adminCreditUserLabel(transaction)}</div>
                <div className="mt-0.5 truncate text-xs text-[var(--studio-muted)]">{transaction.email}</div>
            </div>
        ),
    },
    {
        get title() { return translator("administration.type"); },
        dataIndex: "transactionType",
        width: 132,
        render: (transactionType: ServerAdminCreditTransaction["transactionType"], record) => {
            const Icon = creditTransactionIcon(record);
            return <span className="inline-flex items-center gap-2 text-[var(--studio-text)]"><Icon className="size-4 text-[var(--studio-primary)]" />{creditTransactionTypeLabel(transactionType)}</span>;
        },
    },
    {
        get title() { return translator("administration.details"); },
        dataIndex: "reason",
        ellipsis: true,
        render: (_, record) => <span className="text-[var(--studio-muted)]">{creditTransactionDetail(record.transactionType, record.generationType, record.model, record.reason)}</span>,
    },
    {
        get title() { return translator("administration.creditChange"); },
        dataIndex: "changeAmount",
        width: 128,
        align: "right",
        render: (changeAmount: CreditAmount) => <span className={`font-medium tabular-nums ${creditAmount(changeAmount).greaterThan(0) ? "text-[var(--studio-primary)]" : "text-[var(--studio-ink)]"}`}>{formatCreditChange(changeAmount)}</span>,
    },
    {
        get title() { return translator("administration.balanceSnapshot"); },
        dataIndex: "balanceAfter",
        width: 128,
        align: "right",
        render: (balanceAfter: CreditAmount) => <span className="tabular-nums text-[var(--studio-muted)]">{formatCredits(balanceAfter)}</span>,
    },
    {
        get title() { return translator("administration.time"); },
        dataIndex: "createdAt",
        width: 176,
        render: (createdAt: string) => <span className="tabular-nums text-[var(--studio-muted)]">{formatCreditTime(createdAt)}</span>,
    },
]);

/**
 * 渲染管理员积分统计与明细。
 *
 * @return 积分明细管理内容
 */
function CreditConsumptionManagement() {
    const [filterTeamId, setFilterTeamId] = useState<number | undefined>();
    const teamsQuery = useQuery({ queryKey: ["adminTeams"], queryFn: listTeams });
    const translate = useTranslation();
    const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>(() => [dayjs().subtract(29, "day").startOf("day"), dayjs().endOf("day")]);
    const [generationType, setGenerationType] = useState<GenerationTypeFilter>("all");
    const [trendUnit, setTrendUnit] = useState<TrendUnit>("day");
    const [selectedUser, setSelectedUser] = useState<ServerUserProfile | null>(null);
    const [userKeyword, setUserKeyword] = useState("");
    const [page, setPage] = useState(1);

    const userQuery = useQuery({
        queryKey: ["admin-credit-users", userKeyword],
        queryFn: () => listServerUsers({ page: 1, pageSize: PAGE_SIZE, keyword: userKeyword || undefined }),
    });
    const userOptions = useMemo(() => {
        const users = userQuery.data?.users || [];
        return selectedUser && !users.some((user) => user.id === selectedUser.id) ? [selectedUser, ...users] : users;
    }, [selectedUser, userQuery.data?.users, translate.locale]);
    const filters = useMemo(
        () => ({
            filterTeamId,
            userId: selectedUser?.id,
            startDate: dateRange[0].format("YYYY-MM-DD"),
            endDate: dateRange[1].format("YYYY-MM-DD"),
            generationType: generationType === "all" ? undefined : generationType,
        }),
        [dateRange, generationType, selectedUser?.id, filterTeamId, translate.locale],
    );
    const filterKey = adminCreditFilterKey(filters);
    const overviewQuery = useQuery({
        queryKey: ["admin-credit-overview", filterTeamId, ...filterKey, trendUnit],
        queryFn: () => getAdminCreditOverview({ ...filters, trendUnit }),
    });
    const transactionsQuery = useQuery({
        queryKey: ["admin-credit-transactions", filterTeamId, ...filterKey, page],
        queryFn: () => listAdminCreditTransactions({ ...filters, page, pageSize: CREDIT_TRANSACTION_PAGE_SIZE }),
    });

    const overview = overviewQuery.data;
    const transactions = transactionsQuery.data;
    const generationDistribution = useMemo(() => normalizeGenerationDistribution(overview?.generationTypeDistribution || []), [overview?.generationTypeDistribution, translate.locale]);
    const modelDistribution = useMemo(() => normalizeModelDistribution(overview?.modelDistribution || []), [overview?.modelDistribution, translate.locale]);
    const trend = useMemo(() => (overview?.trend || []).map((item) => ({ name: item.period, value: Number(item.consumedCredits) })), [overview?.trend, translate.locale]);
    const totalConsumed = trend.reduce<CreditAmount>((total, item) => creditAmount(total).plus(item.value).toFixed(), 0);
    const hasError = overviewQuery.isError || transactionsQuery.isError;

    const resetPage = () => setPage(1);

    return (
        <div>
            <div className="flex flex-wrap items-center gap-3"><Select className="w-48" allowClear placeholder="全部空间" value={filterTeamId} options={[{ value: 0, label: "平台空间" }, ...(teamsQuery.data || []).map((team) => ({ value: team.id, label: team.name }))]} onChange={(value) => { setFilterTeamId(value); setPage(1); }} />
                <Select
                    className="w-72 max-w-full"
                    value={selectedUser?.id}
                    options={userOptions.map((user) => ({ value: user.id, label: adminCreditUserLabel(user) }))}
                    showSearch
                    allowClear
                    filterOption={false}
                    placeholder={translate("administration.allUsersSearchNameOrEmail")}
                    notFoundContent={userQuery.isFetching ? <Skeleton active paragraph={false} title={{ width: "70%" }} /> : translate("administration.noMatchingUsers")}
                    onSearch={setUserKeyword}
                    onChange={(userId) => {
                        setSelectedUser(userOptions.find((user) => user.id === userId) || null);
                        resetPage();
                    }}
                    onClear={() => {
                        setSelectedUser(null);
                        resetPage();
                    }}
                />
                <DatePicker.RangePicker
                    value={dateRange}
                    allowClear={false}
                    disabledDate={(date) => date.isAfter(dayjs(), "day")}
                    presets={[
                        { label: translate("administration.today"), value: [dayjs().startOf("day"), dayjs().endOf("day")] },
                        { label: translate("administration.last7Days"), value: [dayjs().subtract(6, "day"), dayjs()] },
                        { label: translate("administration.last30Days"), value: [dayjs().subtract(29, "day"), dayjs()] },
                        { label: translate("administration.thisMonth"), value: [dayjs().startOf("month"), dayjs()] },
                    ]}
                    onChange={(nextDateRange) => {
                        if (!nextDateRange?.[0] || !nextDateRange[1]) return;
                        setDateRange([nextDateRange[0], nextDateRange[1]]);
                        resetPage();
                    }}
                />
                <Segmented
                    value={generationType}
                    options={[
                        { label: translate("administration.all"), value: "all" },
                        { label: translate("administration.generateImage"), value: "image" },
                        { label: translate("administration.generateVideo"), value: "video" },
                    ]}
                    onChange={(value) => {
                        setGenerationType(value as GenerationTypeFilter);
                        resetPage();
                    }}
                />
            </div>

            {hasError ? (
                <Alert
                    className="mt-5"
                    type="error"
                    showIcon
                    title={translate("administration.failedToLoadCreditData")}
                    action={
                        <Button
                            size="small"
                            onClick={() => {
                                void overviewQuery.refetch();
                                void transactionsQuery.refetch();
                            }}
                        >
                            {translate("administration.reload")}</Button>
                    }
                />
            ) : null}

            <section className="mt-6" aria-labelledby="admin-credit-statistics-title">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 id="admin-credit-statistics-title" className="text-base font-semibold text-[var(--studio-ink)]">
                            {translate("administration.usageStatistics")}</h2>
                        <p className="mt-1 text-sm text-[var(--studio-muted)]">
                            {selectedUser ? translate("administration.thisPeriod", { value0: adminCreditUserLabel(selectedUser) }) : translate("administration.allUsersThisPeriod")}{translate("administration.totalUsage")}{formatCredits(totalConsumed)} {translate("administration.credits")}</p>
                    </div>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                    <CreditChartPanel title={translate("administration.imageVsVideoUsage")} loading={overviewQuery.isLoading} empty={!generationDistribution.length}>
                        <CreditChart type="pie" data={generationDistribution} ariaLabel={translate("administration.adminImageAndVideoUsageChart")} />
                    </CreditChartPanel>
                    <CreditChartPanel title={translate("administration.usageByModel")} loading={overviewQuery.isLoading} empty={!modelDistribution.length}>
                        <CreditChart type="pie" data={modelDistribution} ariaLabel={translate("administration.adminCreditUsageByModel")} />
                    </CreditChartPanel>
                    <CreditChartPanel
                        className="lg:col-span-2"
                        title={translate("administration.creditUsageTrend")}
                        loading={overviewQuery.isLoading}
                        empty={!trend.some((item) => creditAmount(item.value).greaterThan(0))}
                        extra={
                            <Segmented
                                value={trendUnit}
                                size="small"
                                options={[
                                    { label: translate("administration.daily"), value: "day" },
                                    { label: translate("administration.monthly"), value: "month" },
                                ]}
                                onChange={(value) => setTrendUnit(value as TrendUnit)}
                            />
                        }
                    >
                        <CreditChart type="bar" data={trend} ariaLabel={translate("administration.adminCreditUsageBarChart")} />
                    </CreditChartPanel>
                </div>
            </section>

            <section className="mt-8 border-t border-[var(--studio-line)] pt-6" aria-labelledby="admin-credit-transactions-title">
                <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h2 id="admin-credit-transactions-title" className="text-base font-semibold text-[var(--studio-ink)]">
                            {translate("administration.creditDetails")}</h2>
                        <p className="mt-1 text-sm text-[var(--studio-muted)]">{selectedUser ? translate("administration.creditRecordsFor", { value0: adminCreditUserLabel(selectedUser) }) : translate("administration.creditRecordsForAllUsers")}{translate("administration.includingUsageRefundsTopUpsAndCheckIns")}</p>
                    </div>
                    <span className="text-sm tabular-nums text-[var(--studio-muted)]">{transactions?.total || 0} {translate("administration.records")}</span>
                </div>
                <Table<ServerAdminCreditTransaction>
                    rowKey="id"
                    columns={createAdminCreditColumns(translate)}
                    dataSource={transactions?.transactions || []}
                    loading={transactionsQuery.isLoading}
                    pagination={false}
                    scroll={{ x: 1_100 }}
                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={translate("administration.noTransactionsInThisPeriod")} /> }}
                />
                {transactions && transactions.total > CREDIT_TRANSACTION_PAGE_SIZE ? (
                    <div className="mt-5 flex justify-end">
                        <Pagination current={page} pageSize={CREDIT_TRANSACTION_PAGE_SIZE} total={transactions.total} showSizeChanger={false} onChange={setPage} />
                    </div>
                ) : null}
            </section>
        </div>
    );
}

/**
 * 渲染管理员积分图表面板。
 *
 * @param props 标题、加载、空状态和图表内容
 * @return 图表面板
 */
function CreditChartPanel({ title, loading, empty, extra, className, children }: { title: string; loading: boolean; empty: boolean; extra?: ReactNode; className?: string; children: ReactNode }) {
    const translate = useTranslation();
    return (
        <section className={`min-w-0 border border-[var(--studio-line)] bg-[var(--studio-surface)] p-4 md:p-5 ${className || ""}`}>
            <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-[var(--studio-ink)]">{title}</h3>
                {extra}
            </div>
            <div className="mt-2">
                {loading ? <Skeleton active className="py-5" paragraph={{ rows: 6 }} /> : null}
                {!loading && empty ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={translate("administration.noUsageDataInThisPeriod")} className="py-9" /> : null}
                {!loading && !empty ? children : null}
            </div>
        </section>
    );
}

function UserManagement() {
    const [filterTeamId, setFilterTeamId] = useState<number | undefined>();
    const teamsQuery = useQuery({ queryKey: ["adminTeams"], queryFn: listTeams });
    const translate = useTranslation();
    const { message, modal } = App.useApp();
    const [users, setUsers] = useState<ServerUserProfile[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(false);
    const [searchKeyword, setSearchKeyword] = useState("");
    const [userIdKeyword, setUserIdKeyword] = useState("");
    const [filterRole, setFilterRole] = useState<string | undefined>();
    const [filterStatus, setFilterStatus] = useState<number | undefined>();
    const [filterCreatedAfter, setFilterCreatedAfter] = useState<string | undefined>();
    const [filterCreatedBefore, setFilterCreatedBefore] = useState<string | undefined>();
    const [createUserOpen, setCreateUserOpen] = useState(false);
    const [newUserAccount, setNewUserAccount] = useState("");
    const [passwordTarget, setPasswordTarget] = useState<ServerUserProfile | null>(null);
    const [newUserPassword, setNewUserPassword] = useState("");
    const [newUserNickname, setNewUserNickname] = useState("");
    const [newUserRole, setNewUserRole] = useState<string>("user");
    const [creditUser, setCreditUser] = useState<ServerUserProfile | null>(null);
    const [creditChangeAmount, setCreditChangeAmount] = useState<CreditAmount | null>(null);
    const [creditReason, setCreditReason] = useState("");
    const [creditSaving, setCreditSaving] = useState(false);
    const statisticsQuery = useQuery({
        queryKey: ["admin-user-statistics", filterTeamId],
        queryFn: () => getServerUserStatistics(filterTeamId),
    });

    const loadUsers = useCallback(
        async (nextPage = page) => {
            const normalizedUserId = userIdKeyword.trim();
            if (normalizedUserId && !/^[1-9]\d*$/.test(normalizedUserId)) {
                message.warning(translate("administration.enterAPositiveIntegerUserID"));
                return;
            }
            setLoading(true);
            try {
                const result = await listServerUsers({
                    page: nextPage,
                    filterTeamId,
                    pageSize: PAGE_SIZE,
                    keyword: searchKeyword || undefined,
                    userId: normalizedUserId || undefined,
                    role: filterRole,
                    status: filterStatus,
                    createdAfter: filterCreatedAfter,
                    createdBefore: filterCreatedBefore,
                });
                setUsers(result.users);
                setTotal(result.total);
            } catch (error) {
                message.error(error instanceof Error ? error.message : translate("administration.failedToLoadUsers"));
            } finally {
                setLoading(false);
            }
        },
        [message, page, searchKeyword, userIdKeyword, filterRole, filterStatus, filterCreatedAfter, filterCreatedBefore, filterTeamId],
    );

    useEffect(() => {
        void loadUsers(page);
    }, [loadUsers, page]);

    const handleSearch = () => {
        setPage(1);
        void loadUsers(1);
    };

    const handleCreateUser = async () => {
        if (!newUserAccount.trim() || !newUserPassword) {
            message.warning(translate("administration.enterAccountAndPassword"));
            return;
        }
        try {
            await adminCreateUser({ account: newUserAccount.trim(), password: newUserPassword, nickname: newUserNickname.trim() || undefined, role: newUserRole });
            message.success(translate("administration.userCreated"));
            setCreateUserOpen(false);
            setNewUserAccount("");
            setNewUserPassword("");
            setNewUserNickname("");
            setNewUserRole("user");
            setPage(1);
            await Promise.all([loadUsers(1), statisticsQuery.refetch()]);
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("administration.failedToCreateUser"));
        }
    };

    const updateStatus = async (user: ServerUserProfile, status: number) => {
        try {
            await updateServerUserStatus(user.id, status);
            message.success(translate("administration.userStatusUpdated"));
            await loadUsers(page);
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("administration.failedToUpdateUserStatus"));
        }
    };

    const updateRole = async (user: ServerUserProfile, role: ServerUserRole) => {
        try {
            await updateServerUserRole(user.id, role);
            message.success(translate("administration.userRoleUpdated"));
            await loadUsers(page);
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("administration.failedToUpdateUserRole"));
        }
    };

    const openCreditAdjustment = (user: ServerUserProfile) => {
        setCreditUser(user);
        setCreditChangeAmount(null);
        setCreditReason("");
    };

    const saveCreditAdjustment = async () => {
        if (!creditUser || !creditChangeAmount || !creditReason.trim()) {
            message.warning(translate("administration.enterANonzeroCreditChangeAndAReason"));
            return;
        }
        setCreditSaving(true);
        try {
            await adjustServerUserCredits({ userId: creditUser.id, changeAmount: creditChangeAmount, reason: creditReason.trim() });
            message.success(translate("administration.userCreditsAdjusted"));
            setCreditUser(null);
            await loadUsers(page);
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("administration.failedToAdjustUserCredits"));
        } finally {
            setCreditSaving(false);
        }
    };

    const unlockPassword = (user: ServerUserProfile) => {
        modal.confirm({
            title: translate("administration.unlockPassword"),
            content: translate("administration.unlockPasswordSignInFor", { value0: user.nickname || user.email }),
            okText: translate("administration.unlock"),
            cancelText: translate("administration.cancel"),
            onOk: async () => {
                try {
                    await unlockServerUserPassword(user.id);
                    message.success(translate("administration.passwordUnlocked"));
                    await loadUsers(page);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : translate("administration.failedToUnlockPassword"));
                }
            },
        });
    };

    const columns: ColumnsType<ServerUserProfile> = [
        {
            title: "ID",
            dataIndex: "id",
            width: 120,
            render: (value: number) => <span className="tabular-nums">{value}</span>,
        },
        {
            title: translate("administration.user"),
            dataIndex: "email",
            render: (_, user) => (
                <div>
                    <div className="studio-title font-medium">{user.nickname || user.username || user.email}</div>
                    <div className="studio-caption mt-1 text-xs">{user.email}</div>
                </div>
            ),
        },
        {
            title: translate("administration.character"),
            dataIndex: "role",
            width: 160,
            render: (_, user) => (
                <Select<ServerUserRole>
                    value={user.role}
                    options={[
                        { label: translate("administration.user_f6a2fa"), value: "user" },
                        { label: translate("administration.administrator"), value: "admin" },
                    ]}
                    onChange={(role) => void updateRole(user, role)}
                    className="w-28"
                />
            ),
        },
        {
            title: translate("administration.status"),
            dataIndex: "status",
            width: 130,
            render: (status: number) => (status === 1 ? <Tag color="green">{translate("administration.normal")}</Tag> : <Tag color="red">{translate("administration.disable")}</Tag>),
        },
        {
            title: translate("administration.availableCredits"),
            dataIndex: "creditBalance",
            width: 120,
            render: (value: number) => <span className="font-medium tabular-nums">{value.toLocaleString(currentLanguageTag())}</span>,
        },
        {
            title: translate("administration.passwordLock"),
            dataIndex: "passwordLockedUntil",
            width: 200,
            render: (value: string | null) => {
                const lockedUntil = value ? new Date(value) : null;
                if (!lockedUntil || Number.isNaN(lockedUntil.getTime()) || lockedUntil.getTime() <= Date.now()) {
                    return <Tag>{translate("administration.unlocked")}</Tag>;
                }
                return <Tag color="orange">{translate("administration.lockedUntil")}{lockedUntil.toLocaleString(currentLanguageTag())}</Tag>;
            },
        },
        {
            title: translate("administration.createdAt"),
            dataIndex: "createdAt",
            width: 180,
            render: (value: string) => (value ? new Date(value).toLocaleString(currentLanguageTag()) : "-"),
        },
        {
            title: translate("administration.actions"),
            width: 310,
            render: (_, user) => (
                <Space size="small">
                    <Button onClick={() => openCreditAdjustment(user)}>{translate("administration.adjustCredits")}</Button>
                    {user.canResetPassword ? <Button onClick={() => setPasswordTarget(user)}>{translate("administration.resetPassword")}</Button> : null}
                    {user.passwordLockedUntil && new Date(user.passwordLockedUntil).getTime() > Date.now() ? <Button onClick={() => unlockPassword(user)}>{translate("administration.unlock")}</Button> : null}
                    {user.status === 1 ? (
                        <Button danger onClick={() => void updateStatus(user, 0)}>
                            {translate("administration.disable")}</Button>
                    ) : (
                        <Button onClick={() => void updateStatus(user, 1)}>{translate("administration.enable")}</Button>
                    )}
                </Space>
            ),
        },
    ];

    return (
        <div>
            <section className="mb-5 grid grid-cols-1 border border-[var(--studio-line)] bg-[var(--studio-surface)] sm:grid-cols-3" aria-label={translate("administration.userStatistics")}>
                {[
                    { label: translate("administration.totalUsers"), value: statisticsQuery.data?.totalUsers },
                    { label: translate("administration.newUsersThisMonth"), value: statisticsQuery.data?.monthlyNewUsers },
                    { label: translate("administration.newUsersToday"), value: statisticsQuery.data?.dailyNewUsers },
                ].map((item, index) => (
                    <div key={item.label} className={`min-w-0 px-5 py-4 ${index > 0 ? "border-t border-[var(--studio-line)] sm:border-l sm:border-t-0" : ""}`}>
                        <div className="text-sm text-[var(--studio-muted)]">{item.label}</div>
                        {statisticsQuery.isLoading ? <Skeleton.Input active size="small" className="mt-2 !h-8 !w-24" /> : <div className="mt-2 text-2xl font-semibold tabular-nums text-[var(--studio-ink)]">{item.value?.toLocaleString(currentLanguageTag()) ?? "--"}</div>}
                    </div>
                ))}
            </section>
            {statisticsQuery.isError ? (
                <Alert
                    className="mb-4"
                    type="error"
                    showIcon
                    title={translate("administration.failedToLoadUserStatistics")}
                    action={
                        <Button size="small" onClick={() => void statisticsQuery.refetch()}>
                            {translate("administration.reload")}</Button>
                    }
                />
            ) : null}
            <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <Select className="w-48" allowClear placeholder="全部团队用户" value={filterTeamId} options={(teamsQuery.data || []).map((team) => ({ value: team.id, label: team.name }))} onChange={(value) => { setFilterTeamId(value); setPage(1); }} />
                    <Input.Search
                        placeholder={translate("administration.searchDisplayNameUsernameOrEmail")}
                        value={searchKeyword}
                        onChange={(e) => setSearchKeyword(e.target.value)}
                        onSearch={handleSearch}
                        className="max-w-64"
                        prefix={<Search className="size-3.5 text-[var(--studio-faint)]" />}
                        allowClear
                    />
                    <Input.Search
                        placeholder={translate("administration.userID_2b8eac")}
                        value={userIdKeyword}
                        onChange={(e) => setUserIdKeyword(e.target.value)}
                        onSearch={handleSearch}
                        className="w-32"
                        inputMode="numeric"
                        prefix={<Search className="size-3.5 text-[var(--studio-faint)]" />}
                        allowClear
                    />
                    <Select<string>
                        placeholder={translate("administration.character")}
                        value={filterRole}
                        onChange={(value) => {
                            setFilterRole(value);
                            setPage(1);
                            void loadUsers(1);
                        }}
                        onClear={() => {
                            setFilterRole(undefined);
                            setPage(1);
                            void loadUsers(1);
                        }}
                        allowClear
                        className="w-28"
                        options={[
                            { label: translate("administration.user_f6a2fa"), value: "user" },
                            { label: translate("administration.administrator"), value: "admin" },
                        ]}
                    />
                    <Select<number>
                        placeholder={translate("administration.status")}
                        value={filterStatus}
                        onChange={(value) => {
                            setFilterStatus(value);
                            setPage(1);
                            void loadUsers(1);
                        }}
                        onClear={() => {
                            setFilterStatus(undefined);
                            setPage(1);
                            void loadUsers(1);
                        }}
                        allowClear
                        className="w-24"
                        options={[
                            { label: translate("administration.normal"), value: 1 },
                            { label: translate("administration.disable"), value: 0 },
                        ]}
                    />
                    <DatePicker.RangePicker
                        onChange={(dates) => {
                            setFilterCreatedAfter(dates?.[0]?.toISOString());
                            setFilterCreatedBefore(dates?.[1]?.toISOString());
                            setPage(1);
                            void loadUsers(1);
                        }}
                        className="w-60"
                    />
                </div>
                <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setCreateUserOpen(true)}>
                    {translate("administration.addUser")}</Button>
            </div>
            <Table rowKey="id" columns={columns} dataSource={users} loading={loading} pagination={false} />
            <div className="mt-4 flex justify-end">
                <Pagination current={page} pageSize={PAGE_SIZE} total={total} showSizeChanger={false} onChange={setPage} />
            </div>

            <ResetAccountPasswordModal target={passwordTarget ? { userId: passwordTarget.id, username: passwordTarget.username } : null} onClose={() => setPasswordTarget(null)} onReset={() => loadUsers(page)} />
            <Modal title={translate("administration.addUser")} open={createUserOpen} onOk={handleCreateUser} onCancel={() => setCreateUserOpen(false)} okText={translate("administration.create")} cancelText={translate("administration.cancel")}>
                <div className="flex flex-col gap-4">
                    <label className="block text-sm">{translate("auth.account")}<Input className="mt-2" value={newUserAccount} onChange={(e) => setNewUserAccount(e.target.value)} placeholder={translate("auth.enterAccount")} autoComplete="username" /></label>
                    <Input.Password value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} placeholder={translate("administration.passwordAtLeast8Characters")} />
                    <Input value={newUserNickname} onChange={(e) => setNewUserNickname(e.target.value)} placeholder={translate("administration.displayNameOptional")} />
                    <Select<string>
                        value={newUserRole}
                        onChange={setNewUserRole}
                        options={[
                            { label: translate("administration.user_f6a2fa"), value: "user" },
                            { label: translate("administration.administrator"), value: "admin" },
                        ]}
                    />
                </div>
            </Modal>

            <Modal
                title={translate("administration.adjustCredits_8df211", { value0: creditUser ? `：${creditUser.nickname || creditUser.email}` : "" })}
                open={Boolean(creditUser)}
                confirmLoading={creditSaving}
                onOk={() => void saveCreditAdjustment()}
                onCancel={() => setCreditUser(null)}
                okText={translate("administration.confirmAdjustment")}
                cancelText={translate("administration.cancel")}
            >
                <div className="flex flex-col gap-4">
                    <div className="text-sm text-[var(--studio-muted)]">
                        {translate("administration.availableCredits_2aa38d")}<span className="font-medium tabular-nums text-[var(--studio-ink)]">{creditUser?.creditBalance.toLocaleString(currentLanguageTag()) ?? 0}</span>
                    </div>
                    <InputNumber<string> stringMode value={creditChangeAmount === null ? null : String(creditChangeAmount)} precision={6} className="w-full" placeholder={translate("administration.positiveToAddNegativeToDeduct")} onChange={(value) => setCreditChangeAmount(value === null ? null : value)} />
                    <div className="pb-5">
                        <Input.TextArea value={creditReason} maxLength={200} showCount placeholder={translate("administration.reasonForAdjustment")} autoSize={{ minRows: 3, maxRows: 5 }} onChange={(event) => setCreditReason(event.target.value)} />
                    </div>
                </div>
            </Modal>
        </div>
    );
}

function NotificationManagement() {
    const translate = useTranslation();
    const { message, modal } = App.useApp();
    const [notifications, setNotifications] = useState<SystemNotification[]>([]);
    const [loading, setLoading] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
    const [newTitle, setNewTitle] = useState("");
    const [newContent, setNewContent] = useState("");
    const [editOpen, setEditOpen] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);
    const [editTitle, setEditTitle] = useState("");
    const [editContent, setEditContent] = useState("");

    const loadNotifications = useCallback(async () => {
        setLoading(true);
        try {
            const result = await listAdminNotifications();
            setNotifications(result.notifications || []);
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("administration.failedToLoadAnnouncements"));
        } finally {
            setLoading(false);
        }
    }, [message]);

    useEffect(() => {
        void loadNotifications();
    }, [loadNotifications]);

    const handleCreate = async () => {
        if (!newTitle.trim()) {
            message.warning(translate("administration.enterAnnouncementTitle"));
            return;
        }
        try {
            await createAdminNotification({ title: newTitle.trim(), content: newContent.trim() });
            message.success(translate("administration.announcementCreated"));
            setCreateOpen(false);
            setNewTitle("");
            setNewContent("");
            await loadNotifications();
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("administration.failedToCreateAnnouncement"));
        }
    };

    const handleEdit = (record: SystemNotification) => {
        setEditId(record.id);
        setEditTitle(record.title);
        setEditContent(record.content || "");
        setEditOpen(true);
    };

    const handleEditSave = async () => {
        if (!editTitle.trim() || editId === null) return;
        try {
            await updateAdminNotification({ id: editId, title: editTitle.trim(), content: editContent.trim() });
            message.success(translate("administration.announcementUpdated"));
            setEditOpen(false);
            setEditId(null);
            await loadNotifications();
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("administration.failedToUpdateAnnouncement"));
        }
    };

    const handlePublish = (id: number) => {
        modal.confirm({
            title: translate("administration.confirmPublish"),
            content: translate("administration.allUsersWillSeeThisAnnouncementAfterPublishingPublish"),
            okText: translate("administration.publish"),
            cancelText: translate("administration.cancel"),
            onOk: async () => {
                try {
                    await publishAdminNotification(id);
                    message.success(translate("administration.announcementPublished"));
                    await loadNotifications();
                } catch (error) {
                    message.error(error instanceof Error ? error.message : translate("administration.failedToPublishAnnouncement"));
                }
            },
        });
    };

    const columns: ColumnsType<SystemNotification> = [
        { title: translate("administration.title"), dataIndex: "title", ellipsis: true },
        { title: translate("administration.content"), dataIndex: "content", ellipsis: true, render: (text: string) => text || "-" },
        {
            title: translate("administration.priority"),
            dataIndex: "priority",
            width: 100,
            render: (priority: string) => (priority === "high" ? <Tag color="red">{translate("administration.high")}</Tag> : <Tag>{translate("administration.regular")}</Tag>),
        },
        {
            title: translate("administration.status"),
            dataIndex: "status",
            width: 100,
            render: (status: number) => (status === 1 ? <Tag color="green">{translate("administration.published")}</Tag> : <Tag>{translate("administration.draft")}</Tag>),
        },
        {
            title: translate("administration.publishedAt"),
            dataIndex: "publishedAt",
            width: 180,
            render: (value: string) => (value ? new Date(value).toLocaleString(currentLanguageTag()) : "-"),
        },
        {
            title: translate("administration.createdAt"),
            dataIndex: "createdAt",
            width: 180,
            render: (value: string) => (value ? new Date(value).toLocaleString(currentLanguageTag()) : "-"),
        },
        {
            title: translate("administration.actions"),
            width: 180,
            render: (_, record) => (
                <span className="inline-flex gap-1">
                    <Button size="small" onClick={() => handleEdit(record)}>
                        {translate("administration.edit")}</Button>
                    {record.status === 0 ? (
                        <Button size="small" icon={<Send className="size-3.5" />} onClick={() => handlePublish(record.id)}>
                            {translate("administration.publish")}</Button>
                    ) : null}
                </span>
            ),
        },
    ];

    return (
        <div>
            <div className="mb-4 flex justify-end">
                <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setCreateOpen(true)}>
                    {translate("administration.newAnnouncement")}</Button>
            </div>
            <Table rowKey="id" columns={columns} dataSource={notifications} loading={loading} pagination={false} />

            <Modal title={translate("administration.newAnnouncement")} open={createOpen} onOk={handleCreate} onCancel={() => setCreateOpen(false)} okText={translate("administration.create")} cancelText={translate("administration.cancel")}>
                <div className="flex flex-col gap-4">
                    <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder={translate("administration.announcementTitle")} />
                    <Input.TextArea value={newContent} onChange={(e) => setNewContent(e.target.value)} rows={4} placeholder={translate("administration.announcementContentOptional")} />
                </div>
            </Modal>

            <Modal title={translate("administration.editAnnouncement")} open={editOpen} onOk={handleEditSave} onCancel={() => setEditOpen(false)} okText={translate("administration.save")} cancelText={translate("administration.cancel")}>
                <div className="flex flex-col gap-4">
                    <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder={translate("administration.announcementTitle")} />
                    <Input.TextArea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={4} placeholder={translate("administration.announcementContentOptional")} />
                </div>
            </Modal>
        </div>
    );
}

type PromptFormValues = {
    title: string;
    prompt: string;
    category: string;
    tagsText?: string;
    coverUrl?: string;
    preview?: string;
    githubUrl?: string;
    sortOrder?: number;
    status?: number;
};

function PromptManagement() {
    const translate = useTranslation();
    const { message, modal } = App.useApp();
    const [form] = Form.useForm<PromptFormValues>();
    const [prompts, setPrompts] = useState<ServerPrompt[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(false);
    const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
    const [keyword, setKeyword] = useState("");
    const [category, setCategory] = useState<string | undefined>();
    const [status, setStatus] = useState<number | undefined>();
    const [editOpen, setEditOpen] = useState(false);
    const [editingPrompt, setEditingPrompt] = useState<ServerPrompt | null>(null);
    const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
    const [coverMode, setCoverMode] = useState<"upload" | "url">("upload");
    const [coverFile, setCoverFile] = useState<File | null>(null);
    const [coverPreview, setCoverPreview] = useState("");
    const [saving, setSaving] = useState(false);
    const coverInputRef = useRef<HTMLInputElement>(null);

    const selectCoverFile = (file: File | undefined) => {
        if (!file) return;
        if (!file.type.startsWith("image/")) {
            message.error(translate("administration.selectAnImageFile"));
            return;
        }
        if (coverPreview.startsWith("blob:")) URL.revokeObjectURL(coverPreview);
        setCoverFile(file);
        setCoverPreview(URL.createObjectURL(file));
    };

    const previewCoverUrl = () => {
        const url = String(form.getFieldValue("coverUrl") || "").trim();
        if (!/^https?:\/\//i.test(url)) {
            message.error(translate("administration.enterAValidImageURL"));
            return;
        }
        if (coverPreview.startsWith("blob:")) URL.revokeObjectURL(coverPreview);
        setCoverFile(null);
        setCoverPreview(url);
    };

    const closeEdit = () => {
        if (coverPreview.startsWith("blob:")) URL.revokeObjectURL(coverPreview);
        setCoverPreview("");
        setCoverFile(null);
        setEditOpen(false);
    };

    const loadPrompts = useCallback(
        async (nextPage = page) => {
            setLoading(true);
            try {
                const result = await listAdminPrompts({
                    page: nextPage,
                    pageSize: PAGE_SIZE,
                    keyword: keyword || undefined,
                    category,
                    status,
                });
                setPrompts(result.items);
                setTotal(result.total);
                setCategoryOptions(result.categories || []);
            } catch (error) {
                message.error(error instanceof Error ? error.message : translate("administration.failedToLoadPrompts"));
            } finally {
                setLoading(false);
            }
        },
        [category, keyword, message, page, status],
    );

    useEffect(() => {
        void loadPrompts(page);
    }, [loadPrompts, page]);

    const openCreate = () => {
        setEditingPrompt(null);
        setCoverMode("upload");
        setCoverFile(null);
        setCoverPreview("");
        form.setFieldsValue({ status: 1, sortOrder: 1000, title: "", prompt: "", category: "", tagsText: "", coverUrl: "", preview: "", githubUrl: "" });
        setEditOpen(true);
    };

    const openEdit = (prompt: ServerPrompt) => {
        setEditingPrompt(prompt);
        setCoverMode(prompt.coverUrl ? "url" : "upload");
        setCoverFile(null);
        setCoverPreview(prompt.coverUrl || "");
        form.setFieldsValue({
            title: prompt.title,
            prompt: prompt.prompt,
            category: prompt.category,
            tagsText: prompt.tags.join("，"),
            coverUrl: prompt.coverUrl,
            preview: prompt.preview,
            githubUrl: prompt.githubUrl,
            sortOrder: prompt.sortOrder ?? 1000,
            status: prompt.status ?? 1,
        });
        setEditOpen(true);
    };

    const savePrompt = async () => {
        let values: PromptFormValues;
        try {
            values = await form.validateFields();
        } catch {
            return;
        }
        setSaving(true);
        try {
            let coverUrlValue = values.coverUrl?.trim() || "";
            if (coverFile) {
                const uploaded = await uploadImage(coverFile);
                coverUrlValue = uploaded.url;
            }
            const input = {
                title: values.title.trim(),
                prompt: values.prompt.trim(),
                category: values.category.trim(),
                tags: splitTags(values.tagsText),
                coverUrl: coverUrlValue,
                preview: values.preview?.trim() || "",
                sourceUrl: values.githubUrl?.trim() || "",
                status: values.status ?? 1,
                sortOrder: values.sortOrder ?? 1000,
            };
            if (editingPrompt) {
                await updateAdminPrompt({ id: editingPrompt.id, ...input });
                message.success(translate("administration.promptUpdated"));
            } else {
                await createAdminPrompt(input);
                message.success(translate("administration.promptCreated"));
            }
            closeEdit();
            await loadPrompts(editingPrompt ? page : 1);
            if (!editingPrompt) setPage(1);
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("administration.failedToSavePrompt"));
        } finally {
            setSaving(false);
        }
    };

    const handleStatusChange = (prompt: ServerPrompt) => {
        const nextStatus = prompt.status === 1 ? 0 : 1;
        modal.confirm({
            title: nextStatus === 1 ? translate("administration.enablePrompt") : translate("administration.disablePrompt"),
            content: nextStatus === 1 ? translate("administration.enabledPromptsAppearInThePromptLibrary") : translate("administration.disabledPromptsAreHiddenFromUsers"),
            okText: nextStatus === 1 ? translate("administration.enable") : translate("administration.disable_4e6fd0"),
            cancelText: translate("administration.cancel"),
            onOk: async () => {
                try {
                    await updateAdminPromptStatus(prompt.id, nextStatus);
                    message.success(translate("administration.promptStatusUpdated"));
                    await loadPrompts(page);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : translate("administration.failedToUpdatePromptStatus"));
                }
            },
        });
    };

    const handleDelete = (ids: number[]) => {
        modal.confirm({
            title: translate("administration.deletePrompt"),
            content: translate("administration.thesePromptsWillDisappearFromUserAndAdminLists"),
            okText: translate("administration.delete"),
            okButtonProps: { danger: true },
            cancelText: translate("administration.cancel"),
            onOk: async () => {
                try {
                    await deleteAdminPrompts(ids);
                    message.success(translate("administration.promptDeleted"));
                    setSelectedRowKeys([]);
                    const nextPage = prompts.length <= ids.length && page > 1 ? page - 1 : page;
                    setPage(nextPage);
                    await loadPrompts(nextPage);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : translate("administration.failedToDeletePrompt"));
                }
            },
        });
    };

    const handleSearch = () => {
        setPage(1);
        void loadPrompts(1);
    };

    const toggleSelectedPrompt = (promptId: number, checked: boolean) => {
        setSelectedRowKeys((keys) => (checked ? Array.from(new Set([...keys, promptId])) : keys.filter((key) => key !== promptId)));
    };

    return (
        <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                    <Input.Search
                        placeholder={translate("administration.searchTitleContentOrCategory")}
                        value={keyword}
                        onChange={(event) => setKeyword(event.target.value)}
                        onSearch={handleSearch}
                        className="w-64"
                        prefix={<Search className="size-3.5 text-[var(--studio-faint)]" />}
                        allowClear
                    />
                    <Select<string>
                        placeholder={translate("administration.category")}
                        value={category}
                        onChange={(value) => {
                            setCategory(value);
                            setPage(1);
                            void loadPrompts(1);
                        }}
                        onClear={() => {
                            setCategory(undefined);
                            setPage(1);
                            void loadPrompts(1);
                        }}
                        allowClear
                        showSearch
                        className="w-44"
                        options={categoryOptions.map((item) => ({ label: item, value: item }))}
                    />
                    <Select<number>
                        placeholder={translate("administration.status")}
                        value={status}
                        onChange={(value) => {
                            setStatus(value);
                            setPage(1);
                            void loadPrompts(1);
                        }}
                        onClear={() => {
                            setStatus(undefined);
                            setPage(1);
                            void loadPrompts(1);
                        }}
                        allowClear
                        className="w-28"
                        options={[
                            { label: translate("administration.enable"), value: 1 },
                            { label: translate("administration.disable_4e6fd0"), value: 0 },
                        ]}
                    />
                    <Button danger disabled={!selectedRowKeys.length} icon={<Trash2 className="size-4" />} onClick={() => handleDelete(selectedRowKeys.map(Number))}>
                        {translate("administration.deleteSelected")}</Button>
                </div>
                <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>
                    {translate("administration.addPrompt")}</Button>
            </div>
            {loading ? (
                <div className="studio-empty flex min-h-60 items-center justify-center">
                    <span className="text-sm">{translate("administration.loading")}</span>
                </div>
            ) : prompts.length ? (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {prompts.map((prompt) => {
                        const selected = selectedRowKeys.includes(prompt.id);
                        return (
                            <article key={prompt.id} className="studio-panel-solid group flex min-h-[360px] flex-col overflow-hidden transition hover:-translate-y-0.5 hover:border-[var(--studio-primary-line)]">
                                <div className="relative aspect-[4/3] overflow-hidden bg-[var(--studio-media)]">
                                    {prompt.coverUrl ? (
                                        <img src={prompt.coverUrl} alt={prompt.title} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
                                    ) : (
                                        <div className="studio-empty flex h-full w-full items-center justify-center text-xs">{translate("administration.noCover")}</div>
                                    )}
                                    <label className="absolute left-3 top-3 inline-flex cursor-pointer items-center rounded-md border border-[var(--studio-line)] bg-[var(--studio-glass-strong)] px-2 py-1 text-xs backdrop-blur">
                                        <input type="checkbox" className="mr-1.5" checked={selected} onChange={(event) => toggleSelectedPrompt(prompt.id, event.target.checked)} />
                                        {translate("administration.select")}</label>
                                    <Tag color={prompt.status === 1 ? "green" : "red"} className="absolute right-3 top-3 m-0">
                                        {prompt.status === 1 ? translate("administration.enable") : translate("administration.disable_4e6fd0")}
                                    </Tag>
                                </div>
                                <div className="flex min-h-0 flex-1 flex-col p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <h3 className="studio-title line-clamp-2 text-sm font-semibold leading-5">{prompt.title}</h3>
                                        <span className="studio-caption shrink-0 text-xs">#{prompt.sortOrder ?? 1000}</span>
                                    </div>
                                    <p className="studio-subtitle mt-2 line-clamp-4 text-xs leading-5">{prompt.prompt}</p>
                                    <div className="mt-3 flex flex-wrap gap-1.5">
                                        <Tag className="m-0 text-[11px]">{prompt.category}</Tag>
                                        {prompt.tags.slice(0, 3).map((tag) => (
                                            <Tag key={tag} className="m-0 text-[11px]">
                                                {tag}
                                            </Tag>
                                        ))}
                                        {prompt.tags.length > 3 ? <Tag className="m-0 text-[11px]">+{prompt.tags.length - 3}</Tag> : null}
                                    </div>
                                    <div className="mt-auto pt-4">
                                        <div className="studio-caption mb-3 text-xs">{translate("administration.updated")}{prompt.updatedAt ? new Date(prompt.updatedAt).toLocaleString(currentLanguageTag()) : "-"}</div>
                                        <div className="grid grid-cols-3 gap-2">
                                            <Button size="small" icon={<Edit className="size-3.5" />} onClick={() => openEdit(prompt)}>
                                                {translate("administration.edit")}</Button>
                                            <Button size="small" icon={<Power className="size-3.5" />} onClick={() => handleStatusChange(prompt)}>
                                                {prompt.status === 1 ? translate("administration.disable_4e6fd0") : translate("administration.enable")}
                                            </Button>
                                            <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => handleDelete([prompt.id])}>
                                                {translate("administration.delete")}</Button>
                                        </div>
                                    </div>
                                </div>
                            </article>
                        );
                    })}
                </div>
            ) : (
                <div className="studio-empty flex min-h-60 items-center justify-center text-sm">{translate("administration.noPrompts")}</div>
            )}
            <div className="mt-4 flex justify-end">
                <Pagination current={page} pageSize={PAGE_SIZE} total={total} showSizeChanger={false} onChange={setPage} />
            </div>

            <Modal title={editingPrompt ? translate("administration.editPrompt") : translate("administration.addPrompt")} open={editOpen} onOk={savePrompt} onCancel={closeEdit} okText={translate("administration.save")} cancelText={translate("administration.cancel")} confirmLoading={saving} width={880}>
                <Form form={form} layout="vertical" className="mt-2">
                    <div className="flex h-[560px] gap-5">
                        <div className="flex w-60 shrink-0 flex-col gap-3">
                            <div className="studio-empty flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-[var(--studio-line)] bg-[var(--studio-media)]">
                                {coverPreview ? (
                                    <img src={coverPreview} alt={translate("administration.coverPreview")} className="h-full w-full object-contain" />
                                ) : (
                                    <span className="text-xs">{translate("administration.noCover")}</span>
                                )}
                            </div>
                            <Segmented
                                block
                                value={coverMode}
                                onChange={(value) => setCoverMode(value as "upload" | "url")}
                                options={[
                                    { label: translate("administration.uploadImage"), value: "upload" },
                                    { label: translate("administration.uploadURL"), value: "url" },
                                ]}
                            />
                            <input
                                ref={coverInputRef}
                                type="file"
                                accept="image/*"
                                hidden
                                onChange={(event) => {
                                    selectCoverFile(event.target.files?.[0]);
                                    event.target.value = "";
                                }}
                            />
                            {coverMode === "upload" ? (
                                <>
                                    <Form.Item name="coverUrl" hidden className="mb-0">
                                        <Input />
                                    </Form.Item>
                                    <Button icon={<Upload className="size-3.5" />} onClick={() => coverInputRef.current?.click()}>
                                        {translate("administration.selectImageAndPreview")}</Button>
                                    {coverFile ? <div className="studio-caption truncate text-xs">{coverFile.name}</div> : null}
                                </>
                            ) : (
                                <>
                                    <Form.Item name="coverUrl" className="mb-0">
                                        <Input placeholder="https://..." allowClear onPressEnter={previewCoverUrl} />
                                    </Form.Item>
                                    <Button icon={<Upload className="size-3.5" />} onClick={previewCoverUrl}>
                                        {translate("administration.uploadAndPreview")}</Button>
                                </>
                            )}
                        </div>
                        <div className="min-w-0 flex-1 overflow-y-auto pr-1">
                            <Form.Item name="title" label={translate("administration.title")} rules={[{ required: true, message: translate("administration.enterATitle") }]}>
                                <Input placeholder={translate("administration.enterPromptTitle")} />
                            </Form.Item>
                            <Form.Item name="prompt" label={translate("administration.promptContent")} rules={[{ required: true, message: translate("administration.enterPromptContent") }]}>
                                <Input.TextArea rows={6} placeholder={translate("administration.enterPromptContent")} />
                            </Form.Item>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Form.Item name="category" label={translate("administration.category")} rules={[{ required: true, message: translate("administration.enterACategory") }]}>
                                    <Input placeholder={translate("administration.eGPhotographyPosterCharacter")} />
                                </Form.Item>
                                <Form.Item name="tagsText" label={translate("administration.tags")}>
                                    <Input placeholder={translate("administration.separateTagsWithCommas")} />
                                </Form.Item>
                            </div>
                            <Form.Item name="preview" label={translate("administration.previewContent")}>
                                <Input.TextArea rows={3} placeholder={translate("administration.markdownImagePreviewContent")} />
                            </Form.Item>
                            <Form.Item name="githubUrl" label={translate("administration.sourceURL")}>
                                <Input placeholder="https://..." />
                            </Form.Item>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Form.Item name="sortOrder" label={translate("administration.sort")}>
                                    <InputNumber className="w-full" min={0} precision={0} />
                                </Form.Item>
                                <Form.Item name="status" label={translate("administration.status")}>
                                    <Select<number>
                                        options={[
                                            { label: translate("administration.enable"), value: 1 },
                                            { label: translate("administration.disable_4e6fd0"), value: 0 },
                                        ]}
                                    />
                                </Form.Item>
                            </div>
                        </div>
                    </div>
                </Form>
            </Modal>
        </div>
    );
}

type GenerationStyleFormValues = {
    generationType: "image" | "video";
    name: string;
    stylePrompt: string;
    coverUrl: string;
    category: string;
    sortOrder?: number;
    status?: number;
};

/**
 * 管理员维护图片和视频生成风格。
 *
 * @return 风格管理内容
 */
function GenerationStyleManagement() {
    const translate = useTranslation();
    const { message, modal } = App.useApp();
    const [form] = Form.useForm<GenerationStyleFormValues>();
    const [styles, setStyles] = useState<ServerGenerationStyle[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [keyword, setKeyword] = useState("");
    const [generationType, setGenerationType] = useState<"all" | "image" | "video">("all");
    const [status, setStatus] = useState<number | undefined>();
    const [loading, setLoading] = useState(false);
    const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
    const [editOpen, setEditOpen] = useState(false);
    const [editingStyle, setEditingStyle] = useState<ServerGenerationStyle | null>(null);
    const [coverUploading, setCoverUploading] = useState(false);
    const coverInputRef = useRef<HTMLInputElement>(null);
    const coverUrl = Form.useWatch("coverUrl", form) || "";
    const coverName = Form.useWatch("name", form) || translate("administration.styleCover");

    const loadStyles = useCallback(
        async (nextPage = page) => {
            setLoading(true);
            try {
                const result = await listAdminGenerationStyles({
                    page: nextPage,
                    pageSize: PAGE_SIZE,
                    keyword: keyword || undefined,
                    generationType,
                    status,
                });
                setStyles(result.styles);
                setTotal(result.total);
                setSelectedRowKeys((current) => current.filter((id) => result.styles.some((style) => style.id === Number(id))));
            } catch (error) {
                message.error(error instanceof Error ? error.message : translate("administration.failedToLoadStyles"));
            } finally {
                setLoading(false);
            }
        },
        [generationType, keyword, message, page, status],
    );

    useEffect(() => {
        void loadStyles(page);
    }, [loadStyles, page]);

    const openCreate = () => {
        setEditingStyle(null);
        form.setFieldsValue({ generationType: "image", name: "", stylePrompt: "", coverUrl: "", category: "", sortOrder: 1000, status: 1 });
        setEditOpen(true);
    };

    const openEdit = (style: ServerGenerationStyle) => {
        setEditingStyle(style);
        form.setFieldsValue({
            generationType: style.generationType,
            name: style.name,
            stylePrompt: style.stylePrompt,
            coverUrl: style.coverUrl || "",
            category: style.category || "",
            sortOrder: style.sortOrder ?? 1000,
            status: style.status ?? 1,
        });
        setEditOpen(true);
    };

    const saveStyle = async () => {
        try {
            const values = await form.validateFields();
            const input = {
                generationType: values.generationType,
                name: values.name.trim(),
                stylePrompt: values.stylePrompt.trim(),
                coverUrl: values.coverUrl.trim(),
                category: values.category.trim(),
                sortOrder: values.sortOrder ?? 1000,
                status: values.status ?? 1,
            };
            if (editingStyle) {
                await updateAdminGenerationStyle({ id: editingStyle.id, ...input });
                message.success(translate("administration.styleUpdated"));
            } else {
                await createAdminGenerationStyle(input);
                message.success(translate("administration.styleCreated"));
            }
            setEditOpen(false);
            await loadStyles(editingStyle ? page : 1);
            if (!editingStyle) setPage(1);
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        }
    };

    const changeStatus = (style: ServerGenerationStyle) => {
        const nextStatus = style.status === 1 ? 0 : 1;
        modal.confirm({
            title: nextStatus === 1 ? translate("administration.enableStyle") : translate("administration.disableStyle"),
            content: nextStatus === 1 ? translate("administration.enabledStylesAreAvailableInImageAndVideoDialogs") : translate("administration.disabledStylesCannotBeSelectedHistoricalSnapshotsRemain"),
            okText: nextStatus === 1 ? translate("administration.enable") : translate("administration.disable_4e6fd0"),
            cancelText: translate("administration.cancel"),
            onOk: async () => {
                try {
                    await updateAdminGenerationStyleStatus(style.id, nextStatus);
                    message.success(translate("administration.styleStatusUpdated"));
                    await loadStyles(page);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : translate("administration.failedToUpdateStyleStatus"));
                }
            },
        });
    };

    const deleteStyles = (ids: number[]) => {
        modal.confirm({
            title: translate("administration.deleteStyle"),
            content: translate("administration.theseStylesWillNoLongerBeAvailableForNew"),
            okText: translate("administration.delete"),
            okButtonProps: { danger: true },
            cancelText: translate("administration.cancel"),
            onOk: async () => {
                try {
                    await deleteAdminGenerationStyles(ids);
                    message.success(translate("administration.styleDeleted"));
                    setSelectedRowKeys([]);
                    const nextPage = styles.length <= ids.length && page > 1 ? page - 1 : page;
                    setPage(nextPage);
                    await loadStyles(nextPage);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : translate("administration.failedToDeleteStyle"));
                }
            },
        });
    };

    const uploadCover = async (file: File | undefined) => {
        if (!file) return;
        if (!file.type.startsWith("image/")) {
            message.error(translate("administration.selectAnImageFile"));
            return;
        }
        setCoverUploading(true);
        try {
            const uploaded = await uploadImage(file);
            form.setFieldValue("coverUrl", uploaded.url);
            message.success(translate("administration.coverUploaded"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("administration.failedToUploadCover"));
        } finally {
            setCoverUploading(false);
        }
    };

    return (
        <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <Space wrap>
                    <Input.Search
                        value={keyword}
                        allowClear
                        placeholder={translate("administration.searchNameCategoryOrPrompt")}
                        onChange={(event) => setKeyword(event.target.value)}
                        onSearch={() => {
                            setPage(1);
                            void loadStyles(1);
                        }}
                    />
                    <Select
                        value={generationType}
                        options={[
                            { label: translate("administration.allTypes"), value: "all" },
                            { label: translate("administration.image"), value: "image" },
                            { label: translate("administration.video"), value: "video" },
                        ]}
                        onChange={(value) => {
                            setGenerationType(value);
                            setPage(1);
                        }}
                    />
                    <Select
                        allowClear
                        placeholder={translate("administration.allStatuses")}
                        value={status}
                        options={[
                            { label: translate("administration.enable"), value: 1 },
                            { label: translate("administration.disable_4e6fd0"), value: 0 },
                        ]}
                        onChange={(value) => {
                            setStatus(value);
                            setPage(1);
                        }}
                    />
                </Space>
                <Space>
                    {selectedRowKeys.length ? (
                        <Button danger icon={<Trash2 className="size-3.5" />} onClick={() => deleteStyles(selectedRowKeys.map(Number))}>
                            {translate("administration.deleteSelected")}</Button>
                    ) : null}
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>
                        {translate("administration.addStyle")}</Button>
                </Space>
            </div>
            {loading ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {Array.from({ length: 10 }, (_, index) => (
                        <Skeleton.Image key={index} active className="!h-auto !w-full [&_.ant-skeleton-image]:aspect-[3/4] [&_.ant-skeleton-image]:h-auto [&_.ant-skeleton-image]:w-full" />
                    ))}
                </div>
            ) : styles.length ? (
                <>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                        {styles.map((style) => {
                            const selected = selectedRowKeys.includes(style.id);
                            return (
                                <article
                                    key={style.id}
                                    className={`group relative overflow-hidden rounded-md border bg-[var(--studio-surface)] transition ${selected ? "border-[var(--studio-action)] ring-1 ring-[var(--studio-action)]" : "border-[var(--studio-line)] hover:border-[var(--studio-line-strong)]"}`}
                                >
                                    <div className="relative aspect-[3/4] overflow-hidden bg-[var(--studio-surface-raised)]">
                                        <GenerationStyleCover key={style.coverUrl} style={style} className="size-full transition duration-200 group-hover:scale-[1.02] motion-reduce:transform-none" />
                                        <span className="absolute left-2 top-2">
                                            <Checkbox
                                                checked={selected}
                                                aria-label={translate("administration.selectStyle", { value0: style.name })}
                                                onChange={(event) => setSelectedRowKeys((current) => (event.target.checked ? [...new Set([...current, style.id])] : current.filter((id) => id !== style.id)))}
                                            />
                                        </span>
                                        <span
                                            className={`absolute right-2 top-2 rounded-sm border px-1.5 py-0.5 text-[11px] ${style.status === 1 ? "border-[var(--studio-success)] text-[var(--studio-success)]" : "border-[var(--studio-line-strong)] text-[var(--studio-muted)]"}`}
                                        >
                                            {style.status === 1 ? translate("administration.enable") : translate("administration.disable_4e6fd0")}
                                        </span>
                                        <span className="absolute bottom-2 left-2 rounded-sm bg-[var(--studio-surface)] px-1.5 py-0.5 text-[11px] text-[var(--studio-muted)]">{style.generationType === "video" ? translate("administration.video") : translate("administration.image")}</span>
                                    </div>
                                    <div className="min-w-0 border-t border-[var(--studio-line)] p-2.5">
                                        <div className="flex min-w-0 items-center justify-between gap-2">
                                            <span className="truncate text-sm font-medium text-[var(--studio-ink)]" title={style.name}>
                                                {style.name}
                                            </span>
                                            <span className="shrink-0 text-[11px] text-[var(--studio-muted)]">#{style.sortOrder}</span>
                                        </div>
                                        <p className="mt-1 truncate text-xs text-[var(--studio-muted)]">{style.category || translate("administration.uncategorized")}</p>
                                        <div className="mt-2 flex items-center justify-end gap-1">
                                            <Tooltip title={translate("administration.edit")}>
                                                <Button type="text" size="small" shape="circle" icon={<Edit className="size-3.5" />} onClick={() => openEdit(style)} aria-label={translate("administration.editStyle", { value0: style.name })} />
                                            </Tooltip>
                                            <Tooltip title={style.status === 1 ? translate("administration.disable_4e6fd0") : translate("administration.enable")}>
                                                <Button type="text" size="small" shape="circle" icon={<Power className="size-3.5" />} onClick={() => changeStatus(style)} aria-label={translate("administration.style", { value0: style.status === 1 ? translate("administration.disable_4e6fd0") : translate("administration.enable"), value1: style.name })} />
                                            </Tooltip>
                                        </div>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                    <div className="mt-5 flex justify-end">
                        <Pagination current={page} pageSize={PAGE_SIZE} total={total} showSizeChanger={false} onChange={setPage} />
                    </div>
                </>
            ) : (
                <Empty description={translate("administration.noStyles")} className="border border-dashed border-[var(--studio-line)] py-12" />
            )}
            <Modal title={editingStyle ? translate("administration.editStyle_1fa17d") : translate("administration.addStyle")} open={editOpen} onOk={saveStyle} onCancel={() => setEditOpen(false)} okText={translate("administration.save")} cancelText={translate("administration.cancel")} confirmLoading={coverUploading}>
                <Form form={form} layout="vertical">
                    <Form.Item name="name" label={translate("administration.styleName")} rules={[{ required: true, message: translate("administration.enterStyleName") }]}>
                        <Input placeholder={translate("administration.eGCinematic")} />
                    </Form.Item>
                    <Form.Item name="category" label={translate("administration.category")} rules={[{ required: true, message: translate("administration.enterStyleCategory") }]}>
                        <Input placeholder={translate("administration.eGPortraitChineseStyleCinematic")} maxLength={100} />
                    </Form.Item>
                    <Form.Item name="coverUrl" label={translate("administration.cover")} rules={[{ required: true, message: translate("administration.uploadOrEnterStyleCover") }]}>
                        <Input placeholder="https://..." />
                    </Form.Item>
                    <div className="mb-4 flex items-start gap-3">
                        <div className="h-28 w-[84px] shrink-0 overflow-hidden rounded-md border border-[var(--studio-line)] bg-[var(--studio-surface-raised)]">
                            <GenerationStyleCover key={coverUrl} style={{ name: coverName, coverUrl }} className="size-full" />
                        </div>
                        <div className="min-w-0">
                            <input
                                ref={coverInputRef}
                                hidden
                                type="file"
                                accept="image/*"
                                onChange={(event) => {
                                    void uploadCover(event.target.files?.[0]);
                                    event.target.value = "";
                                }}
                            />
                            <Button icon={<Upload className="size-3.5" />} loading={coverUploading} onClick={() => coverInputRef.current?.click()}>
                                {translate("administration.uploadCover")}</Button>
                            <p className="mt-2 text-xs text-[var(--studio-muted)]">{translate("administration.thePublicStorageURLWillBeSaved")}</p>
                        </div>
                    </div>
                    <Form.Item name="stylePrompt" label={translate("administration.stylePrompt")} rules={[{ required: true, message: translate("administration.enterStylePrompt") }]}>
                        <Input.TextArea rows={6} placeholder={translate("administration.describeStyleFeaturesToAddToThePrompt")} />
                    </Form.Item>
                    <div className="grid grid-cols-3 gap-3">
                        <Form.Item name="generationType" label={translate("administration.type")} rules={[{ required: true, message: translate("administration.selectAType") }]}>
                            <Select
                                options={[
                                    { label: translate("administration.image"), value: "image" },
                                    { label: translate("administration.video"), value: "video" },
                                ]}
                            />
                        </Form.Item>
                        <Form.Item name="sortOrder" label={translate("administration.sort")}>
                            <InputNumber className="w-full" min={0} />
                        </Form.Item>
                        <Form.Item name="status" label={translate("administration.status")}>
                            <Select
                                options={[
                                    { label: translate("administration.enable"), value: 1 },
                                    { label: translate("administration.disable_4e6fd0"), value: 0 },
                                ]}
                            />
                        </Form.Item>
                    </div>
                </Form>
            </Modal>
        </div>
    );
}

function splitTags(value?: string) {
    if (!value) return [];
    return value
        .split(/[,，]/)
        .map((item) => item.trim())
        .filter(Boolean);
}

type SkillFormValues = {
    name: string;
    targetType: "image" | "video" | "canvasSettingGraph";
    description?: string;
    systemPrompt: string;
    aspectRatio?: string;
    coverUrl?: string;
    sortOrder?: number;
    status?: number;
};

function SkillManagement() {
    const translate = useTranslation();
    const { message, modal } = App.useApp();
    const [form] = Form.useForm<SkillFormValues>();
    const [skills, setSkills] = useState<ServerSkill[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [keyword, setKeyword] = useState("");
    const [targetType, setTargetType] = useState<"all" | "image" | "video" | "canvasSettingGraph">("all");
    const [status, setStatus] = useState<number | undefined>();
    const [loading, setLoading] = useState(false);
    const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
    const [editOpen, setEditOpen] = useState(false);
    const [editingSkill, setEditingSkill] = useState<ServerSkill | null>(null);
    const [coverUploading, setCoverUploading] = useState(false);
    const coverInputRef = useRef<HTMLInputElement>(null);
    const coverUrl = Form.useWatch("coverUrl", form) || "";
    const coverName = Form.useWatch("name", form) || translate("administration.skillCover");

    const loadSkills = useCallback(
        async (nextPage = page) => {
            setLoading(true);
            try {
                const result = await listAdminSkills({
                    page: nextPage,
                    pageSize: PAGE_SIZE,
                    keyword: keyword || undefined,
                    targetType,
                    status,
                });
                setSkills(result.skills);
                setTotal(result.total);
                setSelectedRowKeys((current) => current.filter((id) => result.skills.some((skill) => skill.id === Number(id))));
            } catch (error) {
                message.error(error instanceof Error ? error.message : translate("administration.failedToLoadSkills"));
            } finally {
                setLoading(false);
            }
        },
        [keyword, message, page, status, targetType],
    );

    useEffect(() => {
        void loadSkills(page);
    }, [loadSkills, page]);

    const openCreate = () => {
        setEditingSkill(null);
        form.setFieldsValue({ name: "", targetType: "image", description: "", systemPrompt: "", aspectRatio: "16:9", coverUrl: "", sortOrder: 1000, status: 1 });
        setEditOpen(true);
    };

    const openEdit = (skill: ServerSkill) => {
        setEditingSkill(skill);
        form.setFieldsValue({
            name: skill.name,
            targetType: skill.targetType,
            description: skill.description || "",
            systemPrompt: skill.systemPrompt,
            aspectRatio: skill.aspectRatio || "16:9",
            coverUrl: skill.coverUrl || "",
            sortOrder: skill.sortOrder ?? 1000,
            status: skill.status ?? 1,
        });
        setEditOpen(true);
    };

    const saveSkill = async () => {
        try {
            const values = await form.validateFields();
            const input = {
                name: values.name.trim(),
                targetType: values.targetType,
                description: (values.description || "").trim(),
                systemPrompt: values.systemPrompt.trim(),
                aspectRatio: values.aspectRatio || "16:9",
                coverUrl: (values.coverUrl || "").trim(),
                sortOrder: values.sortOrder ?? 1000,
                status: values.status ?? 1,
            };
            if (editingSkill) {
                await updateAdminSkill({ id: editingSkill.id, ...input });
                message.success(translate("administration.skillUpdated"));
            } else {
                await createAdminSkill(input);
                message.success(translate("administration.skillCreated"));
            }
            setEditOpen(false);
            await loadSkills(editingSkill ? page : 1);
            if (!editingSkill) setPage(1);
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        }
    };

    const uploadCover = async (file: File | undefined) => {
        if (!file) return;
        if (!file.type.startsWith("image/")) {
            message.error(translate("administration.selectAnImageFile"));
            return;
        }
        setCoverUploading(true);
        try {
            const uploaded = await uploadImage(file);
            form.setFieldValue("coverUrl", uploaded.url);
            message.success(translate("administration.coverUploaded"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("administration.failedToUploadCover"));
        } finally {
            setCoverUploading(false);
        }
    };

    const changeStatus = (skill: ServerSkill) => {
        const nextStatus = skill.status === 1 ? 0 : 1;
        modal.confirm({
            title: nextStatus === 1 ? translate("administration.enableSkill") : translate("administration.disableSkill"),
            content: nextStatus === 1 ? translate("administration.enabledSkillsAreAvailableInImageAndVideoDialogs") : translate("administration.disabledSkillsAreUnavailableToUsers"),
            okText: nextStatus === 1 ? translate("administration.enable") : translate("administration.disable_4e6fd0"),
            cancelText: translate("administration.cancel"),
            onOk: async () => {
                try {
                    await updateAdminSkillStatus(skill.id, nextStatus);
                    message.success(translate("administration.skillStatusUpdated"));
                    await loadSkills(page);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : translate("administration.failedToUpdateSkillStatus"));
                }
            },
        });
    };

    const deleteSkills = (ids: number[]) => {
        modal.confirm({
            title: translate("administration.deleteSkill"),
            content: translate("administration.usersWillNoLongerBeAbleToSelectThese"),
            okText: translate("administration.delete"),
            okButtonProps: { danger: true },
            cancelText: translate("administration.cancel"),
            onOk: async () => {
                try {
                    await deleteAdminSkills(ids);
                    message.success(translate("administration.skillDeleted"));
                    setSelectedRowKeys([]);
                    const nextPage = skills.length <= ids.length && page > 1 ? page - 1 : page;
                    setPage(nextPage);
                    await loadSkills(nextPage);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : translate("administration.failedToDeleteSkill"));
                }
            },
        });
    };

    const columns: ColumnsType<ServerSkill> = [
        {
            title: translate("administration.skillName"),
            dataIndex: "name",
            render: (name: string, skill) => (
                <div className="flex min-w-0 items-center gap-2">
                    <Sparkles className="size-3.5 shrink-0 text-[var(--studio-action)]" />
                    <span className="truncate font-medium text-[var(--studio-ink)]" title={name}>
                        {name}
                    </span>
                </div>
            ),
        },
        {
            title: translate("administration.type"),
            dataIndex: "targetType",
            width: 110,
            render: (value: string) => <Tag>{value === "video" ? translate("administration.video") : translate("administration.image")}</Tag>,
        },
        {
            title: translate("administration.introduction"),
            dataIndex: "description",
            ellipsis: true,
            render: (description: string) => (description ? <span className="text-[var(--studio-muted)]">{description}</span> : <span className="text-[var(--studio-faint)]">—</span>),
        },
        {
            title: translate("administration.defaultAspectRatio"),
            dataIndex: "aspectRatio",
            width: 100,
            render: (value: string) => <span className="tabular-nums text-[var(--studio-muted)]">{value || "16:9"}</span>,
        },
        {
            title: translate("administration.status"),
            dataIndex: "status",
            width: 80,
            render: (value: number) =>
                value === 1 ? (
                    <span className="text-[var(--studio-success)]">{translate("administration.enable")}</span>
                ) : (
                    <span className="text-[var(--studio-muted)]">{translate("administration.disable_4e6fd0")}</span>
                ),
        },
        {
            title: translate("administration.sort"),
            dataIndex: "sortOrder",
            width: 80,
            render: (value: number) => <span className="tabular-nums text-[var(--studio-muted)]">{value}</span>,
        },
        {
            title: translate("administration.actions"),
            key: "actions",
            width: 110,
            render: (_, skill) => (
                <Space size={0}>
                    <Tooltip title={translate("administration.edit")}>
                        <Button type="text" size="small" shape="circle" icon={<Edit className="size-3.5" />} onClick={() => openEdit(skill)} aria-label={translate("administration.editSkill", { value0: skill.name })} />
                    </Tooltip>
                    <Tooltip title={skill.status === 1 ? translate("administration.disable_4e6fd0") : translate("administration.enable")}>
                        <Button type="text" size="small" shape="circle" icon={<Power className="size-3.5" />} onClick={() => changeStatus(skill)} aria-label={translate("administration.skill", { value0: skill.status === 1 ? translate("administration.disable_4e6fd0") : translate("administration.enable"), value1: skill.name })} />
                    </Tooltip>
                </Space>
            ),
        },
    ];

    return (
        <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <Space wrap>
                    <Input.Search
                        value={keyword}
                        allowClear
                        placeholder={translate("administration.searchSkillNameOrDescription")}
                        onChange={(event) => setKeyword(event.target.value)}
                        onSearch={() => {
                            setPage(1);
                            void loadSkills(1);
                        }}
                    />
                    <Select
                        value={targetType}
                        options={[
                            { label: translate("administration.allTypes"), value: "all" },
                            { label: translate("administration.image"), value: "image" },
                            { label: translate("administration.video"), value: "video" },
                            { label: translate("administration.canvasReferenceSheet"), value: "canvasSettingGraph" },
                        ]}
                        onChange={(value) => {
                            setTargetType(value);
                            setPage(1);
                        }}
                    />
                    <Select
                        allowClear
                        placeholder={translate("administration.allStatuses")}
                        value={status}
                        options={[
                            { label: translate("administration.enable"), value: 1 },
                            { label: translate("administration.disable_4e6fd0"), value: 0 },
                        ]}
                        onChange={(value) => {
                            setStatus(value);
                            setPage(1);
                        }}
                    />
                </Space>
                <Space>
                    {selectedRowKeys.length ? (
                        <Button danger icon={<Trash2 className="size-3.5" />} onClick={() => deleteSkills(selectedRowKeys.map(Number))}>
                            {translate("administration.deleteSelected")}</Button>
                    ) : null}
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>
                        {translate("administration.addSkill")}</Button>
                </Space>
            </div>
            <Table<ServerSkill>
                rowKey="id"
                columns={columns}
                dataSource={skills}
                loading={loading}
                pagination={{
                    current: page,
                    pageSize: PAGE_SIZE,
                    total,
                    showSizeChanger: false,
                    onChange: setPage,
                }}
                rowSelection={{
                    selectedRowKeys,
                    onChange: setSelectedRowKeys,
                }}
                locale={{ emptyText: <Empty description={translate("administration.noSkills")} /> }}
            />
            <Modal title={editingSkill ? translate("administration.editSkill_149fb4") : translate("administration.addSkill")} open={editOpen} onOk={saveSkill} onCancel={() => setEditOpen(false)} okText={translate("administration.save")} cancelText={translate("administration.cancel")} width={640} confirmLoading={coverUploading}>
                <Form form={form} layout="vertical">
                    <div className="grid grid-cols-3 gap-3">
                        <Form.Item name="name" label={translate("administration.skillName")} rules={[{ required: true, message: translate("administration.enterSkillName") }]} className="col-span-2">
                            <Input placeholder={translate("administration.eGECommerceProductImages")} maxLength={100} />
                        </Form.Item>
                        <Form.Item name="targetType" label={translate("administration.targetType")} rules={[{ required: true, message: translate("administration.selectAType") }]}>
                            <Select
                                options={[
                                    { label: translate("administration.image"), value: "image" },
                                    { label: translate("administration.video"), value: "video" },
                                    { label: translate("administration.canvasReferenceSheet"), value: "canvasSettingGraph" },
                                ]}
                            />
                        </Form.Item>
                    </div>
                    <Form.Item name="description" label={translate("administration.skillIntroduction")}>
                        <Input.TextArea rows={2} maxLength={500} placeholder={translate("administration.introductionShownInTheSkillSelector")} />
                    </Form.Item>
                    <Form.Item name="coverUrl" label={translate("administration.cover")}>
                        <Input placeholder={translate("administration.httpsOptional")} />
                    </Form.Item>
                    <Form.Item name="aspectRatio" label={translate("administration.defaultAspectRatio")} rules={[{ required: true, message: translate("administration.selectDefaultAspectRatio") }]}>
                        <Select
                            options={[
                                { label: translate("administration.169Landscape"), value: "16:9" },
                                { label: translate("administration.916Portrait"), value: "9:16" },
                                { label: translate("administration.11Square"), value: "1:1" },
                                { label: "4:3", value: "4:3" },
                                { label: "3:4", value: "3:4" },
                            ]}
                        />
                    </Form.Item>
                    <div className="mb-4 flex items-start gap-3">
                        <div className="h-28 w-[84px] shrink-0 overflow-hidden rounded-md border border-[var(--studio-line)] bg-[var(--studio-surface-raised)]">
                            <GenerationStyleCover key={coverUrl} style={{ name: coverName, coverUrl }} className="size-full" />
                        </div>
                        <div className="min-w-0">
                            <input
                                ref={coverInputRef}
                                hidden
                                type="file"
                                accept="image/*"
                                onChange={(event) => {
                                    void uploadCover(event.target.files?.[0]);
                                    event.target.value = "";
                                }}
                            />
                            <Button icon={<Upload className="size-3.5" />} loading={coverUploading} onClick={() => coverInputRef.current?.click()}>
                                {translate("administration.uploadCover")}</Button>
                            <p className="mt-2 text-xs text-[var(--studio-muted)]">{translate("administration.publicStorageURLIsSavedAndShownInThe")}</p>
                        </div>
                    </div>
                    <Form.Item name="systemPrompt" label={translate("administration.workflowPrompt")} rules={[{ required: true, message: translate("administration.enterWorkflowPrompt") }]}>
                        <Input.TextArea
                            rows={12}
                            placeholder={translate("administration.builtInGenerationInstructionsGuideAgentStepByStep")}
                        />
                    </Form.Item>
                    <div className="grid grid-cols-3 gap-3">
                        <Form.Item name="sortOrder" label={translate("administration.sort")}>
                            <InputNumber className="w-full" min={0} />
                        </Form.Item>
                        <Form.Item name="status" label={translate("administration.status")}>
                            <Select
                                options={[
                                    { label: translate("administration.enable"), value: 1 },
                                    { label: translate("administration.disable_4e6fd0"), value: 0 },
                                ]}
                            />
                        </Form.Item>
                    </div>
                </Form>
            </Modal>
        </div>
    );
}

function HomepageShowcaseManagement() {
    const translate = useTranslation();
    const { message, modal } = App.useApp();
    const [items, setItems] = useState<HomepageShowcase[]>([]);
    const [loading, setLoading] = useState(false);
    const [editing, setEditing] = useState<HomepageShowcase | null>(null);
    const [open, setOpen] = useState(false);
    const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
    const [form] = Form.useForm();
    const previewMediaType = Form.useWatch("mediaType", form);
    const previewMediaUrl = Form.useWatch("mediaUrl", form);
    const previewThumbnailUrl = Form.useWatch("thumbnailUrl", form);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const result = await listAdminHomepageShowcases();
            setItems(result.items || []);
            setSelectedRowKeys((current) => current.filter((key) => result.items.some((item) => item.id === Number(key))));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("administration.failedToLoadShowcases"));
        } finally {
            setLoading(false);
        }
    }, [message]);

    useEffect(() => {
        void load();
    }, [load]);

    const openCreate = () => {
        setEditing(null);
        form.resetFields();
        form.setFieldsValue({ category: "视觉海报", creatorName: "Novanova Studio", mediaType: "image", targetType: "image", status: 1, sortOrder: 1000 });
        setOpen(true);
    };

    const openEdit = (item: HomepageShowcase) => {
        setEditing(item);
        form.setFieldsValue(item);
        setOpen(true);
    };

    const save = async () => {
        try {
            const values = await form.validateFields();
            const input = {
                title: values.title.trim(),
                description: values.description?.trim() || "",
                category: values.category.trim(),
                creatorName: values.creatorName.trim(),
                mediaType: values.mediaType,
                mediaUrl: values.mediaUrl.trim(),
                thumbnailUrl: values.thumbnailUrl?.trim() || "",
                targetType: values.targetType,
                targetPath: values.targetPath?.trim() || getHomepageTargetPath(values.targetType),
                promptContent: values.promptContent?.trim() || "",
                sortOrder: values.sortOrder ?? 1000,
                status: values.status ?? 1,
            };
            if (editing) {
                await updateAdminHomepageShowcase({ id: editing.id, ...input });
                message.success(translate("administration.showcaseUpdated"));
            } else {
                await createAdminHomepageShowcase(input);
                message.success(translate("administration.showcaseCreated"));
            }
            setOpen(false);
            await load();
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        }
    };

    const toggleStatus = (item: HomepageShowcase) => {
        const nextStatus = item.status === 1 ? 0 : 1;
        modal.confirm({
            title: nextStatus === 1 ? translate("administration.enableShowcase") : translate("administration.disableShowcase"),
            content: nextStatus === 1 ? translate("administration.enabledContentAppearsInTheHomepageGallery") : translate("administration.disabledContentIsHiddenFromTheHomepage"),
            okText: nextStatus === 1 ? translate("administration.enable") : translate("administration.disable_4e6fd0"),
            cancelText: translate("administration.cancel"),
            onOk: async () => {
                await updateAdminHomepageShowcaseStatus(item.id, nextStatus);
                await load();
                message.success(translate("administration.showcaseStatusUpdated"));
            },
        });
    };

    const remove = (ids: number[]) => {
        modal.confirm({
            title: translate("administration.deleteShowcase"),
            content: translate("administration.theseItemsWillDisappearFromTheHomepageContinue"),
            okText: translate("administration.delete"),
            okButtonProps: { danger: true },
            cancelText: translate("administration.cancel"),
            onOk: async () => {
                await deleteAdminHomepageShowcases(ids);
                setSelectedRowKeys([]);
                await load();
                message.success(translate("administration.showcaseDeleted"));
            },
        });
    };

    const columns: ColumnsType<HomepageShowcase> = [
        {
            title: translate("administration.preview"),
            width: 100,
            render: (_, item) =>
                item.mediaType === "video" ? <video src={item.mediaUrl} poster={item.thumbnailUrl || undefined} muted className="h-14 w-20 object-cover" /> : <img src={item.mediaUrl} alt={item.title} className="h-14 w-20 object-cover" />,
        },
        {
            title: translate("administration.title"),
            dataIndex: "title",
            render: (value: string, item) => (
                <div>
                    <div className="studio-title font-medium">{value}</div>
                    <div className="studio-caption mt-1 text-xs">{item.description || translate("administration.noDescription")}</div>
                </div>
            ),
        },
        { title: translate("administration.category"), dataIndex: "category", width: 110, render: (value: string) => <Tag>{value}</Tag> },
        { title: translate("administration.creator"), dataIndex: "creatorName", width: 140, ellipsis: true },
        { title: translate("administration.media"), dataIndex: "mediaType", width: 100, render: (value: HomepageShowcase["mediaType"]) => <Tag icon={value === "video" ? <Video className="size-3" /> : <ImageIcon className="size-3" />}>{value === "video" ? translate("administration.video") : translate("administration.image")}</Tag> },
        { title: translate("administration.entry"), dataIndex: "targetType", width: 100, render: (value: string) => (value === "canvas" ? translate("administration.canvas") : value === "asset" ? translate("administration.assets") : value === "video" ? translate("administration.video") : translate("administration.image")) },
        { title: translate("administration.sort"), dataIndex: "sortOrder", width: 80 },
        { title: translate("administration.status"), dataIndex: "status", width: 90, render: (value: number) => <Tag color={value === 1 ? "green" : "default"}>{value === 1 ? translate("administration.enable") : translate("administration.disable_4e6fd0")}</Tag> },
        { title: translate("administration.updatedAt"), dataIndex: "updatedAt", width: 180, render: (value: string) => (value ? new Date(value).toLocaleString(currentLanguageTag()) : "-") },
        {
            title: translate("administration.actions"),
            key: "actions",
            width: 190,
            render: (_, item) => (
                <Space>
                    <Button size="small" icon={<Edit className="size-3.5" />} onClick={() => openEdit(item)}>
                        {translate("administration.edit")}</Button>
                    <Button size="small" icon={<Power className="size-3.5" />} onClick={() => toggleStatus(item)}>
                        {item.status === 1 ? translate("administration.disable_4e6fd0") : translate("administration.enable")}
                    </Button>
                    <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => remove([item.id])}>
                        {translate("administration.delete")}</Button>
                </Space>
            ),
        },
    ];

    return (
        <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <span className="studio-subtitle text-sm">{translate("administration.manageHomepageArtworkBuiltInSamplesAppearWhenEmpty")}</span>
                <Space>
                    <Button danger disabled={!selectedRowKeys.length} icon={<Trash2 className="size-4" />} onClick={() => remove(selectedRowKeys.map(Number))}>
                        {translate("administration.deleteSelected")}</Button>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>
                        {translate("administration.addShowcase")}</Button>
                </Space>
            </div>
            <Table rowKey="id" rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }} loading={loading} columns={columns} dataSource={items} pagination={false} locale={{ emptyText: translate("administration.noShowcases") }} />
            <Modal title={editing ? translate("administration.editHomepageShowcase") : translate("administration.addHomepageShowcase")} open={open} onOk={() => void save()} onCancel={() => setOpen(false)} okText={translate("administration.save")} cancelText={translate("administration.cancel")} width={720} destroyOnHidden>
                <Form form={form} layout="vertical" className="mt-3">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Form.Item name="title" label={translate("administration.title")} rules={[{ required: true, message: translate("administration.enterATitle") }]}>
                            <Input placeholder={translate("administration.eGArchitecturalCompositionAtNight")} />
                        </Form.Item>
                        <Form.Item name="description" label={translate("administration.description")}>
                            <Input placeholder={translate("administration.shortDescriptionForHomepageGallery")} />
                        </Form.Item>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Form.Item name="category" label={translate("administration.category")} rules={[{ required: true, message: translate("administration.enterArtworkCategory") }]}>
                            <Input placeholder={translate("administration.eGVisualPoster")} maxLength={50} />
                        </Form.Item>
                        <Form.Item name="creatorName" label={translate("administration.creator")} rules={[{ required: true, message: translate("administration.enterCreatorName") }]}>
                            <Input placeholder={translate("administration.eGNovanovaStudio")} maxLength={100} />
                        </Form.Item>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Form.Item name="mediaType" label={translate("administration.mediaType")} rules={[{ required: true }]}>
                            <Select
                                options={[
                                    { label: translate("administration.image"), value: "image" },
                                    { label: translate("administration.video"), value: "video" },
                                ]}
                            />
                        </Form.Item>
                        <Form.Item name="targetType" label={translate("administration.targetEntry")} rules={[{ required: true }]}>
                            <Select
                                options={[
                                    { label: translate("administration.imageWorkspace"), value: "image" },
                                    { label: translate("administration.videoWorkspace"), value: "video" },
                                    { label: translate("administration.infiniteCanvas"), value: "canvas" },
                                    { label: translate("administration.assetLibrary"), value: "asset" },
                                ]}
                            />
                        </Form.Item>
                    </div>
                    <Form.Item name="mediaUrl" label={translate("administration.mediaURL")} rules={[{ required: true, type: "url", message: translate("administration.enterAValidMediaURL") }]}>
                        <Input placeholder="https://..." />
                    </Form.Item>
                    <Form.Item name="thumbnailUrl" label={translate("administration.videoThumbnailURL")} rules={[{ type: "url", message: translate("administration.enterAValidURL") }]}>
                        <Input placeholder={translate("administration.optionalForVideoLeaveEmptyForImages")} />
                    </Form.Item>
                    {previewMediaUrl ? (
                        <div className="mb-4 overflow-hidden rounded-[8px] border border-[var(--studio-line)] bg-[var(--studio-media)]">
                            {previewMediaType === "video" ? (
                                <video src={previewMediaUrl} poster={previewThumbnailUrl || undefined} muted controls className="mx-auto max-h-64 w-full object-contain" />
                            ) : (
                                <img src={previewMediaUrl} alt={translate("administration.showcasePreview")} className="mx-auto max-h-64 w-full object-contain" />
                            )}
                        </div>
                    ) : null}
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Form.Item name="targetPath" label={translate("administration.targetPath")}>
                            <Input placeholder={translate("administration.generatedFromTargetEntryEGImage")} />
                        </Form.Item>
                        <Form.Item name="sortOrder" label={translate("administration.sort")}>
                            <InputNumber className="w-full" min={0} precision={0} />
                        </Form.Item>
                    </div>
                    <Form.Item name="promptContent" label={translate("administration.linkPrompt")}>
                        <Input.TextArea rows={3} placeholder={translate("administration.promptUsedWhenOpeningTheArtwork")} />
                    </Form.Item>
                    <Form.Item name="status" label={translate("administration.status")}>
                        <Select
                            options={[
                                { label: translate("administration.enable"), value: 1 },
                                { label: translate("administration.disable_4e6fd0"), value: 0 },
                            ]}
                        />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
}
