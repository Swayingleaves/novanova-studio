"use client";
import { currentLanguageTag } from "@/features/locale/translate";

import { useTranslation } from "@/features/locale/use-translation";


import React, { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Drawer, Input, Pagination, Select, Table, Tag, type TableProps } from "antd";
import { RefreshCw } from "lucide-react";

import { listAdminApiLogs, type ServerApiLog } from "@/services/api/server";

const PAGE_SIZE = 20;

/**
 * 渲染管理员接口访问记录。
 *
 * @returns 接口记录页面内容
 */
export function ApiLogsManagement() {
    const translate = useTranslation();
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(PAGE_SIZE);
    const [keywordInput, setKeywordInput] = useState("");
    const [keyword, setKeyword] = useState("");
    const [result, setResult] = useState<"success" | "error" | undefined>();
    const [selected, setSelected] = useState<ServerApiLog | null>(null);

    const query = useQuery({
        queryKey: ["admin-api-logs", page, pageSize, keyword, result],
        queryFn: () => listAdminApiLogs({ page, pageSize, keyword: keyword || undefined, result }),
    });

    const [columnWidths, setColumnWidths] = useState<Record<string, number>>({
        requestPath: 380,
        clientIp: 150,
        userId: 110,
        statusCode: 100,
        success: 90,
        hasError: 90,
        errorContent: 240,
        durationMs: 110,
        createdAt: 180,
        operation: 90,
    });

    const handleResize = (key: string) => (event: React.MouseEvent) => {
        event.stopPropagation();
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = columnWidths[key] ?? 100;
        const onMove = (moveEvent: MouseEvent) => {
            const next = Math.max(60, startWidth + moveEvent.clientX - startX);
            setColumnWidths((prev) => ({ ...prev, [key]: next }));
        };
        const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            document.body.style.removeProperty("user-select");
            document.body.style.removeProperty("cursor");
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        document.body.style.userSelect = "none";
        document.body.style.cursor = "col-resize";
    };

    const columns: TableProps<ServerApiLog>["columns"] = [
        {
            title: translate("administration.endpoint"),
            dataIndex: "requestPath",
            key: "requestPath",
            width: columnWidths.requestPath,
            onHeaderCell: () => ({ width: columnWidths.requestPath, onResize: handleResize("requestPath") }),
            render: (_, record) => (
                <div className="flex flex-wrap items-center gap-2">
                    <Tag color={methodColor(record.httpMethod)}>{record.httpMethod}</Tag>
                    <span className="font-mono text-xs break-all text-[var(--studio-ink)]">{record.requestPath}</span>
                </div>
            ),
        },
        {
            title: translate("administration.clientIP"),
            dataIndex: "clientIp",
            key: "clientIp",
            width: columnWidths.clientIp,
            onHeaderCell: () => ({ width: columnWidths.clientIp, onResize: handleResize("clientIp") }),
            render: (value: string) => <span className="font-mono text-xs">{value}</span>,
        },
        {
            title: translate("administration.userID"),
            dataIndex: "userId",
            key: "userId",
            width: columnWidths.userId,
            onHeaderCell: () => ({ width: columnWidths.userId, onResize: handleResize("userId") }),
            render: (value: number | null) => value ? <span className="font-mono tabular-nums">{value}</span> : <span className="text-[var(--studio-faint)]">-</span>,
        },
        {
            title: translate("administration.statusCode"),
            dataIndex: "statusCode",
            key: "statusCode",
            width: columnWidths.statusCode,
            onHeaderCell: () => ({ width: columnWidths.statusCode, onResize: handleResize("statusCode") }),
            render: (value: number) => <Tag color={value < 400 ? "green" : "red"}>{value}</Tag>,
        },
        {
            title: translate("administration.success"),
            dataIndex: "success",
            key: "success",
            width: columnWidths.success,
            onHeaderCell: () => ({ width: columnWidths.success, onResize: handleResize("success") }),
            render: (value: boolean) => <Tag color={value ? "green" : "default"}>{value ? translate("administration.success") : translate("administration.failed")}</Tag>,
        },
        {
            title: translate("administration.error"),
            dataIndex: "hasError",
            key: "hasError",
            width: columnWidths.hasError,
            onHeaderCell: () => ({ width: columnWidths.hasError, onResize: handleResize("hasError") }),
            render: (value: boolean) => <Tag color={value ? "red" : "default"}>{value ? translate("administration.hasErrors") : translate("administration.none")}</Tag>,
        },
        {
            title: translate("administration.errorDetails"),
            dataIndex: "errorContent",
            key: "errorContent",
            width: columnWidths.errorContent,
            onHeaderCell: () => ({ width: columnWidths.errorContent, onResize: handleResize("errorContent") }),
            render: (value: string | null, record) =>
                value ? (
                    <Button type="link" size="small" className="px-0" onClick={() => setSelected(record)}>
                        {value.length > 60 ? `${value.slice(0, 60)}…` : value}
                    </Button>
                ) : (
                    <span className="text-[var(--studio-faint)]">-</span>
                ),
        },
        {
            title: translate("administration.duration"),
            dataIndex: "durationMs",
            key: "durationMs",
            width: columnWidths.durationMs,
            onHeaderCell: () => ({ width: columnWidths.durationMs, onResize: handleResize("durationMs") }),
            render: (value: number) => <span className="tabular-nums">{value} ms</span>,
        },
        {
            title: translate("administration.time"),
            dataIndex: "createdAt",
            key: "createdAt",
            width: columnWidths.createdAt,
            onHeaderCell: () => ({ width: columnWidths.createdAt, onResize: handleResize("createdAt") }),
            render: (value: string) => (value ? new Date(value).toLocaleString(currentLanguageTag()) : "-"),
        },
        {
            title: translate("administration.actions"),
            key: "operation",
            width: columnWidths.operation,
            onHeaderCell: () => ({ width: columnWidths.operation, onResize: handleResize("operation") }),
            render: (_, record) => <Button type="link" size="small" onClick={() => setSelected(record)}>{translate("administration.details")}</Button>,
        },
    ];

    return (
        <div>
            <div className="mb-4 flex flex-wrap items-center gap-3">
                <Input.Search
                    allowClear
                    value={keywordInput}
                    onChange={(event) => {
                        const value = event.target.value;
                        setKeywordInput(value);
                        if (!value) {
                            setKeyword("");
                            setPage(1);
                        }
                    }}
                    onSearch={() => {
                        setKeyword(keywordInput);
                        setPage(1);
                    }}
                    placeholder={translate("administration.keywordIPEndpointUserID")}
                    className="w-72"
                />
                <Select<"success" | "error" | undefined>
                    allowClear
                    placeholder={translate("administration.allResults")}
                    value={result}
                    onChange={(value) => {
                        setResult(value);
                        setPage(1);
                    }}
                    className="w-36"
                    options={[
                        { value: "success", label: translate("administration.success") },
                        { value: "error", label: translate("administration.error") },
                    ]}
                />
                <Button icon={<RefreshCw className="size-4" />} onClick={() => void query.refetch()}>{translate("administration.refresh")}</Button>
            </div>

            <Table<ServerApiLog>
                rowKey="id"
                columns={columns}
                dataSource={query.data?.logs ?? []}
                loading={query.isLoading}
                pagination={false}
                scroll={{ x: 1_400 }}
                components={{ header: { cell: ResizableTitle } }}
            />
            {query.data && query.data.total > 0 ? (
                <div className="mt-4 flex justify-end">
                    <Pagination
                        current={page}
                        pageSize={pageSize}
                        total={query.data.total}
                        showSizeChanger
                        pageSizeOptions={[10, 20, 50, 100]}
                        onChange={setPage}
                        onShowSizeChange={(_, size) => {
                            setPageSize(size);
                            setPage(1);
                        }}
                    />
                </div>
            ) : null}

            <Drawer title={translate("administration.aPIAccessDetails")} open={Boolean(selected)} onClose={() => setSelected(null)} styles={{ wrapper: { width: 680 } }}>
                {selected && (
                    <div className="space-y-4">
                        <DetailRow label={translate("administration.method")}>{selected.httpMethod}</DetailRow>
                        <DetailRow label={translate("administration.endpointURL")}><span className="font-mono break-all">{selected.requestPath}</span></DetailRow>
                        <DetailRow label={translate("administration.clientIP")}><span className="font-mono">{selected.clientIp}</span></DetailRow>
                        <DetailRow label={translate("administration.userID")}>{selected.userId ?? "-"}</DetailRow>
                        <DetailRow label={translate("administration.statusCode")}><Tag color={selected.statusCode < 400 ? "green" : "red"}>{selected.statusCode}</Tag></DetailRow>
                        <DetailRow label={translate("administration.successful")}>{selected.success ? translate("administration.success") : translate("administration.failed")}</DetailRow>
                        <DetailRow label={translate("administration.duration")}>{selected.durationMs} ms</DetailRow>
                        <DetailRow label={translate("administration.time")}>{new Date(selected.createdAt).toLocaleString(currentLanguageTag())}</DetailRow>
                        <div>
                            <div className="mb-1 text-sm font-medium text-[var(--studio-muted)]">{translate("administration.requestBody")}</div>
                            <pre className="max-h-60 overflow-auto rounded bg-[var(--studio-surface)] p-3 font-mono text-xs">{selected.requestBody || "-"}</pre>
                        </div>
                        <div>
                            <div className="mb-1 text-sm font-medium text-[var(--studio-muted)]">{translate("administration.errorDetails")}</div>
                            <pre className="max-h-60 overflow-auto rounded bg-[var(--studio-surface)] p-3 font-mono text-xs">{selected.errorContent || "-"}</pre>
                        </div>
                    </div>
                )}
            </Drawer>
        </div>
    );
}

/**
 * 可拖拽改变宽度的表头单元格。
 *
 * 在表头右侧渲染一个拖拽手柄，按住即可实时修改对应列宽（最小 60px）。
 * 不引入额外依赖，复用 antd 官方 resizable column 思路。
 *
 * @param onResize 鼠标按下时触发的拖拽回调
 * @param width 当前列宽（未指定时不渲染手柄）
 * @param restProps 其余表头属性透传到 th
 */
function ResizableTitle({ onResize, width, ...restProps }: React.HTMLAttributes<HTMLTableCellElement> & {
    onResize?: (event: React.MouseEvent) => void;
    width?: number;
}) {
    if (!width) {
        return <th {...restProps} />;
    }
    return (
        <th {...restProps} style={{ ...(restProps.style ?? {}), position: "relative" }}>
            {restProps.children}
            <span
                onMouseDown={onResize}
                onClick={(event) => event.stopPropagation()}
                className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-[var(--studio-accent)]"
            />
        </th>
    );
}

/**
 * HTTP 方法对应的标签颜色。
 *
 * @param method string HTTP 方法
 * @returns string 标签颜色
 */
function methodColor(method: string): string {
    switch (method) {
        case "GET": return "blue";
        case "POST": return "green";
        case "PUT": return "orange";
        case "PATCH": return "purple";
        case "DELETE": return "red";
        default: return "default";
    }
}

/**
 * 详情行。
 *
 * @param label string 标签
 * @param children ReactNode 内容
 * @returns 详情行
 */
function DetailRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex gap-3 text-sm">
            <span className="w-20 shrink-0 text-[var(--studio-muted)]">{label}</span>
            <span className="text-[var(--studio-ink)]">{children}</span>
        </div>
    );
}
