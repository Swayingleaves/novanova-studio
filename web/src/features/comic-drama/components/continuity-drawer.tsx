"use client";

import { useTranslation } from "@/features/locale/use-translation";

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
    const translate = useTranslation();
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
                message.success(translate("comicDrama.checkCompleteAdjacentShotsUseConsistentVisualAssetVersionsWith"));
            } else {
                message.warning(translate("comicDrama.checkCompleteFoundCountPotentialVisualContinuityIssues", { value0: list.length }));
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
                    <span>{translate("comicDrama.visualContinuityCheck")}</span>
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
                    {translate("comicDrama.runCheck")}</Button>
            }
        >
            <div className="flex flex-col gap-5">
                <Alert
                    type="info"
                    showIcon
                    title={translate("comicDrama.assetVersionConsistencyAcrossAdjacentShots")}
                    description={translate("comicDrama.compareCharacterCostumesSceneLightingAndTimePropStatesAnd")}
                />

                {issues.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                        <CheckCircle2 className="size-12 text-emerald-500" />
                        <h4 className="text-base font-semibold text-[var(--studio-ink)]">
                            {translate("comicDrama.noVisualContinuityIssuesFound")}</h4>
                        <p className="max-w-sm text-xs text-[var(--studio-muted)]">
                            {translate("comicDrama.characterCostumesSceneVersionsAndStatesMatchAcrossShotsYou")}</p>
                        <Button loading={checking} onClick={handleRunCheck}>
                            {translate("comicDrama.runAgain")}</Button>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        <span className="text-xs font-semibold text-[var(--studio-muted)]">{translate("comicDrama.foundCountContinuityPointsToReview_758c90", { value0: issues.length })}</span>

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
                                                {isHigh ? translate("comicDrama.significantDifference") : translate("comicDrama.reviewSuggested")}
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
                                            >{translate("comicDrama.viewShotCount_8cdc59", { value0: currentShot.shotNumber })}</Button>
                                        )}
                                    </div>

                                    <p className="text-xs leading-5 text-[var(--studio-text)]">
                                        {issue.description}
                                    </p>

                                    {issue.suggestion && (
                                        <div className="rounded-lg bg-[var(--studio-line)]/50 p-2.5 text-xs text-[var(--studio-muted)]">
                                            <strong className="text-[var(--studio-ink)]">{translate("comicDrama.suggestion")}</strong>
                                            {issue.suggestion}
                                        </div>
                                    )}

                                    <div className="flex items-center gap-3 text-[11px] text-[var(--studio-faint)]">
                                        {prevShot && <span>{translate("comicDrama.previousShotCount_c36501", { value0: prevShot.shotNumber })}</span>}
                                        {currentShot && <span>{translate("comicDrama.currentShotCount_cba85e", { value0: currentShot.shotNumber })}</span>}
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
