"use client";
import { LanguageMenu } from "@/features/locale/components/language-menu";
import { useTranslation } from "@/features/locale/use-translation";


import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { AuthForm } from "@/features/auth/components/auth-form";
import { safeAuthRedirect } from "@/features/auth/lib/oauth2-login";
import { useUserStore } from "@/features/auth/stores/use-user-store";

export default function AuthPage() {
    const translate = useTranslation();
    return (
        <Suspense fallback={<main className="studio-shell-bg flex min-h-dvh items-center justify-center text-sm text-[var(--studio-muted)]">
            <div className="fixed right-4 top-4 z-50"><LanguageMenu /></div>{translate("auth.openingSignIn")}</main>}>
            <AuthPageContent />
        </Suspense>
    );
}

function AuthPageContent() {
    const translate = useTranslation();
    const router = useRouter();
    const searchParams = useSearchParams();
    const hydrateSession = useUserStore((state) => state.hydrateSession);
    const hydrated = useUserStore((state) => state.hydrated);
    const user = useUserStore((state) => state.user);
    const redirect = safeAuthRedirect(searchParams.get("redirect"));
    const invitationCode = searchParams.get("invitationCode")?.trim() || undefined;

    useEffect(() => {
        hydrateSession();
    }, [hydrateSession]);

    useEffect(() => {
        if (hydrated && user) router.replace(redirect);
    }, [hydrated, redirect, router, user]);

    return (
        <div className="studio-shell-bg relative flex min-h-dvh items-center justify-center overflow-hidden px-4">
            <div className="fixed right-4 top-4 z-50"><LanguageMenu /></div>
            <div className="studio-glass relative z-10 w-full max-w-[380px] rounded-xl p-8">
                <div className="mb-6">
                    <h1 className="studio-title text-2xl font-semibold">Novanova Studio</h1>
                    <p className="studio-subtitle mt-2 text-sm">{translate("auth.signInToContinueCreatingWithAI")}</p>
                    {invitationCode ? <p className="mt-3 rounded-md bg-[var(--studio-surface-soft)] px-3 py-2 text-sm text-[var(--studio-text)]">{translate("auth.youAreSigningUpThroughAnInvitationYourInviter")}</p> : null}
                </div>
                <AuthForm onSuccess={() => router.replace(redirect)} redirectPath={redirect} invitationCode={invitationCode} />
            </div>
        </div>
    );
}
