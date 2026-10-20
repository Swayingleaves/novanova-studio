"use client";

import { useQuery } from "@tanstack/react-query";
import { Alert, App, Button, Form, Input, InputNumber, Modal, Select, Space, Switch, Table } from "antd";
import { useState } from "react";
import { useTeamStore } from "@/features/team/stores/use-team-store";
import { useTranslation } from "@/features/locale/use-translation";
import { getStorageCapacitySettings, saveStorageCapacityPackage, saveStorageCapacitySettings, type StorageCapacityPackage } from "@/services/api/storage";
import { serverGet, serverPost } from "@/services/api/server";
import { listAvailableResources } from "@/services/api/team";
import { creditText } from "@/shared/lib/credit-amounts";
import { formatStorageGigabytes } from "@/features/storage/capacity-format";
import { notifyStorageCapacityChanged } from "@/features/storage/capacity-events";

/** 当前空间免费容量和自有永久扩容套餐，授权的平台套餐由平台维护。 */
export function StorageBillingManagement() {
    const translate = useTranslation();
    const { message } = App.useApp();
    const teamId = useTeamStore((state) => state.team?.id || 0);
    const settings = useQuery({ queryKey: ["storageCapacitySettings", teamId], queryFn: getStorageCapacitySettings });
    const usage = useQuery({ queryKey: ["teamStorageUsage", teamId], queryFn: () => serverGet<{ storageId: string; ownerTeamId: number; objectCount: number; fileBytes: string }[]>("/storage/getTeamUsage") });
    const historical = useQuery({ queryKey: ["unregisteredStorageGroups", teamId], queryFn: () => serverGet<{ provider: string; bucket: string; region: string; objectCount: number }[]>("/storage/listUnregisteredStorageGroups") });
    const resources = useQuery({ queryKey: ["storageCapacityResources", teamId], queryFn: listAvailableResources });
    const [historicalStorageId, setHistoricalStorageId] = useState<string>();
    const [editing, setEditing] = useState<StorageCapacityPackage | "new" | null>(null);
    const [busy, setBusy] = useState(false);
    const [form] = Form.useForm();

    const save = async (operation: () => Promise<unknown>) => {
        setBusy(true);
        try {
            await operation();
            await settings.refetch();
            notifyStorageCapacityChanged();
            message.success(translate("storage.capacitySettingsSaved"));
            return true;
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("storage.capacitySettingsSaveFailed"));
            return false;
        } finally {
            setBusy(false);
        }
    };
    const editPackage = (item: StorageCapacityPackage | "new") => {
        form.resetFields();
        form.setFieldsValue(item === "new" ? { enabled: false } : item);
        setEditing(item);
    };

    return (
        <div className="flex flex-col gap-5">
            <Alert type="info" showIcon title={translate("storage.permanentCapacityRules")} />
            {settings.isError ? (
                <Alert type="error" showIcon title={settings.error.message} />
            ) : settings.data ? (
                <Form
                    name="storageCapacitySettings"
                    key={settings.data.freeGigabytes}
                    layout="vertical"
                    initialValues={{ freeGigabytes: settings.data.freeGigabytes }}
                    onFinish={(values) => void save(() => saveStorageCapacitySettings(values.freeGigabytes))}
                >
                    <div className="max-w-sm">
                        <Form.Item name="freeGigabytes" label={translate("storage.freeCapacityPerUser")} rules={[{ required: true }]}>
                            <InputNumber min={0} max={2147483647} precision={0} suffix="G" className="w-full!" />
                        </Form.Item>
                    </div>
                    <Button type="primary" htmlType="submit" loading={busy}>
                        {translate("storage.saveFreeCapacity")}
                    </Button>
                </Form>
            ) : null}
            <div className="flex items-center justify-between">
                <span className="font-medium text-[var(--studio-ink)]">{translate("storage.capacityPackages")}</span>
                <Button onClick={() => editPackage("new")}>{translate("storage.addCapacityPackage")}</Button>
            </div>
            <Table
                rowKey="id"
                loading={settings.isLoading}
                pagination={false}
                dataSource={settings.data?.packages || []}
                scroll={{ x: 600 }}
                columns={[
                    { title: translate("storage.capacityPackageName"), dataIndex: "name" },
                    { title: translate("storage.capacityAdded"), render: (_, item) => `${item.capacityGigabytes} G`, align: "right" },
                    { title: translate("storage.capacityPrice"), render: (_, item) => creditText(item.credits), align: "right" },
                    { title: translate("storage.capacityPackageStatus"), render: (_, item) => translate(item.enabled ? "storage.capacityPackageOnSale" : "storage.capacityPackageOffSale") },
                    {
                        title: translate("storage.capacityActions"),
                        render: (_, item) => (
                            <Space>
                                <Button size="small" disabled={busy} onClick={() => editPackage(item)}>
                                    {translate("storage.editCapacityPackage")}
                                </Button>
                                <Button size="small" disabled={busy} onClick={() => void save(() => saveStorageCapacityPackage({ ...item, enabled: !item.enabled }))}>
                                    {translate(item.enabled ? "storage.disableCapacityPackage" : "storage.enableCapacityPackage")}
                                </Button>
                            </Space>
                        ),
                    },
                ]}
            />
            {usage.isError ? (
                <Alert type="error" title={usage.error.message} />
            ) : (
                <Table
                    rowKey="storageId"
                    loading={usage.isLoading}
                    pagination={false}
                    dataSource={usage.data || []}
                    scroll={{ x: 400 }}
                    columns={[
                        { title: translate("storage.capacityStorageConfiguration"), dataIndex: "storageId" },
                        { title: translate("storage.capacityObjectCount"), dataIndex: "objectCount", align: "right" },
                        { title: translate("storage.capacityUsed"), render: (_, item) => `${formatStorageGigabytes(item.fileBytes)} G`, align: "right" },
                    ]}
                />
            )}
            {historical.data?.length ? (
                <div className="flex flex-col gap-3">
                    <Alert type="warning" showIcon title={translate("storage.capacityHistoricalWarning")} />
                    <Table
                        rowKey={(item) => `${item.provider}:${item.bucket}:${item.region}`}
                        pagination={false}
                        dataSource={historical.data}
                        columns={[
                            { title: translate("storage.capacityProvider"), dataIndex: "provider" },
                            { title: translate("storage.capacityBucket"), dataIndex: "bucket" },
                            { title: translate("storage.capacityRegion"), dataIndex: "region" },
                            { title: translate("storage.capacityObjectCount"), dataIndex: "objectCount" },
                        ]}
                    />
                    <Select
                        aria-label={translate("storage.capacityConfirmHistorical")}
                        placeholder={translate("storage.capacitySelectHistoricalStorage")}
                        value={historicalStorageId}
                        onChange={setHistoricalStorageId}
                        options={(resources.data || []).filter((item) => item.resourceType === "objectStorage" && item.ownerTeamId === teamId).map((item) => ({ value: item.resourceId, label: item.name }))}
                    />
                    <Button
                        className="self-start"
                        disabled={!historicalStorageId}
                        loading={busy}
                        onClick={() =>
                            void save(async () => {
                                await serverPost("/storage/registerExistingMedia", { storageId: historicalStorageId });
                                await Promise.all([historical.refetch(), usage.refetch()]);
                            })
                        }
                    >
                        {translate("storage.capacityConfirmHistorical")}
                    </Button>
                </div>
            ) : null}
            <Modal
                width={520}
                style={{ maxWidth: "calc(100vw - 32px)" }}
                title={translate(editing === "new" ? "storage.addCapacityPackage" : "storage.editCapacityPackage")}
                open={editing !== null}
                forceRender
                confirmLoading={busy}
                onCancel={() => !busy && setEditing(null)}
                onOk={async () => {
                    const values = await form.validateFields();
                    if (await save(() => saveStorageCapacityPackage({ ...values, ...(editing && editing !== "new" ? { id: editing.id, revision: editing.revision } : {}) }))) setEditing(null);
                }}
            >
                <Form name="storageCapacityPackage" form={form} layout="vertical" disabled={busy}>
                    <Form.Item name="name" label={translate("storage.capacityPackageName")} rules={[{ required: true, whitespace: true }]}>
                        <Input maxLength={100} />
                    </Form.Item>
                    <Form.Item name="capacityGigabytes" label={translate("storage.capacityAdded")} rules={[{ required: true }]}>
                        <InputNumber min={1} max={2147483647} precision={0} suffix="G" className="w-full!" />
                    </Form.Item>
                    <Form.Item name="credits" label={translate("storage.capacityPrice")} rules={[{ required: true }]}>
                        <InputNumber<string> stringMode min="0.000001" precision={6} className="w-full!" />
                    </Form.Item>
                    <Form.Item name="enabled" label={translate("storage.capacityPackageOnSale")} valuePropName="checked">
                        <Switch />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
}
