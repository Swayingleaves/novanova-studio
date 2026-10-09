"use client";

import { useEffect, useState } from "react";
import { App, Alert, Button, Modal, Select, Tag } from "antd";
import { linkNovelAdaptationAsset, listNovelAdaptationAssetLinks, listStoryBibleItems } from "@/services/api/script";
import { useComicDramaStore } from "../stores/use-comic-drama-store";
import type { NovelAdaptationAssetLink, StoryBibleItem } from "@/features/script/types";

/** 提供已确认的人物和地点事实，用户确认后关联视觉资产。 */
export function NovelAssetSuggestions() {
    const { message, modal } = App.useApp();
    const workspace = useComicDramaStore((state) => state.workspace);
    const reloadWorkspace = useComicDramaStore((state) => state.reloadWorkspace);
    const [factType, setFactType] = useState<"character" | "location">("character");
    const [page, setPage] = useState(1);
    const [facts, setFacts] = useState<StoryBibleItem[]>([]);
    const [links, setLinks] = useState<NovelAdaptationAssetLink[]>([]);
    const [total, setTotal] = useState(0);
    const [factId, setFactId] = useState("");
    const [assetId, setAssetId] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const projectId = workspace?.projectId || "";

    useEffect(() => {
        if (!projectId) return;
        let active = true;
        setLoading(true);
        void Promise.all([
            listStoryBibleItems({ projectId, itemType: factType, status: "confirmed", page, pageSize: 100 }),
            listNovelAdaptationAssetLinks(projectId),
        ]).then(([result, assetLinks]) => {
            if (active) { setFacts(result.items); setTotal(result.total); setLinks(assetLinks); setError(""); }
        }).catch((failure: unknown) => {
            if (active) setError(failure instanceof Error ? failure.message : "故事事实加载失败");
        }).finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [factType, page, projectId, workspace?.revision]);

    if (!workspace) return null;
    const availableFacts = facts.filter((fact) => !links.some((link) => link.factId === fact.id));
    const fact = facts.find((item) => item.id === factId);
    const assetType = factType === "character" ? "character" : "scene";
    const availableAssets = workspace.assets.filter((asset) => asset.assetType === assetType
        && !asset.sourceEntityId && !links.some((link) => link.assetId === asset.id));

    const confirmLink = () => {
        if (!fact) return message.warning("请选择已确认的故事事实");
        const selectedAsset = availableAssets.find((asset) => asset.id === assetId);
        modal.confirm({
            title: selectedAsset ? "关联现有视觉资产？" : "根据故事事实新建视觉资产？",
            content: <p>事实：{fact.name}；视觉资产：{selectedAsset?.name || `新建“${fact.name}”文字资产`}。该操作不会生成图片、声音或视频；后续事实变化只显示待审提示。</p>,
            okText: "确认关联", cancelText: "取消",
            onOk: async () => {
                const current = useComicDramaStore.getState().workspace;
                if (!current || current.projectId !== projectId) throw new Error("漫剧项目已切换，请刷新后重试");
                await linkNovelAdaptationAsset({ projectId, factId: fact.id, assetId: selectedAsset?.id, expectedProductionRevision: current.revision });
                await reloadWorkspace();
                setLinks(await listNovelAdaptationAssetLinks(projectId));
                setFactId("");
                setAssetId("");
                message.success("故事事实与视觉资产已关联");
            },
        });
    };

    return <section className="space-y-3 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-4">
        <div><h3 className="font-semibold text-[var(--studio-ink)]">故事知识库资产建议</h3><p className="mt-1 text-xs text-[var(--studio-muted)]">人物与地点事实可关联现有资产或建立文字资产。事实变化不会自动覆盖描述与生成图片。</p></div>
        {error ? <Alert type="error" showIcon title={error} /> : null}
        <div className="flex flex-wrap items-center gap-2">
            <Select value={factType} className="w-24" options={[{ value: "character", label: "人物" }, { value: "location", label: "地点" }]} onChange={(value) => { setFactType(value); setPage(1); setFactId(""); setAssetId(""); }} />
            <Select showSearch optionFilterProp="label" loading={loading} value={factId || undefined} className="min-w-48 flex-1" placeholder="选择已确认事实" options={availableFacts.map((item) => ({ value: item.id, label: item.name }))} onChange={(value) => { setFactId(value); setAssetId(""); }} />
            <Select allowClear value={assetId || undefined} className="min-w-48 flex-1" placeholder="新建资产，或选择现有资产" options={availableAssets.map((asset) => ({ value: asset.id, label: asset.name }))} onChange={(value) => setAssetId(value || "")} />
            <Button type="primary" disabled={!fact} onClick={confirmLink}>确认关联</Button>
        </div>
        {total > 100 ? <div className="flex items-center justify-end gap-2 text-xs text-[var(--studio-muted)]"><Button size="small" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</Button><span>第 {page} 页，共 {total} 条</span><Button size="small" disabled={page * 100 >= total} onClick={() => setPage((value) => value + 1)}>下一页</Button></div> : null}
        {links.length ? <div className="flex flex-wrap gap-2">{links.map((link) => <Tag key={link.assetId} color={link.needsReview ? "orange" : "blue"}>{link.factName || "已删除事实"} → {link.assetName}{link.needsReview ? " · 待审阅" : ""}</Tag>)}</div> : null}
    </section>;
}
