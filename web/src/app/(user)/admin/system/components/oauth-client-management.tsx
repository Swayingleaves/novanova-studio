"use client";

import { useTranslation } from "@/features/locale/use-translation";

import { Alert, App, Button, Drawer, Empty, Form, Input, Switch, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Copy, KeyRound, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
    createOAuthClient,
    deleteOAuthClient,
    listOAuthClients,
    resetOAuthClientSecret,
    serverBaseUrl,
    updateOAuthClient,
    type OAuthClientInfo,
} from "@/services/api/server";
import { useCopyText } from "@/shared/hooks/use-copy-text";

type OAuthClientFormValues = {
    displayName: string;
    enabled: boolean;
    redirectUris: string;
};

/** 把多行文本整理成回调地址列表。 */
const redirectUriList = (value: string) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

/** 挂载后再读取接口根地址，避免服务端渲染和客户端不一致。 */
const useServerBaseUrl = () => {
    const [baseUrl, setBaseUrl] = useState("");
    useEffect(() => {
        setBaseUrl(serverBaseUrl());
    }, []);
    return baseUrl;
};

/**
 * 对外 OAuth2 授权客户端管理：维护多个应用的名称、回调地址和密钥。
 *
 * @returns 授权客户端表格与编辑抽屉
 */
export function OAuthClientManagement() {
    const translate = useTranslation();
    const { message, modal } = App.useApp();
    const copyText = useCopyText();
    const serverBase = useServerBaseUrl();
    const endpoints = serverBase
        ? [
            { label: translate("administration.oauthClientsAuthorizationEndpoint"), value: `${serverBase}/oauth/authorize` },
            { label: translate("administration.oauthClientsTokenEndpoint"), value: `${serverBase}/oauth/token` },
            { label: translate("administration.oauthClientsUserInfoEndpoint"), value: `${serverBase}/oauth/userinfo` },
        ]
        : [];
    const [form] = Form.useForm<OAuthClientFormValues>();
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [editing, setEditing] = useState<OAuthClientInfo | null>(null);
    const [saving, setSaving] = useState(false);
    const clientsQuery = useQuery({ queryKey: ["platform-oauth-clients"], queryFn: listOAuthClients });
    const clients = clientsQuery.data?.clients ?? [];

    const openCreate = () => {
        setEditing(null);
        form.setFieldsValue({ displayName: "", enabled: false, redirectUris: "" });
        setDrawerOpen(true);
    };

    const openEdit = (client: OAuthClientInfo) => {
        setEditing(client);
        form.setFieldsValue({ displayName: client.displayName, enabled: client.enabled, redirectUris: client.redirectUris.join("\n") });
        setDrawerOpen(true);
    };

    const save = async () => {
        const values = await form.validateFields();
        const redirectUris = redirectUriList(values.redirectUris);
        if (!redirectUris.length) {
            message.warning(translate("administration.oauthClientsRedirectUrisRequired"));
            return;
        }
        setSaving(true);
        try {
            const saved = editing
                ? await updateOAuthClient({ clientId: editing.clientId, displayName: values.displayName.trim(), enabled: values.enabled, redirectUris })
                : await createOAuthClient({ displayName: values.displayName.trim(), enabled: values.enabled, redirectUris });
            message.success(translate(editing ? "administration.oauthClientsUpdated" : "administration.oauthClientsCreated"));
            setEditing(saved);
            form.setFieldsValue({ displayName: saved.displayName, enabled: saved.enabled, redirectUris: saved.redirectUris.join("\n") });
            await clientsQuery.refetch();
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate(editing ? "administration.oauthClientsUpdateFailed" : "administration.oauthClientsCreateFailed"));
        } finally {
            setSaving(false);
        }
    };

    const resetSecret = () => {
        if (!editing) return;
        modal.confirm({
            title: translate("administration.oauthClientsResetSecret"),
            content: translate("administration.oauthClientsResetSecretConfirm"),
            onOk: async () => {
                try {
                    const saved = await resetOAuthClientSecret(editing.clientId);
                    setEditing(saved);
                    message.success(translate("administration.oauthClientsSecretReset"));
                    await clientsQuery.refetch();
                } catch (error) {
                    message.error(error instanceof Error ? error.message : translate("administration.oauthClientsSecretResetFailed"));
                }
            },
        });
    };

    const removeClient = (client: OAuthClientInfo) => {
        modal.confirm({
            title: translate("administration.oauthClientsDelete"),
            content: translate("administration.oauthClientsDeleteConfirm", { value0: client.displayName }),
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    await deleteOAuthClient(client.clientId);
                    message.success(translate("administration.oauthClientsDeleted"));
                    await clientsQuery.refetch();
                } catch (error) {
                    message.error(error instanceof Error ? error.message : translate("administration.oauthClientsDeleteFailed"));
                }
            },
        });
    };

    const columns: ColumnsType<OAuthClientInfo> = [
        {
            title: translate("administration.oauthClientsDisplayName"),
            dataIndex: "displayName",
            width: 240,
            render: (_, client) => (
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 font-medium text-[var(--studio-ink)]">
                        <span className="wrap-anywhere">{client.displayName}</span>
                        <Tag color={client.enabled ? "success" : "default"}>{translate(client.enabled ? "administration.oauthEnabled" : "administration.oauthDisabled")}</Tag>
                    </div>
                    <div className="mt-1 truncate font-mono text-xs text-[var(--studio-muted)]">{client.clientId}</div>
                </div>
            ),
        },
        {
            title: translate("administration.oauthClientsRedirectUris"),
            dataIndex: "redirectUris",
            ellipsis: true,
            render: (redirectUris: string[]) => <span className="text-xs text-[var(--studio-muted)]">{redirectUris.join("、") || "—"}</span>,
        },
        {
            title: translate("administration.oauthClientsClientSecret"),
            dataIndex: "clientSecret",
            width: 88,
            render: (clientSecret: string) => (
                <Button type="text" aria-label={translate("administration.oauthClientsClientSecret")} icon={<Copy className="size-4" />} onClick={() => copyText(clientSecret, translate("administration.oauthClientCopied"))} />
            ),
        },
        {
            title: translate("administration.actions"),
            width: 120,
            render: (_, client) => (
                <div className="flex items-center gap-1">
                    <Button type="text" aria-label={translate("administration.oauthClientsEdit")} icon={<Pencil className="size-4" />} onClick={() => openEdit(client)} />
                    <Button type="text" danger aria-label={translate("administration.oauthClientsDelete")} icon={<Trash2 className="size-4" />} onClick={() => removeClient(client)} />
                </div>
            ),
        },
    ];

    return (
        <div className="min-w-0">
            <div className="mb-4 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-3">
                <div className="text-sm font-semibold text-[var(--studio-ink)]">{translate("administration.oauthClientsEndpoints")}</div>
                <div className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">{translate("administration.oauthClientsHint")}</div>
                <div className="mt-3 space-y-2">
                    {endpoints.map((endpoint) => (
                        <div key={endpoint.value} className="flex min-w-0 items-center gap-2">
                            <span className="w-28 shrink-0 text-xs text-[var(--studio-muted)]">{endpoint.label}</span>
                            <span className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--studio-ink)]" title={endpoint.value}>{endpoint.value}</span>
                            <Button type="text" aria-label={endpoint.label} icon={<Copy className="size-4" />} onClick={() => copyText(endpoint.value, translate("administration.oauthClientCopied"))} />
                        </div>
                    ))}
                </div>
            </div>
            <div className="mb-4 flex justify-end">
                <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>{translate("administration.oauthClientsAdd")}</Button>
            </div>
            {clientsQuery.isError && !clients.length ? (
                <Alert
                    type="error"
                    showIcon
                    title={translate("administration.oauthClientsLoadFailed")}
                    description={clientsQuery.error instanceof Error ? clientsQuery.error.message : undefined}
                    action={<Button icon={<RefreshCw className="size-4" />} onClick={() => void clientsQuery.refetch()}>{translate("administration.reload")}</Button>}
                />
            ) : (
                <Table<OAuthClientInfo>
                    rowKey="clientId"
                    tableLayout="fixed"
                    loading={clientsQuery.isLoading}
                    dataSource={clients}
                    columns={columns}
                    pagination={false}
                    scroll={{ x: 860 }}
                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={translate("administration.oauthClientsEmpty")} /> }}
                />
            )}
            <Drawer
                open={drawerOpen}
                title={translate(editing ? "administration.oauthClientsEdit" : "administration.oauthClientsAdd")}
                size={560}
                destroyOnHidden
                onClose={() => setDrawerOpen(false)}
                extra={<Button type="primary" loading={saving} onClick={() => void save()}>{translate("administration.oauthSave")}</Button>}
            >
                <Form form={form} layout="vertical" requiredMark={false}>
                    <Form.Item name="displayName" label={<span className="block">{translate("administration.oauthClientsDisplayName")}</span>} rules={[{ required: true, whitespace: true, message: translate("administration.oauthClientsDisplayNameRequired") }]}>
                        <Input maxLength={50} />
                    </Form.Item>
                    <Form.Item name="enabled" label={<span className="block">{translate("administration.oauthClientsEnabled")}</span>} valuePropName="checked">
                        <Switch />
                    </Form.Item>
                    <Form.Item name="redirectUris" label={<span className="block">{translate("administration.oauthClientsRedirectUris")}</span>} extra={translate("administration.oauthClientsRedirectUrisHint")} rules={[{ required: true, whitespace: true, message: translate("administration.oauthClientsRedirectUrisRequired") }]}>
                        <Input.TextArea rows={5} />
                    </Form.Item>
                    {editing ? (
                        <>
                            <Form.Item label={<span className="block">{translate("administration.oauthClientsClientId")}</span>}>
                                <div className="flex gap-2">
                                    <Input value={editing.clientId} readOnly className="w-full!" />
                                    <Button aria-label={translate("administration.oauthClientsClientId")} icon={<Copy className="size-4" />} onClick={() => copyText(editing.clientId, translate("administration.oauthClientCopied"))} />
                                </div>
                            </Form.Item>
                            <Form.Item label={<span className="block">{translate("administration.oauthClientsClientSecret")}</span>}>
                                <div className="flex gap-2">
                                    <Input.Password value={editing.clientSecret} readOnly visibilityToggle className="w-full!" />
                                    <Button aria-label={translate("administration.oauthClientsClientSecret")} icon={<Copy className="size-4" />} onClick={() => copyText(editing.clientSecret, translate("administration.oauthClientCopied"))} />
                                </div>
                            </Form.Item>
                            <Button icon={<KeyRound className="size-4" />} onClick={resetSecret}>{translate("administration.oauthClientsResetSecret")}</Button>
                        </>
                    ) : null}
                </Form>
            </Drawer>
        </div>
    );
}
