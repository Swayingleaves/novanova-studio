"use client";

import { creditText } from "@/shared/lib/credit-amounts";
import type { CreditAmount } from "@/shared/lib/credit-amounts";

import { useTranslation } from "@/features/locale/use-translation";

import { App, Button, Empty, Form, InputNumber, Modal, Switch, Table, Tag } from "antd";
import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { createAdminCreditProduct, listAdminCreditProducts, updateAdminCreditProduct, updateAdminCreditProductStatus, type ServerCreditProduct } from "@/services/api/server";

type ProductFormValues = {
    credits: CreditAmount;
    priceAmount: string;
    sortOrder: number;
    enabled: boolean;
};

/**
 * 管理平台积分商品配置。
 *
 * @returns 积分商品表格和编辑弹窗
 */
export function CreditProductManagement() {
    const translate = useTranslation();
    const { message } = App.useApp();
    const [form] = Form.useForm<ProductFormValues>();
    const [editing, setEditing] = useState<ServerCreditProduct | null>(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const productsQuery = useQuery({ queryKey: ["admin-credit-products"], queryFn: listAdminCreditProducts });
    const products = productsQuery.data || [];

    const openCreate = () => {
        setEditing(null);
        form.setFieldsValue({ credits: "10", priceAmount: "1.00", sortOrder: products.length ? Math.max(...products.map((item) => item.sortOrder)) + 10 : 10, enabled: true });
        setModalOpen(true);
    };

    const openEdit = (product: ServerCreditProduct) => {
        setEditing(product);
        form.setFieldsValue({ credits: product.credits, priceAmount: product.priceAmount, sortOrder: product.sortOrder, enabled: product.enabled });
        setModalOpen(true);
    };

    const saveProduct = async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
            if (editing) await updateAdminCreditProduct({ id: editing.id, ...values });
            else await createAdminCreditProduct(values);
            await productsQuery.refetch();
            setModalOpen(false);
            message.success(translate("credits.productSaved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("credits.productSaveFailed"));
        } finally {
            setSaving(false);
        }
    };

    const toggleStatus = async (product: ServerCreditProduct, enabled: boolean) => {
        try {
            await updateAdminCreditProductStatus(product.id, enabled);
            await productsQuery.refetch();
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("credits.productSaveFailed"));
        }
    };

    return (
        <div className="min-w-0">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-3">
                <div>
                    <div className="text-sm font-semibold text-[var(--studio-ink)]">{translate("credits.creditProducts")}</div>
                    <div className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">{translate("credits.creditProductsHint")}</div>
                </div>
                <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>
                    {translate("credits.addProduct")}
                </Button>
            </div>
            <Table<ServerCreditProduct>
                rowKey="id"
                loading={productsQuery.isLoading}
                dataSource={products}
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={translate("credits.noProducts")} /> }}
                scroll={{ x: 660 }}
                columns={[
                    { title: translate("credits.creditsUnit"), dataIndex: "credits", width: 150, render: (value: CreditAmount) => <span className="tabular-nums">{creditText(value)}</span> },
                    { title: translate("credits.price"), dataIndex: "priceAmount", width: 140, render: (value: string) => <span className="tabular-nums">¥ {value}</span> },
                    { title: translate("credits.sortOrder"), dataIndex: "sortOrder", width: 110 },
                    {
                        title: translate("credits.status"),
                        dataIndex: "enabled",
                        width: 130,
                        render: (enabled: boolean, product) => <Switch checked={enabled} checkedChildren={translate("credits.enabled")} unCheckedChildren={translate("credits.disabled")} onChange={(checked) => void toggleStatus(product, checked)} />,
                    },
                    {
                        title: translate("credits.actions"),
                        width: 110,
                        render: (_, product) => (
                            <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => openEdit(product)}>
                                {translate("credits.edit")}
                            </Button>
                        ),
                    },
                ]}
            />
            <Modal
                open={modalOpen}
                title={editing ? translate("credits.editProduct") : translate("credits.addProduct")}
                confirmLoading={saving}
                onCancel={() => setModalOpen(false)}
                onOk={() => void saveProduct()}
                mask={{ closable: false }}
                destroyOnHidden
            >
                <Form form={form} layout="vertical" requiredMark={false} className="pt-2">
                    <Form.Item name="credits" label={translate("credits.creditsUnit")} rules={[{ required: true, message: translate("credits.enterCredits") }]}>
                        <InputNumber<string> stringMode min="0.000001" precision={6} suffix={translate("credits.creditsUnit")} className="w-full!" />
                    </Form.Item>
                    <Form.Item name="priceAmount" label={translate("credits.price")} rules={[{ required: true, message: translate("credits.enterPrice") }]}>
                        <InputNumber<string> stringMode min="0.01" precision={2} suffix="元" className="w-full!" />
                    </Form.Item>
                    <Form.Item name="sortOrder" label={translate("credits.sortOrder")} rules={[{ required: true, message: translate("credits.enterSortOrder") }]}>
                        <InputNumber min={0} precision={0} className="w-full!" />
                    </Form.Item>
                    <Form.Item name="enabled" label={translate("credits.status")} valuePropName="checked" className="mb-0">
                        <Switch checkedChildren={translate("credits.enabled")} unCheckedChildren={translate("credits.disabled")} />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
}
