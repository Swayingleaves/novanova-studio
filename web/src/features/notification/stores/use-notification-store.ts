"use client";

import { create } from "zustand";

import { listMyNotifications, markAllNotificationsRead, markNotificationRead, type SystemNotification } from "@/services/api/server";

type NotificationStore = {
    notifications: SystemNotification[];
    unreadCount: number;
    loaded: boolean;
    loadNotifications: () => Promise<void>;
    markRead: (notificationId: number) => Promise<boolean>;
    markAllRead: () => Promise<boolean>;
};

export const useNotificationStore = create<NotificationStore>()((set, get) => ({
    notifications: [],
    unreadCount: 0,
    loaded: false,
    loadNotifications: async () => {
        try {
            const result = await listMyNotifications();
            const notifications = result.notifications || [];
            set({ notifications, unreadCount: notifications.filter((n) => !n.read).length, loaded: true });
        } catch {
            // 静默失败
        }
    },
    markRead: async (notificationId: number) => {
        try {
            await markNotificationRead(notificationId);
            const notifications = get().notifications.map((n) => (n.id === notificationId ? { ...n, read: true } : n));
            set({ notifications, unreadCount: notifications.filter((n) => !n.read).length });
            return true;
        } catch {
            return false;
        }
    },
    markAllRead: async () => {
        try {
            await markAllNotificationsRead();
            const notifications = get().notifications.map((notification) => ({ ...notification, read: true }));
            set({ notifications, unreadCount: 0 });
            return true;
        } catch {
            return false;
        }
    },
}));
