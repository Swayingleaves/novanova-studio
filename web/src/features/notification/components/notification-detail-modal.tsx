"use client";
import { currentLanguageTag } from "@/features/locale/translate";

import { useTranslation } from "@/features/locale/use-translation";


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
    const translate = useTranslation();
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
        message.error(translate("notification.failedToMarkAnnouncementReadTryLater"));
    };

    const handleMarkAllRead = async () => {
        setPendingAction("all");
        const succeeded = await markAllRead();
        setPendingAction(null);
        if (succeeded) {
            onClose();
            return;
        }
        message.error(translate("notification.failedToMarkAllAnnouncementsRead"));
    };

    return (
        <Modal
            title={notification.title || translate("notification.announcementDetails")}
            open
            width={640}
            centered
            destroyOnHidden
            onCancel={onClose}
            footer={(
                <div className="flex justify-end gap-2">
                    <Button type="primary" disabled={Boolean(notification.read)} loading={pendingAction === "current"} onClick={() => void handleMarkCurrentRead()}>
                        {translate("notification.iHaveRead")}</Button>
                    <Button disabled={unreadCount === 0} loading={pendingAction === "all"} onClick={() => void handleMarkAllRead()}>
                        {translate("notification.markAllRead")}</Button>
                </div>
            )}
            styles={{ body: { height: 360, overflowY: "auto", paddingRight: 12 } }}
        >
            <div className="space-y-4">
                {notification.content ? <div className="whitespace-pre-wrap text-sm leading-7 text-[var(--studio-text)]">{notification.content}</div> : <div className="text-sm text-[var(--studio-faint)]">{translate("notification.noContent")}</div>}
                <div className="border-t border-[var(--studio-line)] pt-3 text-xs text-[var(--studio-faint)]">
                    {notification.publishedAt ? translate("notification.published", { value0: new Date(notification.publishedAt).toLocaleString(currentLanguageTag()) }) : translate("notification.created", { value0: new Date(notification.createdAt).toLocaleString(currentLanguageTag()) })}
                </div>
            </div>
        </Modal>
    );
}
