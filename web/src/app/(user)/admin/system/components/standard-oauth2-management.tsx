"use client";

import { useTranslation } from "@/features/locale/use-translation";

import { Alert, App, Button, Drawer, Empty, Form, Input, Select, Switch, Table, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Copy, Globe, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
    createStandardOAuthProvider,
    deleteStandardOAuthProvider,
    listStandardOAuthProviders,
    updateStandardOAuthProvider,
    type StandardOAuthProviderInfo,
    type StandardOAuthProviderInput,
} from "@/services/api/server";
import { useCopyText } from "@/shared/hooks/use-copy-text";

/** 标准 OAuth2 渠道 ID 前缀与随机十六进制位数：c + 20 位小写十六进制。 */
const PROVIDER_ID_PREFIX = "c";
const PROVIDER_ID_HEX_LENGTH = 20;

type StandardOAuthProviderFormValues = StandardOAuthProviderInput;

/** 生成 c + 20 位小写十六进制的渠道 ID。 */
const createProviderId = () => {
    const bytes = new Uint8Array(PROVIDER_ID_HEX_LENGTH / 2);
    crypto.getRandomValues(bytes);
    return `${PROVIDER_ID_PREFIX}${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
};

/** 服务端按渠道标识拼接标准 OAuth2 回调路径。 */
const callbackPathOf = (provider: string) => `/api/v1/auth/oauth/callback/${provider}`;

/** 判断渠道是否已填写完整配置，用于状态标签与启用前校验。 */
const hasCompleteConfiguration = (provider: Pick<StandardOAuthProviderInfo, "displayName" | "clientId" | "clientSecret" | "redirectUri" | "authorizationUri" | "tokenUri" | "userInfoUri" | "scopes" | "userNameAttribute" | "emailAttribute">) =>
    Boolean(
        provider.displayName.trim() &&
            provider.clientId.trim() &&
            provider.clientSecret.trim() &&
            provider.redirectUri.trim() &&
            provider.authorizationUri.trim() &&
            provider.tokenUri.trim() &&
            provider.userInfoUri.trim() &&
            provider.scopes.trim() &&
            provider.userNameAttribute.trim() &&
            provider.emailAttribute.trim(),
    );

/** 新增渠道的默认表单值，授权范围与用户字段使用服务端默认值。 */
const createDefaultFormValues = (provider: string): StandardOAuthProviderFormValues => ({
    provider,
    displayName: "",
    enabled: false,
    clientId: "",
    clientSecret: "",
    redirectUri: "",
    authorizationUri: "",
    tokenUri: "",
    userInfoUri: "",
    scopes: "profile email",
    clientAuthenticationMethod: "client_secret_basic",
    userNameAttribute: "sub",
    emailAttribute: "email",
    nicknameAttribute: "name",
    avatarAttribute: "picture",
});

/**
 * 平台标准 OAuth2 登录渠道管理：列表展示并支持新增、编辑、删除。
 *
 * @returns 标准 OAuth2 渠道表格与编辑抽屉
 */
export function StandardOAuth2Management() {
    const translate = useTranslation();
    const { message, modal } = App.useApp();
    const copyText = useCopyText();
    const [form] = Form.useForm<StandardOAuthProviderFormValues>();
    const [editingProvider, setEditingProvider] = useState<StandardOAuthProviderInfo | null>(null);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const providersQuery = useQuery({ queryKey: ["admin-standard-oauth-providers"], queryFn: listStandardOAuthProviders });
    const providers = providersQuery.data?.providers || [];
    const watchedProvider = Form.useWatch("provider", form) || "";
    const callbackPath = editingProvider?.callbackPath || (watchedProvider ? callbackPathOf(watchedProvider) : "");

    const statusTag = (provider: StandardOAuthProviderInfo) => {
        if (!hasCompleteConfiguration(provider)) return <Tag color="warning">{translate("administration.oauthNotConfigured")}</Tag>;
        return provider.enabled ? <Tag color="success">{translate("administration.oauthEnabled")}</Tag> : <Tag>{translate("administration.oauthDisabled")}</Tag>;
    };

    const openCreate = () => {
        const provider = createProviderId();
        setEditingProvider(null);
        form.setFieldsValue({ ...createDefaultFormValues(provider), displayName: translate("administration.standardOAuth2"), redirectUri: `${window.location.origin}${callbackPathOf(provider)}` });
        setDrawerOpen(true);
    };

    const openEdit = (provider: StandardOAuthProviderInfo) => {
        setEditingProvider(provider);
        form.setFieldsValue({
            provider: provider.provider,
            displayName: provider.displayName,
            enabled: provider.enabled,
            clientId: provider.clientId,
            clientSecret: provider.clientSecret,
            redirectUri: provider.redirectUri,
            authorizationUri: provider.authorizationUri,
            tokenUri: provider.tokenUri,
            userInfoUri: provider.userInfoUri,
            scopes: provider.scopes,
            clientAuthenticationMethod: provider.clientAuthenticationMethod,
            userNameAttribute: provider.userNameAttribute,
            emailAttribute: provider.emailAttribute,
            nicknameAttribute: provider.nicknameAttribute,
            avatarAttribute: provider.avatarAttribute,
        });
        setDrawerOpen(true);
    };

    /** 用当前域名与渠道回调路径生成回调地址。 */
    const currentOriginRedirectUri = () => `${window.location.origin}${callbackPath || callbackPathOf(String(form.getFieldValue("provider") || ""))}`;

    const copyCallback = () => copyText(String(form.getFieldValue("redirectUri") || "").trim() || currentOriginRedirectUri(), translate("administration.oauthCallbackCopied"));

    const copyProviderCallback = (provider: StandardOAuthProviderInfo) => copyText(provider.redirectUri.trim() || `${window.location.origin}${provider.callbackPath}`, translate("administration.oauthCallbackCopied"));

    const saveProvider = async () => {
        // 先检查启用完整性，避免表单必填错误抢先抛出而不展示启用提示。
        if (form.getFieldValue("enabled") && !hasCompleteConfiguration(form.getFieldsValue())) {
            message.error(translate("administration.standardOAuth2EnabledIncomplete"));
            return;
        }
        let values: StandardOAuthProviderFormValues;
        try {
            values = await form.validateFields();
        } catch {
            return;
        }
        const input: StandardOAuthProviderInput = {
            provider: editingProvider?.provider || values.provider,
            displayName: values.displayName.trim(),
            enabled: values.enabled,
            clientId: values.clientId.trim(),
            clientSecret: values.clientSecret.trim(),
            redirectUri: values.redirectUri.trim(),
            authorizationUri: values.authorizationUri.trim(),
            tokenUri: values.tokenUri.trim(),
            userInfoUri: values.userInfoUri.trim(),
            scopes: values.scopes.trim(),
            clientAuthenticationMethod: values.clientAuthenticationMethod,
            userNameAttribute: values.userNameAttribute.trim(),
            emailAttribute: values.emailAttribute.trim(),
            nicknameAttribute: values.nicknameAttribute.trim(),
            avatarAttribute: values.avatarAttribute.trim(),
        };
        setSaving(true);
        try {
            if (editingProvider) await updateStandardOAuthProvider(input);
            else await createStandardOAuthProvider(input);
            await providersQuery.refetch();
            setDrawerOpen(false);
            message.success(editingProvider ? translate("administration.standardOAuth2Updated") : translate("administration.standardOAuth2Created"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : editingProvider ? translate("administration.standardOAuth2UpdateFailed") : translate("administration.standardOAuth2CreateFailed"));
        } finally {
            setSaving(false);
        }
    };

    const removeProvider = (provider: StandardOAuthProviderInfo) => {
        modal.confirm({
            title: translate("administration.standardOAuth2Delete"),
            content: translate("administration.standardOAuth2DeleteConfirm", { value0: provider.displayName || provider.provider }),
            okText: translate("administration.delete"),
            okType: "danger",
            cancelText: translate("administration.cancel"),
            onOk: async () => {
                try {
                    await deleteStandardOAuthProvider(provider.provider);
                    message.success(translate("administration.standardOAuth2Deleted"));
                    await providersQuery.refetch();
                } catch (error) {
                    message.error(error instanceof Error ? error.message : translate("administration.standardOAuth2DeleteFailed"));
                }
            },
        });
    };

    const columns: ColumnsType<StandardOAuthProviderInfo> = [
        {
            title: translate("administration.standardOAuth2DisplayName"),
            dataIndex: "displayName",
            width: 220,
            render: (_, provider) => (
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 font-medium text-[var(--studio-ink)]">
                        <span className="wrap-anywhere">{provider.displayName || provider.provider}</span>
                        {statusTag(provider)}
                    </div>
                    <div className="mt-1 truncate font-mono text-xs text-[var(--studio-muted)]">{provider.provider}</div>
                </div>
            ),
        },
        {
            title: translate("administration.standardOAuth2AuthorizationUri"),
            dataIndex: "authorizationUri",
            ellipsis: true,
            render: (authorizationUri: string) => <span className="text-xs text-[var(--studio-muted)]">{authorizationUri || "—"}</span>,
        },
        {
            title: translate("administration.oauthRedirectUri"),
            dataIndex: "redirectUri",
            width: 320,
            render: (_, provider) => (
                <div className="flex min-w-0 items-center gap-1">
                    <span className="min-w-0 flex-1 truncate text-xs text-[var(--studio-muted)]" title={provider.redirectUri || provider.callbackPath}>
                        {provider.redirectUri || provider.callbackPath}
                    </span>
                    <Tooltip title={translate("administration.oauthCopyCallback")}>
                        <Button size="small" type="text" icon={<Copy className="size-3.5" />} aria-label={translate("administration.oauthCopyCallback")} onClick={() => copyProviderCallback(provider)} />
                    </Tooltip>
                </div>
            ),
        },
        {
            title: translate("administration.standardOAuth2UserNameAttribute"),
            dataIndex: "userNameAttribute",
            width: 160,
            render: (userNameAttribute: string) => <span className="font-mono text-xs text-[var(--studio-muted)]">{userNameAttribute || "—"}</span>,
        },
        {
            title: translate("administration.actions"),
            width: 180,
            fixed: "right",
            render: (_, provider) => (
                <div className="flex flex-wrap items-center gap-2">
                    <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => openEdit(provider)}>
                        {translate("administration.edit")}
                    </Button>
                    <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => removeProvider(provider)}>
                        {translate("administration.delete")}
                    </Button>
                </div>
            ),
        },
    ];

    return (
        <div className="min-w-0">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-3">
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-[var(--studio-ink)]">{translate("administration.standardOAuth2")}</div>
                    <div className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">{translate("administration.standardOAuth2Hint")}</div>
                    <div className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">{translate("administration.standardOAuth2TrustedEmailHint")}</div>
                </div>
                <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>
                    {translate("administration.standardOAuth2Add")}
                </Button>
            </div>
            {providersQuery.isError && !providers.length ? (
                <Alert
                    type="error"
                    showIcon
                    title={translate("administration.standardOAuth2LoadFailed")}
                    description={providersQuery.error instanceof Error ? providersQuery.error.message : undefined}
                    action={
                        <Button icon={<RefreshCw className="size-4" />} onClick={() => void providersQuery.refetch()}>
                            {translate("administration.reload")}
                        </Button>
                    }
                />
            ) : (
                <Table<StandardOAuthProviderInfo>
                    rowKey="provider"
                    tableLayout="fixed"
                    loading={providersQuery.isLoading}
                    dataSource={providers}
                    columns={columns}
                    pagination={false}
                    scroll={{ x: 1_100 }}
                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={translate("administration.standardOAuth2Empty")} /> }}
                />
            )}

            <Drawer
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                title={editingProvider ? translate("administration.standardOAuth2Edit") : translate("administration.standardOAuth2Add")}
                size={680}
                destroyOnHidden
                footer={
                    <div className="flex justify-end gap-2">
                        <Button onClick={() => setDrawerOpen(false)}>{translate("administration.cancel")}</Button>
                        <Button type="primary" loading={saving} onClick={() => void saveProvider()}>
                            {translate("administration.oauthSave")}
                        </Button>
                    </div>
                }
            >
                <Form form={form} layout="vertical" requiredMark={false}>
                    <section className="space-y-4">
                        <h3 className="text-sm font-semibold text-[var(--studio-ink)]">{translate("administration.standardOAuth2ApplicationCredentials")}</h3>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Form.Item name="displayName" label={translate("administration.standardOAuth2DisplayName")} className="mb-0" rules={[{ required: true, whitespace: true, message: translate("administration.standardOAuth2DisplayNameRequired") }]}>
                                <Input maxLength={50} className="w-full!" />
                            </Form.Item>
                            <Form.Item name="provider" label={translate("administration.standardOAuth2ProviderId")} className="mb-0">
                                <Input disabled maxLength={30} className="w-full!" />
                            </Form.Item>
                            <Form.Item name="clientId" label={translate("administration.oauthClientId")} className="mb-0">
                                <Input maxLength={255} className="w-full!" />
                            </Form.Item>
                            <Form.Item name="clientSecret" label={translate("administration.oauthClientSecret")} className="mb-0" extra={editingProvider ? translate("administration.standardOAuth2ClientSecretHint") : undefined}>
                                <Input.Password maxLength={512} className="w-full!" autoComplete="new-password" />
                            </Form.Item>
                            <Form.Item
                                name="redirectUri"
                                label={translate("administration.oauthRedirectUri")}
                                className="mb-0 sm:col-span-2"
                                extra={
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <span className="break-all">
                                            {translate("administration.oauthCallbackPath")}：<span className="font-mono">{callbackPath || "—"}</span>
                                        </span>
                                        <div className="flex items-center gap-1">
                                            <Button size="small" type="link" icon={<Globe className="size-3.5" />} onClick={() => form.setFieldValue("redirectUri", currentOriginRedirectUri())}>
                                                {translate("administration.oauthUseCurrentOrigin")}
                                            </Button>
                                            <Button size="small" type="link" icon={<Copy className="size-3.5" />} onClick={copyCallback}>
                                                {translate("administration.oauthCopyCallback")}
                                            </Button>
                                        </div>
                                    </div>
                                }
                            >
                                <Input maxLength={512} className="w-full!" placeholder={callbackPath} />
                            </Form.Item>
                        </div>
                    </section>

                    <section className="mt-6 space-y-4 border-t border-[var(--studio-line)] pt-5">
                        <h3 className="text-sm font-semibold text-[var(--studio-ink)]">{translate("administration.standardOAuth2AuthenticationEndpoints")}</h3>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Form.Item name="authorizationUri" label={translate("administration.standardOAuth2AuthorizationUri")} className="mb-0">
                                <Input maxLength={512} className="w-full!" placeholder="https://..." />
                            </Form.Item>
                            <Form.Item name="tokenUri" label={translate("administration.standardOAuth2TokenUri")} className="mb-0">
                                <Input maxLength={512} className="w-full!" placeholder="https://..." />
                            </Form.Item>
                            <Form.Item name="userInfoUri" label={translate("administration.standardOAuth2UserInfoUri")} className="mb-0 sm:col-span-2">
                                <Input maxLength={512} className="w-full!" placeholder="https://..." />
                            </Form.Item>
                            <Form.Item name="clientAuthenticationMethod" label={translate("administration.standardOAuth2ClientAuthenticationMethod")} className="mb-0">
                                <Select
                                    className="w-full!"
                                    options={[
                                        { value: "client_secret_basic", label: translate("administration.standardOAuth2ClientSecretBasic") },
                                        { value: "client_secret_post", label: translate("administration.standardOAuth2ClientSecretPost") },
                                    ]}
                                />
                            </Form.Item>
                            <Form.Item name="scopes" label={translate("administration.standardOAuth2Scopes")} className="mb-0" extra={translate("administration.standardOAuth2ScopesHint")}>
                                <Input maxLength={255} className="w-full!" placeholder="profile email" />
                            </Form.Item>
                        </div>
                    </section>

                    <section className="mt-6 space-y-4 border-t border-[var(--studio-line)] pt-5">
                        <div>
                            <h3 className="text-sm font-semibold text-[var(--studio-ink)]">{translate("administration.standardOAuth2UserInfoMapping")}</h3>
                            <p className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">{translate("administration.standardOAuth2UserInfoMappingHint")}</p>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Form.Item name="userNameAttribute" label={translate("administration.standardOAuth2UserNameAttribute")} className="mb-0">
                                <Input maxLength={64} className="w-full!" />
                            </Form.Item>
                            <Form.Item name="emailAttribute" label={translate("administration.standardOAuth2EmailAttribute")} className="mb-0">
                                <Input maxLength={64} className="w-full!" />
                            </Form.Item>
                            <Form.Item name="nicknameAttribute" label={translate("administration.standardOAuth2NicknameAttribute")} className="mb-0">
                                <Input maxLength={64} className="w-full!" />
                            </Form.Item>
                            <Form.Item name="avatarAttribute" label={translate("administration.standardOAuth2AvatarAttribute")} className="mb-0">
                                <Input maxLength={64} className="w-full!" />
                            </Form.Item>
                        </div>
                    </section>

                    <section className="mt-6 space-y-3 border-t border-[var(--studio-line)] pt-5">
                        <Form.Item name="enabled" label={translate("administration.oauthProviderEnabled")} valuePropName="checked" className="mb-0">
                            <Switch />
                        </Form.Item>
                        <Alert type="warning" showIcon title={translate("administration.standardOAuth2EnableRequiresComplete")} />
                    </section>
                </Form>
            </Drawer>
        </div>
    );
}
