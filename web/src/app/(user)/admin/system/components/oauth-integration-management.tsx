"use client";

import { useTranslation } from "@/features/locale/use-translation";

import { Alert, App, Button, Empty, Input, Skeleton, Switch, Tag } from "antd";
import { Copy, Globe, RefreshCw, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { listOAuthProviders, updateOAuthProvider, type OAuthProviderInfo } from "@/services/api/server";
import { oauth2ProviderIconPath } from "@/features/auth/lib/oauth2-provider-icons";
import { useCopyText } from "@/shared/hooks/use-copy-text";
import { cn } from "@/shared/lib/utils";

/** OAuth 渠道的可编辑配置草案。 */
type OAuthProviderDraft = Pick<OAuthProviderInfo, "provider" | "enabled" | "clientId" | "clientSecret" | "redirectUri">;

/** 从服务端配置提取可编辑字段。 */
const toDraft = (provider: OAuthProviderInfo): OAuthProviderDraft => ({
    provider: provider.provider,
    enabled: provider.enabled,
    clientId: provider.clientId,
    clientSecret: provider.clientSecret,
    redirectUri: provider.redirectUri,
});

/** 三个字段都填写后才算完成配置。 */
const isConfigured = (draft: OAuthProviderDraft) => Boolean(draft.clientId.trim() && draft.clientSecret.trim() && draft.redirectUri.trim());

/** 判断草案相对已保存配置是否有改动。 */
const isDirty = (draft: OAuthProviderDraft, baseline: OAuthProviderDraft) =>
    draft.enabled !== baseline.enabled || draft.clientId !== baseline.clientId || draft.clientSecret !== baseline.clientSecret || draft.redirectUri !== baseline.redirectUri;

/**
 * 平台 OAuth 登录渠道配置：顶部按渠道切换，下方编辑并保存当前渠道，切换渠道不丢失其他渠道的编辑内容。
 *
 * @returns Google、linux.do 等 OAuth 渠道配置
 */
export function OAuthIntegrationManagement() {
    const translate = useTranslation();
    const { message } = App.useApp();
    const copyText = useCopyText();
    const [providers, setProviders] = useState<OAuthProviderInfo[]>([]);
    const [baselines, setBaselines] = useState<Record<string, OAuthProviderDraft>>({});
    const [drafts, setDrafts] = useState<Record<string, OAuthProviderDraft>>({});
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [savingProvider, setSavingProvider] = useState("");
    const [selectedProvider, setSelectedProvider] = useState("");

    const loadProviders = useCallback(async () => {
        setLoading(true);
        setLoadError("");
        try {
            const result = await listOAuthProviders();
            const nextBaselines = Object.fromEntries(result.providers.map((provider) => [provider.provider, toDraft(provider)] as const));
            setProviders(result.providers);
            setBaselines(nextBaselines);
            setDrafts(Object.fromEntries(Object.entries(nextBaselines).map(([provider, draft]) => [provider, { ...draft }] as const)));
            setSelectedProvider((current) => (result.providers.some((provider) => provider.provider === current) ? current : (result.providers[0]?.provider ?? "")));
        } catch (error) {
            setLoadError(error instanceof Error ? error.message : translate("administration.oauthLoadFailed"));
        } finally {
            setLoading(false);
        }
    }, [translate]);

    useEffect(() => {
        void loadProviders();
    }, [loadProviders]);

    const updateDraft = (provider: string, patch: Partial<OAuthProviderDraft>) => {
        setDrafts((current) => {
            const draft = current[provider];
            return draft ? { ...current, [provider]: { ...draft, ...patch } } : current;
        });
    };

    const saveProvider = async (provider: OAuthProviderInfo) => {
        const draft = drafts[provider.provider];
        if (!draft) return;
        setSavingProvider(provider.provider);
        try {
            const saved = await updateOAuthProvider({
                provider: draft.provider,
                enabled: draft.enabled,
                clientId: draft.clientId.trim(),
                clientSecret: draft.clientSecret.trim(),
                redirectUri: draft.redirectUri.trim(),
            });
            const savedDraft = toDraft(saved);
            setProviders((current) => current.map((item) => (item.provider === saved.provider ? saved : item)));
            setBaselines((current) => ({ ...current, [saved.provider]: savedDraft }));
            setDrafts((current) => ({ ...current, [saved.provider]: { ...savedDraft } }));
            message.success(translate("administration.oauthSaved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("administration.oauthSaveFailed"));
        } finally {
            setSavingProvider("");
        }
    };

    if (loading) {
        return (
            <div className="space-y-4">
                {[0, 1].map((index) => (
                    <div key={index} className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-panel)] p-4">
                        <Skeleton active paragraph={{ rows: 3 }} />
                    </div>
                ))}
            </div>
        );
    }

    if (loadError) {
        return (
            <Alert
                type="error"
                showIcon
                title={translate("administration.oauthLoadFailed")}
                description={loadError}
                action={
                    <Button icon={<RefreshCw className="size-4" />} onClick={() => void loadProviders()}>
                        {translate("administration.oauthRetry")}
                    </Button>
                }
            />
        );
    }

    // 当前选中的渠道，加载完成后默认选中第一个渠道。
    const activeProvider = providers.find((provider) => provider.provider === selectedProvider) ?? providers[0];
    const activeDraft = activeProvider ? drafts[activeProvider.provider] : undefined;
    const activeBaseline = activeProvider ? baselines[activeProvider.provider] : undefined;
    const activeSaving = activeProvider ? savingProvider === activeProvider.provider : false;
    const activeConfigured = activeDraft ? isConfigured(activeDraft) : false;
    const activeDirty = Boolean(activeDraft && activeBaseline && isDirty(activeDraft, activeBaseline));
    const activeProviderId = activeProvider?.provider ?? "";
    const currentOriginRedirectUri = () => `${window.location.origin}${activeProvider?.callbackPath ?? ""}`;

    return (
        <div className="min-w-0 space-y-4">
            <div className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-3">
                <div className="text-sm font-semibold text-[var(--studio-ink)]">{translate("administration.oauthIntegration")}</div>
                <div className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">{translate("administration.oauthIntegrationHint")}</div>
            </div>
            {activeProvider && activeDraft && activeBaseline ? (
                <>
                    <div role="tablist" aria-label={translate("administration.oauthIntegration")} className="flex w-full gap-1 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-1">
                        {providers.map((provider) => {
                            const selected = provider.provider === activeProvider.provider;
                            return (
                                <button
                                    key={provider.provider}
                                    type="button"
                                    role="tab"
                                    aria-selected={selected}
                                    className={cn(
                                        "flex min-w-0 flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--studio-action)]",
                                        selected ? "bg-[var(--studio-surface)] font-medium text-[var(--studio-ink)] shadow-sm ring-1 ring-[var(--studio-line)]" : "text-[var(--studio-muted)] hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]",
                                    )}
                                    onClick={() => setSelectedProvider(provider.provider)}
                                >
                                    <img src={oauth2ProviderIconPath(provider.provider)} alt="" aria-hidden="true" className="size-4 shrink-0" />
                                    <span className="truncate">{provider.displayName}</span>
                                </button>
                            );
                        })}
                    </div>
                    <section className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-panel)] p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <img src={oauth2ProviderIconPath(activeProvider.provider)} alt="" aria-hidden="true" className="size-5 shrink-0" />
                                    <span className="text-sm font-semibold text-[var(--studio-ink)]">{activeProvider.displayName}</span>
                                    {!activeConfigured ? <Tag color="warning">{translate("administration.oauthNotConfigured")}</Tag> : activeDraft.enabled ? <Tag color="success">{translate("administration.oauthEnabled")}</Tag> : <Tag>{translate("administration.oauthDisabled")}</Tag>}
                                </div>
                                <div className="mt-1 break-all text-xs text-[var(--studio-muted)]">
                                    {translate("administration.oauthCallbackPath")}：<span className="font-mono">{activeProvider.callbackPath}</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Switch id={`oauth-enabled-${activeProviderId}`} checked={activeDraft.enabled} disabled={activeSaving} onChange={(enabled) => updateDraft(activeProviderId, { enabled })} />
                                <label htmlFor={`oauth-enabled-${activeProviderId}`} className="block text-sm text-[var(--studio-text)]">
                                    {translate("administration.oauthProviderEnabled")}
                                </label>
                            </div>
                        </div>
                        {activeDraft.enabled && !activeConfigured ? <Alert className="mt-3" type="warning" showIcon title={translate("administration.oauthRequiredWhenEnabled")} /> : null}
                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                            <label className="block" htmlFor={`oauth-client-id-${activeProviderId}`}>
                                <span className="mb-1 block text-xs font-medium text-[var(--studio-muted)]">{translate("administration.oauthClientId")}</span>
                                <Input id={`oauth-client-id-${activeProviderId}`} className="w-full!" value={activeDraft.clientId} maxLength={255} disabled={activeSaving} onChange={(event) => updateDraft(activeProviderId, { clientId: event.target.value })} />
                            </label>
                            <label className="block" htmlFor={`oauth-client-secret-${activeProviderId}`}>
                                <span className="mb-1 block text-xs font-medium text-[var(--studio-muted)]">{translate("administration.oauthClientSecret")}</span>
                                <Input.Password id={`oauth-client-secret-${activeProviderId}`} className="w-full!" value={activeDraft.clientSecret} maxLength={512} disabled={activeSaving} onChange={(event) => updateDraft(activeProviderId, { clientSecret: event.target.value })} />
                            </label>
                            <div className="md:col-span-2">
                                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                                    <label className="block text-xs font-medium text-[var(--studio-muted)]" htmlFor={`oauth-redirect-uri-${activeProviderId}`}>
                                        {translate("administration.oauthRedirectUri")}
                                    </label>
                                    <div className="flex items-center gap-1">
                                        <Button size="small" type="link" icon={<Globe className="size-3.5" />} disabled={activeSaving} onClick={() => updateDraft(activeProviderId, { redirectUri: currentOriginRedirectUri() })}>
                                            {translate("administration.oauthUseCurrentOrigin")}
                                        </Button>
                                        <Button
                                            size="small"
                                            type="link"
                                            icon={<Copy className="size-3.5" />}
                                            disabled={activeSaving}
                                            onClick={() => copyText(activeDraft.redirectUri.trim() || currentOriginRedirectUri(), translate("administration.oauthCallbackCopied"))}
                                        >
                                            {translate("administration.oauthCopyCallback")}
                                        </Button>
                                    </div>
                                </div>
                                <Input id={`oauth-redirect-uri-${activeProviderId}`} className="w-full!" value={activeDraft.redirectUri} maxLength={512} placeholder={activeProvider.callbackPath} disabled={activeSaving} onChange={(event) => updateDraft(activeProviderId, { redirectUri: event.target.value })} />
                            </div>
                        </div>
                        <div className="mt-4 flex justify-end">
                            <Button type="primary" icon={<Save className="size-4" />} loading={activeSaving} disabled={!activeDirty || (activeDraft.enabled && !activeConfigured)} onClick={() => void saveProvider(activeProvider)}>
                                {translate("administration.oauthSave")}
                            </Button>
                        </div>
                    </section>
                </>
            ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={translate("administration.oauthNoProviders")} />
            )}
        </div>
    );
}
