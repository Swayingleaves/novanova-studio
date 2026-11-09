"use client";

import { useTranslation } from "@/features/locale/use-translation";

import { Alert, App, Button, Empty, Input, Skeleton, Switch, Tag } from "antd";
import { Copy, Globe, RefreshCw, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { listOAuthProviders, updateOAuthProvider, type OAuthProviderInfo } from "@/services/api/server";
import { useCopyText } from "@/shared/hooks/use-copy-text";

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
 * 平台 OAuth 登录渠道配置：进入时读取全部渠道，每个渠道独立编辑和保存。
 *
 * @returns Google、linux.do 等 OAuth 渠道配置卡片
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

    const loadProviders = useCallback(async () => {
        setLoading(true);
        setLoadError("");
        try {
            const result = await listOAuthProviders();
            const nextBaselines = Object.fromEntries(result.providers.map((provider) => [provider.provider, toDraft(provider)] as const));
            setProviders(result.providers);
            setBaselines(nextBaselines);
            setDrafts(Object.fromEntries(Object.entries(nextBaselines).map(([provider, draft]) => [provider, { ...draft }] as const)));
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

    return (
        <div className="min-w-0 space-y-4">
            <div className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-3">
                <div className="text-sm font-semibold text-[var(--studio-ink)]">{translate("administration.oauthIntegration")}</div>
                <div className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">{translate("administration.oauthIntegrationHint")}</div>
            </div>
            {providers.length ? (
                providers.map((provider) => {
                    const draft = drafts[provider.provider];
                    const baseline = baselines[provider.provider];
                    if (!draft || !baseline) return null;
                    const saving = savingProvider === provider.provider;
                    const configured = isConfigured(draft);
                    const dirty = isDirty(draft, baseline);
                    const enabledInputId = `oauth-enabled-${provider.provider}`;
                    const clientIdInputId = `oauth-client-id-${provider.provider}`;
                    const clientSecretInputId = `oauth-client-secret-${provider.provider}`;
                    const redirectUriInputId = `oauth-redirect-uri-${provider.provider}`;
                    const defaultRedirectUri = () => `${window.location.origin}${provider.callbackPath}`;
                    return (
                        <section key={provider.provider} className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-panel)] p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-semibold text-[var(--studio-ink)]">{provider.displayName}</span>
                                        {!configured ? <Tag color="warning">{translate("administration.oauthNotConfigured")}</Tag> : draft.enabled ? <Tag color="success">{translate("administration.oauthEnabled")}</Tag> : <Tag>{translate("administration.oauthDisabled")}</Tag>}
                                    </div>
                                    <div className="mt-1 break-all text-xs text-[var(--studio-muted)]">
                                        {translate("administration.oauthCallbackPath")}：<span className="font-mono">{provider.callbackPath}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Switch id={enabledInputId} checked={draft.enabled} disabled={saving} onChange={(enabled) => updateDraft(provider.provider, { enabled })} />
                                    <label htmlFor={enabledInputId} className="block text-sm text-[var(--studio-text)]">
                                        {translate("administration.oauthProviderEnabled")}
                                    </label>
                                </div>
                            </div>
                            {draft.enabled && !configured ? <Alert className="mt-3" type="warning" showIcon title={translate("administration.oauthRequiredWhenEnabled")} /> : null}
                            <div className="mt-4 grid gap-4 md:grid-cols-2">
                                <label className="block" htmlFor={clientIdInputId}>
                                    <span className="mb-1 block text-xs font-medium text-[var(--studio-muted)]">{translate("administration.oauthClientId")}</span>
                                    <Input id={clientIdInputId} className="w-full!" value={draft.clientId} maxLength={255} disabled={saving} onChange={(event) => updateDraft(provider.provider, { clientId: event.target.value })} />
                                </label>
                                <label className="block" htmlFor={clientSecretInputId}>
                                    <span className="mb-1 block text-xs font-medium text-[var(--studio-muted)]">{translate("administration.oauthClientSecret")}</span>
                                    <Input.Password id={clientSecretInputId} className="w-full!" value={draft.clientSecret} maxLength={512} disabled={saving} onChange={(event) => updateDraft(provider.provider, { clientSecret: event.target.value })} />
                                </label>
                                <div className="md:col-span-2">
                                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                                        <label className="block text-xs font-medium text-[var(--studio-muted)]" htmlFor={redirectUriInputId}>
                                            {translate("administration.oauthRedirectUri")}
                                        </label>
                                        <div className="flex items-center gap-1">
                                            <Button size="small" type="link" icon={<Globe className="size-3.5" />} disabled={saving} onClick={() => updateDraft(provider.provider, { redirectUri: defaultRedirectUri() })}>
                                                {translate("administration.oauthUseCurrentOrigin")}
                                            </Button>
                                            <Button
                                                size="small"
                                                type="link"
                                                icon={<Copy className="size-3.5" />}
                                                disabled={saving}
                                                onClick={() => copyText(draft.redirectUri.trim() || defaultRedirectUri(), translate("administration.oauthCallbackCopied"))}
                                            >
                                                {translate("administration.oauthCopyCallback")}
                                            </Button>
                                        </div>
                                    </div>
                                    <Input id={redirectUriInputId} className="w-full!" value={draft.redirectUri} maxLength={512} placeholder={provider.callbackPath} disabled={saving} onChange={(event) => updateDraft(provider.provider, { redirectUri: event.target.value })} />
                                </div>
                            </div>
                            <div className="mt-4 flex justify-end">
                                <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={!dirty || (draft.enabled && !configured)} onClick={() => void saveProvider(provider)}>
                                    {translate("administration.oauthSave")}
                                </Button>
                            </div>
                        </section>
                    );
                })
            ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={translate("administration.oauthNoProviders")} />
            )}
        </div>
    );
}
