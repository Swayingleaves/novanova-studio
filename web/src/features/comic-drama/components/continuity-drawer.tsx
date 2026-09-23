"use client";

import { useState } from "react";
import { Alert, App, Button, Drawer, Empty, Space, Tag } from "antd";
import { AlertTriangle, CheckCircle2, ChevronRight, Eye, RefreshCw, ShieldCheck } from "lucide-react";

import { useComicDramaStore } from "../stores/use-comic-drama-store";
import type { ComicDramaContinuityIssue } from "../types";

type ContinuityDrawerProps = {
    open: boolean;
    onClose: () => void;
};

/** P1 视觉连续性诊断抽屉组件。 */
export function ContinuityDrawer({ open, onClose }: ContinuityDrawerProps) {
    const { message } = App.useApp();
    const workspace = useComicDramaStore((state) => state.workspace);
    const checkContinuity = useComicDramaStore((state) => state.checkContinuity);
    const setSelectedShotId = useComicDramaStore((state) => state.setSelectedShotId);
    const setActiveStage = useComicDramaStore((state) => state.setActiveStage);

    const [checking, setChecking] = useState(false);

    if (!workspace) return null;

    const issues = workspace.continuityIssues || [];
    const shots = workspace.shots || [];

    const handleRunCheck = async () => {
        setChecking(true);
        try {
            const list = await checkContinuity();
            if (list.length === 0) {
                message.success("诊断完成：相邻镜头视觉资产版本连续一致，未发现明显断层");
            } else {
                message.warning(`诊断完成：发现 ${list.length} 处潜在的视觉连续性衔接问题`);
            }
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        } finally {
            setChecking(false);
        }
    };

    const handleLocateShot = (shotId: string) => {
        setSelectedShotId(shotId);
        setActiveStage("shots");
        onClose();
    };

    return (
        <Drawer
            title={
                <div className="flex items-center gap-2">
                    <ShieldCheck className="size-5 text-[var(--studio-primary)]" />
                    <span>视觉连续性诊断 (Continuity Check)</span>
                </div>
            }
            open={open}
            onClose={onClose}
            size="large"
            extra={
                <Button
                    type="primary"
                    loading={checking}
                    icon={<RefreshCw className={`size-4 ${checking ? "animate-spin" : ""}`} />}
                    onClick={handleRunCheck}
                >
                    运行诊断
                </Button>
            }
        >
            <div className="flex flex-col gap-5">
                <Alert
                    type="info"
                    showIcon
                    title="相邻镜头资产版本一致性分析"
                    description="系统自动比对相邻镜头的角色服装版本、场景光照时间、重要道具状态与视线轴线，帮助在正式批量渲染前排除穿帮隐患。"
                />

                {issues.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                        <CheckCircle2 className="size-12 text-emerald-500" />
                        <h4 className="text-base font-semibold text-[var(--studio-ink)]">
                            未检测到视觉连续性问题
                        </h4>
                        <p className="max-w-sm text-xs text-[var(--studio-muted)]">
                            所有镜头的出场人物服装、场景版本与状态衔接自然，可放心进行后续画面与视频生产。
                        </p>
                        <Button loading={checking} onClick={handleRunCheck}>
                            重新诊断
                        </Button>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        <span className="text-xs font-semibold text-[var(--studio-muted)]">
                            发现 {issues.length} 条建议优化的衔接点：
                        </span>

                        {issues.map((issue, idx) => {
                            const currentShot = shots.find((s) => s.id === issue.shotId);
                            const prevShot = shots.find((s) => s.id === issue.previousShotId);
                            const isHigh = issue.severity === "high";

                            return (
                                <div
                                    key={idx}
                                    className="flex flex-col gap-2.5 rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-4 shadow-sm"
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                            <Tag color={isHigh ? "error" : "warning"}>
                                                {isHigh ? "显著差异" : "建议检查"}
                                            </Tag>
                                            <span className="font-semibold text-[var(--studio-ink)]">
                                                {issue.title}
                                            </span>
                                        </div>

                                        {currentShot && (
                                            <Button
                                                size="small"
                                                type="link"
                                                icon={<ChevronRight className="size-3.5" />}
                                                onClick={() => handleLocateShot(currentShot.id)}
                                            >
                                                查看镜头 #{currentShot.shotNumber}
                                            </Button>
                                        )}
                                    </div>

                                    <p className="text-xs leading-5 text-[var(--studio-text)]">
                                        {issue.description}
                                    </p>

                                    {issue.suggestion && (
                                        <div className="rounded-lg bg-[var(--studio-line)]/50 p-2.5 text-xs text-[var(--studio-muted)]">
                                            <strong className="text-[var(--studio-ink)]">修改建议：</strong>
                                            {issue.suggestion}
                                        </div>
                                    )}

                                    <div className="flex items-center gap-3 text-[11px] text-[var(--studio-faint)]">
                                        {prevShot && <span>上一个镜头: #{prevShot.shotNumber}</span>}
                                        {currentShot && <span>当前镜头: #{currentShot.shotNumber}</span>}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </Drawer>
    );
}
