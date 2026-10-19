"use client";

import type { CreditAmount } from "@/shared/lib/credit-amounts";


import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, App, Button, Empty, InputNumber, Select, Space, Tag } from "antd";
import { RefreshCw } from "lucide-react";

import { getEpisodeBodiesPricing, saveEpisodeBodiesPricing } from "@/services/api/script";
import type { EpisodeBodiesModelPricing } from "@/features/script/types";

/** 分集正文定价：一集一次模型调用，所以按文本模型配置每生成一集的积分。 */
export function EpisodeBodiesPricingManagement() {
    const { message } = App.useApp();
    const query = useQuery({ queryKey: ["admin", "episodeBodiesPricing"], queryFn: getEpisodeBodiesPricing });
    const [modelConfigId, setModelConfigId] = useState("");
    const [credits, setCredits] = useState<CreditAmount>(0);
    const [saving, setSaving] = useState(false);
    const models = query.data || [];
    const current: EpisodeBodiesModelPricing | undefined = models.find((item) => item.modelConfigId === modelConfigId);
    // 未配置的模型 revision 为 0，服务端据此走新增分支；保存成功后会拿到新 revision。
    const configured = (current?.revision ?? 0) > 0;

    useEffect(() => {
        if (!modelConfigId && models.length) setModelConfigId(models[0].modelConfigId);
    }, [modelConfigId, models]);
    useEffect(() => { setCredits(current?.credits ?? 0); }, [current]);

    const save = async () => {
        if (!current) return;
        setSaving(true);
        try {
            await saveEpisodeBodiesPricing(current.modelConfigId, current.revision, credits);
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
            <Alert type="info" showIcon title="一集正文一次模型调用，这里配置的是「每生成一集」的积分；未配置的模型无法在小说改编最后一步发起生成。" description="批量生成分集正文时按所选分集数量预扣，只结算真正生成成功的分集，取消或失败时未完成部分的积分退回。" />
            <Space wrap>
                <Select className="w-72" loading={query.isLoading} value={modelConfigId || undefined} onChange={setModelConfigId} options={models.map((item) => ({ value: item.modelConfigId, label: <span>{item.displayName} {item.revision > 0 ? <Tag color="green">已定价</Tag> : <Tag>未定价</Tag>}</span> }))} />
                <Button icon={<RefreshCw className="size-3.5" />} onClick={() => void query.refetch()}>刷新</Button>
                <Button type="primary" loading={saving} disabled={!current} onClick={() => void save()}>保存</Button>
                {/* model 形如 "channelId::modelName"，渠道标识不展示。 */}
                {current ? <span className="text-xs text-[var(--studio-muted)]">{current.model.split("::").pop()} · 修订 {current.revision}</span> : null}
            </Space>
            <label className="flex flex-wrap items-center gap-3 text-sm text-[var(--studio-text)]">
                每集积分
                {/* 这里用内联宽度：antd 的 InputNumber 自带 width:90px，Tailwind 的宽度类压不过它。 */}
                <InputNumber style={{ width: 160 }} min={0} max={1_000_000} disabled={!current} value={credits}
                    onChange={(value) => setCredits(value ?? 0)} />
                {current && !configured ? <span className="text-xs text-[var(--studio-muted)]">该模型尚未定价，保存后即可用于生成。</span> : null}
            </label>
        </div>
    );
}
