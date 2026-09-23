"use client";

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
                    message.error(err instanceof Error ? err.message : "获取删除影响失败");
                })
                .finally(() => setLoading(false));
        }
    }, [open, shot, workspace, message]);

    if (!shot || !workspace) return null;

    const handleDelete = async () => {
        setDeleting(true);
        try {
            await deleteShot(shot.id, true);
            message.success(`镜头 #${shot.shotNumber} 已删除`);
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
                    <span>确认删除镜头 #{shot.shotNumber}？</span>
                </div>
            }
            open={open}
            onCancel={onClose}
            footer={[
                <Button key="cancel" onClick={onClose}>
                    取消
                </Button>,
                <Button key="delete" danger type="primary" loading={deleting} onClick={handleDelete}>
                    确认删除
                </Button>,
            ]}
        >
            <div className="flex flex-col gap-4 py-2">
                <div className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-3 text-sm">
                    <p className="font-medium text-[var(--studio-ink)]">
                        镜号 #{shot.shotNumber} · 景别：{shot.shotSize || "未设"} · 时长：{shot.durationSeconds}s
                    </p>
                    <p className="mt-1 text-xs text-[var(--studio-muted)]">
                        {shot.visualDescription || "暂无画面描述"}
                    </p>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-4">
                        <Spin description="正在预检受影响媒体..." />
                    </div>
                ) : impact ? (
                    impact.affectedMediaCount > 0 ? (
                        <Alert
                            type="warning"
                            showIcon
                            title={`注意：该镜头关联了 ${impact.affectedMediaCount} 个已生成的图片或视频素材`}
                            description="删除镜头将同时级联删除对应的提示词版本、绑定关系及该镜头专属的媒体记录。操作不可逆，请谨慎确认。"
                        />
                    ) : (
                        <Alert
                            type="info"
                            showIcon
                            title="该镜头尚未生成媒体素材，删除不会损失生成成果。"
                        />
                    )
                ) : null}
            </div>
        </Modal>
    );
}
