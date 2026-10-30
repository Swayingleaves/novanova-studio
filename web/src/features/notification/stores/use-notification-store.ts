"use client";

import { create } from "zustand";

import { listMyNotifications, markAllNotificationsRead, markNotificationRead, type SystemNotification } from "@/services/api/server";
import { listMyInvitations, type TeamInvitation } from "@/services/api/team";

type NotificationStore = {
    notifications: SystemNotification[];
    /** 待接受团队邀请，直接复用邀请接口，不单独落通知表。 */
    invitations: TeamInvitation[];
    unreadCount: number;
    loaded: boolean;
    loadNotifications: () => Promise<void>;
    markRead: (notificationId: number) => Promise<boolean>;
    markAllRead: () => Promise<boolean>;
};

/** 邀请只能靠接受或撤销消解，不随「全部已读」消失。 */
const unreadTotal = (notifications: SystemNotification[], invitations: TeamInvitation[]) =>
    notifications.filter((notification) => !notification.read).length + invitations.length;

export const useNotificationStore = create<NotificationStore>()((set, get) => ({
    notifications: [],
    invitations: [],
    unreadCount: 0,
    loaded: false,
    loadNotifications: async () => {
        // 两类数据各自兜底：某一项失败时保留上一次结果，避免轮询抖动把角标清零。
        const [notifications, invitations] = await Promise.all([
            listMyNotifications().then((result) => result.notifications || []).catch(() => get().notifications),
            listMyInvitations().catch(() => get().invitations),
        ]);
        set({ notifications, invitations, unreadCount: unreadTotal(notifications, invitations), loaded: true });
    },
    markRead: async (notificationId: number) => {
        try {
            await markNotificationRead(notificationId);
            const notifications = get().notifications.map((notification) => (notification.id === notificationId ? { ...notification, read: true } : notification));
            set({ notifications, unreadCount: unreadTotal(notifications, get().invitations) });
            return true;
        } catch {
            return false;
        }
    },
    markAllRead: async () => {
        try {
            await markAllNotificationsRead();
            const notifications = get().notifications.map((notification) => ({ ...notification, read: true }));
            set({ notifications, unreadCount: unreadTotal(notifications, get().invitations) });
            return true;
        } catch {
            return false;
        }
    },
}));
