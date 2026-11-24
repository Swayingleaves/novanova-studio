"use client";
import { currentLanguageTag } from "@/features/locale/translate";

import { useTranslation } from "@/features/locale/use-translation";


import { useEffect, useState } from "react";
import { App, Button, Image, Modal } from "antd";
import { ArrowRight } from "lucide-react";

import { applyAnnouncementTargetModel } from "@/features/notification/lib/announcement-action";
import { useNotificationStore } from "@/features/notification/stores/use-notification-store";
import { useCachedNotificationImage } from "@/features/notification/lib/notification-image-cache";
import { useRouter } from "@/shared/lib/team-navigation";
import type { SystemNotification } from "@/services/api/server";

type NotificationDetailModalProps = {
    notification: SystemNotification | null;
    onClose: () => void;
};

/**
 * 渲染固定尺寸的系统通知详情弹窗。
 *
 * @param props 当前通知与关闭回调
 * @return 通知详情弹窗
 */
export function NotificationDetailModal({ notification, onClose }: NotificationDetailModalProps) {
    const translate = useTranslation();
    const { message } = App.useApp();
    const router = useRouter();
    const hasUnreadAnnouncements = useNotificationStore((state) => state.notifications.some((item) => !item.read));
    const markRead = useNotificationStore((state) => state.markRead);
    const markAllRead = useNotificationStore((state) => state.markAllRead);
    const [pendingAction, setPendingAction] = useState<"current" | "all" | null>(null);
    const cachedImageUrl = useCachedNotificationImage(notification?.imageUrl);

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

    const targetPath = notification.targetPath?.trim() || "";
    const actionLabel = notification.actionLabel?.trim() || "去试一试";

    const handleTryAction = () => {
        if (!targetPath) return;
        applyAnnouncementTargetModel(notification.targetModel, targetPath);
        if (!notification.read) void markRead(notification.id);
        onClose();
        router.push(targetPath);
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
                    <Button type={targetPath ? "default" : "primary"} disabled={Boolean(notification.read)} loading={pendingAction === "current"} onClick={() => void handleMarkCurrentRead()}>
                        {translate("notification.iHaveRead")}</Button>
                    <Button disabled={!hasUnreadAnnouncements} loading={pendingAction === "all"} onClick={() => void handleMarkAllRead()}>
                        {translate("notification.markAllRead")}</Button>
                    {targetPath ? (
                        <Button type="primary" icon={<ArrowRight className="size-3.5" />} iconPlacement="end" onClick={handleTryAction}>
                            {actionLabel}
                        </Button>
                    ) : null}
                </div>
            )}
            styles={{ body: { height: 360, overflowY: "auto", paddingRight: 12 } }}
        >
            <div className="space-y-4">
                {notification.imageUrl ? (
                    targetPath ? (
                        <button
                            type="button"
                            onClick={handleTryAction}
                            title={`点击${actionLabel}`}
                            className="flex w-full cursor-pointer justify-center overflow-hidden rounded-lg bg-[var(--studio-surface-soft)] transition hover:opacity-95"
                        >
                            <img
                                src={cachedImageUrl || notification.imageUrl}
                                alt={notification.title || translate("notification.announcementDetails")}
                                className="max-h-64 w-auto object-contain"
                            />
                        </button>
                    ) : (
                        <div className="flex justify-center overflow-hidden rounded-lg bg-[var(--studio-surface-soft)]">
                            <Image
                                src={cachedImageUrl || notification.imageUrl}
                                alt={notification.title || translate("notification.announcementDetails")}
                                className="max-h-64 w-auto object-contain"
                            />
                        </div>
                    )
                ) : null}
                {notification.content ? (
                    <div className="whitespace-pre-wrap text-sm leading-7 text-[var(--studio-text)]">{notification.content}</div>
                ) : !notification.imageUrl ? (
                    <div className="text-sm text-[var(--studio-faint)]">{translate("notification.noContent")}</div>
                ) : null}
                <div className="border-t border-[var(--studio-line)] pt-3 text-xs text-[var(--studio-faint)]">
                    {notification.publishedAt ? translate("notification.published", { value0: new Date(notification.publishedAt).toLocaleString(currentLanguageTag()) }) : translate("notification.created", { value0: new Date(notification.createdAt).toLocaleString(currentLanguageTag()) })}
                </div>
            </div>
        </Modal>
    );
}
