"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2, FileText, Image as ImageIcon, LoaderCircle, MapPin, MessageSquareText, Square, Video } from "lucide-react";
import { Button, Modal, Tooltip } from "antd";

import { formatBytes } from "@/features/generation/lib/image-utils";
import { useCanvasTheme } from "./canvas-theme-provider";

export type CanvasTaskPanelTask = {
    id: string;
    nodeId: string;
    runningNodeId: string;
    name: string;
    type: "image" | "video" | "text";
    status: "loading" | "success" | "error" | "idle";
    isRunning: boolean;
    prompt?: string;
    content?: string;
    errorDetails?: string;
    width?: number;
    height?: number;
    bytes?: number;
    durationMs?: number;
    startedAt?: string;
    completedAt?: string;
    batchCount?: number;
};

type CanvasTaskPanelProps = {
    tasks: CanvasTaskPanelTask[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onLocateTask: (task: CanvasTaskPanelTask) => void;
    onStopTask: (task: CanvasTaskPanelTask) => void;
};

export function CanvasTaskPanel({ tasks, open, onOpenChange, onLocateTask, onStopTask }: CanvasTaskPanelProps) {
    const theme = useCanvasTheme();
    const runningCount = tasks.filter((task) => task.isRunning).length;
    const panelStyle = { background: theme.node.panel, borderColor: theme.toolbar.border, color: theme.node.text, boxShadow: "0 18px 48px rgba(28,25,23,.16)" };

    return (
        <div className="relative">
            <Tooltip title="任务">
                <Button
                    type="text"
                    className="!px-2"
                    aria-pressed={open}
                    style={{ color: open ? theme.toolbar.activeGradientText : theme.node.text, background: open ? theme.toolbar.activeGradient : "transparent" }}
                    icon={runningCount ? <LoaderCircle className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                    onClick={() => onOpenChange(!open)}
                >
                    <span className="inline-flex items-center gap-1">
                        任务
                        <span className="text-xs font-normal leading-none" style={{ color: open ? theme.toolbar.activeGradientText : runningCount ? "#2f80ff" : theme.node.muted }}>
                            {runningCount ? `${runningCount}/${tasks.length}` : tasks.length}
                        </span>
                    </span>
                </Button>
            </Tooltip>

            {open ? (
                <div className="absolute right-0 top-12 z-[130] w-[min(380px,calc(100vw-24px))] overflow-hidden rounded-xl border" style={panelStyle} data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                    <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: theme.toolbar.border }}>
                        <div>
                            <div className="text-sm font-semibold">生成任务</div>
                            <div className="mt-0.5 text-xs" style={{ color: theme.node.muted }}>
                                {runningCount ? `${runningCount} 个进行中` : `${tasks.length} 个任务`}
                            </div>
                        </div>
                        <Button type="text" className="!h-8 !w-8 !min-w-8 !p-0" style={{ color: theme.node.muted }} onClick={() => onOpenChange(false)} aria-label="关闭任务面板">
                            ×
                        </Button>
                    </div>

                    <div className="thin-scrollbar max-h-[min(520px,calc(100vh-112px))] overflow-y-auto p-2">
                        {tasks.length ? (
                            <div className="grid gap-2">
                                {tasks.map((task) => (
                                    <TaskItem key={task.id} task={task} onLocateTask={onLocateTask} onStopTask={onStopTask} />
                                ))}
                            </div>
                        ) : (
                            <div className="flex h-36 flex-col items-center justify-center gap-2 text-center text-sm" style={{ color: theme.node.muted }}>
                                <CheckCircle2 className="size-6 opacity-45" />
                                <span>暂无生成任务</span>
                            </div>
                        )}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function TaskItem({ task, onLocateTask, onStopTask }: { task: CanvasTaskPanelTask; onLocateTask: (task: CanvasTaskPanelTask) => void; onStopTask: (task: CanvasTaskPanelTask) => void }) {
    const theme = useCanvasTheme();
    const state = taskState(task);
    const [detailOpen, setDetailOpen] = useState(false);

    return (
        <>
            <div
                className="group grid w-full grid-cols-[56px_minmax(0,1fr)] gap-3 rounded-lg border p-2.5 text-left transition hover:translate-y-[-1px]"
                style={{ background: theme.node.fill, borderColor: theme.toolbar.border, color: theme.node.text }}
            >
                <TaskPreview task={task} />
                <span className="flex min-w-0 flex-col gap-2">
                    <span className="flex min-w-0 items-start justify-between gap-2">
                        <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">{task.name}</span>
                            <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs" style={{ color: theme.node.muted }}>
                                <TaskTypeIcon type={task.type} className="size-3.5 shrink-0" />
                                <span>{taskTypeLabel(task.type)}</span>
                                {task.batchCount && task.batchCount > 1 ? <span>· {task.batchCount} 张</span> : null}
                            </span>
                        </span>
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium" style={{ background: state.background, color: state.color }}>
                            {state.icon}
                            {state.label}
                        </span>
                    </span>

                    <span className="min-h-5 truncate text-xs" style={{ color: task.status === "error" ? "#ef4444" : theme.node.muted }}>
                        {resultText(task)}
                    </span>

                    <span className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1">
                            <Button
                                size="small"
                                type="text"
                                className="!h-7 !rounded-md !px-2 !text-xs"
                                style={{ color: theme.node.text }}
                                icon={<MapPin className="size-3.5" />}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onLocateTask(task);
                                }}
                            >
                                定位节点
                            </Button>
                            <Button
                                size="small"
                                type="text"
                                className="!h-7 !rounded-md !px-2 !text-xs"
                                style={{ color: theme.node.text }}
                                icon={<FileText className="size-3.5" />}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    setDetailOpen(true);
                                }}
                            >
                                查看详情
                            </Button>
                        </span>
                        {task.isRunning ? (
                            <Button
                                size="small"
                                danger
                                className="!h-7"
                                icon={<Square className="size-3 fill-current" />}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onStopTask(task);
                                }}
                            >
                                停止
                            </Button>
                        ) : null}
                    </span>
                </span>
            </div>

            <Modal
                title="任务详情"
                open={detailOpen}
                onCancel={() => setDetailOpen(false)}
                footer={null}
                width={480}
                className="canvas-task-detail-modal"
                styles={{ body: { maxHeight: "min(520px, calc(100vh - 200px))", overflowY: "auto" } }}
            >
                <div className="grid gap-4 py-1">
                    <DetailRow label="任务名称" value={task.name} />
                    <DetailRow label="任务类型" value={taskTypeLabel(task.type)} icon={<TaskTypeIcon type={task.type} className="size-4" />} />
                    <DetailRow label="状态">
                        <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium" style={{ background: state.background, color: state.color }}>
                            {state.icon}
                            {state.label}
                        </span>
                    </DetailRow>
                    {task.durationMs ? <DetailRow label="耗时" value={`${Math.round(task.durationMs / 1000)} 秒`} /> : null}
                    {task.startedAt ? <DetailRow label="开始时间" value={task.startedAt} /> : null}
                    {task.completedAt ? <DetailRow label="完成时间" value={task.completedAt} /> : null}
                    {task.width && task.height ? <DetailRow label="尺寸" value={`${Math.round(task.width)} × ${Math.round(task.height)}`} /> : null}
                    {task.bytes ? <DetailRow label="文件大小" value={formatBytes(task.bytes)} /> : null}
                    {task.batchCount && task.batchCount > 1 ? <DetailRow label="生成数量" value={`${task.batchCount} 张`} /> : null}
                    {task.prompt ? (
                        <div className="grid gap-1">
                            <span className="text-xs font-medium" style={{ color: theme.node.muted }}>
                                提示词
                            </span>
                            <div
                                className="rounded-lg border p-3 text-xs leading-relaxed whitespace-pre-wrap"
                                style={{ borderColor: theme.toolbar.border, background: theme.node.fill, color: theme.node.text }}
                            >
                                {task.prompt}
                            </div>
                        </div>
                    ) : null}
                    {task.status === "error" && task.errorDetails ? (
                        <div className="grid gap-1">
                            <span className="text-xs font-medium" style={{ color: "#ef4444" }}>
                                错误信息
                            </span>
                            <div
                                className="rounded-lg border p-3 text-xs leading-relaxed whitespace-pre-wrap"
                                style={{ borderColor: "#ef4444", background: "rgba(239,68,68,.06)", color: "#ef4444" }}
                            >
                                {task.errorDetails}
                            </div>
                        </div>
                    ) : null}
                </div>
            </Modal>
        </>
    );
}

function DetailRow({ label, value, icon }: { label: string; value?: string; icon?: React.ReactNode }) {
    const theme = useCanvasTheme();
    return (
        <div className="flex items-center justify-between gap-4 text-sm">
            <span className="shrink-0 font-medium" style={{ color: theme.node.muted }}>
                {label}
            </span>
            <span className="min-w-0 truncate text-right" style={{ color: theme.node.text }}>
                {icon ? <span className="inline-flex items-center gap-1.5">{icon}{value}</span> : value}
            </span>
        </div>
    );
}

function TaskPreview({ task }: { task: CanvasTaskPanelTask }) {
    const theme = useCanvasTheme();
    if (task.type === "image" && task.content) return <img src={task.content} alt={task.name} className="h-14 w-14 rounded-lg object-cover" draggable={false} />;
    if (task.type === "video" && task.content) return <video src={task.content} className="h-14 w-14 rounded-lg bg-black object-cover" muted playsInline />;
    if (task.type === "text" && task.content)
        return (
            <span className="grid h-14 w-14 place-items-center overflow-hidden rounded-lg p-1 text-center text-[10px] leading-tight" style={{ background: theme.toolbar.itemHover, color: theme.node.muted }}>
                {task.content.slice(0, 24)}
            </span>
        );

    return (
        <span className="grid h-14 w-14 place-items-center rounded-lg" style={{ background: theme.toolbar.itemHover, color: theme.node.muted }}>
            {task.status === "loading" ? <LoaderCircle className="size-5 animate-spin" /> : <TaskTypeIcon type={task.type} className="size-5" />}
        </span>
    );
}

function TaskTypeIcon({ type, className }: { type: CanvasTaskPanelTask["type"]; className?: string }) {
    if (type === "video") return <Video className={className} />;
    if (type === "text") return <MessageSquareText className={className} />;
    return <ImageIcon className={className} />;
}

function taskTypeLabel(type: CanvasTaskPanelTask["type"]) {
    if (type === "video") return "视频生成";
    if (type === "text") return "文本生成";
    return "图片生成";
}

function taskState(task: CanvasTaskPanelTask) {
    if (task.isRunning || task.status === "loading") return { label: "进行中", color: "#2f80ff", background: "rgba(47,128,255,.12)", icon: <LoaderCircle className="size-3 animate-spin" /> };
    if (task.status === "success") return { label: "已完成", color: "#16a34a", background: "rgba(22,163,74,.12)", icon: <CheckCircle2 className="size-3" /> };
    if (task.status === "error") return { label: "失败", color: "#ef4444", background: "rgba(239,68,68,.12)", icon: <AlertCircle className="size-3" /> };
    return { label: "未完成", color: "#d97706", background: "rgba(217,119,6,.12)", icon: <AlertCircle className="size-3" /> };
}

function resultText(task: CanvasTaskPanelTask) {
    if (task.status === "error") return task.errorDetails || "生成失败";
    if (task.isRunning || task.status === "loading") return "等待生成结果";
    if (task.status !== "success") return task.prompt || "结果未生成";
    if (task.type === "text") return task.content ? `${task.content.slice(0, 40)}${task.content.length > 40 ? "..." : ""}` : "已生成结果";
    const size = task.width && task.height ? `${Math.round(task.width)} x ${Math.round(task.height)}` : "";
    const duration = task.durationMs ? `${Math.round(task.durationMs / 1000)} 秒` : "";
    const bytes = task.bytes ? formatBytes(task.bytes) : "";
    return [size, duration, bytes].filter(Boolean).join(" · ") || "已生成结果";
}
