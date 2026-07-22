"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { AuthForm } from "@/features/auth/components/auth-form";
import { safeAuthRedirect } from "@/features/auth/lib/oauth2-login";
import { useUserStore } from "@/features/auth/stores/use-user-store";

export default function AuthPage() {
    return (
        <Suspense fallback={<main className="studio-shell-bg flex min-h-dvh items-center justify-center text-sm text-[var(--studio-muted)]">正在打开登录页...</main>}>
            <AuthPageContent />
        </Suspense>
    );
}

function AuthPageContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const hydrateSession = useUserStore((state) => state.hydrateSession);
    const hydrated = useUserStore((state) => state.hydrated);
    const user = useUserStore((state) => state.user);
    const redirect = safeAuthRedirect(searchParams.get("redirect"));

    useEffect(() => {
        hydrateSession();
    }, [hydrateSession]);

    useEffect(() => {
        if (hydrated && user) router.replace(redirect);
    }, [hydrated, redirect, router, user]);

    return (
        <div className="studio-shell-bg relative flex min-h-dvh items-center justify-center overflow-hidden px-4">
            <div className="studio-glass relative z-10 w-full max-w-[380px] rounded-xl p-8">
                <div className="mb-6">
                    <h1 className="studio-title text-2xl font-semibold">Novanova Studio</h1>
                    <p className="studio-subtitle mt-2 text-sm">登录后继续你的 AI 视觉创作工作台。</p>
                </div>
                <AuthForm onSuccess={() => router.replace(redirect)} redirectPath={redirect} />
            </div>
        </div>
    );
}
