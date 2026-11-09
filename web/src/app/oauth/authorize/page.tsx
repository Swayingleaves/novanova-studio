"use client";

import { LanguageMenu } from "@/features/locale/components/language-menu";
import { useTranslation } from "@/features/locale/use-translation";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { approveOAuthAuthorization, denyOAuthAuthorization, getOAuthAuthorizationRequest, type OAuthAuthorizationRequestView } from "@/services/api/server";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "antd";
import { CircleAlert, LoaderCircle } from "lucide-react";

/** 只允许跳回 http(s) 回调，避免授权结果被带到站内路径。 */
const externalCallback = (value: string) => {
    try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
    } catch {
        return "";
    }
};

export default function OAuthAuthorizePage() {
    const translate = useTranslation();
    return (
        <Suspense fallback={<OAuthAuthorizeStatus label={translate("auth.externalAuthorizationPreparing")} />}>
            <OAuthAuthorizeContent />
        </Suspense>
    );
}

function OAuthAuthorizeContent() {
    const translate = useTranslation();
    const searchParams = useSearchParams();
    const requestId = searchParams.get("requestId")?.trim() ?? "";
    const hydrateSession = useUserStore((state) => state.hydrateSession);
    const hydrated = useUserStore((state) => state.hydrated);
    const user = useUserStore((state) => state.user);
    const [request, setRequest] = useState<OAuthAuthorizationRequestView | null>(null);
    const [errorMessage, setErrorMessage] = useState("");
    const [submitting, setSubmitting] = useState<"allow" | "deny" | "">("");

    useEffect(() => {
        hydrateSession();
    }, [hydrateSession]);

    useEffect(() => {
        if (!hydrated || !requestId || user) return;
        const redirect = `/oauth/authorize?requestId=${encodeURIComponent(requestId)}`;
        window.location.replace(`/auth?redirect=${encodeURIComponent(redirect)}`);
    }, [hydrated, requestId, user]);

    useEffect(() => {
        if (!hydrated || !user || !requestId) return;
        let cancelled = false;
        void getOAuthAuthorizationRequest(requestId)
            .then((view) => {
                if (!cancelled) setRequest(view);
            })
            .catch((error) => {
                if (!cancelled) setErrorMessage(error instanceof Error ? error.message : translate("auth.externalAuthorizationExpired"));
            });
        return () => {
            cancelled = true;
        };
    }, [hydrated, requestId, translate, user]);

    const finish = async (decision: "allow" | "deny") => {
        setSubmitting(decision);
        try {
            const result = decision === "allow" ? await approveOAuthAuthorization(requestId) : await denyOAuthAuthorization(requestId);
            const callback = externalCallback(result.redirectUrl);
            if (!callback) {
                setErrorMessage(translate("auth.externalAuthorizationFailed"));
                return;
            }
            window.location.replace(callback);
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : translate("auth.externalAuthorizationFailed"));
            setSubmitting("");
        }
    };

    if (!requestId) return <OAuthAuthorizeError message={translate("auth.externalAuthorizationMissingRequest")} />;
    if (errorMessage) return <OAuthAuthorizeError message={errorMessage} />;
    if (!request) return <OAuthAuthorizeStatus label={translate("auth.externalAuthorizationPreparing")} />;

    return (
        <main className="studio-shell-bg flex min-h-dvh items-center justify-center px-4">
            <div className="fixed right-4 top-4 z-50"><LanguageMenu /></div>
            <section className="studio-glass w-full max-w-[420px] rounded-xl p-8">
                <h1 className="studio-title text-xl font-semibold">{translate("auth.externalAuthorization")}</h1>
                <p className="studio-subtitle mt-3 text-sm leading-6">{translate("auth.externalAuthorizationDescription", { value0: request.displayName })}</p>
                <div className="mt-6 flex flex-col gap-3">
                    <Button type="primary" size="large" block loading={submitting === "allow"} disabled={submitting === "deny"} onClick={() => void finish("allow")}>{translate("auth.externalAuthorizationAllow")}</Button>
                    <Button size="large" block loading={submitting === "deny"} disabled={submitting === "allow"} onClick={() => void finish("deny")}>{translate("auth.externalAuthorizationDeny")}</Button>
                </div>
            </section>
        </main>
    );
}

function OAuthAuthorizeStatus({ label }: { label: string }) {
    return (
        <main className="studio-shell-bg flex min-h-dvh items-center justify-center px-4" role="status" aria-label={label}>
            <div className="fixed right-4 top-4 z-50"><LanguageMenu /></div>
            <LoaderCircle className="size-6 animate-spin text-[var(--studio-muted)]" aria-hidden="true" />
        </main>
    );
}

function OAuthAuthorizeError({ message }: { message: string }) {
    const translate = useTranslation();
    return (
        <main className="studio-shell-bg flex min-h-dvh items-center justify-center px-4">
            <div className="fixed right-4 top-4 z-50"><LanguageMenu /></div>
            <section className="studio-glass w-full max-w-[420px] rounded-xl p-8 text-center">
                <CircleAlert className="mx-auto size-8 text-[var(--studio-danger)]" aria-hidden="true" />
                <h1 className="studio-title mt-4 text-lg font-semibold">{translate("auth.externalAuthorization")}</h1>
                <p className="studio-subtitle mt-2 text-sm leading-6">{message}</p>
            </section>
        </main>
    );
}
