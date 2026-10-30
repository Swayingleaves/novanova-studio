"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, App, Button, Empty, InputNumber, Select, Tag } from "antd";
import { RefreshCw } from "lucide-react";
import { useTeamStore } from "@/features/team/stores/use-team-store";
import { getComicDramaFinalPromptPricing, saveComicDramaFinalPromptPricing } from "@/services/api/comic-drama";
import { creditText } from "@/shared/lib/credit-amounts";

/** 漫剧最终提示词独立定价，授权平台模型在团队空间内只读。 */
export function ComicDramaFinalPromptPricingManagement() {
    const { message } = App.useApp();
    const teamId = useTeamStore((state) => state.team?.id ?? 0);
    const query = useQuery({ queryKey: ["admin", "comicDramaFinalPromptPricing", teamId], queryFn: getComicDramaFinalPromptPricing });
    const [modelConfigId, setModelConfigId] = useState("");
    const [credits, setCredits] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const models = query.data;
    const current = models?.find((model) => model.modelConfigId === modelConfigId);

    useEffect(() => {
        if (models?.length && !models.some((model) => model.modelConfigId === modelConfigId)) setModelConfigId(models[0].modelConfigId);
    }, [modelConfigId, models]);
    useEffect(() => { setCredits(current?.credits == null ? null : creditText(current.credits)); }, [current]);

    const save = async () => {
        if (!current?.editable || credits === null) return;
        setSaving(true);
        try {
            await saveComicDramaFinalPromptPricing(current.modelConfigId, current.revision, credits);
            message.success("价格已保存");
            await query.refetch();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        } finally {
            setSaving(false);
        }
    };

    if (query.error) return <Alert type="error" showIcon title={query.error.message} action={<Button onClick={() => void query.refetch()}>重试</Button>} />;
    if (!query.isLoading && !models?.length) return <Empty description="尚未配置文本模型" />;

    return (
        <div className="space-y-4">
            <Alert type="info" showIcon title="每个镜头生成最终提示词计费一次，单镜头与批量生成使用同一价格。"
                description="未配置时禁止生成；明确保存为 0 才允许免费生成。批量任务共用启动时的单价，失败镜头自动退款。此配置不影响画布。" />
            <div className="flex flex-wrap items-end gap-3">
                <div className="w-full sm:w-80">
                    <label className="mb-2 block text-sm" htmlFor="comic-drama-final-prompt-model">文本模型</label>
                    <Select id="comic-drama-final-prompt-model" className="w-full!" loading={query.isLoading} disabled={saving}
                        value={current?.modelConfigId} onChange={setModelConfigId}
                        options={models?.map((model) => ({ value: model.modelConfigId, label: <span>{model.displayName} {model.revision > 0 ? <Tag color="green">已配置</Tag> : <Tag>未配置</Tag>}</span> }))} />
                </div>
                <Button icon={<RefreshCw className="size-3.5" />} disabled={saving} loading={query.isFetching} onClick={() => void query.refetch()}>刷新</Button>
                <Button type="primary" loading={saving} disabled={!current?.editable || credits === null || query.isFetching} onClick={() => void save()}>保存</Button>
            </div>
            <div className="w-full sm:w-80">
                <label className="mb-2 block text-sm" htmlFor="comic-drama-final-prompt-credits">每镜头积分</label>
                <InputNumber<string> id="comic-drama-final-prompt-credits" className="w-full!" stringMode min="0" max="999999999999999999.999999"
                    precision={6} step="0.000001" suffix="积分 / 镜头" value={credits} onChange={setCredits}
                    disabled={!current?.editable || saving || query.isFetching} placeholder="未配置，请填写每镜头积分" />
            </div>
            {current ? <p className="text-xs text-[var(--studio-muted)]">{current.model.split("::").pop()} · 修订 {current.revision}
                {current.editable ? " · 支持六位小数，填写 0 表示免费" : " · 授权平台模型价格只读，请联系平台管理员调整"}</p> : null}
        </div>
    );
}
