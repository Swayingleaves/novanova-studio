"use client";

import { translateMessage } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";

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

export const getItemTypeLabels = (translate = translateMessage): Record<StoryBibleItemType, string> => ({ character: translate("script.character"), location: translate("script.location"), relationship: translate("script.relationship"), event: translate("script.event"), storyline: translate("script.storyline") });
export const getItemStatusLabels = (translate = translateMessage): Record<StoryBibleItemStatus, string> => ({ pending: translate("script.pendingApproval"), confirmed: translate("script.confirmed"), rejected: translate("script.rejected") });

const getRoleLabels = (translate = translateMessage): Record<StoryBibleLinkRole, string> => ({ relation_source: translate("script.relationshipSource"), relation_target: translate("script.relationshipTarget"), participant: translate("script.participants"), location: translate("script.location"), storyline_event: translate("script.includedEvents") });

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
    const translate = useTranslation();
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
            if (requestSequence === detailRequestSequence.current) setError(requestError instanceof Error ? requestError.message : translate("script.couldNotLoadTheEntry"));
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
            message.error(requestError instanceof Error ? requestError.message : translate("script.operationFailed"));
            if (itemId) void load();
        } finally {
            setSaving(false);
        }
    };

    const save = () => {
        if (!itemType) return;
        if (!draft.name.trim()) {
            message.warning(translate("script.nameCannotBeEmpty"));
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
        }), translate("script.savedAndLockedFutureAnalysisWillNotOverwriteIt"));
    };

    const merge = () => {
        if (!detail) return;
        let sourceId = "";
        modal.confirm({
            title: translate("script.mergeOtherCountEntriesIntoCount", { value0: getItemTypeLabels(translate)[detail.item.itemType], value1: detail.item.name }),
            content: <ItemSelect projectId={projectId} itemType={detail.item.itemType} exclude={detail.item.id} onChange={(value) => { sourceId = value; }} />,
            okText: translate("script.merge"),
            cancelText: translate("script.cancel"),
            onOk: async () => {
                if (!sourceId) {
                    message.warning(translate("script.selectEntriesToMerge"));
                    return Promise.reject(new Error("empty"));
                }
                const source = await getStoryBibleItem(projectId, sourceId);
                await run(() => mergeStoryBibleEntities({ projectId, targetItemId: detail.item.id, targetRevision: detail.item.revision, sourceItemId: sourceId, sourceRevision: source.item.revision }), translate("script.mergedAliasesAndEvidenceHaveBeenCombined"));
            },
        });
    };

    const split = () => {
        if (!detail) return;
        let name = "";
        modal.confirm({
            title: translate("script.splitIntoANewEntry"),
            content: <div className="space-y-2"><p className="text-xs text-[var(--studio-muted)]">{translate("script.selectedCountAliasesAndCountEvidenceItemsEvidenceLinked_af255c", { value0: splitAliasIds.length, value1: splitEvidenceIds.length })}</p><Input placeholder={translate("script.newEntryName")} maxLength={255} onChange={(event) => { name = event.target.value; }} /></div>,
            okText: translate("script.split"),
            cancelText: translate("script.cancel"),
            onOk: () => {
                if (!name.trim()) {
                    message.warning(translate("script.enterANewEntryName"));
                    return Promise.reject(new Error("empty"));
                }
                return run(() => splitStoryBibleEntity({ projectId, itemId: detail.item.id, expectedRevision: detail.item.revision, name: name.trim(), aliasIds: splitAliasIds, evidenceIds: splitEvidenceIds }), translate("script.splitIntoANewEntry_2fca8b"));
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
            title: translate("script.mergeCountSelectedSuggestions", { value0: selectedSuggestions.length }),
            content: translate("script.aliasesAndEvidenceFromTheSuggestionsWillBeMergedInto"),
            okText: translate("script.mergeSelected"),
            cancelText: translate("script.cancel"),
            onOk: async () => {
                setSaving(true);
                try {
                    await confirmStoryBibleItems(projectId, selectedSuggestions.map(({ item: suggestion }) => ({ itemId: suggestion.id, expectedRevision: suggestion.revision })));
                    message.success(translate("script.mergedCountSuggestions", { value0: selectedSuggestions.length }));
                    onChanged();
                    await load();
                } catch (requestError) {
                    message.error(requestError instanceof Error ? requestError.message : translate("script.couldNotMergeSelectedSuggestions"));
                    await load();
                    throw requestError;
                } finally {
                    setSaving(false);
                }
            },
        });
    };

    return (
        <Drawer open={open} onClose={onClose} size="min(720px, 100vw)" title={item ? <span className="flex items-center gap-2">{item.name}<Tag className="mr-0">{getItemTypeLabels(translate)[item.itemType]}</Tag><Tag color={item.status === "confirmed" ? "green" : item.status === "rejected" ? "default" : "gold"} className="mr-0">{getItemStatusLabels(translate)[item.status]}</Tag>{item.locked ? <Lock className="size-3.5 text-[var(--studio-muted)]" aria-label={translate("script.locked")} /> : null}</span> : createType ? translate("script.createCount", { value0: getItemTypeLabels(translate)[createType] }) : ""}
            extra={item && !editing ? <span className="flex gap-2">
                {item.status !== "confirmed" ? <Button size="small" type="primary" icon={<Check className="size-3.5" />} loading={saving} onClick={() => void run(() => confirmStoryBibleItem(projectId, item.id, item.revision), translate("script.confirmed"))}>{translate("script.confirm_b56d9a")}</Button> : null}
                {item.status !== "rejected" ? <Button size="small" icon={<X className="size-3.5" />} loading={saving} onClick={() => void run(() => rejectStoryBibleItem(projectId, item.id, item.revision), translate("script.rejectedFutureAnalysisWillNotGenerateItAgain"))}>{translate("script.reject")}</Button> : null}
                <Button size="small" onClick={() => setEditing(true)}>{translate("script.edit")}</Button>
            </span> : null}>
            {loading && !detail ? <div className="flex justify-center p-6"><Spin /></div> : null}
            {error ? <Alert type="error" showIcon title={error} action={<Button size="small" onClick={() => void load()}>{translate("script.retry")}</Button>} /> : null}
            {editing && itemType ? (
                <div className="space-y-3">
                    <Field label={translate("script.name")}><Input value={draft.name} maxLength={255} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
                    {entity ? <Field label={translate("script.aliases")}><Select mode="tags" className="w-full" value={draft.aliases} onChange={(aliases) => setDraft({ ...draft, aliases })} placeholder={translate("script.pressEnterToAdd")} /></Field> : null}
                    {itemType === "relationship" ? <>
                        <Field label={translate("script.relationshipType")}><Input value={draft.relationType} maxLength={60} onChange={(event) => setDraft({ ...draft, relationType: event.target.value })} placeholder={translate("script.forExampleMentorRomanticPartnerEnemy")} /></Field>
                        <Field label={translate("script.sourceCharacter")}><ItemSelect projectId={projectId} itemType="character" value={draft.source} onChange={(source) => setDraft({ ...draft, source })} /></Field>
                        <Field label={translate("script.targetCharacter")}><ItemSelect projectId={projectId} itemType="character" value={draft.target} onChange={(target) => setDraft({ ...draft, target })} /></Field>
                    </> : null}
                    {itemType === "event" ? <>
                        <Field label={translate("script.participatingCharacters")}><ItemSelect projectId={projectId} itemType="character" multiple value={draft.participants} onChange={(participants) => setDraft({ ...draft, participants })} /></Field>
                        <Field label={translate("script.location")}><ItemSelect projectId={projectId} itemType="location" value={draft.location} onChange={(location) => setDraft({ ...draft, location })} /></Field>
                        <Field label={translate("script.storyTime")}><div className="flex items-center gap-2"><Input value={draft.storyTime} maxLength={255} onChange={(event) => setDraft({ ...draft, storyTime: event.target.value })} placeholder={translate("script.forExampleThreeYearsAgoTheNextMorning")} /><Checkbox checked={draft.storyTimeKnown} onChange={(event) => setDraft({ ...draft, storyTimeKnown: event.target.checked })}>{translate("script.confirmed")}</Checkbox></div></Field>
                        <Field label={translate("script.storyOrder")}><InputNumber className="w-40" value={draft.storyOrder} onChange={(storyOrder) => setDraft({ ...draft, storyOrder: storyOrder ?? null })} placeholder={translate("script.lowerNumbersAppearEarlier")} /></Field>
                    </> : null}
                    {itemType === "storyline" ? <Field label={translate("script.includedEvents")}><ItemSelect projectId={projectId} itemType="event" multiple value={draft.events} onChange={(events) => setDraft({ ...draft, events })} /></Field> : null}
                    <Field label={translate("script.summary")}><Input.TextArea value={draft.summary} maxLength={5000} autoSize={{ minRows: 3, maxRows: 10 }} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></Field>
                    <div className="flex justify-end gap-2"><Button onClick={() => (detail ? (setEditing(false), setDraft(toDraft(detail))) : onClose())}>{translate("script.cancel")}</Button><Button type="primary" loading={saving} onClick={save}>{translate("script.save")}</Button></div>
                </div>
            ) : null}
            {detail && !editing ? (
                <div className="space-y-5">
                    {item?.summary ? <p className="whitespace-pre-wrap text-sm text-[var(--studio-text)]">{item.summary}</p> : null}
                    {item?.attributes?.uncertain === true ? <Alert type="warning" showIcon title={translate("script.aiIsUnsureWhetherTheseReferToTheSameSubject")} /> : null}
                    {item?.itemType === "event" ? <p className="text-xs text-[var(--studio-muted)]">{translate("script.storyTimeCountcount_2dee0a", { value0: item.storyTimeStatus === "known" ? item.storyTime : translate("script.pendingCount", { value0: item.storyTime ? `（${item.storyTime}）` : "" }), value1: item.storyOrder != null ? translate("script.orderCount", { value0: item.storyOrder }) : "" })}</p> : null}
                    {entity ? (
                        <section>
                            <div className="mb-2 flex items-center gap-2"><h3 className="text-sm font-semibold">{translate("script.aliases")}</h3><span className="flex-1" /><Button size="small" onClick={merge}>{translate("script.mergeOtherEntries")}</Button><Button size="small" disabled={!splitAliasIds.length && !splitEvidenceIds.length} onClick={split}>{translate("script.splitSelected")}</Button></div>
                            <div className="flex flex-wrap gap-2">{detail.aliases.map((alias) => <Checkbox key={alias.id} checked={splitAliasIds.includes(alias.id)} onChange={(event) => setSplitAliasIds((current) => event.target.checked ? [...current, alias.id] : current.filter((id) => id !== alias.id))}>{alias.alias}</Checkbox>)}</div>
                        </section>
                    ) : null}
                    {detail.links.length ? <section><h3 className="mb-2 text-sm font-semibold">{translate("script.links")}</h3><div className="flex flex-wrap gap-2">{detail.links.map((link) => <Tag key={`${link.role}-${link.relatedItemId}`}>{getRoleLabels(translate)[link.role]}：{link.relatedName}</Tag>)}</div></section> : null}
                    {detail.referencedBy.length ? <section><h3 className="mb-2 text-sm font-semibold">{translate("script.appearsIn")}</h3><div className="flex flex-wrap gap-2">{detail.referencedBy.map((link) => <Tag key={`${link.role}-${link.relatedItemId}`}>{getItemTypeLabels(translate)[link.relatedType]}：{link.relatedName}</Tag>)}</div></section> : null}
                    {detail.suggestions.length ? (
                        <section>
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                                <h3 className="text-sm font-semibold">{translate("script.newSuggestionsFromAnalysis")}</h3>
                                <span className="flex-1" />
                                <Checkbox checked={selectedSuggestions.length === pendingSuggestions.length} indeterminate={selectedSuggestions.length > 0 && selectedSuggestions.length < pendingSuggestions.length} onChange={(event) => setSelectedSuggestionIds(event.target.checked ? pendingSuggestions.slice(0, 200).map((suggestion) => suggestion.item.id) : [])}>{pendingSuggestions.length > 200 ? translate("script.selectFirst200Suggestions") : translate("script.selectAllSuggestions")}</Checkbox>
                                <Button size="small" type="primary" disabled={!selectedSuggestions.length} loading={saving} onClick={confirmSelectedSuggestions}>{translate("script.mergeSelectedCount_9bd263", { value0: selectedSuggestions.length ? `（${selectedSuggestions.length}）` : "" })}</Button>
                            </div>
                            <p className="mb-2 text-xs text-[var(--studio-muted)]">{translate("script.thisEntryIsLockedNewFindingsAreNotAddedAutomatically")}</p>
                            <div className="space-y-2">{detail.suggestions.map((suggestion) => (
                                <div key={suggestion.item.id} className="rounded-lg border border-dashed border-[var(--studio-line-strong)] p-3">
                                    <div className="flex items-center gap-2"><Checkbox aria-label={translate("script.selectSuggestionCount", { value0: suggestion.item.name })} checked={selectedSuggestionIds.includes(suggestion.item.id)} onChange={(event) => {
                                        if (event.target.checked && selectedSuggestionIds.length >= 200) {
                                            message.warning(translate("script.selectAtMost200SuggestionsAtATime"));
                                            return;
                                        }
                                        setSelectedSuggestionIds((current) => event.target.checked ? [...current, suggestion.item.id] : current.filter((id) => id !== suggestion.item.id));
                                    }} /><span className="text-sm font-medium">{suggestion.item.name}</span><span className="flex-1" /><Button size="small" type="primary" loading={saving} onClick={() => void run(() => confirmStoryBibleItem(projectId, suggestion.item.id, suggestion.item.revision), translate("script.suggestionMerged"))}>{translate("script.merge_7938b3")}</Button><Button size="small" loading={saving} onClick={() => void run(() => rejectStoryBibleItem(projectId, suggestion.item.id, suggestion.item.revision), translate("script.suggestionRejected"), false).then(() => load())}>{translate("script.reject")}</Button></div>
                                    {suggestion.item.summary ? <p className="mt-1 text-xs text-[var(--studio-text)]">{suggestion.item.summary}</p> : null}
                                    <EvidenceList evidences={suggestion.evidences} onOpenSource={onOpenSource} />
                                </div>
                            ))}</div>
                        </section>
                    ) : null}
                    <section>
                        <h3 className="mb-2 text-sm font-semibold">{translate("script.sourceEvidenceCount_2ea5e1", { value0: detail.evidences.length })}</h3>
                        {detail.evidences.length ? <EvidenceList evidences={detail.evidences} onOpenSource={onOpenSource} selectable={entity} selected={splitEvidenceIds} onSelect={setSplitEvidenceIds} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={translate("script.noSourceEvidenceYet")} />}
                    </section>
                </div>
            ) : null}
        </Drawer>
    );
}

function EvidenceList({ evidences, onOpenSource, selectable, selected = [], onSelect }: { evidences: StoryBibleItemDetail["evidences"]; onOpenSource: (start: number, end: number) => void; selectable?: boolean; selected?: string[]; onSelect?: (ids: string[]) => void }) {
    const translate = useTranslation();
    return (
        <ol className="mt-2 space-y-1">
            {evidences.map((evidence) => (
                <li key={evidence.id} className="flex items-start gap-2 text-xs">
                    {selectable ? <Checkbox checked={selected.includes(evidence.id)} onChange={(event) => onSelect?.(event.target.checked ? [...selected, evidence.id] : selected.filter((id) => id !== evidence.id))} /> : null}
                    <button type="button" className="min-w-0 flex-1 rounded px-1 text-left text-[var(--studio-text)] hover:bg-[var(--studio-surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--studio-action)]" title={translate("script.goToSource")} onClick={() => onOpenSource(evidence.startOffset, evidence.endOffset)}>
                        <span className="mr-2 text-[var(--studio-faint)]">{evidence.startOffset}</span>“{evidence.quote}”
                    </button>
                </li>
            ))}
        </ol>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    const translate = useTranslation();
    return <label className="block"><span className="mb-1 block text-xs text-[var(--studio-muted)]">{label}</span>{children}</label>;
}

/** 按类型远程搜索条目的选择器。 */
function ItemSelect({ projectId, itemType, exclude, multiple, value, onChange }: { projectId: string; itemType: StoryBibleItemType; exclude?: string; multiple?: boolean; value?: string | string[]; onChange: (value: never) => void }) {
    const translate = useTranslation();
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
    return <Select className="w-full" showSearch filterOption={false} allowClear mode={multiple ? "multiple" : undefined} value={value || undefined} onSearch={(keyword) => void search(keyword)} onChange={(next) => onChange((next ?? (multiple ? [] : "")) as never)} options={options.map((item) => ({ value: item.id, label: item.name }))} placeholder={translate("script.selectCount_501c10", { value0: getItemTypeLabels(translate)[itemType] })} />;
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
