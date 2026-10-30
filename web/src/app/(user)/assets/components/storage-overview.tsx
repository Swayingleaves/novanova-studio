"use client";

import { useState } from "react";
import { Alert, Button, Skeleton, Tooltip } from "antd";
import { Cloud, Plus } from "lucide-react";
import { useTranslation } from "@/features/locale/use-translation";
import { useStorageCapacity } from "@/features/storage/use-storage-capacity";
import { formatStorageGigabytes, storageUsageSegments } from "@/features/storage/capacity-format";
import { StorageCapacityModal } from "@/features/storage/components/storage-capacity-modal";

/** 两个资产页签共用真实容量总览和永久扩容入口。 */
export function StorageOverview() {
    const translate = useTranslation();
    const capacity = useStorageCapacity(true);
    const [expansionOpen, setExpansionOpen] = useState(false);
    const data = capacity.data;
    const usage = data ? storageUsageSegments(data) : null;

    return (
        <section className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface)] p-4 sm:p-5" aria-label={translate("storage.cloudStorage")}>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-sm font-medium text-[var(--studio-ink)]">
                    <Cloud className="size-4 text-[var(--studio-muted)]" aria-hidden />
                    {translate("storage.cloudStorage")}
                </h2>
                <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setExpansionOpen(true)}>
                    {translate("storage.expandCapacity")}
                </Button>
            </div>
            {capacity.isError ? (
                <Alert
                    className="mt-4"
                    type="error"
                    showIcon
                    title={translate("storage.capacityLoadFailed")}
                    action={
                        <Button size="small" onClick={() => void capacity.refetch()}>
                            {translate("storage.retry")}
                        </Button>
                    }
                />
            ) : null}
            {data && usage ? (
                <div className="mt-4 space-y-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-2">
                        <p className="tabular-nums text-[var(--studio-ink)]">
                            <span className="text-2xl font-semibold">{formatStorageGigabytes(data.usedBytes)}</span>
                            <span className="ml-1 text-sm text-[var(--studio-muted)]">
                                {" "}
                                / {formatStorageGigabytes(data.totalBytes)} G {translate("storage.usedLabel")}
                            </span>
                        </p>
                        <p className="text-sm text-[var(--studio-muted)]">
                            {translate("storage.availableCapacity")} <span className="tabular-nums text-[var(--studio-ink)]">{formatStorageGigabytes(usage.availableBytes)} G</span>
                        </p>
                    </div>
                    <div
                        className="flex h-4 overflow-hidden rounded-sm bg-[var(--studio-surface-hover)]"
                        role="img"
                        aria-label={translate("storage.usageBarDescription", { value0: formatStorageGigabytes(data.usedBytes), value1: formatStorageGigabytes(data.totalBytes), value2: formatStorageGigabytes(data.reservedBytes) })}
                    >
                        {usage.categories.map((item, index) => (item.percentage > 0 ? <div key={item.category} className="h-full shrink-0" style={{ width: `${item.percentage}%`, backgroundColor: `var(--chart-${index + 1})` }} aria-hidden /> : null))}
                        {usage.reservedPercentage > 0 ? (
                            <div
                                className="h-full shrink-0 bg-[var(--studio-muted)]"
                                style={{ width: `${usage.reservedPercentage}%`, backgroundImage: "repeating-linear-gradient(135deg, transparent, transparent 3px, var(--studio-surface) 3px, var(--studio-surface) 5px)" }}
                                aria-hidden
                            />
                        ) : null}
                    </div>
                    <ul className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3 xl:grid-cols-6">
                        {usage.categories.map((item, index) => (
                            <li key={item.category} className="min-w-0 text-xs">
                                <div className="flex items-center gap-1.5 text-[var(--studio-muted)]">
                                    <span className="size-2 shrink-0 rounded-xs" style={{ backgroundColor: `var(--chart-${index + 1})` }} aria-hidden />
                                    {translate(`storage.fileCategory_${item.category}`)}
                                </div>
                                <Tooltip title={translate("storage.fileCount", { value0: item.fileCount })}>
                                    <p className="mt-1 tabular-nums text-[var(--studio-ink)]">
                                        {formatStorageGigabytes(item.usedBytes)} G <span className="text-[var(--studio-muted)]">· {item.fileCount}</span>
                                    </p>
                                </Tooltip>
                            </li>
                        ))}
                        <li className="min-w-0 text-xs">
                            <p className="text-[var(--studio-muted)]">{translate("storage.reservedCapacity")}</p>
                            <p className="mt-1 tabular-nums text-[var(--studio-ink)]">{formatStorageGigabytes(data.reservedBytes)} G</p>
                        </li>
                    </ul>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--studio-line)] pt-3 text-xs text-[var(--studio-muted)]">
                        <span>
                            {translate("storage.freeCapacity")} {formatStorageGigabytes(data.freeBytes)} G
                        </span>
                        <span>
                            {translate("storage.purchasedCapacity")} {formatStorageGigabytes(data.purchasedBytes)} G
                        </span>
                        {data.pendingDeletionBytes !== "0" ? <span>{translate("storage.pendingDeletionCapacity", { value0: formatStorageGigabytes(data.pendingDeletionBytes) })}</span> : null}
                    </div>
                    {usage.exceededBytes !== "0" ? <Alert type="warning" showIcon title={translate("storage.exceededCapacity", { value0: formatStorageGigabytes(usage.exceededBytes) })} /> : null}
                </div>
            ) : !capacity.isError ? (
                <Skeleton className="mt-4" active paragraph={{ rows: 3 }} />
            ) : null}
            <StorageCapacityModal open={expansionOpen} onClose={() => setExpansionOpen(false)} />
        </section>
    );
}
