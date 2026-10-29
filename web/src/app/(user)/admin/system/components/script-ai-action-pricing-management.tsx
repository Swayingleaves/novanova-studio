"use client";

import type { CreditAmount } from "@/shared/lib/credit-amounts";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, App, Button, Empty, InputNumber, Select, Space, Table, Tag } from "antd";
import { RefreshCw } from "lucide-react";

import { getScriptAiActionPricing, saveScriptAiActionPricing } from "@/services/api/script";
import { SCRIPT_AI_ACTIONS } from "@/features/script/lib/script-ai-actions";
import { useTranslation } from "@/features/locale/use-translation";
import type { ScriptAiActionModelPricing } from "@/features/script/types";

/** 剧本 AI 助手动作定价：一个动作一次模型调用，按「文本模型 × 动作」配置每次积分。 */
export function ScriptAiActionPricingManagement() {
    const translate = useTranslation();
    const { message } = App.useApp();
    const query = useQuery({ queryKey: ["admin", "scriptAiActionPricing"], queryFn: getScriptAiActionPricing });
    const [modelConfigId, setModelConfigId] = useState("");
    const [drafts, setDrafts] = useState<Record<string, CreditAmount | null>>({});
    const [saving, setSaving] = useState(false);
    const models = query.data || [];
    const current: ScriptAiActionModelPricing | undefined = models.find((item) => item.modelConfigId === modelConfigId);

    useEffect(() => {
        if (!modelConfigId && models.length) setModelConfigId(models[0].modelConfigId);
    }, [modelConfigId, models]);
    useEffect(() => {
        setDrafts(Object.fromEntries((current?.actions || []).map((item) => [item.actionType, item.credits])));
    }, [current]);

    const pricedCount = Object.values(drafts).filter((credits) => credits !== null && credits !== undefined).length;

    const save = async () => {
        if (!current) return;
        const actions = Object.entries(drafts)
            .filter(([, credits]) => credits !== null && credits !== undefined && Number(credits) >= 0)
            .map(([actionType, credits]) => ({ actionType, credits: credits as CreditAmount }));
        setSaving(true);
        try {
            await saveScriptAiActionPricing(current.modelConfigId, current.revision, actions);
            message.success("价格已保存");
            await query.refetch();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        } finally {
            setSaving(false);
        }
    };

    if (query.error) return <Alert type="error" showIcon title={query.error instanceof Error ? query.error.message : "价格加载失败"} action={<Button size="small" onClick={() => void query.refetch()}>重试</Button>} />;
    if (!query.isLoading && !models.length) return <Empty description="尚未配置文本模型" />;

    return (
        <div className="space-y-4">
            <Alert type="info" showIcon
                title="一个动作一次模型调用，这里配置的是「该动作每次调用」的积分；留空表示未定价。"
                description="未定价的动作无法在「AI 剧本助手」中发起，不会回落到文本模型自身的积分。同一模型下所有动作共用一个修订号，保存时整组生效。" />
            <Space wrap>
                <Select className="w-72" loading={query.isLoading} value={modelConfigId || undefined} onChange={setModelConfigId}
                    options={models.map((item) => ({ value: item.modelConfigId, label: <span>{item.displayName} {item.actions.some((action) => action.credits !== null) ? <Tag color="green">已定价</Tag> : <Tag>未定价</Tag>}</span> }))} />
                <Button icon={<RefreshCw className="size-3.5" />} onClick={() => void query.refetch()}>刷新</Button>
                <Button type="primary" loading={saving} disabled={!current} onClick={() => void save()}>保存</Button>
                {/* model 形如 "channelId::modelName"，渠道标识不展示。 */}
                {current ? <span className="text-xs text-[var(--studio-muted)]">{current.model.split("::").pop()} · 修订 {current.revision} · 已定价 {pricedCount}/{SCRIPT_AI_ACTIONS.length}</span> : null}
            </Space>
            <Table<{ actionType: string; label: string; credits: CreditAmount | null }>
                size="small"
                pagination={false}
                rowKey="actionType"
                dataSource={SCRIPT_AI_ACTIONS.map((action) => ({ actionType: action.value, label: translate(action.labelKey), credits: drafts[action.value] ?? null }))}
                locale={{ emptyText: "尚未配置动作" }}
                columns={[
                    { title: "动作", dataIndex: "label" },
                    {
                        title: "积分 / 次", dataIndex: "credits", width: 200,
                        // 这里用内联宽度：antd 的 InputNumber 自带 width:90px，Tailwind 的宽度类压不过它。
                        render: (credits: CreditAmount | null, row) => <InputNumber style={{ width: 160 }} min={0} max={1_000_000}
                            placeholder="未定价" value={credits === null ? null : Number(credits)}
                            onChange={(value) => setDrafts((list) => ({ ...list, [row.actionType]: value ?? null }))} />,
                    },
                    {
                        title: "状态", width: 100,
                        render: (_, row) => row.credits === null || row.credits === undefined ? <Tag>未定价</Tag> : <Tag color="green">已定价</Tag>,
                    },
                ]}
            />
        </div>
    );
}
