"use client";

import { useEffect, useState } from "react";
import { App, Button } from "antd";
import { useTranslation } from "@/features/locale/use-translation";
import { getAiTaskInfo, requeryAiTask, type ServerAiTask } from "@/services/api/server";

/**
 * 失败任务上的再次查询按钮。没有供应商任务号时不显示。
 */
export function RequeryFailedTaskButton({ taskId, canRequery, onRestarted }: {
    taskId?: string;
    canRequery?: boolean;
    onRestarted?: (task: ServerAiTask) => void;
}) {
    const translate = useTranslation();
    const { message } = App.useApp();
    const [visible, setVisible] = useState(canRequery === true);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!taskId || canRequery === false) {
            setVisible(false);
            return;
        }
        if (canRequery === true) {
            setVisible(true);
            return;
        }
        let cancelled = false;
        void getAiTaskInfo(taskId).then((task) => {
            if (!cancelled) setVisible(task.status === "failed" && task.canRequery === true);
        }).catch(() => {
            if (!cancelled) setVisible(false);
        });
        return () => {
            cancelled = true;
        };
    }, [canRequery, taskId]);

    if (!visible || !taskId) return null;
    return (
        <Button
            size="small"
            loading={loading}
            className="nodrag nopan"
            onClick={(event) => {
                event.stopPropagation();
                setLoading(true);
                void requeryAiTask(taskId).then((task) => {
                    onRestarted?.(task);
                }).catch((error: unknown) => {
                    message.error(error instanceof Error ? error.message : translate("generation.requeryTaskFailed"));
                }).finally(() => setLoading(false));
            }}
        >
            {translate("generation.requeryTask")}
        </Button>
    );
}
