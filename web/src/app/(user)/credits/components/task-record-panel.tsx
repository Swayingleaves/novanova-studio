"use client";

import { useMemo, useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "@/features/locale/use-translation";
import { Button, Empty, Input, Modal, Pagination, Segmented, Skeleton, Table, Tag, DatePicker, type TableProps } from "antd";
import { Image as ImageIcon, Play, Video } from "lucide-react";

import { listAdminTaskRecords, listTaskRecords, type ServerAdminTaskRecord, type ServerTaskRecord } from "@/services/api/server";

import { formatCreditTime, generationTypeLabel } from "../credit-page-utils";
import { formatConsumedCredits, TASK_RECORD_PAGE_SIZE, taskRecordStatusLabel, taskRecordStatusTone, taskRecordUserLabel } from "../task-record-utils";

type TaskTypeFilter = "all" | "image" | "video";
type MediaPreview = { url: string; taskType: "image" | "video" };
type TaskRecordView = ServerTaskRecord & Partial<Pick<ServerAdminTaskRecord, "userId" | "username" | "nickname" | "email">>;

/**
 * 渲染积分页下方的图片与视频生成任务记录。
 *
 * @param props 管理员模式开启时查询全站记录并显示用户列
 * @return 任务记录面板
 */
export function TaskRecordPanel({ admin = false }: { admin?: boolean } = {}) {
    const translate = useTranslation();
    const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>(() => [dayjs().subtract(29, "day").startOf("day"), dayjs().endOf("day")]);
    const [taskType, setTaskType] = useState<TaskTypeFilter>("all");
    const [keyword, setKeyword] = useState("");
    const [keywordDraft, setKeywordDraft] = useState("");
    const [page, setPage] = useState(1);
    const [detail, setDetail] = useState<TaskRecordView | null>(null);
    const [preview, setPreview] = useState<MediaPreview | null>(null);

    const filters = useMemo(() => ({
        startDate: dateRange[0].format("YYYY-MM-DD"),
        endDate: dateRange[1].format("YYYY-MM-DD"),
        taskType: taskType === "all" ? undefined : taskType,
        keyword: keyword || undefined,
    }), [dateRange, taskType, keyword]);

    const recordsQuery = useQuery({
        queryKey: [admin ? "admin-task-records" : "task-records", filters.startDate, filters.endDate, filters.taskType, filters.keyword, page],
        queryFn: () => admin
            ? listAdminTaskRecords({ ...filters, page, pageSize: TASK_RECORD_PAGE_SIZE })
            : listTaskRecords({ ...filters, page, pageSize: TASK_RECORD_PAGE_SIZE }),
    });

    const records: TaskRecordView[] = recordsQuery.data?.records || [];
    const columns = useMemo<TableProps<TaskRecordView>["columns"]>(() => [
        ...(admin ? [{
            title: translate("administration.user"),
            dataIndex: "username",
            width: 160,
            ellipsis: true,
            render: (_: string | null | undefined, record: TaskRecordView) => <span className="block truncate text-[var(--studio-text)]" title={record.email || undefined}>{taskRecordUserLabel(record)}</span>,
        }] : []),
        {
            title: translate("credits.time"),
            dataIndex: "createdAt",
            width: 168,
            render: (createdAt: string) => <span className="tabular-nums text-[var(--studio-muted)]">{formatCreditTime(createdAt)}</span>,
        },
        {
            title: translate("credits.taskType"),
            dataIndex: "taskType",
            width: 120,
            render: (taskTypeValue: ServerTaskRecord["taskType"]) => {
                const Icon = taskTypeValue === "video" ? Video : ImageIcon;
                return <span className="inline-flex items-center gap-2 text-[var(--studio-text)]"><Icon className="size-4 text-[var(--studio-primary)]" />{generationTypeLabel(taskTypeValue)}</span>;
            },
        },
        {
            title: translate("credits.model"),
            dataIndex: "model",
            width: 180,
            ellipsis: true,
            render: (model: string) => <span className="block truncate text-[var(--studio-muted)]">{model || "—"}</span>,
        },
        {
            title: translate("credits.consumedCredits"),
            dataIndex: "consumedCredits",
            width: 108,
            align: "right",
            render: (consumedCredits: ServerTaskRecord["consumedCredits"]) => <span className="font-medium tabular-nums text-[var(--studio-ink)]">{formatConsumedCredits(consumedCredits)}</span>,
        },
        {
            title: translate("credits.taskStatus"),
            dataIndex: "status",
            width: 108,
            render: (status: ServerTaskRecord["status"]) => <Tag color={taskRecordStatusTone(status)}>{taskRecordStatusLabel(status)}</Tag>,
        },
        {
            title: translate("credits.details"),
            dataIndex: "resultUrls",
            width: 200,
            render: (_, record) => (
                <div className="flex items-center gap-3">
                    <TaskRecordThumbnails record={record} onPreview={setPreview} />
                    <Button size="small" onClick={() => setDetail(record)}>{translate("credits.details")}</Button>
                </div>
            ),
        },
    ], [admin, translate, translate.locale]);

    return (
        <div>
            <div className="flex flex-wrap items-center gap-3">
                <DatePicker.RangePicker
                    value={dateRange}
                    allowClear={false}
                    disabledDate={(date) => date.isAfter(dayjs(), "day")}
                    onChange={(nextDateRange) => {
                        if (!nextDateRange?.[0] || !nextDateRange[1]) return;
                        setDateRange([nextDateRange[0], nextDateRange[1]]);
                        setPage(1);
                    }}
                />
                <Segmented
                    value={taskType}
                    options={[
                        { label: translate("credits.all"), value: "all" },
                        { label: translate("credits.generateImage"), value: "image" },
                        { label: translate("credits.generateVideo"), value: "video" },
                    ]}
                    onChange={(value) => {
                        setTaskType(value as TaskTypeFilter);
                        setPage(1);
                    }}
                />
                <Input.Search
                    allowClear
                    className="w-full sm:w-64"
                    value={keywordDraft}
                    placeholder={translate("credits.searchPromptOrModel")}
                    onChange={(event) => {
                        const nextValue = event.target.value;
                        setKeywordDraft(nextValue);
                        if (!nextValue) {
                            setKeyword("");
                            setPage(1);
                        }
                    }}
                    onSearch={(value) => {
                        setKeywordDraft(value);
                        setKeyword(value.trim());
                        setPage(1);
                    }}
                />
                <span className="ml-auto text-sm tabular-nums text-[var(--studio-muted)]">{recordsQuery.data?.total || 0} {translate("credits.records")}</span>
            </div>

            <div className="mt-4 hidden md:block">
                <Table<TaskRecordView>
                    rowKey="taskId"
                    columns={columns}
                    dataSource={records}
                    loading={recordsQuery.isLoading}
                    pagination={false}
                    scroll={{ x: admin ? 1_044 : 884 }}
                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={translate("credits.noTaskRecordsInThisPeriod")} /> }}
                />
            </div>
            <div className="mt-4 md:hidden">
                {recordsQuery.isLoading ? <Skeleton active paragraph={{ rows: 6 }} /> : null}
                {!recordsQuery.isLoading && !records.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={translate("credits.noTaskRecordsInThisPeriod")} /> : null}
                {records.map((record) => (
                    <article key={record.taskId} className="flex gap-3 border-b border-[var(--studio-line)] py-4">
                        <div className="shrink-0"><TaskRecordThumbnails record={record} onPreview={setPreview} compact /></div>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                                <span className="text-sm font-medium text-[var(--studio-ink)]">{generationTypeLabel(record.taskType)}</span>
                                <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--studio-ink)]">{formatConsumedCredits(record.consumedCredits)}</span>
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-xs text-[var(--studio-muted)]">
                                <Tag color={taskRecordStatusTone(record.status)} className="mr-0">{taskRecordStatusLabel(record.status)}</Tag>
                                <span className="tabular-nums">{formatCreditTime(record.createdAt)}</span>
                            </div>
                            {admin ? <p className="mt-1 truncate text-xs text-[var(--studio-muted)]">{translate("administration.user")} · {taskRecordUserLabel(record)}</p> : null}
                            <p className="mt-1 truncate text-xs text-[var(--studio-muted)]" title={record.model}>{record.model || "—"}</p>
                            <p className="mt-1 line-clamp-2 text-xs text-[var(--studio-muted)]">{record.prompt || translate("credits.noPrompt")}</p>
                            <div className="mt-2">
                                <Button size="small" onClick={() => setDetail(record)}>{translate("credits.details")}</Button>
                            </div>
                        </div>
                    </article>
                ))}
            </div>

            {recordsQuery.data && recordsQuery.data.total > TASK_RECORD_PAGE_SIZE ? (
                <div className="mt-5 flex justify-end">
                    <Pagination current={page} pageSize={TASK_RECORD_PAGE_SIZE} total={recordsQuery.data.total} showSizeChanger={false} onChange={setPage} />
                </div>
            ) : null}

            <TaskRecordDetail record={detail} onClose={() => setDetail(null)} onPreview={setPreview} />
            <MediaPreviewDialog preview={preview} onClose={() => setPreview(null)} />
        </div>
    );
}

/**
 * 渲染任务结果缩略图，视频显示首帧并提示可播放。
 *
 * @param props 任务记录、预览回调与紧凑模式
 * @return 缩略图列表
 */
function TaskRecordThumbnails({ record, onPreview, compact }: { record: ServerTaskRecord; onPreview: (preview: MediaPreview) => void; compact?: boolean }) {
    const translate = useTranslation();
    if (!record.resultUrls.length) {
        const generating = record.status === "pending" || record.status === "running";
        return (
            <span className="text-xs text-[var(--studio-muted)]">
                {generating ? translate("credits.generatingResult") : translate("credits.failedWithoutResult")}
            </span>
        );
    }
    const visibleUrls = record.resultUrls.slice(0, compact ? 1 : 2);
    return (
        <div className="flex flex-wrap items-center gap-2">
            {visibleUrls.map((url) => (
                <button
                    key={url}
                    type="button"
                    className="relative size-14 shrink-0 overflow-hidden rounded-md border border-[var(--studio-line)] bg-[var(--studio-media)]"
                    onClick={(event) => {
                        event.stopPropagation();
                        onPreview({ url, taskType: record.taskType });
                    }}
                >
                    {record.taskType === "video" ? (
                        <>
                            <video src={`${url}#t=0.1`} muted playsInline preload="metadata" className="size-full object-cover" />
                            <span className="absolute inset-0 grid place-items-center bg-black/25"><Play className="size-4 fill-white text-white" /></span>
                        </>
                    ) : (
                        <img src={url} alt="" loading="lazy" className="size-full object-cover" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
                    )}
                </button>
            ))}
            {record.resultUrls.length > visibleUrls.length ? (
                <span className="text-xs tabular-nums text-[var(--studio-muted)]">+{record.resultUrls.length - visibleUrls.length}</span>
            ) : null}
        </div>
    );
}

/**
 * 渲染任务详情弹窗，展示参数、提示词与生成结果。
 *
 * @param props 任务记录、关闭回调与媒体预览回调
 * @return 任务详情弹窗
 */
function TaskRecordDetail({ record, onClose, onPreview }: { record: ServerTaskRecord | null; onClose: () => void; onPreview: (preview: MediaPreview) => void }) {
    const translate = useTranslation();
    const details = record ? [
        { label: translate("credits.model"), value: record.model || "—" },
        { label: translate("credits.taskType"), value: generationTypeLabel(record.taskType) },
        { label: translate("credits.resolution"), value: record.resolution || "—" },
        { label: translate("credits.aspectRatio"), value: record.size || "—" },
        { label: translate("credits.durationSeconds"), value: record.seconds ? `${record.seconds}s` : "—" },
        { label: translate("credits.consumedCredits"), value: formatConsumedCredits(record.consumedCredits) },
        { label: translate("credits.taskStatus"), value: taskRecordStatusLabel(record.status) },
        { label: translate("credits.time"), value: formatCreditTime(record.createdAt) },
    ] : [];

    return (
        <Modal
            open={Boolean(record)}
            onCancel={onClose}
            footer={null}
            width={880}
            centered
            destroyOnHidden
            mask={{ closable: true }}
            title={translate("credits.taskDetail")}
            styles={{ body: { maxHeight: "76vh", overflowY: "auto" } }}
        >
            {record ? (
                <div className="flex flex-col gap-5">
                    <TaskRecordResult record={record} onPreview={onPreview} />
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                        {details.map((item) => (
                            <div key={item.label} className="min-w-0">
                                <dt className="text-xs text-[var(--studio-muted)]">{item.label}</dt>
                                <dd className="mt-1 break-words text-sm text-[var(--studio-ink)]">{item.value}</dd>
                            </div>
                        ))}
                    </dl>
                    {record.errorMessage ? (
                        <div>
                            <p className="text-xs text-[var(--studio-muted)]">{translate("credits.failureReason")}</p>
                            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--studio-danger)]">{record.errorMessage}</p>
                        </div>
                    ) : null}
                    <div>
                        <p className="text-xs text-[var(--studio-muted)]">{translate("credits.prompt")}</p>
                        <p className="mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-[var(--studio-surface-raised)] p-3 text-sm leading-6 text-[var(--studio-text)]">
                            {record.prompt || translate("credits.noPrompt")}
                        </p>
                    </div>
                </div>
            ) : null}
        </Modal>
    );
}

/**
 * 渲染任务详情中的生成结果。
 *
 * @param props 任务记录与媒体预览回调
 * @return 图片网格、视频播放器或空状态
 */
function TaskRecordResult({ record, onPreview }: { record: ServerTaskRecord; onPreview: (preview: MediaPreview) => void }) {
    const translate = useTranslation();
    if (!record.resultUrls.length) {
        const generating = record.status === "pending" || record.status === "running";
        return (
            <div className="grid place-items-center rounded-lg border border-dashed border-[var(--studio-line)] px-4 py-10 text-sm text-[var(--studio-muted)]">
                {generating ? translate("credits.generatingResult") : translate("credits.failedWithoutResult")}
            </div>
        );
    }
    if (record.taskType === "video") {
        return <video src={record.resultUrls[0]} controls playsInline className="mx-auto max-h-[420px] w-full rounded-lg bg-black" />;
    }
    return (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {record.resultUrls.map((url) => (
                <button
                    key={url}
                    type="button"
                    className="overflow-hidden rounded-lg border border-[var(--studio-line)] bg-[var(--studio-media)]"
                    onClick={() => onPreview({ url, taskType: "image" })}
                >
                    <img src={url} alt="" loading="lazy" className="aspect-square w-full object-cover" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
                </button>
            ))}
        </div>
    );
}

/**
 * 渲染图片大图或视频播放弹窗。
 *
 * @param props 待预览媒体与关闭回调
 * @return 媒体预览弹窗
 */
function MediaPreviewDialog({ preview, onClose }: { preview: MediaPreview | null; onClose: () => void }) {
    const translate = useTranslation();
    return (
        <Modal
            open={Boolean(preview)}
            onCancel={onClose}
            footer={null}
            width={preview?.taskType === "video" ? 900 : 760}
            centered
            destroyOnHidden
            mask={{ closable: true }}
            title={translate("credits.generationResult")}
            styles={{ body: { padding: 0 } }}
        >
            {preview?.taskType === "video" ? (
                <video src={preview.url} controls autoPlay playsInline className="max-h-[76vh] w-full rounded-lg bg-black" />
            ) : preview ? (
                <img src={preview.url} alt={translate("credits.generationResult")} className="max-h-[76vh] w-full object-contain" />
            ) : null}
        </Modal>
    );
}
