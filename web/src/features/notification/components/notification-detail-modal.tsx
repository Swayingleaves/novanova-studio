"use client";

import { useEffect, useState } from "react";
import { App, Button, Modal } from "antd";

import { useNotificationStore } from "@/features/notification/stores/use-notification-store";
import type { SystemNotification } from "@/services/api/server";

type NotificationDetailModalProps = {
    notification: SystemNotification | null;
    onClose: () => void;
};

/**
 * 渲染固定尺寸的系统公告详情弹窗。
 *
 * @param props 当前公告与关闭回调
 * @return 公告详情弹窗
 */
export function NotificationDetailModal({ notification, onClose }: NotificationDetailModalProps) {
    const { message } = App.useApp();
    const unreadCount = useNotificationStore((state) => state.unreadCount);
    const markRead = useNotificationStore((state) => state.markRead);
    const markAllRead = useNotificationStore((state) => state.markAllRead);
    const [pendingAction, setPendingAction] = useState<"current" | "all" | null>(null);

    useEffect(() => {
        setPendingAction(null);
    }, [notification?.id]);

    if (!notification) return null;

    const handleMarkCurrentRead = async () => {
        setPendingAction("current");
        const succeeded = await markRead(notification.id);
        setPendingAction(null);
        if (succeeded) {
            onClose();
            return;
        }
        message.error("标记公告已读失败，请稍后重试");
    };

    const handleMarkAllRead = async () => {
        setPendingAction("all");
        const succeeded = await markAllRead();
        setPendingAction(null);
        if (succeeded) {
            onClose();
            return;
        }
        message.error("标记全部公告已读失败，请稍后重试");
    };

    return (
        <Modal
            title={notification.title || "公告详情"}
            open
            width={640}
            centered
            destroyOnHidden
            onCancel={onClose}
            footer={(
                <div className="flex justify-end gap-2">
                    <Button type="primary" disabled={Boolean(notification.read)} loading={pendingAction === "current"} onClick={() => void handleMarkCurrentRead()}>
                        我已阅读
                    </Button>
                    <Button disabled={unreadCount === 0} loading={pendingAction === "all"} onClick={() => void handleMarkAllRead()}>
                        全部已读
                    </Button>
                </div>
            )}
            styles={{ body: { height: 360, overflowY: "auto", paddingRight: 12 } }}
        >
            <div className="space-y-4">
                {notification.content ? <div className="whitespace-pre-wrap text-sm leading-7 text-[var(--studio-text)]">{notification.content}</div> : <div className="text-sm text-[var(--studio-faint)]">暂无内容</div>}
                <div className="border-t border-[var(--studio-line)] pt-3 text-xs text-[var(--studio-faint)]">
                    {notification.publishedAt ? `发布时间：${new Date(notification.publishedAt).toLocaleString()}` : `创建时间：${new Date(notification.createdAt).toLocaleString()}`}
                </div>
            </div>
        </Modal>
    );
}
