"use client";

import { useMemo, useState } from "react";
import { Alert, App, Button, Card, Empty, Radio, Space, Tag } from "antd";
import { AlertTriangle, CheckCircle2, CheckSquare, Clock, RefreshCw, RotateCcw, ShieldAlert } from "lucide-react";

import { useComicDramaStore } from "../stores/use-comic-drama-store";
import type { ComicDramaChangeImpact } from "../types";

/** 上游变更联动与影响确认阶段视图。 */
export function StageUpdates() {
    const { message } = App.useApp();
    const workspace = useComicDramaStore((state) => state.workspace);
    const confirmUpdate = useComicDramaStore((state) => state.confirmUpdate);

    const [statusFilter, setStatusFilter] = useState<string>("pending");
    const [operatingId, setOperatingId] = useState<string | null>(null);

    if (!workspace) return null;

    const impacts = workspace.impacts || [];

    const pendingImpacts = useMemo(() => {
        return impacts.filter((i) => i.status === "pending");
    }, [impacts]);

    const filteredImpacts = useMemo(() => {
        if (statusFilter === "pending") return pendingImpacts;
        return impacts.filter((i) => i.status !== "pending");
    }, [impacts, statusFilter, pendingImpacts]);

    const handleResolve = async (
        impact: ComicDramaChangeImpact,
        resolution: "keepOld" | "update"
    ) => {
        setOperatingId(impact.id);
        try {
            await confirmUpdate(impact.targetType, impact.targetId, resolution);
            message.success(
                resolution === "keepOld"
                    ? "已确认保留旧结果，不触发重新生成"
                    : "已标记需要更新，您可按需重新合成提示词或生成媒体"
            );
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        } finally {
            setOperatingId(null);
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <header className="flex flex-col gap-2 border-b border-[var(--studio-line)] pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-[var(--studio-ink)]">上游变更联动管理</h2>
                    <p className="mt-1 text-sm text-[var(--studio-muted)]">
                        当共享剧本、人物设定或场景描述修改后，系统精准追踪受影响的下游镜头与资产，并保留全部既有生成成果。未经您的明确确认，绝不自动覆盖或重复扣费。
                    </p>
                </div>
            </header>

            {pendingImpacts.length > 0 ? (
                <Alert
                    type="warning"
                    showIcon
                    title={`检测到 ${pendingImpacts.length} 项上游剧本或设定变更影响`}
                    description="“需要更新”仅代表剧本来源已发生变化，并不代表历史生成结果失效。您可以自由选择“保留旧结果”继续使用，或选择“确认更新”按新剧本重新制作。"
                />
            ) : (
                <Alert
                    type="success"
                    showIcon
                    title="当前下游生产内容与上游剧本保持完全同步"
                    description="所有镜头、提示词与视觉资产均为最新状态，暂无待确认的变更影响项。"
                />
            )}

            <div className="flex items-center justify-between">
                <Radio.Group
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    buttonStyle="solid"
                >
                    <Radio.Button value="pending">
                        待处理影响 ({pendingImpacts.length})
                    </Radio.Button>
                    <Radio.Button value="history">
                        已处理历史 ({impacts.length - pendingImpacts.length})
                    </Radio.Button>
                </Radio.Group>
            </div>

            {filteredImpacts.length === 0 ? (
                <Empty description={statusFilter === "pending" ? "暂无待处理的上游变更" : "暂无历史处理记录"} />
            ) : (
                <div className="grid gap-3">
                    {filteredImpacts.map((impact) => {
                        const isPending = impact.status === "pending";
                        const isLoading = operatingId === impact.id;

                        return (
                            <div
                                key={impact.id}
                                className="flex flex-col justify-between gap-3 rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-4 shadow-sm transition-all sm:flex-row sm:items-center"
                            >
                                <div className="flex items-start gap-3">
                                    <div className="mt-0.5 rounded-lg bg-[var(--studio-line)] p-2">
                                        {isPending ? (
                                            <AlertTriangle className="size-5 text-amber-500" />
                                        ) : (
                                            <CheckCircle2 className="size-5 text-emerald-500" />
                                        )}
                                    </div>

                                    <div className="flex flex-col gap-1">
                                        <div className="flex items-center gap-2">
                                            <Tag color={isPending ? "warning" : "default"}>
                                                {isPending ? "待处理" : impact.status === "accepted" ? "已确认更新" : "已保留旧成果"}
                                            </Tag>
                                            <span className="font-semibold text-[var(--studio-ink)]">
                                                {impact.changeSummary || "上游设定发生变动"}
                                            </span>
                                        </div>

                                        <p className="text-xs text-[var(--studio-muted)]">
                                            来源类型：{impact.sourceType} · 受影响目标：{impact.targetType} (#{impact.targetId})
                                        </p>
                                    </div>
                                </div>

                                {isPending ? (
                                    <Space>
                                        <Button
                                            size="small"
                                            loading={isLoading}
                                            onClick={() => handleResolve(impact, "keepOld")}
                                        >
                                            保留旧结果
                                        </Button>
                                        <Button
                                            size="small"
                                            type="primary"
                                            loading={isLoading}
                                            onClick={() => handleResolve(impact, "update")}
                                        >
                                            确认更新
                                        </Button>
                                    </Space>
                                ) : (
                                    <span className="text-xs text-[var(--studio-faint)]">
                                        处理时间：{new Date(impact.resolvedAt || impact.createdAt || "").toLocaleString("zh-CN")}
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
