"use client";
import { LanguageMenu } from "@/features/locale/components/language-menu";
import { useTranslation } from "@/features/locale/use-translation";


import { Suspense, useEffect, useRef, useState } from "react";
import { App, Button } from "antd";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { useRouter, useSearchParams } from "@/shared/lib/team-navigation";

import { consumeOAuth2Redirect, oauth2ErrorMessage } from "@/features/auth/lib/oauth2-login";
import { completeAuthentication } from "@/features/auth/lib/complete-authentication";
import { exchangeOAuth2LoginCode } from "@/services/api/server";

export default function OAuth2CallbackPage() {
    return (
        <Suspense fallback={<OAuth2CallbackLoading />}>
            <OAuth2CallbackContent />
        </Suspense>
    );
}

function OAuth2CallbackContent() {
    const translate = useTranslation();
    const { message } = App.useApp();
    const router = useRouter();
    const searchParams = useSearchParams();
    const handled = useRef(false);
    const [errorMessage, setErrorMessage] = useState("");
    const authorizationError = searchParams.get("error");
    const loginCode = searchParams.get("loginCode");

    useEffect(() => {
        if (handled.current) return;
        handled.current = true;
        let redirectPath: string | null;
        try { redirectPath = consumeOAuth2Redirect(); }
        catch (error) { setErrorMessage(error instanceof Error ? error.message : "登录跳转地址无效"); return; }
        if (redirectPath === null) {
            setErrorMessage(translate("auth.sessionStorageUnavailableCannotFinishSignIn"));
            return;
        }
        if (authorizationError) {
            setErrorMessage(oauth2ErrorMessage(authorizationError));
            return;
        }
        if (!loginCode) {
            setErrorMessage(translate("auth.oAuth2CallbackHasNoOneTimeCodeSignIn"));
            return;
        }
        void exchangeOAuth2LoginCode(loginCode)
            .then((session) => {
                completeAuthentication(session, redirectPath);
                message.success(translate("auth.signedIn"));
            })
            .catch((error) => {
                setErrorMessage(error instanceof Error ? error.message : translate("auth.oAuth2SignInFailedTryAgain"));
            });
    }, [authorizationError, loginCode, message]);

    if (!errorMessage) return <OAuth2CallbackLoading />;

    return (
        <main className="studio-shell-bg flex min-h-dvh items-center justify-center px-4">
            <div className="fixed right-4 top-4 z-50"><LanguageMenu /></div>
            <section className="studio-glass w-full max-w-[380px] rounded-xl p-8 text-center">
                <CircleAlert className="mx-auto size-8 text-[var(--studio-danger)]" aria-hidden="true" />
                <h1 className="studio-title mt-4 text-lg font-semibold">{translate("auth.signInIncomplete")}</h1>
                <p className="studio-subtitle mt-2 text-sm leading-6">{errorMessage}</p>
                <Button className="mt-6" type="primary" size="large" block onClick={() => router.replace("/auth")}>{translate("auth.backToSignIn")}</Button>
            </section>
        </main>
    );
}

function OAuth2CallbackLoading() {
    const translate = useTranslation();
    return (
        <main className="studio-shell-bg flex min-h-dvh items-center justify-center px-4" role="status" aria-label={translate("auth.completingSignIn")}>
            <div className="fixed right-4 top-4 z-50"><LanguageMenu /></div>
            <section className="studio-glass w-full max-w-[380px] rounded-xl p-8 text-center">
                <LoaderCircle className="mx-auto size-8 animate-spin text-[var(--studio-primary)] motion-reduce:animate-none" aria-hidden="true" />
                <h1 className="studio-title mt-4 text-lg font-semibold">{translate("auth.completingSignIn")}</h1>
                <p className="studio-subtitle mt-2 text-sm">{translate("auth.creatingYourLocalSignInSession")}</p>
            </section>
        </main>
    );
}
