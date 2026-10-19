"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Alert, App, Button, Spin } from "antd";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { AuthBackdrop } from "@/features/auth/components/auth-backdrop";
import { useTeamStore } from "../stores/use-team-store";
import { subscribeSessionNavigation } from "../session-navigation";
import { isAuthenticationPath, parseSpacePath } from "../space-path";
import { loadTeamEntry } from "../team-entry";

/** 在任何业务初始化前解析URL团队，校验失败不会加载平台资源。 */
export function TeamBoundary({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    useEffect(() => { const handler = (event: Event) => { message.error((event as CustomEvent<string>).detail); }; window.addEventListener("team-switch-error", handler); return () => window.removeEventListener("team-switch-error", handler); }, [message]);
    const ready = useTeamStore((state) => state.ready);
    const pathname = usePathname();
    const { teamSlug } = parseSpacePath(pathname);
    const authenticationPage = isAuthenticationPath(pathname);
    const entryKey = `${teamSlug ? `team:${teamSlug}` : "platform"}:${authenticationPage ? "authentication" : "business"}`;
    const initialTeamSlug = useRef(teamSlug);
    const [resolvedEntry, setResolvedEntry] = useState("");
    const [error, setError] = useState("");
    useEffect(() => {
        // 跨空间的客户端导航必须重建整页，防止复用旧空间业务缓存和订阅。
        if (teamSlug !== initialTeamSlug.current) {
            useTeamStore.setState({ team: null, wallets: null, ready: false });
            window.location.reload();
            return;
        }
        const store = useUserStore.getState();
        store.hydrateSession();
        const controller = new AbortController();
        const unsubscribe = subscribeSessionNavigation(() => controller.abort());
        setError("");
        useTeamStore.setState({ team: null, wallets: null, ready: false });
        if (!teamSlug) {
            useTeamStore.getState().setTeam(null);
            setResolvedEntry(entryKey);
            return unsubscribe;
        }
        void (async () => {
            try {
                const team = await loadTeamEntry(teamSlug, authenticationPage, useUserStore.getState().token, controller.signal);
                if (controller.signal.aborted) return;
                useTeamStore.getState().setTeam(team);
                setResolvedEntry(entryKey);
            } catch (failure) {
                if (!controller.signal.aborted) {
                    setError(failure instanceof Error ? failure.message : "团队加载失败");
                    setResolvedEntry(entryKey);
                }
            }
        })();
        return () => { controller.abort(); unsubscribe(); };
    }, [authenticationPage, entryKey, teamSlug]);
    if (error && resolvedEntry === entryKey) return <main className="studio-shell-bg studio-page flex min-h-dvh flex-col items-center justify-center gap-6 p-8"><Alert type="error" showIcon title={error} /><Button onClick={() => window.location.assign("/teams")}>返回平台查看团队与邀请</Button></main>;
    if (!ready || resolvedEntry !== entryKey || teamSlug !== initialTeamSlug.current) return <div className="studio-shell-bg auth-stage studio-page relative flex min-h-dvh items-center justify-center overflow-hidden">{authenticationPage ? <AuthBackdrop /> : null}<Spin description="正在加载空间" /></div>;
    return children;
}
