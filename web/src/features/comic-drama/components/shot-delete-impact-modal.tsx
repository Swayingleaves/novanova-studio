"use client";

import { productionParameterLabel } from "../lib/production-labels";

import { useTranslation } from "@/features/locale/use-translation";

import { useEffect, useState } from "react";
import { Alert, App, Button, Modal, Spin } from "antd";
import { AlertTriangle, Trash2 } from "lucide-react";

import { getComicDramaShotDeleteImpact } from "@/services/api/comic-drama";
import { useComicDramaStore } from "../stores/use-comic-drama-store";
import type { ComicDramaShot } from "../types";

type ShotDeleteImpactModalProps = {
    shot: ComicDramaShot | null;
    open: boolean;
    onClose: () => void;
};

/** 镜头删除前影响预检与二次确认弹窗。 */
export function ShotDeleteImpactModal({ shot, open, onClose }: ShotDeleteImpactModalProps) {
    const translate = useTranslation();
    const { message } = App.useApp();
    const workspace = useComicDramaStore((state) => state.workspace);
    const deleteShot = useComicDramaStore((state) => state.deleteShot);

    const [loading, setLoading] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [impact, setImpact] = useState<{
        shotId: string;
        affectedMediaCount: number;
        mediaIds: string[];
        requiresConfirmation: boolean;
    } | null>(null);

    useEffect(() => {
        if (open && shot && workspace) {
            setLoading(true);
            setImpact(null);
            getComicDramaShotDeleteImpact(workspace.projectId, shot.id)
                .then(setImpact)
                .catch((err) => {
                    message.error(err instanceof Error ? err.message : translate("comicDrama.couldNotCheckDeletionImpact"));
                })
                .finally(() => setLoading(false));
        }
    }, [open, shot, workspace, message]);

    if (!shot || !workspace) return null;

    const handleDelete = async () => {
        setDeleting(true);
        try {
            await deleteShot(shot.id, true);
            message.success(translate("comicDrama.shotCountDeleted", { value0: shot.shotNumber }));
            onClose();
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        } finally {
            setDeleting(false);
        }
    };

    return (
        <Modal
            title={
                <div className="flex items-center gap-2 text-rose-500">
                    <AlertTriangle className="size-5" />
                    <span>{translate("comicDrama.deleteShotCount_b2c3d2", { value0: shot.shotNumber })}</span>
                </div>
            }
            open={open}
            onCancel={onClose}
            footer={[
                <Button key="cancel" onClick={onClose}>
                    {translate("comicDrama.cancel")}</Button>,
                <Button key="delete" danger type="primary" loading={deleting} onClick={handleDelete}>
                    {translate("comicDrama.confirmDelete")}</Button>,
            ]}
        >
            <div className="flex flex-col gap-4 py-2">
                <div className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-3 text-sm">
                    <p className="font-medium text-[var(--studio-ink)]">{translate("comicDrama.shotCountSizeCountDurationCounts_fdbaa8", { value0: shot.shotNumber, value1: productionParameterLabel(shot.shotSize || "", translate) || translate("comicDrama.notSet"), value2: shot.durationSeconds })}</p>
                    <p className="mt-1 text-xs text-[var(--studio-muted)]">
                        {shot.visualDescription || translate("comicDrama.noVisualDescription")}
                    </p>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-4">
                        <Spin description={translate("comicDrama.checkingAffectedMedia")} />
                    </div>
                ) : impact ? (
                    impact.affectedMediaCount > 0 ? (
                        <Alert
                            type="warning"
                            showIcon
                            title={translate("comicDrama.thisShotHasCountGeneratedImagesOrVideos", { value0: impact.affectedMediaCount })}
                            description={translate("comicDrama.deletingTheShotAlsoDeletesItsPromptVersionsBindingsAnd")}
                        />
                    ) : (
                        <Alert
                            type="info"
                            showIcon
                            title={translate("comicDrama.thisShotHasNoGeneratedMediaSoNoGeneratedResults")}
                        />
                    )
                ) : null}
            </div>
        </Modal>
    );
}
