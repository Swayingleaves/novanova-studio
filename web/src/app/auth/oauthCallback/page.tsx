"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { App, Button } from "antd";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { consumeOAuth2Redirect, oauth2ErrorMessage } from "@/features/auth/lib/oauth2-login";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { exchangeOAuth2LoginCode } from "@/services/api/server";

export default function OAuth2CallbackPage() {
    return (
        <Suspense fallback={<OAuth2CallbackLoading />}>
            <OAuth2CallbackContent />
        </Suspense>
    );
}

function OAuth2CallbackContent() {
    const { message } = App.useApp();
    const router = useRouter();
    const searchParams = useSearchParams();
    const setSession = useUserStore((state) => state.setSession);
    const handled = useRef(false);
    const [errorMessage, setErrorMessage] = useState("");
    const authorizationError = searchParams.get("error");
    const loginCode = searchParams.get("loginCode");

    useEffect(() => {
        if (handled.current) return;
        handled.current = true;
        const redirectPath = consumeOAuth2Redirect();
        if (redirectPath === null) {
            setErrorMessage("浏览器会话存储不可用，无法完成第三方登录。");
            return;
        }
        if (authorizationError) {
            setErrorMessage(oauth2ErrorMessage(authorizationError));
            return;
        }
        if (!loginCode) {
            setErrorMessage("OAuth2回调缺少一次性登录码，请重新登录。");
            return;
        }
        void exchangeOAuth2LoginCode(loginCode)
            .then((session) => {
                setSession(session);
                message.success("登录成功");
                router.replace(redirectPath);
            })
            .catch((error) => {
                setErrorMessage(error instanceof Error ? error.message : "OAuth2登录失败，请重新尝试。");
            });
    }, [authorizationError, loginCode, message, router, setSession]);

    if (!errorMessage) return <OAuth2CallbackLoading />;

    return (
        <main className="studio-shell-bg flex min-h-dvh items-center justify-center px-4">
            <section className="studio-glass w-full max-w-[380px] rounded-xl p-8 text-center">
                <CircleAlert className="mx-auto size-8 text-[var(--studio-danger)]" aria-hidden="true" />
                <h1 className="studio-title mt-4 text-lg font-semibold">登录未完成</h1>
                <p className="studio-subtitle mt-2 text-sm leading-6">{errorMessage}</p>
                <Button className="mt-6" type="primary" size="large" block onClick={() => router.replace("/auth")}>返回登录</Button>
            </section>
        </main>
    );
}

function OAuth2CallbackLoading() {
    return (
        <main className="studio-shell-bg flex min-h-dvh items-center justify-center px-4" role="status" aria-label="正在完成登录">
            <section className="studio-glass w-full max-w-[380px] rounded-xl p-8 text-center">
                <LoaderCircle className="mx-auto size-8 animate-spin text-[var(--studio-primary)] motion-reduce:animate-none" aria-hidden="true" />
                <h1 className="studio-title mt-4 text-lg font-semibold">正在完成登录</h1>
                <p className="studio-subtitle mt-2 text-sm">正在安全地创建本地登录会话...</p>
            </section>
        </main>
    );
}
