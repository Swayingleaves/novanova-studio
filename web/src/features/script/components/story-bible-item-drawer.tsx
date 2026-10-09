"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { App, Alert, Button, Checkbox, Drawer, Empty, Input, InputNumber, Select, Spin, Tag } from "antd";
import { Check, Lock, X } from "lucide-react";

import {
    confirmStoryBibleItem,
    confirmStoryBibleItems,
    getStoryBibleItem,
    listStoryBibleItems,
    mergeStoryBibleEntities,
    rejectStoryBibleItem,
    saveStoryBibleItem,
    splitStoryBibleEntity,
} from "@/services/api/script";
import type { StoryBibleItem, StoryBibleItemDetail, StoryBibleItemStatus, StoryBibleItemType, StoryBibleLinkRole } from "../types";

export const ITEM_TYPE_LABELS: Record<StoryBibleItemType, string> = { character: "人物", location: "地点", relationship: "关系", event: "事件", storyline: "故事线" };
export const ITEM_STATUS_LABELS: Record<StoryBibleItemStatus, string> = { pending: "待确认", confirmed: "已确认", rejected: "已拒绝" };

const ROLE_LABELS: Record<StoryBibleLinkRole, string> = { relation_source: "关系来源", relation_target: "关系目标", participant: "参与者", location: "地点", storyline_event: "包含事件" };

type Draft = { name: string; summary: string; aliases: string[]; storyTime: string; storyTimeKnown: boolean; storyOrder: number | null; relationType: string; source: string; target: string; participants: string[]; location: string; events: string[] };

const EMPTY_DRAFT: Draft = { name: "", summary: "", aliases: [], storyTime: "", storyTimeKnown: false, storyOrder: null, relationType: "", source: "", target: "", participants: [], location: "", events: [] };

/** 条目详情抽屉：编辑、确认、拒绝、证据侧栏、待审建议以及人物地点的合并拆分。 */
export function StoryBibleItemDrawer({ projectId, itemId, createType, onClose, onChanged, onOpenSource }: {
    projectId: string;
    itemId: string | null;
    createType: StoryBibleItemType | null;
    onClose: () => void;
    onChanged: (nextItemId?: string) => void;
    onOpenSource: (start: number, end: number) => void;
}) {
    const { message, modal } = App.useApp();
    const [detail, setDetail] = useState<StoryBibleItemDetail | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [splitAliasIds, setSplitAliasIds] = useState<string[]>([]);
    const [splitEvidenceIds, setSplitEvidenceIds] = useState<string[]>([]);
    const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<string[]>([]);
    const detailRequestSequence = useRef(0);
    const open = itemId != null || createType != null;
    const itemType = detail?.item.itemType || createType;

    const load = useCallback(async () => {
        if (!itemId) return;
        const requestSequence = ++detailRequestSequence.current;
        setLoading(true);
        try {
            const next = await getStoryBibleItem(projectId, itemId);
            if (requestSequence !== detailRequestSequence.current) return;
            setDetail(next);
            setDraft(toDraft(next));
            setSelectedSuggestionIds([]);
            setError("");
        } catch (requestError) {
            if (requestSequence === detailRequestSequence.current) setError(requestError instanceof Error ? requestError.message : "条目加载失败");
        } finally {
            if (requestSequence === detailRequestSequence.current) setLoading(false);
        }
    }, [itemId, projectId]);

    useEffect(() => {
        setEditing(createType != null);
        setSplitAliasIds([]);
        setSplitEvidenceIds([]);
        setSelectedSuggestionIds([]);
        setDetail(null);
        setError("");
        if (itemId) void load();
        else {
            detailRequestSequence.current += 1;
            setLoading(false);
            setDraft(EMPTY_DRAFT);
        }
    }, [createType, itemId, load]);

    const run = async (action: () => Promise<StoryBibleItemDetail>, done: string, reopen = true) => {
        setSaving(true);
        try {
            const next = await action();
            message.success(done);
            if (reopen && next.item.id === itemId) {
                setDetail(next);
                setDraft(toDraft(next));
            }
            setEditing(false);
            setSplitAliasIds([]);
            setSplitEvidenceIds([]);
            onChanged(reopen ? next.item.id : undefined);
        } catch (requestError) {
            message.error(requestError instanceof Error ? requestError.message : "操作失败");
            if (itemId) void load();
        } finally {
            setSaving(false);
        }
    };

    const save = () => {
        if (!itemType) return;
        if (!draft.name.trim()) {
            message.warning("名称不能为空");
            return;
        }
        const links = itemType === "relationship"
            ? (draft.source && draft.target ? [{ relatedItemId: draft.source, role: "relation_source" as const }, { relatedItemId: draft.target, role: "relation_target" as const }] : undefined)
            : itemType === "event"
                ? [...draft.participants.map((id) => ({ relatedItemId: id, role: "participant" as const })), ...(draft.location ? [{ relatedItemId: draft.location, role: "location" as const }] : [])]
                : itemType === "storyline" ? draft.events.map((id) => ({ relatedItemId: id, role: "storyline_event" as const })) : undefined;
        const attributes = { ...(detail?.item.attributes || {}), ...(itemType === "relationship" ? { relationType: draft.relationType } : {}) };
        delete (attributes as Record<string, unknown>).uncertain;
        void run(() => saveStoryBibleItem({
            projectId,
            itemId: detail?.item.id,
            expectedRevision: detail?.item.revision ?? 0,
            itemType,
            name: draft.name.trim(),
            summary: draft.summary,
            attributes,
            aliases: draft.aliases,
            links,
            storyTime: draft.storyTime,
            storyTimeStatus: draft.storyTimeKnown ? "known" : "uncertain",
            storyOrder: draft.storyOrder,
        }), "已保存并锁定，重新分析不会覆盖");
    };

    const merge = () => {
        if (!detail) return;
        let sourceId = "";
        modal.confirm({
            title: `把其他${ITEM_TYPE_LABELS[detail.item.itemType]}并入“${detail.item.name}”`,
            content: <ItemSelect projectId={projectId} itemType={detail.item.itemType} exclude={detail.item.id} onChange={(value) => { sourceId = value; }} />,
            okText: "合并",
            cancelText: "取消",
            onOk: async () => {
                if (!sourceId) {
                    message.warning("请选择要并入的条目");
                    return Promise.reject(new Error("empty"));
                }
                const source = await getStoryBibleItem(projectId, sourceId);
                await run(() => mergeStoryBibleEntities({ projectId, targetItemId: detail.item.id, targetRevision: detail.item.revision, sourceItemId: sourceId, sourceRevision: source.item.revision }), "已合并，别名与证据已并入");
            },
        });
    };

    const split = () => {
        if (!detail) return;
        let name = "";
        modal.confirm({
            title: "拆分为新条目",
            content: <div className="space-y-2"><p className="text-xs text-[var(--studio-muted)]">已选 {splitAliasIds.length} 个别名、{splitEvidenceIds.length} 条证据；所选别名下的证据会一并移出。</p><Input placeholder="新条目名称" maxLength={255} onChange={(event) => { name = event.target.value; }} /></div>,
            okText: "拆分",
            cancelText: "取消",
            onOk: () => {
                if (!name.trim()) {
                    message.warning("请输入新条目名称");
                    return Promise.reject(new Error("empty"));
                }
                return run(() => splitStoryBibleEntity({ projectId, itemId: detail.item.id, expectedRevision: detail.item.revision, name: name.trim(), aliasIds: splitAliasIds, evidenceIds: splitEvidenceIds }), "已拆分为新条目");
            },
        });
    };

    const item = detail?.item;
    const entity = itemType === "character" || itemType === "location";
    const pendingSuggestions = detail?.suggestions.filter((suggestion) => suggestion.item.status === "pending") || [];
    const selectedSuggestions = pendingSuggestions.filter((suggestion) => selectedSuggestionIds.includes(suggestion.item.id));
    const confirmSelectedSuggestions = () => {
        if (!selectedSuggestions.length || saving) return;
        modal.confirm({
            title: `并入选中的 ${selectedSuggestions.length} 条建议？`,
            content: "建议中的别名和证据会并入当前条目，并校验每条建议的最新修订号。",
            okText: "批量并入",
            cancelText: "取消",
            onOk: async () => {
                setSaving(true);
                try {
                    await confirmStoryBibleItems(projectId, selectedSuggestions.map(({ item: suggestion }) => ({ itemId: suggestion.id, expectedRevision: suggestion.revision })));
                    message.success(`已并入 ${selectedSuggestions.length} 条建议`);
                    onChanged();
                    await load();
                } catch (requestError) {
                    message.error(requestError instanceof Error ? requestError.message : "批量并入失败");
                    await load();
                    throw requestError;
                } finally {
                    setSaving(false);
                }
            },
        });
    };

    return (
        <Drawer open={open} onClose={onClose} size="min(720px, 100vw)" title={item ? <span className="flex items-center gap-2">{item.name}<Tag className="mr-0">{ITEM_TYPE_LABELS[item.itemType]}</Tag><Tag color={item.status === "confirmed" ? "green" : item.status === "rejected" ? "default" : "gold"} className="mr-0">{ITEM_STATUS_LABELS[item.status]}</Tag>{item.locked ? <Lock className="size-3.5 text-[var(--studio-muted)]" aria-label="已锁定" /> : null}</span> : createType ? `新建${ITEM_TYPE_LABELS[createType]}` : ""}
            extra={item && !editing ? <span className="flex gap-2">
                {item.status !== "confirmed" ? <Button size="small" type="primary" icon={<Check className="size-3.5" />} loading={saving} onClick={() => void run(() => confirmStoryBibleItem(projectId, item.id, item.revision), "已确认")}>确认</Button> : null}
                {item.status !== "rejected" ? <Button size="small" icon={<X className="size-3.5" />} loading={saving} onClick={() => void run(() => rejectStoryBibleItem(projectId, item.id, item.revision), "已拒绝，重新分析不会再生成")}>拒绝</Button> : null}
                <Button size="small" onClick={() => setEditing(true)}>编辑</Button>
            </span> : null}>
            {loading && !detail ? <div className="flex justify-center p-6"><Spin /></div> : null}
            {error ? <Alert type="error" showIcon title={error} action={<Button size="small" onClick={() => void load()}>重试</Button>} /> : null}
            {editing && itemType ? (
                <div className="space-y-3">
                    <Field label="名称"><Input value={draft.name} maxLength={255} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
                    {entity ? <Field label="别名"><Select mode="tags" className="w-full" value={draft.aliases} onChange={(aliases) => setDraft({ ...draft, aliases })} placeholder="输入后回车添加" /></Field> : null}
                    {itemType === "relationship" ? <>
                        <Field label="关系类型"><Input value={draft.relationType} maxLength={60} onChange={(event) => setDraft({ ...draft, relationType: event.target.value })} placeholder="如 师徒、恋人、敌对" /></Field>
                        <Field label="来源人物"><ItemSelect projectId={projectId} itemType="character" value={draft.source} onChange={(source) => setDraft({ ...draft, source })} /></Field>
                        <Field label="目标人物"><ItemSelect projectId={projectId} itemType="character" value={draft.target} onChange={(target) => setDraft({ ...draft, target })} /></Field>
                    </> : null}
                    {itemType === "event" ? <>
                        <Field label="参与人物"><ItemSelect projectId={projectId} itemType="character" multiple value={draft.participants} onChange={(participants) => setDraft({ ...draft, participants })} /></Field>
                        <Field label="地点"><ItemSelect projectId={projectId} itemType="location" value={draft.location} onChange={(location) => setDraft({ ...draft, location })} /></Field>
                        <Field label="故事时间"><div className="flex items-center gap-2"><Input value={draft.storyTime} maxLength={255} onChange={(event) => setDraft({ ...draft, storyTime: event.target.value })} placeholder="如 三年前、次日清晨" /><Checkbox checked={draft.storyTimeKnown} onChange={(event) => setDraft({ ...draft, storyTimeKnown: event.target.checked })}>已确认</Checkbox></div></Field>
                        <Field label="故事排序"><InputNumber className="w-40" value={draft.storyOrder} onChange={(storyOrder) => setDraft({ ...draft, storyOrder: storyOrder ?? null })} placeholder="越小越早" /></Field>
                    </> : null}
                    {itemType === "storyline" ? <Field label="包含事件"><ItemSelect projectId={projectId} itemType="event" multiple value={draft.events} onChange={(events) => setDraft({ ...draft, events })} /></Field> : null}
                    <Field label="摘要"><Input.TextArea value={draft.summary} maxLength={5000} autoSize={{ minRows: 3, maxRows: 10 }} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></Field>
                    <div className="flex justify-end gap-2"><Button onClick={() => (detail ? (setEditing(false), setDraft(toDraft(detail))) : onClose())}>取消</Button><Button type="primary" loading={saving} onClick={save}>保存</Button></div>
                </div>
            ) : null}
            {detail && !editing ? (
                <div className="space-y-5">
                    {item?.summary ? <p className="whitespace-pre-wrap text-sm text-[var(--studio-text)]">{item.summary}</p> : null}
                    {item?.attributes?.uncertain === true ? <Alert type="warning" showIcon title="AI 对是否为同一对象不确定，请核对别名与证据后确认，或拆分" /> : null}
                    {item?.itemType === "event" ? <p className="text-xs text-[var(--studio-muted)]">故事时间：{item.storyTimeStatus === "known" ? item.storyTime : `待确认${item.storyTime ? `（${item.storyTime}）` : ""}`}{item.storyOrder != null ? ` · 排序 ${item.storyOrder}` : ""}</p> : null}
                    {entity ? (
                        <section>
                            <div className="mb-2 flex items-center gap-2"><h3 className="text-sm font-semibold">别名</h3><span className="flex-1" /><Button size="small" onClick={merge}>合并其他条目</Button><Button size="small" disabled={!splitAliasIds.length && !splitEvidenceIds.length} onClick={split}>拆分所选</Button></div>
                            <div className="flex flex-wrap gap-2">{detail.aliases.map((alias) => <Checkbox key={alias.id} checked={splitAliasIds.includes(alias.id)} onChange={(event) => setSplitAliasIds((current) => event.target.checked ? [...current, alias.id] : current.filter((id) => id !== alias.id))}>{alias.alias}</Checkbox>)}</div>
                        </section>
                    ) : null}
                    {detail.links.length ? <section><h3 className="mb-2 text-sm font-semibold">关联</h3><div className="flex flex-wrap gap-2">{detail.links.map((link) => <Tag key={`${link.role}-${link.relatedItemId}`}>{ROLE_LABELS[link.role]}：{link.relatedName}</Tag>)}</div></section> : null}
                    {detail.referencedBy.length ? <section><h3 className="mb-2 text-sm font-semibold">出现在</h3><div className="flex flex-wrap gap-2">{detail.referencedBy.map((link) => <Tag key={`${link.role}-${link.relatedItemId}`}>{ITEM_TYPE_LABELS[link.relatedType]}：{link.relatedName}</Tag>)}</div></section> : null}
                    {detail.suggestions.length ? (
                        <section>
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                                <h3 className="text-sm font-semibold">重新分析的新建议</h3>
                                <span className="flex-1" />
                                <Checkbox checked={selectedSuggestions.length === pendingSuggestions.length} indeterminate={selectedSuggestions.length > 0 && selectedSuggestions.length < pendingSuggestions.length} onChange={(event) => setSelectedSuggestionIds(event.target.checked ? pendingSuggestions.slice(0, 200).map((suggestion) => suggestion.item.id) : [])}>{pendingSuggestions.length > 200 ? "选择前200条建议" : "全选建议"}</Checkbox>
                                <Button size="small" type="primary" disabled={!selectedSuggestions.length} loading={saving} onClick={confirmSelectedSuggestions}>批量并入{selectedSuggestions.length ? `（${selectedSuggestions.length}）` : ""}</Button>
                            </div>
                            <p className="mb-2 text-xs text-[var(--studio-muted)]">该条目已锁定，新发现的内容不会自动写入。确认后并入别名与证据，拒绝后不再重复提示。</p>
                            <div className="space-y-2">{detail.suggestions.map((suggestion) => (
                                <div key={suggestion.item.id} className="rounded-lg border border-dashed border-[var(--studio-line-strong)] p-3">
                                    <div className="flex items-center gap-2"><Checkbox aria-label={`选择建议${suggestion.item.name}`} checked={selectedSuggestionIds.includes(suggestion.item.id)} onChange={(event) => {
                                        if (event.target.checked && selectedSuggestionIds.length >= 200) {
                                            message.warning("单次最多选择200条建议");
                                            return;
                                        }
                                        setSelectedSuggestionIds((current) => event.target.checked ? [...current, suggestion.item.id] : current.filter((id) => id !== suggestion.item.id));
                                    }} /><span className="text-sm font-medium">{suggestion.item.name}</span><span className="flex-1" /><Button size="small" type="primary" loading={saving} onClick={() => void run(() => confirmStoryBibleItem(projectId, suggestion.item.id, suggestion.item.revision), "建议已并入")}>并入</Button><Button size="small" loading={saving} onClick={() => void run(() => rejectStoryBibleItem(projectId, suggestion.item.id, suggestion.item.revision), "已拒绝该建议", false).then(() => load())}>拒绝</Button></div>
                                    {suggestion.item.summary ? <p className="mt-1 text-xs text-[var(--studio-text)]">{suggestion.item.summary}</p> : null}
                                    <EvidenceList evidences={suggestion.evidences} onOpenSource={onOpenSource} />
                                </div>
                            ))}</div>
                        </section>
                    ) : null}
                    <section>
                        <h3 className="mb-2 text-sm font-semibold">原文证据（{detail.evidences.length}）</h3>
                        {detail.evidences.length ? <EvidenceList evidences={detail.evidences} onOpenSource={onOpenSource} selectable={entity} selected={splitEvidenceIds} onSelect={setSplitEvidenceIds} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无原文证据" />}
                    </section>
                </div>
            ) : null}
        </Drawer>
    );
}

function EvidenceList({ evidences, onOpenSource, selectable, selected = [], onSelect }: { evidences: StoryBibleItemDetail["evidences"]; onOpenSource: (start: number, end: number) => void; selectable?: boolean; selected?: string[]; onSelect?: (ids: string[]) => void }) {
    return (
        <ol className="mt-2 space-y-1">
            {evidences.map((evidence) => (
                <li key={evidence.id} className="flex items-start gap-2 text-xs">
                    {selectable ? <Checkbox checked={selected.includes(evidence.id)} onChange={(event) => onSelect?.(event.target.checked ? [...selected, evidence.id] : selected.filter((id) => id !== evidence.id))} /> : null}
                    <button type="button" className="min-w-0 flex-1 rounded px-1 text-left text-[var(--studio-text)] hover:bg-[var(--studio-surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--studio-action)]" title="跳转原文" onClick={() => onOpenSource(evidence.startOffset, evidence.endOffset)}>
                        <span className="mr-2 text-[var(--studio-faint)]">{evidence.startOffset}</span>“{evidence.quote}”
                    </button>
                </li>
            ))}
        </ol>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return <label className="block"><span className="mb-1 block text-xs text-[var(--studio-muted)]">{label}</span>{children}</label>;
}

/** 按类型远程搜索条目的选择器。 */
function ItemSelect({ projectId, itemType, exclude, multiple, value, onChange }: { projectId: string; itemType: StoryBibleItemType; exclude?: string; multiple?: boolean; value?: string | string[]; onChange: (value: never) => void }) {
    const [options, setOptions] = useState<StoryBibleItem[]>([]);
    const search = useCallback(async (keyword: string) => {
        try {
            const page = await listStoryBibleItems({ projectId, itemType, keyword: keyword.trim() || undefined, page: 1, pageSize: 50 });
            setOptions(page.items.filter((item) => item.id !== exclude));
        } catch {
            setOptions([]);
        }
    }, [exclude, itemType, projectId]);
    useEffect(() => { void search(""); }, [search]);
    return <Select className="w-full" showSearch filterOption={false} allowClear mode={multiple ? "multiple" : undefined} value={value || undefined} onSearch={(keyword) => void search(keyword)} onChange={(next) => onChange((next ?? (multiple ? [] : "")) as never)} options={options.map((item) => ({ value: item.id, label: item.name }))} placeholder={`选择${ITEM_TYPE_LABELS[itemType]}`} />;
}

/** 条目详情转为编辑草稿。 */
function toDraft(detail: StoryBibleItemDetail): Draft {
    const { item, links } = detail;
    const pick = (role: StoryBibleLinkRole) => links.filter((link) => link.role === role).map((link) => link.relatedItemId);
    return {
        name: item.name,
        summary: item.summary,
        aliases: detail.aliases.map((alias) => alias.alias).filter((alias) => alias !== item.name),
        storyTime: item.storyTime,
        storyTimeKnown: item.storyTimeStatus === "known",
        storyOrder: item.storyOrder,
        relationType: typeof item.attributes?.relationType === "string" ? item.attributes.relationType : "",
        source: pick("relation_source")[0] || "",
        target: pick("relation_target")[0] || "",
        participants: pick("participant"),
        location: pick("location")[0] || "",
        events: pick("storyline_event"),
    };
}
