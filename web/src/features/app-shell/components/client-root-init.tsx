"use client";
import { useTranslation } from "@/features/locale/use-translation";


import type { ReactNode } from "react";
import { useEffect } from "react";
import { App } from "antd";
import { usePathname } from "@/shared/lib/team-navigation";
import { usePathname as useBrowserPathname } from "next/navigation";

import { useCanvasStore } from "@/features/canvas/stores/use-canvas-store";
import { useAiTaskStore } from "@/features/ai-task/stores/use-ai-task-store";
import { useConfigStore } from "@/features/settings/stores/use-config-store";
import { useAssetStore } from "@/features/assets/stores/use-asset-store";
import { useNotificationStore } from "@/features/notification/stores/use-notification-store";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { getWalletBalances } from "@/services/api/team";
import { useTeamStore } from "@/features/team/stores/use-team-store";
import { getCurrentUserInfo, subscribeCreditBalanceEvents } from "@/services/api/server";
import { canInitializeSpaceBusiness } from "@/features/team/team-entry";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const translate = useTranslation();
    const { message } = App.useApp();
    const pathname = usePathname();
    const sessionHydrated = useUserStore((state) => state.hydrated);
    const hydrateSession = useUserStore((state) => state.hydrateSession);
    const user = useUserStore((state) => state.user);
    const authenticationRedirect = useUserStore((state) => state.authenticationRedirect);
    const team = useTeamStore((state) => state.team);
    const browserPathname = useBrowserPathname();
    const businessEnabled = sessionHydrated && Boolean(user) && !authenticationRedirect && canInitializeSpaceBusiness(browserPathname, team);
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
        if (!businessEnabled) return;
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
    }, [businessEnabled, setUser, user?.id]);

    useEffect(() => {
        if (!businessEnabled || !user) return;
        const userId = user.id;
        return subscribeCreditBalanceEvents((creditBalance) => {
            if (useUserStore.getState().user?.id === userId) {
                setCreditBalance(creditBalance);
            }
        });
    }, [businessEnabled, setCreditBalance, user?.id]);

    useEffect(() => {
        if (!businessEnabled) return;
        startTaskSubscribe();
        void Promise.all([hydrateConfig(), hydrateDocuments(), hydrateAssets(), hydrateRunningTasks()]).catch((error) => {
            message.error(error instanceof Error ? error.message : translate("appShell.failedToLoadServerData"));
        });
        return stopTaskSubscribe;
    }, [businessEnabled, hydrateAssets, hydrateConfig, hydrateDocuments, hydrateRunningTasks, message, startTaskSubscribe, stopTaskSubscribe, user]);

    useEffect(() => {
        if (!businessEnabled) return;
        let active = true;
        const reload = () => { void getWalletBalances().then((wallets) => { if (active) useTeamStore.getState().setWallets(wallets); }).catch(() => undefined); };
        reload();
        const timer = window.setInterval(reload, 30000);
        return () => { active = false; window.clearInterval(timer); };
    }, [businessEnabled, user?.id, user?.creditBalance]);

    // 公告轮询独立 effect，登录后每5分钟刷新。
    useEffect(() => {
        if (!businessEnabled) return;
        useNotificationStore.getState().loadNotifications();
        const timer = window.setInterval(() => useNotificationStore.getState().loadNotifications(), 30_000);
        return () => window.clearInterval(timer);
    }, [businessEnabled, pathname, user]);

    return <>{children}</>;
}
