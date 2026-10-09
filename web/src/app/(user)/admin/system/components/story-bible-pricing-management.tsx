"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, App, Button, Empty, InputNumber, Select, Space, Switch, Table, Tag, Tooltip } from "antd";
import { HelpCircle, Plus, RefreshCw, Trash2 } from "lucide-react";

import { getStoryBiblePricing, saveStoryBiblePricing } from "@/services/api/script";
import type { StoryBibleModelPricing, StoryBiblePricingTier, StoryBibleQuickConfiguration } from "@/features/script/types";

/** 管理员必须填写实测值；此对象只用于开启编辑，不能未经验证直接保存。 */
const EMPTY_QUICK_CONFIGURATION: StoryBibleQuickConfiguration = {
    contextWindowTokens: 0, maximumInputCharacters: 0, maximumOutputTokens: 0,
    maximumSupplementCalls: 0,
};

/** 「最多补分析调用次数」的悬停说明。 */
const SUPPLEMENT_CALLS_HINT = "模型输出不合格（片段缺失、标识重复或被截断）时，允许把该批拆成两个更小的子批重新调用的总次数上限，全任务共用；额度用尽后该片段记为缺口并跳过。不影响扣费。";

/** 故事知识库分析价格：按文本模型维护首尾相接、不重叠的字数档位。 */
export function StoryBiblePricingManagement() {
    const { message } = App.useApp();
    const query = useQuery({ queryKey: ["admin", "storyBiblePricing"], queryFn: getStoryBiblePricing });
    const [modelConfigId, setModelConfigId] = useState("");
    const [tiers, setTiers] = useState<StoryBiblePricingTier[]>([]);
    const [quickConfiguration, setQuickConfiguration] = useState<StoryBibleQuickConfiguration | null>(null);
    const [saving, setSaving] = useState(false);
    const models = query.data || [];
    const current: StoryBibleModelPricing | undefined = models.find((item) => item.modelConfigId === modelConfigId);

    useEffect(() => {
        if (!modelConfigId && models.length) setModelConfigId(models[0].modelConfigId);
    }, [modelConfigId, models]);
    useEffect(() => { setTiers(current?.tiers || []); setQuickConfiguration(current?.quickConfiguration || null); }, [current]);

    /* 修改上限时自动衔接下一档起点，保证档位首尾相接。 */
    const updateMax = (index: number, maxChars: number | null) => setTiers((list) => list.map((tier, position) => position === index ? { ...tier, maxChars } : position === index + 1 && maxChars != null ? { ...tier, minChars: maxChars + 1 } : tier));
    const updateCredits = (index: number, credits: number) => setTiers((list) => list.map((tier, position) => position === index ? { ...tier, credits } : tier));
    const addTier = () => setTiers((list) => {
        const last = list[list.length - 1];
        if (!last) return [{ minChars: 1, maxChars: null, credits: 0 }];
        const lastMax = last.maxChars ?? last.minChars + 99_999;
        return [...list.slice(0, -1), { ...last, maxChars: lastMax }, { minChars: lastMax + 1, maxChars: null, credits: last.credits }];
    });
    const removeTier = (index: number) => setTiers((list) => {
        const next = list.filter((_, position) => position !== index);
        if (next.length) next[0] = { ...next[0], minChars: 1 };
        for (let position = 1; position < next.length; position++) next[position] = { ...next[position], minChars: (next[position - 1].maxChars ?? 0) + 1 };
        return next;
    });

    const save = async () => {
        if (!current) return;
        setSaving(true);
        try {
            await saveStoryBiblePricing(current.modelConfigId, current.revision, tiers, quickConfiguration);
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
            <Alert type="info" showIcon title="计费字数为所选原文范围内的非空白字符数（汉字、字母、数字、标点计入，空格与换行不计入）。未覆盖当前字数的模型无法启动分析。" />
            <Alert type="warning" showIcon title="分析容量须由管理员对当前模型与渠道实测：上下文 Token 不等于可输入汉字数。这里填写的正文字符上限不得超过 50 万，且应为留出提示词和输出空间后的安全值。" />
            <Space wrap>
                <Select className="w-72" loading={query.isLoading} value={modelConfigId || undefined} onChange={setModelConfigId} options={models.map((item) => ({ value: item.modelConfigId, label: <span>{item.displayName} {item.tiers.length ? <Tag color="green">已定价</Tag> : <Tag>未定价</Tag>}</span> }))} />
                <Button icon={<RefreshCw className="size-3.5" />} onClick={() => void query.refetch()}>刷新</Button>
                <Button icon={<Plus className="size-3.5" />} onClick={addTier}>新增档位</Button>
                <Button type="primary" loading={saving} disabled={!current} onClick={() => void save()}>保存</Button>
                {/* model 形如 "channelId::modelName"，渠道标识不展示。 */}
                {current ? <span className="text-xs text-[var(--studio-muted)]">{current.model.split("::").pop()} · 修订 {current.revision}</span> : null}
            </Space>
            <Table<StoryBiblePricingTier & { index: number }>
                size="small"
                pagination={false}
                rowKey="index"
                dataSource={tiers.map((tier, index) => ({ ...tier, index }))}
                locale={{ emptyText: "尚未设置档位" }}
                columns={[
                    { title: "起始字数", dataIndex: "minChars", render: (value: number) => value.toLocaleString("zh-CN") },
                    { title: "上限字数（含）", dataIndex: "maxChars", render: (value: number | null, row) => row.index === tiers.length - 1 && value == null ? <Button size="small" type="link" onClick={() => updateMax(row.index, row.minChars + 99_999)}>不限（点击设上限）</Button> : <InputNumber min={row.minChars} max={100_000_000} value={value} onChange={(next) => updateMax(row.index, next ?? (row.index === tiers.length - 1 ? null : row.minChars))} /> },
                    { title: "积分", dataIndex: "credits", render: (value: number, row) => <InputNumber min={0} value={value} onChange={(next) => updateCredits(row.index, next ?? 0)} /> },
                    { title: "", width: 60, render: (_, row) => <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} aria-label="删除档位" onClick={() => removeTier(row.index)} /> },
                ]}
            />
            <div className="space-y-3 rounded-lg border border-[var(--studio-line)] p-3">
                <label className="flex items-center gap-2 text-sm text-[var(--studio-text)]">
                    <Switch checked={quickConfiguration !== null} onChange={(enabled) => setQuickConfiguration(enabled ? { ...EMPTY_QUICK_CONFIGURATION } : null)} />
                    开启该模型的故事知识库分析
                </label>
                {quickConfiguration ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {([
                        ["contextWindowTokens", "模型上下文 Token", 4096, undefined],
                        ["maximumInputCharacters", "单次正文最大字符数（实测）", 1000, 500000],
                        ["maximumOutputTokens", "预留输出 Token", 1024, undefined],
                        ["maximumSupplementCalls", "最多补分析调用次数", 0, 100],
                    ] as const).map(([key, label, min, max]) => <label key={key} className="space-y-1 text-xs text-[var(--studio-muted)]">
                        <span className="flex items-center gap-1">
                            {label}
                            {key === "maximumSupplementCalls" ? <Tooltip placement="top" title={SUPPLEMENT_CALLS_HINT}><HelpCircle className="size-3.5 cursor-help" aria-label="补分析调用次数说明" /></Tooltip> : null}
                        </span>
                        <InputNumber className="w-full" min={min} max={max} value={quickConfiguration[key]}
                            onChange={(value) => setQuickConfiguration((current) => current ? { ...current, [key]: value ?? 0 } : current)} />
                    </label>)}
                </div> : null}
            </div>
        </div>
    );
}
