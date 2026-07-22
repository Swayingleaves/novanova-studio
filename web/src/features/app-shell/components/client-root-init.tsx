"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { App } from "antd";
import { usePathname } from "next/navigation";

import { useCanvasStore } from "@/features/canvas/stores/use-canvas-store";
import { useAiTaskStore } from "@/features/ai-task/stores/use-ai-task-store";
import { useConfigStore } from "@/features/settings/stores/use-config-store";
import { useAssetStore } from "@/features/assets/stores/use-asset-store";
import { useNotificationStore } from "@/features/notification/stores/use-notification-store";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { getCurrentUserInfo, subscribeCreditBalanceEvents } from "@/services/api/server";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const pathname = usePathname();
    const sessionHydrated = useUserStore((state) => state.hydrated);
    const hydrateSession = useUserStore((state) => state.hydrateSession);
    const user = useUserStore((state) => state.user);
    const setUser = useUserStore((state) => state.setUser);
    const setCreditBalance = useUserStore((state) => state.setCreditBalance);
    const hydrateConfig = useConfigStore((state) => state.hydrateConfig);
    const hydrateDocuments = useCanvasStore((state) => state.hydrateDocuments);
    const hydrateAssets = useAssetStore((state) => state.hydrateAssets);
    const hydrateRunningTasks = useAiTaskStore((state) => state.hydrateRunningTasks);
    const startTaskSubscribe = useAiTaskStore((state) => state.startSubscribe);
    const stopTaskSubscribe = useAiTaskStore((state) => state.stopSubscribe);

    useEffect(() => {
        hydrateSession();
    }, [hydrateSession]);

    useEffect(() => {
        if (!sessionHydrated || !user) return;
        // 登录态只保存了快照，应用启动后以服务端余额覆盖，避免展示过期积分。
        let active = true;
        void getCurrentUserInfo()
            .then((profile) => {
                if (active) setUser(profile);
            })
            .catch(() => undefined);
        return () => {
            active = false;
        };
    }, [sessionHydrated, setUser, user?.id]);

    useEffect(() => {
        if (!user) return;
        const userId = user.id;
        return subscribeCreditBalanceEvents((creditBalance) => {
            if (useUserStore.getState().user?.id === userId) {
                setCreditBalance(creditBalance);
            }
        });
    }, [setCreditBalance, user?.id]);

    useEffect(() => {
        if (!sessionHydrated || !user) return;
        startTaskSubscribe();
        void Promise.all([hydrateConfig(), hydrateDocuments(), hydrateAssets(), hydrateRunningTasks()]).catch((error) => {
            message.error(error instanceof Error ? error.message : "加载后端数据失败");
        });
        return stopTaskSubscribe;
    }, [hydrateAssets, hydrateConfig, hydrateDocuments, hydrateRunningTasks, message, sessionHydrated, startTaskSubscribe, stopTaskSubscribe, user]);

    // 公告轮询独立 effect，登录后每5分钟刷新。
    useEffect(() => {
        if (!user || pathname === "/auth") return;
        useNotificationStore.getState().loadNotifications();
        const timer = window.setInterval(() => useNotificationStore.getState().loadNotifications(), 30_000);
        return () => window.clearInterval(timer);
    }, [pathname, user]);

    return <>{children}</>;
}
