"use client";

import { type Key, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import dayjs, { type Dayjs } from "dayjs";
import { useQuery } from "@tanstack/react-query";
import { Alert, App, Button, DatePicker, Empty, Form, Input, InputNumber, Modal, Pagination, Segmented, Select, Skeleton, Space, Table, Tabs, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Edit, Image as ImageIcon, Plus, Power, Search, Send, Trash2, Upload, Video } from "lucide-react";

import {
    adjustServerUserCredits,
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
    type SystemNotification,
} from "@/services/api/server";
import { useUserStore, type ServerUserProfile, type ServerUserRole } from "@/features/auth/stores/use-user-store";
import { getHomepageTargetPath } from "@/features/homepage/api/homepage-showcases";
import { adminCreditFilterKey, adminCreditUserLabel } from "./admin-credit-utils";
import {
    CREDIT_TRANSACTION_PAGE_SIZE,
    formatCredits,
    formatCreditTime,
    generationSourceLabel,
    generationTypeLabel,
    normalizeGenerationDistribution,
    normalizeModelDistribution,
} from "@/app/(user)/credits/credit-page-utils";

const PAGE_SIZE = 20;

const CreditChart = dynamic(() => import("@/app/(user)/credits/components/credit-chart").then((module) => module.CreditChart), {
    ssr: false,
    loading: () => <Skeleton active className="px-5 py-6" paragraph={{ rows: 7 }} />,
});

type GenerationTypeFilter = "all" | "image" | "video";
type TrendUnit = "day" | "month";

export default function AdminSystemPage() {
    const { message, modal } = App.useApp();
    const currentUser = useUserStore((state) => state.user);
    const isAdmin = currentUser?.role === "admin";

    if (!isAdmin) {
        return (
            <main className="studio-page h-full overflow-auto">
                <div className="mx-auto flex min-h-[420px] max-w-4xl flex-col items-center justify-center px-6 text-center">
                    <h1 className="studio-title text-2xl font-semibold">需要管理员权限</h1>
                    <p className="studio-subtitle mt-3 text-sm">当前账号无法访问系统管理。</p>
                </div>
            </main>
        );
    }

    return (
        <main className="studio-page h-full overflow-auto">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6">
                <header className="border-b border-[var(--studio-line)] pb-5">
                    <h1 className="studio-title text-2xl font-semibold">系统管理</h1>
                    <p className="studio-subtitle mt-2 text-sm">用户、公告和提示词库的运营控制台。</p>
                </header>
                <Tabs
                    defaultActiveKey="users"
                    items={[
                        { key: "users", label: "用户管理", children: <UserManagement /> },
                        { key: "credits", label: "积分消耗", children: <CreditConsumptionManagement /> },
                        { key: "notifications", label: "消息管理", children: <NotificationManagement /> },
                        { key: "prompts", label: "提示词库", children: <PromptManagement /> },
                        { key: "homepage", label: "首页展示", children: <HomepageShowcaseManagement /> },
                    ]}
                />
            </div>
        </main>
    );
}

const ADMIN_CREDIT_COLUMNS: ColumnsType<ServerAdminCreditTransaction> = [
    {
        title: "用户",
        width: 220,
        render: (_, transaction) => (
            <div className="min-w-0">
                <div className="truncate font-medium text-[var(--studio-ink)]">{adminCreditUserLabel(transaction)}</div>
                <div className="mt-0.5 truncate text-xs text-[var(--studio-muted)]">{transaction.email}</div>
            </div>
        ),
    },
    {
        title: "生成类型",
        dataIndex: "generationType",
        width: 132,
        render: (generationType: ServerAdminCreditTransaction["generationType"]) => {
            const Icon = generationType === "video" ? Video : ImageIcon;
            return <span className="inline-flex items-center gap-2 text-[var(--studio-text)]"><Icon className="size-4 text-[var(--studio-primary)]" />{generationTypeLabel(generationType)}</span>;
        },
    },
    {
        title: "模型",
        dataIndex: "model",
        width: 220,
        ellipsis: true,
        render: (model: string) => <span className="font-mono text-xs text-[var(--studio-text)]">{model}</span>,
    },
    {
        title: "来源",
        dataIndex: "generationSource",
        width: 128,
        render: (generationSource: ServerAdminCreditTransaction["generationSource"]) => <span className="text-[var(--studio-muted)]">{generationSourceLabel(generationSource)}</span>,
    },
    {
        title: "消耗积分",
        dataIndex: "consumedCredits",
        width: 128,
        align: "right",
        render: (consumedCredits: number) => <span className="font-medium tabular-nums text-[var(--studio-ink)]">-{formatCredits(consumedCredits)}</span>,
    },
    {
        title: "时间",
        dataIndex: "createdAt",
        width: 176,
        render: (createdAt: string) => <span className="tabular-nums text-[var(--studio-muted)]">{formatCreditTime(createdAt)}</span>,
    },
];

/**
 * 渲染管理员积分消耗统计与明细。
 *
 * @return 积分消耗管理内容
 */
function CreditConsumptionManagement() {
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
    }, [selectedUser, userQuery.data?.users]);
    const filters = useMemo(() => ({
        userId: selectedUser?.id,
        startDate: dateRange[0].format("YYYY-MM-DD"),
        endDate: dateRange[1].format("YYYY-MM-DD"),
        generationType: generationType === "all" ? undefined : generationType,
    }), [dateRange, generationType, selectedUser?.id]);
    const filterKey = adminCreditFilterKey(filters);
    const overviewQuery = useQuery({
        queryKey: ["admin-credit-overview", ...filterKey, trendUnit],
        queryFn: () => getAdminCreditOverview({ ...filters, trendUnit }),
    });
    const transactionsQuery = useQuery({
        queryKey: ["admin-credit-transactions", ...filterKey, page],
        queryFn: () => listAdminCreditTransactions({ ...filters, page, pageSize: CREDIT_TRANSACTION_PAGE_SIZE }),
    });

    const overview = overviewQuery.data;
    const transactions = transactionsQuery.data;
    const generationDistribution = useMemo(() => normalizeGenerationDistribution(overview?.generationTypeDistribution || []), [overview?.generationTypeDistribution]);
    const modelDistribution = useMemo(() => normalizeModelDistribution(overview?.modelDistribution || []), [overview?.modelDistribution]);
    const trend = useMemo(() => (overview?.trend || []).map((item) => ({ name: item.period, value: item.consumedCredits })), [overview?.trend]);
    const totalConsumed = trend.reduce((total, item) => total + item.value, 0);
    const hasError = overviewQuery.isError || transactionsQuery.isError;

    const resetPage = () => setPage(1);

    return (
        <div>
            <div className="flex flex-wrap items-center gap-3">
                <Select
                    className="w-72 max-w-full"
                    value={selectedUser?.id}
                    options={userOptions.map((user) => ({ value: user.id, label: adminCreditUserLabel(user) }))}
                    showSearch
                    allowClear
                    filterOption={false}
                    placeholder="全部用户（搜索昵称、用户名或邮箱）"
                    notFoundContent={userQuery.isFetching ? <Skeleton active paragraph={false} title={{ width: "70%" }} /> : "没有匹配用户"}
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
                        { label: "今日", value: [dayjs().startOf("day"), dayjs().endOf("day")] },
                        { label: "近7天", value: [dayjs().subtract(6, "day"), dayjs()] },
                        { label: "近30天", value: [dayjs().subtract(29, "day"), dayjs()] },
                        { label: "本月", value: [dayjs().startOf("month"), dayjs()] },
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
                        { label: "全部", value: "all" },
                        { label: "生图", value: "image" },
                        { label: "生视频", value: "video" },
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
                    message="积分数据加载失败"
                    action={<Button size="small" onClick={() => { void overviewQuery.refetch(); void transactionsQuery.refetch(); }}>重新加载</Button>}
                />
            ) : null}

            <section className="mt-6" aria-labelledby="admin-credit-statistics-title">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 id="admin-credit-statistics-title" className="text-base font-semibold text-[var(--studio-ink)]">消耗统计</h2>
                        <p className="mt-1 text-sm text-[var(--studio-muted)]">{selectedUser ? `${adminCreditUserLabel(selectedUser)}本期` : "全部用户本期"}共消耗 {formatCredits(totalConsumed)} 积分</p>
                    </div>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                    <CreditChartPanel title="生图与生视频消耗分布" loading={overviewQuery.isLoading} empty={!generationDistribution.length}>
                        <CreditChart type="pie" data={generationDistribution} ariaLabel="管理员生图与生视频积分消耗分布图" />
                    </CreditChartPanel>
                    <CreditChartPanel title="模型消耗分布" loading={overviewQuery.isLoading} empty={!modelDistribution.length}>
                        <CreditChart type="pie" data={modelDistribution} ariaLabel="管理员模型积分消耗分布图" />
                    </CreditChartPanel>
                    <CreditChartPanel
                        className="lg:col-span-2"
                        title="积分消耗趋势"
                        loading={overviewQuery.isLoading}
                        empty={!trend.some((item) => item.value > 0)}
                        extra={<Segmented value={trendUnit} size="small" options={[{ label: "按日", value: "day" }, { label: "按月", value: "month" }]} onChange={(value) => setTrendUnit(value as TrendUnit)} />}
                    >
                        <CreditChart type="bar" data={trend} ariaLabel="管理员积分消耗趋势柱状图" />
                    </CreditChartPanel>
                </div>
            </section>

            <section className="mt-8 border-t border-[var(--studio-line)] pt-6" aria-labelledby="admin-credit-transactions-title">
                <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h2 id="admin-credit-transactions-title" className="text-base font-semibold text-[var(--studio-ink)]">积分消耗明细</h2>
                        <p className="mt-1 text-sm text-[var(--studio-muted)]">{selectedUser ? `${adminCreditUserLabel(selectedUser)}最近使用的积分记录` : "所有用户最近使用的积分记录"}</p>
                    </div>
                    <span className="text-sm tabular-nums text-[var(--studio-muted)]">{transactions?.total || 0} 条记录</span>
                </div>
                <Table<ServerAdminCreditTransaction>
                    rowKey="id"
                    columns={ADMIN_CREDIT_COLUMNS}
                    dataSource={transactions?.transactions || []}
                    loading={transactionsQuery.isLoading}
                    pagination={false}
                    scroll={{ x: 1_100 }}
                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="所选范围没有积分消耗记录" /> }}
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
    return (
        <section className={`min-w-0 border border-[var(--studio-line)] bg-[var(--studio-surface)] p-4 md:p-5 ${className || ""}`}>
            <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-[var(--studio-ink)]">{title}</h3>
                {extra}
            </div>
            <div className="mt-2">
                {loading ? <Skeleton active className="py-5" paragraph={{ rows: 6 }} /> : null}
                {!loading && empty ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="所选范围暂无消耗数据" className="py-9" /> : null}
                {!loading && !empty ? children : null}
            </div>
        </section>
    );
}

function UserManagement() {
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
    const [newUserEmail, setNewUserEmail] = useState("");
    const [newUserPassword, setNewUserPassword] = useState("");
    const [newUserNickname, setNewUserNickname] = useState("");
    const [newUserRole, setNewUserRole] = useState<string>("user");
    const [creditUser, setCreditUser] = useState<ServerUserProfile | null>(null);
    const [creditChangeAmount, setCreditChangeAmount] = useState<number | null>(null);
    const [creditReason, setCreditReason] = useState("");
    const [creditSaving, setCreditSaving] = useState(false);

    const loadUsers = useCallback(
        async (nextPage = page) => {
            const normalizedUserId = userIdKeyword.trim();
            if (normalizedUserId && !/^[1-9]\d*$/.test(normalizedUserId)) {
                message.warning("请输入正整数用户ID");
                return;
            }
            setLoading(true);
            try {
                const result = await listServerUsers({
                    page: nextPage,
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
                message.error(error instanceof Error ? error.message : "查询用户失败");
            } finally {
                setLoading(false);
            }
        },
        [message, page, searchKeyword, userIdKeyword, filterRole, filterStatus, filterCreatedAfter, filterCreatedBefore],
    );

    useEffect(() => {
        void loadUsers(page);
    }, [loadUsers, page]);

    const handleSearch = () => {
        setPage(1);
        void loadUsers(1);
    };

    const handleCreateUser = async () => {
        if (!newUserEmail.trim() || !newUserPassword.trim()) {
            message.warning("请填写邮箱和密码");
            return;
        }
        try {
            await adminCreateUser({ email: newUserEmail.trim(), password: newUserPassword, nickname: newUserNickname.trim() || undefined, role: newUserRole });
            message.success("用户已创建");
            setCreateUserOpen(false);
            setNewUserEmail("");
            setNewUserPassword("");
            setNewUserNickname("");
            setNewUserRole("user");
            setPage(1);
            await loadUsers(1);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "创建用户失败");
        }
    };

    const updateStatus = async (user: ServerUserProfile, status: number) => {
        try {
            await updateServerUserStatus(user.id, status);
            message.success("用户状态已更新");
            await loadUsers(page);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新用户状态失败");
        }
    };

    const updateRole = async (user: ServerUserProfile, role: ServerUserRole) => {
        try {
            await updateServerUserRole(user.id, role);
            message.success("用户角色已更新");
            await loadUsers(page);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新用户角色失败");
        }
    };

    const openCreditAdjustment = (user: ServerUserProfile) => {
        setCreditUser(user);
        setCreditChangeAmount(null);
        setCreditReason("");
    };

    const saveCreditAdjustment = async () => {
        if (!creditUser || !creditChangeAmount || !creditReason.trim()) {
            message.warning("请填写非零积分变动值和调整原因");
            return;
        }
        setCreditSaving(true);
        try {
            await adjustServerUserCredits({ userId: creditUser.id, changeAmount: creditChangeAmount, reason: creditReason.trim() });
            message.success("用户积分已调整");
            setCreditUser(null);
            await loadUsers(page);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "调整用户积分失败");
        } finally {
            setCreditSaving(false);
        }
    };

    const unlockPassword = (user: ServerUserProfile) => {
        modal.confirm({
            title: "解除密码锁定",
            content: `确认解除“${user.nickname || user.email}”的密码锁定吗？`,
            okText: "解除锁定",
            cancelText: "取消",
            onOk: async () => {
                try {
                    await unlockServerUserPassword(user.id);
                    message.success("密码锁定已解除");
                    await loadUsers(page);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "解除密码锁定失败");
                }
            },
        });
    };

    const columns: ColumnsType<ServerUserProfile> = [
        {
            title: "用户ID",
            dataIndex: "id",
            width: 120,
            render: (value: number) => <span className="tabular-nums">{value}</span>,
        },
        {
            title: "用户",
            dataIndex: "email",
            render: (_, user) => (
                <div>
                    <div className="studio-title font-medium">{user.nickname || user.username || user.email}</div>
                    <div className="studio-caption mt-1 text-xs">{user.email}</div>
                </div>
            ),
        },
        {
            title: "角色",
            dataIndex: "role",
            width: 160,
            render: (_, user) => (
                <Select<ServerUserRole>
                    value={user.role}
                    options={[
                        { label: "普通用户", value: "user" },
                        { label: "管理员", value: "admin" },
                    ]}
                    onChange={(role) => void updateRole(user, role)}
                    className="w-28"
                />
            ),
        },
        {
            title: "状态",
            dataIndex: "status",
            width: 130,
            render: (status: number) => (status === 1 ? <Tag color="green">正常</Tag> : <Tag color="red">禁用</Tag>),
        },
        {
            title: "可用积分",
            dataIndex: "creditBalance",
            width: 120,
            render: (value: number) => <span className="font-medium tabular-nums">{value.toLocaleString()}</span>,
        },
        {
            title: "密码锁定",
            dataIndex: "passwordLockedUntil",
            width: 200,
            render: (value: string | null) => {
                const lockedUntil = value ? new Date(value) : null;
                if (!lockedUntil || Number.isNaN(lockedUntil.getTime()) || lockedUntil.getTime() <= Date.now()) {
                    return <Tag>未锁定</Tag>;
                }
                return <Tag color="orange">锁定至 {lockedUntil.toLocaleString()}</Tag>;
            },
        },
        {
            title: "创建时间",
            dataIndex: "createdAt",
            width: 180,
            render: (value: string) => (value ? new Date(value).toLocaleString() : "-"),
        },
        {
            title: "操作",
            width: 310,
            render: (_, user) => (
                <Space size="small">
                    <Button onClick={() => openCreditAdjustment(user)}>调整积分</Button>
                    {user.passwordLockedUntil && new Date(user.passwordLockedUntil).getTime() > Date.now() ? <Button onClick={() => unlockPassword(user)}>解除锁定</Button> : null}
                    {user.status === 1 ? (
                        <Button danger onClick={() => void updateStatus(user, 0)}>
                            禁用
                        </Button>
                    ) : (
                        <Button onClick={() => void updateStatus(user, 1)}>启用</Button>
                    )}
                </Space>
            ),
        },
    ];

    return (
        <div>
            <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <Input.Search
                        placeholder="搜索昵称、用户名或邮箱"
                        value={searchKeyword}
                        onChange={(e) => setSearchKeyword(e.target.value)}
                        onSearch={handleSearch}
                        className="max-w-64"
                        prefix={<Search className="size-3.5 text-[var(--studio-faint)]" />}
                        allowClear
                    />
                    <Input.Search
                        placeholder="用户ID"
                        value={userIdKeyword}
                        onChange={(e) => setUserIdKeyword(e.target.value)}
                        onSearch={handleSearch}
                        className="w-32"
                        inputMode="numeric"
                        prefix={<Search className="size-3.5 text-[var(--studio-faint)]" />}
                        allowClear
                    />
                    <Select<string>
                        placeholder="角色"
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
                            { label: "普通用户", value: "user" },
                            { label: "管理员", value: "admin" },
                        ]}
                    />
                    <Select<number>
                        placeholder="状态"
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
                            { label: "正常", value: 1 },
                            { label: "禁用", value: 0 },
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
                    新增用户
                </Button>
            </div>
            <Table rowKey="id" columns={columns} dataSource={users} loading={loading} pagination={false} />
            <div className="mt-4 flex justify-end">
                <Pagination current={page} pageSize={PAGE_SIZE} total={total} showSizeChanger={false} onChange={setPage} />
            </div>

            <Modal title="新增用户" open={createUserOpen} onOk={handleCreateUser} onCancel={() => setCreateUserOpen(false)} okText="创建" cancelText="取消">
                <div className="flex flex-col gap-4">
                    <Input value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} placeholder="邮箱" type="email" />
                    <Input.Password value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} placeholder="密码（至少8位）" />
                    <Input value={newUserNickname} onChange={(e) => setNewUserNickname(e.target.value)} placeholder="昵称（可选）" />
                    <Select<string>
                        value={newUserRole}
                        onChange={setNewUserRole}
                        options={[
                            { label: "普通用户", value: "user" },
                            { label: "管理员", value: "admin" },
                        ]}
                    />
                </div>
            </Modal>

            <Modal
                title={`调整积分${creditUser ? `：${creditUser.nickname || creditUser.email}` : ""}`}
                open={Boolean(creditUser)}
                confirmLoading={creditSaving}
                onOk={() => void saveCreditAdjustment()}
                onCancel={() => setCreditUser(null)}
                okText="确认调整"
                cancelText="取消"
            >
                <div className="flex flex-col gap-4">
                    <div className="text-sm text-[var(--studio-muted)]">
                        当前可用积分：<span className="font-medium tabular-nums text-[var(--studio-ink)]">{creditUser?.creditBalance.toLocaleString() ?? 0}</span>
                    </div>
                    <InputNumber value={creditChangeAmount} precision={0} className="w-full" placeholder="正数增加，负数扣减" onChange={(value) => setCreditChangeAmount(value === null ? null : Number(value))} />
                    <div className="pb-5">
                        <Input.TextArea value={creditReason} maxLength={200} showCount placeholder="填写调整原因" autoSize={{ minRows: 3, maxRows: 5 }} onChange={(event) => setCreditReason(event.target.value)} />
                    </div>
                </div>
            </Modal>
        </div>
    );
}

function NotificationManagement() {
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
            message.error(error instanceof Error ? error.message : "查询公告失败");
        } finally {
            setLoading(false);
        }
    }, [message]);

    useEffect(() => {
        void loadNotifications();
    }, [loadNotifications]);

    const handleCreate = async () => {
        if (!newTitle.trim()) {
            message.warning("请输入公告标题");
            return;
        }
        try {
            await createAdminNotification({ title: newTitle.trim(), content: newContent.trim() });
            message.success("公告已创建");
            setCreateOpen(false);
            setNewTitle("");
            setNewContent("");
            await loadNotifications();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "创建公告失败");
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
            message.success("公告已更新");
            setEditOpen(false);
            setEditId(null);
            await loadNotifications();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新公告失败");
        }
    };

    const handlePublish = (id: number) => {
        modal.confirm({
            title: "发布确认",
            content: "发布后所有用户将看到此公告，确定发布？",
            okText: "发布",
            cancelText: "取消",
            onOk: async () => {
                try {
                    await publishAdminNotification(id);
                    message.success("公告已发布");
                    await loadNotifications();
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "发布公告失败");
                }
            },
        });
    };

    const columns: ColumnsType<SystemNotification> = [
        { title: "标题", dataIndex: "title", ellipsis: true },
        { title: "内容", dataIndex: "content", ellipsis: true, render: (text: string) => text || "-" },
        {
            title: "优先级",
            dataIndex: "priority",
            width: 100,
            render: (priority: string) => (priority === "high" ? <Tag color="red">高</Tag> : <Tag>普通</Tag>),
        },
        {
            title: "状态",
            dataIndex: "status",
            width: 100,
            render: (status: number) => (status === 1 ? <Tag color="green">已发布</Tag> : <Tag>草稿</Tag>),
        },
        {
            title: "发布时间",
            dataIndex: "publishedAt",
            width: 180,
            render: (value: string) => (value ? new Date(value).toLocaleString() : "-"),
        },
        {
            title: "创建时间",
            dataIndex: "createdAt",
            width: 180,
            render: (value: string) => (value ? new Date(value).toLocaleString() : "-"),
        },
        {
            title: "操作",
            width: 180,
            render: (_, record) => (
                <span className="inline-flex gap-1">
                    <Button size="small" onClick={() => handleEdit(record)}>
                        编辑
                    </Button>
                    {record.status === 0 ? (
                        <Button size="small" icon={<Send className="size-3.5" />} onClick={() => handlePublish(record.id)}>
                            发布
                        </Button>
                    ) : null}
                </span>
            ),
        },
    ];

    return (
        <div>
            <div className="mb-4 flex justify-end">
                <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setCreateOpen(true)}>
                    新建公告
                </Button>
            </div>
            <Table rowKey="id" columns={columns} dataSource={notifications} loading={loading} pagination={false} />

            <Modal title="新建公告" open={createOpen} onOk={handleCreate} onCancel={() => setCreateOpen(false)} okText="创建" cancelText="取消">
                <div className="flex flex-col gap-4">
                    <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="公告标题" />
                    <Input.TextArea value={newContent} onChange={(e) => setNewContent(e.target.value)} rows={4} placeholder="公告内容（可选）" />
                </div>
            </Modal>

            <Modal title="编辑公告" open={editOpen} onOk={handleEditSave} onCancel={() => setEditOpen(false)} okText="保存" cancelText="取消">
                <div className="flex flex-col gap-4">
                    <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="公告标题" />
                    <Input.TextArea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={4} placeholder="公告内容（可选）" />
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
                message.error(error instanceof Error ? error.message : "查询提示词失败");
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
        form.setFieldsValue({ status: 1, sortOrder: 1000, title: "", prompt: "", category: "", tagsText: "", coverUrl: "", preview: "", githubUrl: "" });
        setEditOpen(true);
    };

    const openEdit = (prompt: ServerPrompt) => {
        setEditingPrompt(prompt);
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
        try {
            const values = await form.validateFields();
            const input = {
                title: values.title.trim(),
                prompt: values.prompt.trim(),
                category: values.category.trim(),
                tags: splitTags(values.tagsText),
                coverUrl: values.coverUrl?.trim() || "",
                preview: values.preview?.trim() || "",
                sourceUrl: values.githubUrl?.trim() || "",
                status: values.status ?? 1,
                sortOrder: values.sortOrder ?? 1000,
            };
            if (editingPrompt) {
                await updateAdminPrompt({ id: editingPrompt.id, ...input });
                message.success("提示词已更新");
            } else {
                await createAdminPrompt(input);
                message.success("提示词已创建");
            }
            setEditOpen(false);
            await loadPrompts(editingPrompt ? page : 1);
            if (!editingPrompt) setPage(1);
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        }
    };

    const handleStatusChange = (prompt: ServerPrompt) => {
        const nextStatus = prompt.status === 1 ? 0 : 1;
        modal.confirm({
            title: nextStatus === 1 ? "启用提示词" : "停用提示词",
            content: nextStatus === 1 ? "启用后用户侧提示词库将展示该提示词。" : "停用后用户侧提示词库将不再展示该提示词。",
            okText: nextStatus === 1 ? "启用" : "停用",
            cancelText: "取消",
            onOk: async () => {
                try {
                    await updateAdminPromptStatus(prompt.id, nextStatus);
                    message.success("提示词状态已更新");
                    await loadPrompts(page);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "更新提示词状态失败");
                }
            },
        });
    };

    const handleDelete = (ids: number[]) => {
        modal.confirm({
            title: "删除提示词",
            content: "删除后用户侧和管理端列表都不会再展示这些提示词，确定删除？",
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                try {
                    await deleteAdminPrompts(ids);
                    message.success("提示词已删除");
                    setSelectedRowKeys([]);
                    const nextPage = prompts.length <= ids.length && page > 1 ? page - 1 : page;
                    setPage(nextPage);
                    await loadPrompts(nextPage);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "删除提示词失败");
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
                        placeholder="搜索标题、内容或分类"
                        value={keyword}
                        onChange={(event) => setKeyword(event.target.value)}
                        onSearch={handleSearch}
                        className="w-64"
                        prefix={<Search className="size-3.5 text-[var(--studio-faint)]" />}
                        allowClear
                    />
                    <Select<string>
                        placeholder="分类"
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
                        placeholder="状态"
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
                            { label: "启用", value: 1 },
                            { label: "停用", value: 0 },
                        ]}
                    />
                    <Button danger disabled={!selectedRowKeys.length} icon={<Trash2 className="size-4" />} onClick={() => handleDelete(selectedRowKeys.map(Number))}>
                        批量删除
                    </Button>
                </div>
                <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>
                    新增提示词
                </Button>
            </div>
            {loading ? (
                <div className="studio-empty flex min-h-60 items-center justify-center">
                    <span className="text-sm">加载中...</span>
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
                                        <div className="studio-empty flex h-full w-full items-center justify-center text-xs">暂无封面</div>
                                    )}
                                    <label className="absolute left-3 top-3 inline-flex cursor-pointer items-center rounded-md border border-[var(--studio-line)] bg-[var(--studio-glass-strong)] px-2 py-1 text-xs backdrop-blur">
                                        <input type="checkbox" className="mr-1.5" checked={selected} onChange={(event) => toggleSelectedPrompt(prompt.id, event.target.checked)} />
                                        选择
                                    </label>
                                    <Tag color={prompt.status === 1 ? "green" : "red"} className="absolute right-3 top-3 m-0">
                                        {prompt.status === 1 ? "启用" : "停用"}
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
                                        <div className="studio-caption mb-3 text-xs">更新于 {prompt.updatedAt ? new Date(prompt.updatedAt).toLocaleString() : "-"}</div>
                                        <div className="grid grid-cols-3 gap-2">
                                            <Button size="small" icon={<Edit className="size-3.5" />} onClick={() => openEdit(prompt)}>
                                                编辑
                                            </Button>
                                            <Button size="small" icon={<Power className="size-3.5" />} onClick={() => handleStatusChange(prompt)}>
                                                {prompt.status === 1 ? "停用" : "启用"}
                                            </Button>
                                            <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => handleDelete([prompt.id])}>
                                                删除
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </article>
                        );
                    })}
                </div>
            ) : (
                <div className="studio-empty flex min-h-60 items-center justify-center text-sm">暂无提示词</div>
            )}
            <div className="mt-4 flex justify-end">
                <Pagination current={page} pageSize={PAGE_SIZE} total={total} showSizeChanger={false} onChange={setPage} />
            </div>

            <Modal title={editingPrompt ? "编辑提示词" : "新增提示词"} open={editOpen} onOk={savePrompt} onCancel={() => setEditOpen(false)} okText="保存" cancelText="取消" width={760}>
                <Form form={form} layout="vertical" className="mt-2">
                    <Form.Item name="title" label="标题" rules={[{ required: true, message: "请输入标题" }]}>
                        <Input placeholder="请输入提示词标题" />
                    </Form.Item>
                    <Form.Item name="prompt" label="提示词内容" rules={[{ required: true, message: "请输入提示词内容" }]}>
                        <Input.TextArea rows={6} placeholder="请输入提示词内容" />
                    </Form.Item>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Form.Item name="category" label="分类" rules={[{ required: true, message: "请输入分类" }]}>
                            <Input placeholder="例如：摄影、海报、角色" />
                        </Form.Item>
                        <Form.Item name="tagsText" label="标签">
                            <Input placeholder="多个标签用逗号分隔" />
                        </Form.Item>
                    </div>
                    <Form.Item name="coverUrl" label="封面 URL">
                        <Space.Compact block>
                            <Input placeholder="https://..." />
                            <Button disabled icon={<Upload className="size-3.5" />}>
                                上传后续支持
                            </Button>
                        </Space.Compact>
                    </Form.Item>
                    <Form.Item name="preview" label="预览内容">
                        <Input.TextArea rows={3} placeholder="可填写 Markdown 图片预览内容" />
                    </Form.Item>
                    <Form.Item name="githubUrl" label="来源 URL">
                        <Input placeholder="https://..." />
                    </Form.Item>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Form.Item name="sortOrder" label="排序">
                            <InputNumber className="w-full" min={0} precision={0} />
                        </Form.Item>
                        <Form.Item name="status" label="状态">
                            <Select<number>
                                options={[
                                    { label: "启用", value: 1 },
                                    { label: "停用", value: 0 },
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

function HomepageShowcaseManagement() {
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
            message.error(error instanceof Error ? error.message : "查询首页展示失败");
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
                message.success("首页展示已更新");
            } else {
                await createAdminHomepageShowcase(input);
                message.success("首页展示已创建");
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
            title: nextStatus === 1 ? "启用首页展示" : "停用首页展示",
            content: nextStatus === 1 ? "启用后该内容会出现在首页精选作品墙。" : "停用后该内容不会出现在首页。",
            okText: nextStatus === 1 ? "启用" : "停用",
            cancelText: "取消",
            onOk: async () => {
                await updateAdminHomepageShowcaseStatus(item.id, nextStatus);
                await load();
                message.success("首页展示状态已更新");
            },
        });
    };

    const remove = (ids: number[]) => {
        modal.confirm({
            title: "删除首页展示",
            content: "删除后首页不会再展示这些内容，确定继续？",
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                await deleteAdminHomepageShowcases(ids);
                setSelectedRowKeys([]);
                await load();
                message.success("首页展示已删除");
            },
        });
    };

    const columns: ColumnsType<HomepageShowcase> = [
        {
            title: "预览",
            width: 100,
            render: (_, item) =>
                item.mediaType === "video" ? <video src={item.mediaUrl} poster={item.thumbnailUrl || undefined} muted className="h-14 w-20 object-cover" /> : <img src={item.mediaUrl} alt={item.title} className="h-14 w-20 object-cover" />,
        },
        {
            title: "标题",
            dataIndex: "title",
            render: (value: string, item) => (
                <div>
                    <div className="studio-title font-medium">{value}</div>
                    <div className="studio-caption mt-1 text-xs">{item.description || "无描述"}</div>
                </div>
            ),
        },
        { title: "分类", dataIndex: "category", width: 110, render: (value: string) => <Tag>{value}</Tag> },
        { title: "创作者", dataIndex: "creatorName", width: 140, ellipsis: true },
        { title: "媒体", dataIndex: "mediaType", width: 100, render: (value: HomepageShowcase["mediaType"]) => <Tag icon={value === "video" ? <Video className="size-3" /> : <ImageIcon className="size-3" />}>{value === "video" ? "视频" : "图片"}</Tag> },
        { title: "入口", dataIndex: "targetType", width: 100, render: (value: string) => (value === "canvas" ? "画布" : value === "asset" ? "资产" : value === "video" ? "视频" : "图片") },
        { title: "排序", dataIndex: "sortOrder", width: 80 },
        { title: "状态", dataIndex: "status", width: 90, render: (value: number) => <Tag color={value === 1 ? "green" : "default"}>{value === 1 ? "启用" : "停用"}</Tag> },
        { title: "更新时间", dataIndex: "updatedAt", width: 180, render: (value: string) => (value ? new Date(value).toLocaleString("zh-CN") : "-") },
        {
            title: "操作",
            key: "actions",
            width: 190,
            render: (_, item) => (
                <Space>
                    <Button size="small" icon={<Edit className="size-3.5" />} onClick={() => openEdit(item)}>
                        编辑
                    </Button>
                    <Button size="small" icon={<Power className="size-3.5" />} onClick={() => toggleStatus(item)}>
                        {item.status === 1 ? "停用" : "启用"}
                    </Button>
                    <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => remove([item.id])}>
                        删除
                    </Button>
                </Space>
            ),
        },
    ];

    return (
        <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <span className="studio-subtitle text-sm">管理首页精选作品，空列表时首页使用内置示例。</span>
                <Space>
                    <Button danger disabled={!selectedRowKeys.length} icon={<Trash2 className="size-4" />} onClick={() => remove(selectedRowKeys.map(Number))}>
                        批量删除
                    </Button>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>
                        新增展示
                    </Button>
                </Space>
            </div>
            <Table rowKey="id" rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }} loading={loading} columns={columns} dataSource={items} pagination={false} locale={{ emptyText: "暂无首页展示内容" }} />
            <Modal title={editing ? "编辑首页展示" : "新增首页展示"} open={open} onOk={() => void save()} onCancel={() => setOpen(false)} okText="保存" cancelText="取消" width={720} destroyOnHidden>
                <Form form={form} layout="vertical" className="mt-3">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Form.Item name="title" label="标题" rules={[{ required: true, message: "请输入标题" }]}>
                            <Input placeholder="例如：夜色中的建筑构成" />
                        </Form.Item>
                        <Form.Item name="description" label="描述">
                            <Input placeholder="首页作品墙中的简短描述" />
                        </Form.Item>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Form.Item name="category" label="分类" rules={[{ required: true, message: "请输入作品分类" }]}>
                            <Input placeholder="例如：视觉海报" maxLength={50} />
                        </Form.Item>
                        <Form.Item name="creatorName" label="创作者" rules={[{ required: true, message: "请输入创作者名称" }]}>
                            <Input placeholder="例如：Novanova Studio" maxLength={100} />
                        </Form.Item>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Form.Item name="mediaType" label="媒体类型" rules={[{ required: true }]}>
                            <Select
                                options={[
                                    { label: "图片", value: "image" },
                                    { label: "视频", value: "video" },
                                ]}
                            />
                        </Form.Item>
                        <Form.Item name="targetType" label="目标入口" rules={[{ required: true }]}>
                            <Select
                                options={[
                                    { label: "图片工作区", value: "image" },
                                    { label: "视频工作区", value: "video" },
                                    { label: "无限画布", value: "canvas" },
                                    { label: "资产库", value: "asset" },
                                ]}
                            />
                        </Form.Item>
                    </div>
                    <Form.Item name="mediaUrl" label="媒体 URL" rules={[{ required: true, type: "url", message: "请输入有效的媒体 URL" }]}>
                        <Input placeholder="https://..." />
                    </Form.Item>
                    <Form.Item name="thumbnailUrl" label="视频缩略图 URL" rules={[{ type: "url", message: "请输入有效 URL" }]}>
                        <Input placeholder="视频可选，图片无需填写" />
                    </Form.Item>
                    {previewMediaUrl ? (
                        <div className="mb-4 overflow-hidden rounded-[8px] border border-[var(--studio-line)] bg-[var(--studio-media)]">
                            {previewMediaType === "video" ? (
                                <video src={previewMediaUrl} poster={previewThumbnailUrl || undefined} muted controls className="mx-auto max-h-64 w-full object-contain" />
                            ) : (
                                <img src={previewMediaUrl} alt="首页展示预览" className="mx-auto max-h-64 w-full object-contain" />
                            )}
                        </div>
                    ) : null}
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Form.Item name="targetPath" label="目标路径">
                            <Input placeholder="默认按目标入口生成，例如 /image" />
                        </Form.Item>
                        <Form.Item name="sortOrder" label="排序">
                            <InputNumber className="w-full" min={0} precision={0} />
                        </Form.Item>
                    </div>
                    <Form.Item name="promptContent" label="关联提示词">
                        <Input.TextArea rows={3} placeholder="点击作品后可带入工作区的提示词" />
                    </Form.Item>
                    <Form.Item name="status" label="状态">
                        <Select
                            options={[
                                { label: "启用", value: 1 },
                                { label: "停用", value: 0 },
                            ]}
                        />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
}
