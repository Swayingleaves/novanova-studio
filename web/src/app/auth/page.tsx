"use client";
import { useSpaceBrand } from "@/features/team/use-space-brand";
import { LanguageMenu } from "@/features/locale/components/language-menu";
import { useTranslation } from "@/features/locale/use-translation";


import { Suspense, useEffect, useRef } from "react";
import { useSearchParams } from "@/shared/lib/team-navigation";
import { Alert, Button, Typography } from "antd";
import { ArrowLeft } from "lucide-react";

import { AuthForm } from "@/features/auth/components/auth-form";
import { AuthBackdrop } from "@/features/auth/components/auth-backdrop";
import { PwaInstallButton } from "@/features/pwa/components/install-button";
import { resolveAuthenticationRedirect } from "@/features/auth/lib/authentication-path";
import { useTeamStore } from "@/features/team/stores/use-team-store";
import { useUserStore } from "@/features/auth/stores/use-user-store";

export default function AuthPage() {
    const translate = useTranslation();
    return (
        <Suspense fallback={<main className="studio-shell-bg auth-stage relative flex min-h-dvh items-center justify-center overflow-hidden text-sm text-[var(--studio-muted)]">
            <AuthBackdrop />
            <div className="fixed right-4 top-4 z-50"><LanguageMenu /></div><span className="relative">{translate("auth.openingSignIn")}</span></main>}>
            <AuthPageContent />
        </Suspense>
    );
}

function AuthPageContent() {
    const brand = useSpaceBrand();
    const translate = useTranslation();
    const searchParams = useSearchParams();
    const hydrateSession = useUserStore((state) => state.hydrateSession);
    const hydrated = useUserStore((state) => state.hydrated);
    const user = useUserStore((state) => state.user);
    const authenticationRedirect = useUserStore((state) => state.authenticationRedirect);
    const teamSlug = useTeamStore((state) => state.team?.teamSlug ?? null);
    const navigated = useRef(false);
    let redirect = "";
    let redirectError = "";
    try { redirect = resolveAuthenticationRedirect(searchParams.get("redirect"), teamSlug); }
    catch (error) { redirectError = error instanceof Error ? error.message : "登录跳转地址无效"; }
    const invitationCode = brand.isTeam ? undefined : searchParams.get("invitationCode")?.trim() || undefined;

    useEffect(() => {
        hydrateSession();
    }, [hydrateSession]);

    useEffect(() => {
        if (hydrated && user && !authenticationRedirect && !redirectError && !navigated.current) {
            navigated.current = true;
            window.location.replace(redirect);
        }
    }, [authenticationRedirect, hydrated, redirect, redirectError, user]);

    const authenticationContent = redirectError ? <Alert type="error" showIcon title={redirectError} /> : <AuthForm redirectPath={redirect} invitationCode={invitationCode} />;
    const brandIntroduction = brand.isTeam ? brand.introduction : brand.introduction || translate("auth.signInToContinueCreatingWithAI");

    return (
        <div className="studio-shell-bg auth-stage relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-8">
            <AuthBackdrop />
            <div className="fixed right-4 top-4 z-50"><LanguageMenu /></div>
            <div className="auth-card relative z-10 w-full max-w-[380px] rounded-xl p-8">
                <PwaInstallButton />
                <div className="mb-6">
                    <img src={brand.logoUrl} alt="" className="mb-3 size-12 object-contain" /><h1 className="studio-title wrap-anywhere text-2xl font-semibold">{brand.name}</h1>
                    {brandIntroduction ? <Typography.Paragraph
                        className="mt-2! mb-0! wrap-anywhere whitespace-pre-wrap text-sm!"
                        style={{ color: "var(--studio-muted)" }}
                        ellipsis={brand.isTeam ? { rows: 3, expandable: "collapsible", symbol: (expanded) => translate(expanded ? "auth.collapseTeamIntroduction" : "auth.expandTeamIntroduction") } : false}
                    >{brandIntroduction}</Typography.Paragraph> : null}
                    {invitationCode ? <p className="mt-3 rounded-md bg-[var(--studio-surface-soft)] px-3 py-2 text-sm text-[var(--studio-text)]">{translate("auth.youAreSigningUpThroughAnInvitationYourInviter")}</p> : null}
                </div>
                {authenticationContent}
                {brand.isTeam ? <Button type="link" block className="mt-4 min-h-11" href="/auth" icon={<ArrowLeft className="size-4" aria-hidden="true" />}>{translate("auth.backToPlatformSignIn")}</Button> : null}
            </div>
        </div>
    );
}
