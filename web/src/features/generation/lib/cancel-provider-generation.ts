"use client";

import { translateMessage } from "@/features/locale/translate";
import { cancelAiTask, isProviderRequestAlreadySentError, markGenerationCancelForfeit, type ServerAiTask } from "@/services/api/server";

export type CancelRefundOutcome = "empty" | "refunded" | "forfeited" | "declined";

type ConfirmModal = {
    confirm: (config: {
        title: string;
        content: string;
        okText: string;
        cancelText: string;
        okButtonProps?: { danger?: boolean };
        onOk?: () => void;
        onCancel?: () => void;
    }) => void;
};

/** 图片或视频任务是否已经把生成请求发往供应商且尚未结束。 */
export function isSubmittedMediaTask(task: Pick<ServerAiTask, "taskType" | "status" | "providerRequestSent">) {
    return (task.taskType === "image" || task.taskType === "video")
        && (task.status === "pending" || task.status === "running")
        && task.providerRequestSent === true;
}

function confirmForfeit(modal: ConfirmModal) {
    return new Promise<boolean>((resolve) => {
        modal.confirm({
            title: translateMessage("generation.cancelWithoutRefund"),
            content: translateMessage("generation.requestAlreadySentCancelKeepsTheCharge"),
            okText: translateMessage("generation.cancelWithoutRefundConfirm"),
            cancelText: translateMessage("generation.continueGenerating"),
            okButtonProps: { danger: true },
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
        });
    });
}

/** 先按可退款规则取消。服务端拒绝已发送的请求时，确认后只取消这些任务且不退款。 */
export async function cancelAiTasksWithRefundPolicy(taskIds: string[], modal: ConfirmModal): Promise<CancelRefundOutcome> {
    const ids = [...new Set(taskIds.filter(Boolean))];
    if (!ids.length) return "empty";
    const results = await Promise.allSettled(ids.map((taskId) => cancelAiTask(taskId)));
    const blocked = ids.filter((_, index) => {
        const result = results[index];
        return result.status === "rejected" && isProviderRequestAlreadySentError(result.reason);
    });
    const otherError = results.find((result) => result.status === "rejected" && !isProviderRequestAlreadySentError(result.reason));
    if (otherError?.status === "rejected" && !blocked.length) throw otherError.reason;
    if (!blocked.length) return "refunded";
    if (!await confirmForfeit(modal)) return "declined";
    markGenerationCancelForfeit(blocked);
    await Promise.all(blocked.map((taskId) => cancelAiTask(taskId, { forfeitRefund: true })));
    return "forfeited";
}

/** 对话停止先询问服务端。已发送的图片或视频请求需要确认后才真正取消，且不退款。 */
export async function runCancelWithProviderRequestPolicy(modal: ConfirmModal, cancel: (forfeitSubmittedGeneration: boolean) => Promise<void>) {
    try {
        await cancel(false);
        return true;
    } catch (error) {
        if (!isProviderRequestAlreadySentError(error)) throw error;
    }
    if (!await confirmForfeit(modal)) return false;
    await cancel(true);
    return true;
}
