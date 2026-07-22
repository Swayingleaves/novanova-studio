"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { LoaderCircle } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import { AppShell } from "@/features/app-shell/components/app-shell";
import { safeAuthRedirect } from "@/features/auth/lib/oauth2-login";
import { useUserStore } from "@/features/auth/stores/use-user-store";

export default function UserLayout({ children }: { children: ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const hydrated = useUserStore((state) => state.hydrated);
    const hydrateSession = useUserStore((state) => state.hydrateSession);
    const user = useUserStore((state) => state.user);
    const openAuthModal = useUserStore((state) => state.openAuthModal);

    useEffect(() => {
        hydrateSession();
    }, [hydrateSession]);

    /* 未登录时访问非首页路由 → 回首页并附加 redirect 参数 */
    useEffect(() => {
        if (!hydrated || user || pathname === "/") return;
        const target = typeof window === "undefined" ? pathname : `${window.location.pathname}${window.location.search}`;
        router.replace(`/?redirect=${encodeURIComponent(target)}`);
    }, [hydrated, pathname, router, user]);

    /* 首页检测 ?redirect= 参数 → 弹登录窗 */
    useEffect(() => {
        if (!hydrated || user || pathname !== "/") return;
        const params = new URLSearchParams(window.location.search);
        const redirect = params.get("redirect");
        if (redirect && safeAuthRedirect(redirect) !== "/") {
            openAuthModal(redirect);
        }
    }, [hydrated, user, pathname, openAuthModal]);

    /* hydration 未完成 → loading */
    if (!hydrated) {
        return <UserLoadingFallback />;
    }

    /* 未登录 + 非首页（正在重定向中）→ loading */
    if (!user && pathname !== "/") {
        return <UserLoadingFallback />;
    }

    return <AppShell>{children}</AppShell>;
}

function UserLoadingFallback() {
    return (
        <div className="studio-shell-bg flex h-dvh items-center justify-center text-[var(--studio-muted)]" role="status" aria-label="加载中">
            <LoaderCircle className="size-7 animate-spin" aria-hidden="true" />
        </div>
    );
}
