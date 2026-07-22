"use client";

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { App, Button, Divider, Skeleton } from "antd";
import { LogIn } from "lucide-react";

import { storeOAuth2Redirect } from "@/features/auth/lib/oauth2-login";
import { listOAuth2Providers, type OAuth2ProviderInfo } from "@/services/api/server";

type OAuth2LoginOptionsProps = {
    /** OAuth2登录成功后的站内跳转目标 */
    redirectPath?: string;
};

const PROVIDER_ICON_PATHS: Record<string, string> = {
    google: "/icons/google.svg",
    linuxDo: "/icons/linuxdo.svg",
};

const PROVIDER_DISPLAY_ORDER: Record<string, number> = {
    google: 0,
    linuxDo: 1,
};

export function OAuth2LoginOptions({ redirectPath }: OAuth2LoginOptionsProps) {
    const { message } = App.useApp();
    const providerQuery = useQuery({
        queryKey: ["oauth2Providers"],
        queryFn: listOAuth2Providers,
        staleTime: 5 * 60 * 1000,
    });
    const providers = [...(providerQuery.data?.providers || [])]
        .sort((left, right) => (PROVIDER_DISPLAY_ORDER[left.providerId] ?? Number.MAX_SAFE_INTEGER)
            - (PROVIDER_DISPLAY_ORDER[right.providerId] ?? Number.MAX_SAFE_INTEGER));

    const startLogin = (provider: OAuth2ProviderInfo) => {
        if (!storeOAuth2Redirect(redirectPath)) {
            message.error("浏览器会话存储不可用，无法发起第三方登录");
            return;
        }
        window.location.assign(provider.authorizationPath);
    };

    if (providerQuery.isPending) {
        return (
            <OAuth2LoginSection>
                <div className="grid grid-cols-2 gap-2" aria-label="正在加载第三方登录方式">
                    <Skeleton.Button active block size="large" />
                    <Skeleton.Button active block size="large" />
                </div>
            </OAuth2LoginSection>
        );
    }

    if (providers.length) {
        return (
            <OAuth2LoginSection>
                <div className="grid grid-cols-2 gap-2">
                    {providers.map((provider) => (
                        <Button
                            key={provider.providerId}
                            size="large"
                            block
                            className={`h-11 min-w-0 border-[var(--studio-line)] bg-[var(--studio-panel-solid)] px-2 text-[var(--studio-text)] shadow-none hover:!border-[var(--studio-primary-line)] hover:!bg-[var(--studio-surface-hover)] hover:!text-[var(--studio-ink)] focus-visible:!outline-2 focus-visible:!outline-offset-2 focus-visible:!outline-[var(--studio-primary-line)] ${providers.length === 1 ? "col-span-2" : ""}`}
                            icon={providerIcon(provider)}
                            onClick={() => startLogin(provider)}
                        >
                            <span className="truncate">{provider.displayName}</span>
                        </Button>
                    ))}
                </div>
            </OAuth2LoginSection>
        );
    }

    return providerQuery.isError ? <OAuth2LoginSection><div className="text-center text-sm text-[var(--studio-muted)]">第三方登录暂不可用</div></OAuth2LoginSection> : null;
}

function OAuth2LoginSection({ children }: { children: ReactNode }) {
    return (
        <div className="mt-5">
            <Divider plain className="!my-4 !text-xs !text-[var(--studio-muted)]">或使用以下方式登录</Divider>
            {children}
        </div>
    );
}

function providerIcon(provider: OAuth2ProviderInfo) {
    const iconPath = PROVIDER_ICON_PATHS[provider.providerId];
    return iconPath
        ? <img src={iconPath} alt="" aria-hidden="true" className="size-5 shrink-0" />
        : <LogIn className="size-4" aria-hidden="true" />;
}
