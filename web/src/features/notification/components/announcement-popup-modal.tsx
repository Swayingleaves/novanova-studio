"use client";

import { useEffect, useMemo, useState } from "react";
import { App, Button, Image, Modal } from "antd";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";

import { useUserStore } from "@/features/auth/stores/use-user-store";
import { currentLanguageTag } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";
import { applyAnnouncementTargetModel } from "@/features/notification/lib/announcement-action";
import {
    formatLocalDayKey,
    markAnnouncementSessionDismissed,
    markAnnouncementSuppressedToday,
    readDailySuppressedMap,
    readSessionDismissedIds,
    selectPopupAnnouncements,
} from "@/features/notification/lib/announcement-popup-policy";
import { useCachedNotificationImage } from "@/features/notification/lib/notification-image-cache";
import { useNotificationStore } from "@/features/notification/stores/use-notification-store";
import type { SystemNotification } from "@/services/api/server";
import { usePathname, useRouter } from "@/shared/lib/team-navigation";

export type AnnouncementPopupPreviewModalProps = {
    notification: SystemNotification | null;
    onClose: () => void;
    onTryAction?: (notification: SystemNotification) => void;
};

/**
 * 后台消息管理专用：以与用户端完全一致的居中弹窗样式预览单条公告效果。
 */
export function AnnouncementPopupPreviewModal({ notification, onClose, onTryAction }: AnnouncementPopupPreviewModalProps) {
    const translate = useTranslation();
    const cachedImageUrl = useCachedNotificationImage(notification?.imageUrl);
    if (!notification) return null;

    const hasTitle = Boolean(notification.title?.trim());
    const hasContent = Boolean(notification.content?.trim());
    const hasImage = Boolean(notification.imageUrl?.trim());
    const targetPath = notification.targetPath?.trim() || "";
    const actionLabel = notification.actionLabel?.trim() || "去试一试";
    const isImageOnly = hasImage && !hasTitle && !hasContent;

    const handleTry = () => {
        if (!targetPath) return;
        onTryAction?.(notification);
    };

    return (
        <Modal
            open
            centered
            width={isImageOnly ? 520 : 580}
            destroyOnHidden
            mask={{ closable: true }}
            title={hasTitle ? notification.title : isImageOnly ? null : translate("notification.announcementDetails")}
            onCancel={onClose}
            footer={
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <Button onClick={onClose}>今日不再提示</Button>
                    <div className="flex items-center gap-2">
                        <Button type={targetPath ? "default" : "primary"} onClick={onClose}>
                            不再提示
                        </Button>
                        {targetPath ? (
                            <Button
                                type="primary"
                                icon={<ArrowRight className="size-3.5" />}
                                iconPlacement="end"
                                onClick={handleTry}
                            >
                                {actionLabel}
                            </Button>
                        ) : null}
                    </div>
                </div>
            }
            styles={{ body: { maxHeight: "70vh", overflowY: "auto" } }}
        >
            <div className="space-y-4">
                {hasImage ? (
                    targetPath ? (
                        <button
                            type="button"
                            onClick={handleTry}
                            title={`点击${actionLabel}`}
                            className="group relative flex w-full cursor-pointer justify-center overflow-hidden rounded-lg bg-[var(--studio-surface-soft)] transition hover:opacity-95"
                        >
                            <img
                                src={cachedImageUrl || notification.imageUrl!}
                                alt={notification.title || "系统公告图片"}
                                className="max-h-[52vh] w-auto object-contain"
                            />
                        </button>
                    ) : (
                        <div className="flex justify-center overflow-hidden rounded-lg bg-[var(--studio-surface-soft)]">
                            <Image
                                src={cachedImageUrl || notification.imageUrl!}
                                alt={notification.title || "系统公告图片"}
                                className="max-h-[52vh] w-auto object-contain"
                            />
                        </div>
                    )
                ) : null}
                {hasContent ? (
                    <div className="whitespace-pre-wrap text-sm leading-7 text-[var(--studio-text)]">
                        {notification.content}
                    </div>
                ) : null}
                {!isImageOnly ? (
                    <div className="border-t border-[var(--studio-line)] pt-2.5 text-xs text-[var(--studio-faint)]">
                        {notification.publishedAt
                            ? translate("notification.published", { value0: new Date(notification.publishedAt).toLocaleString(currentLanguageTag()) })
                            : translate("notification.created", { value0: new Date(notification.createdAt).toLocaleString(currentLanguageTag()) })}
                    </div>
                ) : null}
            </div>
        </Modal>
    );
}

/**
 * 全局居中系统公告弹窗：
 * - 用户登录后拉取未读公告，按发布时间倒序合并在一个居中弹窗内翻页展示；
 * - 点击「不再提示」调后端标记永久已读；
 * - 点击「今日不再提示」记录当天本地静默（当天刷新/重登不再弹，次日重登仍可提醒）；
 * - 点击右上角关闭仅当前会话静默，退出重新登录或管理员发布新公告时会再次提醒。
 */
export function AnnouncementPopupModal() {
    const translate = useTranslation();
    const { message } = App.useApp();
    const pathname = usePathname();
    const router = useRouter();
    const user = useUserStore((state) => state.user);
    const showAuthModal = useUserStore((state) => state.showAuthModal);
    const notifications = useNotificationStore((state) => state.notifications);
    const loaded = useNotificationStore((state) => state.loaded);
    const loadNotifications = useNotificationStore((state) => state.loadNotifications);
    const markRead = useNotificationStore((state) => state.markRead);
    const markAllRead = useNotificationStore((state) => state.markAllRead);

    const [revision, setRevision] = useState(0);
    const [activeIndex, setActiveIndex] = useState(0);
    const [pendingAction, setPendingAction] = useState<"dismiss" | "today" | "all" | null>(null);

    // 登录后确保拉取最新公告，并在切回页面（跨日或管理员刚发新公告）时静默刷新。
    useEffect(() => {
        if (!user?.id) return;
        void loadNotifications();
        const reloadOnFocus = () => {
            if (document.visibilityState === "hidden") return;
            void loadNotifications();
            setRevision((value) => value + 1);
        };
        window.addEventListener("focus", reloadOnFocus);
        document.addEventListener("visibilitychange", reloadOnFocus);
        return () => {
            window.removeEventListener("focus", reloadOnFocus);
            document.removeEventListener("visibilitychange", reloadOnFocus);
        };
    }, [user?.id, loadNotifications]);

    const userIdKey = user?.id != null ? String(user.id) : "";
    const isAdminRoute = pathname.startsWith("/admin/") || pathname === "/admin";
    const shouldBlockPopup = !userIdKey || !loaded || showAuthModal || isAdminRoute || user?.welcomeRead === false;

    const popupItems = useMemo(() => {
        if (shouldBlockPopup || !userIdKey) return [];
        const todayKey = formatLocalDayKey();
        return selectPopupAnnouncements(notifications, {
            todayKey,
            sessionDismissedIds: readSessionDismissedIds(userIdKey),
            dailySuppressedMap: readDailySuppressedMap(userIdKey, todayKey),
        });
    }, [notifications, revision, shouldBlockPopup, userIdKey]);

    useEffect(() => {
        setActiveIndex((current) => (popupItems.length ? Math.min(current, popupItems.length - 1) : 0));
    }, [popupItems.length]);

    const currentItem = popupItems[activeIndex] ?? null;
    const cachedImageUrl = useCachedNotificationImage(currentItem?.imageUrl);
    if (!currentItem || !userIdKey) return null;

    const hasTitle = Boolean(currentItem.title?.trim());
    const hasContent = Boolean(currentItem.content?.trim());
    const hasImage = Boolean(currentItem.imageUrl?.trim());
    const targetPath = currentItem.targetPath?.trim() || "";
    const actionLabel = currentItem.actionLabel?.trim() || "去试一试";
    const isImageOnly = hasImage && !hasTitle && !hasContent;

    const handleCloseOnce = () => {
        markAnnouncementSessionDismissed(userIdKey, popupItems.map((item) => item.id));
        setRevision((value) => value + 1);
    };

    const handleTryAction = () => {
        if (!targetPath) return;
        applyAnnouncementTargetModel(currentItem.targetModel, targetPath);
        markAnnouncementSessionDismissed(userIdKey, [currentItem.id]);
        void markRead(currentItem.id);
        setRevision((value) => value + 1);
        router.push(targetPath);
    };

    const handleSuppressToday = () => {
        setPendingAction("today");
        markAnnouncementSuppressedToday(userIdKey, [currentItem.id]);
        setRevision((value) => value + 1);
        setPendingAction(null);
    };

    const handleDismissForever = async () => {
        setPendingAction("dismiss");
        const succeeded = await markRead(currentItem.id);
        setPendingAction(null);
        if (!succeeded) {
            message.error(translate("notification.failedToMarkAnnouncementReadTryLater"));
            return;
        }
        setRevision((value) => value + 1);
    };

    const handleDismissAllForever = async () => {
        setPendingAction("all");
        const succeeded = await markAllRead();
        setPendingAction(null);
        if (!succeeded) {
            message.error(translate("notification.failedToMarkAllAnnouncementsRead"));
            return;
        }
        setRevision((value) => value + 1);
    };

    return (
        <Modal
            open
            centered
            width={isImageOnly ? 520 : 580}
            destroyOnHidden
            mask={{ closable: false }}
            title={hasTitle ? currentItem.title : isImageOnly ? null : translate("notification.announcementDetails")}
            onCancel={handleCloseOnce}
            footer={
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <Button
                            disabled={pendingAction !== null}
                            loading={pendingAction === "today"}
                            onClick={handleSuppressToday}
                        >
                            今日不再提示
                        </Button>
                        {popupItems.length > 1 ? (
                            <div className="flex items-center gap-1 text-xs text-[var(--studio-muted)]">
                                <Button
                                    size="small"
                                    type="text"
                                    icon={<ChevronLeft className="size-3.5" />}
                                    disabled={activeIndex <= 0}
                                    aria-label="上一条公告"
                                    onClick={() => setActiveIndex((index) => Math.max(0, index - 1))}
                                />
                                <span className="tabular-nums">
                                    {activeIndex + 1} / {popupItems.length}
                                </span>
                                <Button
                                    size="small"
                                    type="text"
                                    icon={<ChevronRight className="size-3.5" />}
                                    disabled={activeIndex >= popupItems.length - 1}
                                    aria-label="下一条公告"
                                    onClick={() => setActiveIndex((index) => Math.min(popupItems.length - 1, index + 1))}
                                />
                            </div>
                        ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                        {popupItems.length > 1 ? (
                            <Button
                                disabled={pendingAction !== null}
                                loading={pendingAction === "all"}
                                onClick={() => void handleDismissAllForever()}
                            >
                                全部不再提示
                            </Button>
                        ) : null}
                        <Button
                            type={targetPath ? "default" : "primary"}
                            disabled={pendingAction !== null}
                            loading={pendingAction === "dismiss"}
                            onClick={() => void handleDismissForever()}
                        >
                            不再提示
                        </Button>
                        {targetPath ? (
                            <Button
                                type="primary"
                                icon={<ArrowRight className="size-3.5" />}
                                iconPlacement="end"
                                disabled={pendingAction !== null}
                                onClick={handleTryAction}
                            >
                                {actionLabel}
                            </Button>
                        ) : null}
                    </div>
                </div>
            }
            styles={{ body: { maxHeight: "70vh", overflowY: "auto" } }}
        >
            <div className="space-y-4">
                {hasImage ? (
                    targetPath ? (
                        <button
                            type="button"
                            onClick={handleTryAction}
                            title={`点击${actionLabel}`}
                            className="group relative flex w-full cursor-pointer justify-center overflow-hidden rounded-lg bg-[var(--studio-surface-soft)] transition hover:opacity-95"
                        >
                            <img
                                src={cachedImageUrl || currentItem.imageUrl!}
                                alt={currentItem.title || "系统公告图片"}
                                className="max-h-[52vh] w-auto object-contain"
                            />
                        </button>
                    ) : (
                        <div className="flex justify-center overflow-hidden rounded-lg bg-[var(--studio-surface-soft)]">
                            <Image
                                src={cachedImageUrl || currentItem.imageUrl!}
                                alt={currentItem.title || "系统公告图片"}
                                className="max-h-[52vh] w-auto object-contain"
                            />
                        </div>
                    )
                ) : null}
                {hasContent ? (
                    <div className="whitespace-pre-wrap text-sm leading-7 text-[var(--studio-text)]">
                        {currentItem.content}
                    </div>
                ) : null}
                {!isImageOnly ? (
                    <div className="border-t border-[var(--studio-line)] pt-2.5 text-xs text-[var(--studio-faint)]">
                        {currentItem.publishedAt
                            ? translate("notification.published", { value0: new Date(currentItem.publishedAt).toLocaleString(currentLanguageTag()) })
                            : translate("notification.created", { value0: new Date(currentItem.createdAt).toLocaleString(currentLanguageTag()) })}
                    </div>
                ) : null}
            </div>
        </Modal>
    );
}
