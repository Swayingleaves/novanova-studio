"use client";

import { translateMessage } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";

import { useState } from "react";
import { nanoid } from "nanoid";
import { Button, Checkbox, Empty, Input, InputNumber, Modal, Pagination, Popconfirm, Select, Tabs } from "antd";
import { ArrowDown, ArrowUp, BookOpen, MapPin, Plus, Sparkles, Trash2 } from "lucide-react";

import { createScriptScene, moveScriptBlock, removeScriptBlock, replaceScriptBlock, synchronizeDialogueCharacters } from "../lib/script-episode-editing";
import { useScriptStore } from "../stores/use-script-store";
import type { EpisodeDetail, ScriptBlock, ScriptCharacter, ScriptLocation, ScriptOverview, ScriptScene, ScriptWorkspaceSection, WorldItem } from "../types";
import { CharactersEditor } from "./characters-editor";
import { ScriptVersions } from "./script-versions";

type ScriptSectionEditorProps = { section: Exclude<ScriptWorkspaceSection, "episodes" | "source"> };

const getContentTypeOptions = (translate = translateMessage) => ([
    { value: "comicDrama", label: translate("script.comicDrama") },
    { value: "liveActionShort", label: translate("script.liveActionShortDrama") },
    { value: "animation", label: translate("script.animation") },
    { value: "advertisement", label: translate("script.advertisementPromotionalVideo") },
    { value: "musicVideo", label: translate("script.musicVideo") },
    { value: "storyShort", label: translate("script.shortFilm") },
] as const);

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];

/** 世界规则条目的分类，取值必须与后端 `WorldItem.itemType` 的枚举一致。 */
const getWorldItemTypes = (translate = translateMessage) => ([
    ["rule", translate("script.rule")], ["organization", translate("script.organization")], ["faction", translate("script.faction")],
    ["hierarchy", translate("script.level")], ["restriction", translate("script.restriction")], ["history", translate("script.historicalEvent")],
] as const);

/** 地点字段的录入行数，0 表示单行输入。 */
const getLocationFields = (translate = translateMessage) => ([
    ["spacePurpose", translate("script.locationPurpose"), 2], ["narrativeRole", translate("script.narrativeRole"), 2], ["defaultTime", translate("script.defaultTime"), 0],
    ["weather", translate("script.weather"), 0], ["atmosphere", translate("script.atmosphere"), 2], ["keyObjects", translate("script.keyObjects"), 2], ["mainEvents", translate("script.majorEvents"), 3],
] as const);

/** 渲染工作台当前剧本区块。 */
export function ScriptSectionEditor({ section }: ScriptSectionEditorProps) {
    const translate = useTranslation();
    if (section === "overview") return <OverviewEditor />;
    if (section === "outline") return <OutlineEditor />;
    if (section === "characters") return <CharactersEditor />;
    if (section === "world") return <WorldEditor />;
    return <ScriptVersions />;
}

function SectionHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
    const translate = useTranslation();
    return <header className="mb-5 flex items-start justify-between gap-4 border-b border-[var(--studio-line)] pb-4"><div><h2 className="text-xl font-semibold text-[var(--studio-ink)]">{title}</h2><p className="mt-1 text-sm text-[var(--studio-muted)]">{description}</p></div>{action}</header>;
}

function Field({ label, required = false, requirement, children }: {
    label: string;
    required?: boolean;
    requirement?: string;
    children: React.ReactNode;
}) {
    const translate = useTranslation();
    return <label className="flex min-w-0 flex-col gap-2 text-sm text-[var(--studio-text)]"><span className="flex flex-wrap items-center gap-1.5 font-medium"><span>{label}{required ? <><span aria-hidden="true" className="ml-1 text-[var(--studio-danger)]">*</span><span className="sr-only">{translate("script.required")}</span></> : null}</span>{requirement ? <span className="text-xs font-normal text-[var(--studio-muted)]">{requirement}</span> : null}</span>{children}</label>;
}

function OverviewEditor() {
    const translate = useTranslation();
    const project = useScriptStore((state) => state.project);
    const updateOverview = useScriptStore((state) => state.updateOverview);
    if (!project) return null;
    const update = <K extends keyof ScriptOverview>(key: K, value: ScriptOverview[K]) => updateOverview({ ...project.overview, [key]: value });
    const textAreas: Array<[keyof ScriptOverview, string, number]> = [
        ["logline", translate("script.logline"), 2], ["synopsis", translate("script.synopsis_210895"), 5],
        ["theme", translate("script.storyTheme"), 3], ["mainPlot", translate("script.mainPlot"), 6],
        ["mainConflict", translate("script.centralConflict"), 4], ["endingDirection", translate("script.endingDirection"), 4], ["narrativeStyle", translate("script.narrativeStyle"), 3],
    ];
    return <section><SectionHeader title={translate("script.storyOverview")} description={translate("script.defineTheStoryGoalMainConflictAndEndingDirectionFirst")} /><p id="script-overview-story-requirement" className="mb-4 text-xs leading-5 text-[var(--studio-muted)]"><span aria-hidden="true" className="font-medium text-[var(--studio-danger)]">*</span> {translate("script.isRequiredAddEitherALoglineOrASynopsisTo")}</p><div className="grid gap-4 md:grid-cols-2"><Field label={translate("script.projectName")} required><Input aria-required="true" value={project.overview.title} maxLength={120} onChange={(event) => update("title", event.target.value)} /></Field><Field label={translate("script.contentFormat")} required><Select aria-required="true" value={project.overview.contentType} options={[...getContentTypeOptions(translate)]} onChange={(value) => update("contentType", value)} /></Field><Field label={translate("script.genre")}><Input value={project.overview.genre} maxLength={80} onChange={(event) => update("genre", event.target.value)} /></Field><Field label={translate("script.targetEpisodes")}><InputNumber className="w-full" min={1} max={1000} value={project.overview.targetEpisodeCount} onChange={(value) => update("targetEpisodeCount", value || 1)} /></Field><Field label={translate("script.targetTotalDurationSeconds")}><InputNumber className="w-full" min={0} value={project.overview.targetDurationSeconds} onChange={(value) => update("targetDurationSeconds", value || 0)} /></Field>{textAreas.map(([key, label, rows]) => { const isStoryPrerequisite = key === "logline" || key === "synopsis"; return <div key={key} className={key === "logline" ? "" : "md:col-span-2"}><Field label={label} requirement={isStoryPrerequisite ? translate("script.atLeastOneRequired") : undefined}><Input.TextArea aria-describedby={isStoryPrerequisite ? "script-overview-story-requirement" : undefined} value={String(project.overview[key] || "")} rows={rows} onChange={(event) => update(key, event.target.value as never)} /></Field></div>; })}</div></section>;
}

function OutlineEditor() {
    const translate = useTranslation();
    const project = useScriptStore((state) => state.project);
    const episodes = useScriptStore((state) => state.episodes);
    const updateOutline = useScriptStore((state) => state.updateOutline);
    if (!project) return null;
    const sections = project.outlineSections;
    const events = project.storyEvents;
    const replaceSection = (id: string, patch: Partial<(typeof sections)[number]>) => updateOutline(sections.map((item) => item.id === id ? { ...item, ...patch } : item), events);
    const moveSection = (index: number, direction: -1 | 1) => {
        const next = [...sections];
        const target = index + direction;
        if (target < 0 || target >= next.length) return;
        [next[index], next[target]] = [next[target], next[index]];
        updateOutline(next.map((item, sortOrder) => ({ ...item, sortOrder })), events);
    };
    const removeSection = (id: string) => updateOutline(sections.filter((item) => item.id !== id).map((item, sortOrder) => ({ ...item, sortOrder })), events.map((event) => event.outlineSectionId === id ? { ...event, outlineSectionId: null } : event));
    const updateEvent = (id: string, patch: Partial<(typeof events)[number]>) => updateOutline(sections,
        events.map((event) => event.id === id ? { ...event, ...patch } : event));
    const episodeOptions = project.episodes.map((episode) => ({ value: episode.id, label: translate("script.episodeCountCount", { value0: episode.episodeNumber, value1: episode.title }) }));
    const eventTypes = [
        ["plot", translate("script.plot")], ["conflict", translate("script.conflict")], ["suspense", translate("script.suspense")],
        ["twist", translate("script.twist")], ["climax", translate("script.climax")], ["ending", translate("script.ending_2de9b9")],
    ];
    return <section><SectionHeader title={translate("script.storyOutline")} description={translate("script.organizeTheStoryAroundActsTheMainPlotSubplotsOr")} action={<Button icon={<Plus className="size-4" />} onClick={() => updateOutline([...sections, { id: nanoid(), sectionType: "act", title: translate("script.sectionCount", { value0: sections.length + 1 }), content: "", sortOrder: sections.length }], events)}>{translate("script.addSection")}</Button>} /><div className="space-y-4">{sections.map((item, index) => <article key={item.id} className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4"><div className="flex flex-wrap gap-2"><Input className="min-w-48 flex-1" value={item.title} onChange={(event) => replaceSection(item.id, { title: event.target.value })} /><Select value={item.sectionType} className="w-36" onChange={(sectionType) => replaceSection(item.id, { sectionType })} options={[{ value: "act", label: translate("script.actStructure") }, { value: "mainPlot", label: translate("script.mainPlot_342ed9") }, { value: "subplot", label: translate("script.subplot") }, { value: "characterArc", label: translate("script.characterArc_e1a811") }]} /><Button aria-label={translate("script.moveUp")} icon={<ArrowUp className="size-4" />} disabled={!index} onClick={() => moveSection(index, -1)} /><Button aria-label={translate("script.moveDown")} icon={<ArrowDown className="size-4" />} disabled={index === sections.length - 1} onClick={() => moveSection(index, 1)} /><Popconfirm title={translate("script.deleteThisSection")} onConfirm={() => removeSection(item.id)}><Button danger aria-label={translate("script.delete")} icon={<Trash2 className="size-4" />} /></Popconfirm></div><Input.TextArea className="mt-3" rows={6} value={item.content} onChange={(event) => replaceSection(item.id, { content: event.target.value })} placeholder={translate("script.describePlotDevelopmentCharacterChoicesAndKeyOutcomesInThis")} /></article>)}</div><div className="mt-8"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold text-[var(--studio-ink)]">{translate("script.keyEvents")}</h3><Button size="small" icon={<Plus className="size-4" />} onClick={() => updateOutline(sections, [...events, { id: nanoid(), outlineSectionId: sections[0]?.id || null, episodeId: null, sceneId: null, eventType: "plot", title: translate("script.newEvent"), description: "", sortOrder: events.length }])}>{translate("script.addEvent")}</Button></div><div className="space-y-3">{events.map((event) => {
        const selectedEpisode = event.episodeId ? episodes[event.episodeId] : undefined;
        const sceneOptions = selectedEpisode?.scenes.map((scene) => ({ value: scene.id, label: translate("script.sceneCountCount", { value0: scene.sceneNumber, value1: scene.title || translate("script.untitledScene") }) })) || [];
        return <div key={event.id} className="grid gap-2 rounded-lg border border-[var(--studio-line)] p-3 md:grid-cols-2 xl:grid-cols-[140px_180px_180px_180px_1fr_auto]"><Select aria-label={translate("script.eventType")} value={event.eventType} onChange={(eventType) => updateEvent(event.id, { eventType })} options={eventTypes.map(([value, label]) => ({ value, label }))} /><Select aria-label={translate("script.outlineSection")} allowClear value={event.outlineSectionId || undefined} placeholder={translate("script.outlineSection")} options={sections.map((section) => ({ value: section.id, label: section.title }))} onChange={(outlineSectionId) => updateEvent(event.id, { outlineSectionId: outlineSectionId || null })} /><Select aria-label={translate("script.linkedEpisode")} allowClear value={event.episodeId || undefined} placeholder={translate("script.linkedEpisodeOptional")} options={episodeOptions} onChange={(episodeId) => updateEvent(event.id, { episodeId: episodeId || null, sceneId: null })} /><Select aria-label={translate("script.linkedScene")} allowClear disabled={!event.episodeId || !selectedEpisode} value={event.sceneId || undefined} placeholder={!event.episodeId ? translate("script.selectAnEpisodeFirst") : selectedEpisode ? translate("script.linkedSceneOptional") : translate("script.loadThisEpisodeFirst")} options={sceneOptions} onChange={(sceneId) => updateEvent(event.id, { sceneId: sceneId || null })} /><div><Input aria-label={translate("script.eventTitle")} value={event.title} onChange={(input) => updateEvent(event.id, { title: input.target.value })} /><Input.TextArea aria-label={translate("script.eventDescription")} className="mt-2" rows={2} value={event.description} onChange={(input) => updateEvent(event.id, { description: input.target.value })} /></div><Button danger aria-label={translate("script.deleteEvent")} icon={<Trash2 className="size-4" />} onClick={() => updateOutline(sections, events.filter((item) => item.id !== event.id).map((item, sortOrder) => ({ ...item, sortOrder })))} /></div>;
    })}</div><p className="mt-2 text-xs text-[var(--studio-faint)]">{translate("script.openTheEpisodeInEpisodeScriptToLoadItsScene")}</p></div></section>;
}

/** 卡片列表的分页与勾选状态；页码越界自动回落，选中项自动剔除已不存在的条目。 */
function useCardPaging<T extends { id: string }>(items: T[]) {
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);
    const selectedSet = new Set(selectedIds);
    const selectedCount = items.filter((item) => selectedSet.has(item.id)).length;
    const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
    const currentPage = Math.min(page, pageCount);
    const pagedItems = items.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    const selectedOnPage = pagedItems.filter((item) => selectedSet.has(item.id)).length;
    return {
        pagedItems, selectedSet, selectedCount, currentPage, pageSize, selectedOnPage,
        selectedIds: items.filter((item) => selectedSet.has(item.id)).map((item) => item.id),
        toggle: (id: string) => setSelectedIds((ids) => ids.includes(id) ? ids.filter((current) => current !== id) : [...ids, id]),
        togglePage: () => setSelectedIds((ids) => selectedOnPage === pagedItems.length
            ? ids.filter((id) => !pagedItems.some((item) => item.id === id))
            : Array.from(new Set([...ids, ...pagedItems.map((item) => item.id)]))),
        changePage: (nextPage: number, nextPageSize: number) => { if (nextPageSize !== pageSize) { setPageSize(nextPageSize); setPage(1); } else setPage(nextPage); },
        clear: () => setSelectedIds([]),
    };
}

/** 与人物设定一致的卡片外壳：左上角勾选、整卡点击进入编辑。 */
function CardShell({ name, icon, selected, onSelect, onOpen, children }: {
    name: string;
    icon: React.ReactNode;
    selected: boolean;
    onSelect: () => void;
    onOpen: () => void;
    children: React.ReactNode;
}) {
    const translate = useTranslation();
    const label = name.trim() || translate("script.untitledEntry");
    return <article className={`group relative min-w-0 overflow-hidden rounded-lg border bg-[var(--studio-panel-solid)] transition-colors ${selected ? "border-[var(--studio-primary)]" : "border-[var(--studio-line)] hover:border-[var(--studio-primary-line)]"}`}>
        <div className="absolute left-2 top-2 z-10"><Checkbox aria-label={translate("script.selectCount", { value0: label })} checked={selected} onChange={onSelect} /></div>
        <button type="button" className="block w-full cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--studio-primary)]" aria-label={translate("script.viewAndEditCount", { value0: label })} onClick={onOpen}>
            <div className="flex h-28 items-center justify-center border-b border-[var(--studio-line)] bg-[var(--studio-primary-soft)] text-4xl font-semibold text-[var(--studio-primary)]" aria-hidden="true">{name.trim().charAt(0) || icon}</div>
            {children}
        </button>
    </article>;
}

/** 某一类世界规则条目的分页卡片列表。 */
function WorldItemPane({ typeLabel, items, onAdd, onOpen, onDelete }: {
    typeLabel: string;
    items: WorldItem[];
    onAdd: () => void;
    onOpen: (item: WorldItem) => void;
    onDelete: (ids: string[]) => void;
}) {
    const translate = useTranslation();
    const paging = useCardPaging(items);
    return <>
        <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
                {items.length ? <Checkbox checked={paging.selectedOnPage === paging.pagedItems.length} indeterminate={paging.selectedOnPage > 0 && paging.selectedOnPage < paging.pagedItems.length} onChange={paging.togglePage}>{translate("script.selectThisPage")}</Checkbox> : null}
                <Popconfirm title={translate("script.deleteCountSelectedEntries", { value0: paging.selectedCount })} okText={translate("script.delete")} cancelText={translate("script.cancel")} okButtonProps={{ danger: true }} disabled={!paging.selectedCount} onConfirm={() => { onDelete(paging.selectedIds); paging.clear(); }}>
                    <Button danger disabled={!paging.selectedCount} icon={<Trash2 className="size-4" />}>{paging.selectedCount ? translate("script.deleteCount", { value0: paging.selectedCount }) : translate("script.delete")}</Button>
                </Popconfirm>
            </div>
            <Button icon={<Plus className="size-4" />} onClick={onAdd}>{translate("script.addEntry")}</Button>
        </div>
        {items.length ? <>
            <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-3 sm:gap-4">
                {paging.pagedItems.map((item) => <CardShell key={item.id} name={item.name} icon={<BookOpen className="size-9" />} selected={paging.selectedSet.has(item.id)} onSelect={() => paging.toggle(item.id)} onOpen={() => onOpen(item)}>
                    <div className="space-y-2 p-4"><div className="flex items-center gap-2"><strong className="truncate text-base text-[var(--studio-ink)]">{item.name || translate("script.untitledEntry")}</strong><span className="shrink-0 rounded bg-[var(--studio-surface-soft)] px-2 py-0.5 text-xs text-[var(--studio-muted)]">{typeLabel}</span></div>
                        <p className="line-clamp-3 min-h-[3.75rem] text-sm leading-5 text-[var(--studio-text)]">{item.description || translate("script.noDescriptionYetOpenThisCardToAddOne")}</p>
                    </div>
                </CardShell>)}
            </div>
            <div className="mt-4 flex justify-end"><Pagination size="small" current={paging.currentPage} pageSize={paging.pageSize} pageSizeOptions={PAGE_SIZE_OPTIONS} total={items.length} showSizeChanger onChange={paging.changePage} /></div>
        </> : <Empty className="py-12" description={translate("script.noCountEntriesYetAddOneUsingTheButtonAbove", { value0: typeLabel })} />}
    </>;
}

/** 世界规则：按条目类型分子 Tab 展示分页卡片。 */
function WorldRulesTab({ items, onSave, onDelete }: { items: WorldItem[]; onSave: (item: WorldItem, isNew: boolean) => void; onDelete: (ids: string[]) => void }) {
    const translate = useTranslation();
    const [draft, setDraft] = useState<{ item: WorldItem; isNew: boolean } | null>(null);
    const updateDraft = (patch: Partial<WorldItem>) => setDraft((current) => current ? { ...current, item: { ...current.item, ...patch } } : current);
    const saveDraft = () => {
        if (!draft) return;
        onSave({ ...draft.item, name: draft.item.name.trim() || translate("script.untitledEntry") }, draft.isNew);
        setDraft(null);
    };
    return <>
        <Tabs size="small" items={getWorldItemTypes(translate).map(([itemType, typeLabel]) => ({
            key: itemType,
            label: `${typeLabel} (${items.filter((item) => item.itemType === itemType).length})`,
            children: <WorldItemPane typeLabel={typeLabel} items={items.filter((item) => item.itemType === itemType)} onDelete={onDelete}
                onAdd={() => setDraft({ isNew: true, item: { id: nanoid(), itemType, name: translate("script.newCount", { value0: typeLabel }), description: "", sortOrder: items.length } })}
                onOpen={(item) => setDraft({ isNew: false, item: { ...item } })} />,
        }))} />
        <Modal title={draft?.isNew ? translate("script.addWorldRule") : translate("script.editEntryCount", { value0: draft?.item.name || translate("script.untitledEntry") })} open={Boolean(draft)} width={640} onCancel={() => setDraft(null)} destroyOnHidden
            footer={<><Button onClick={() => setDraft(null)}>{translate("script.cancel")}</Button><Button type="primary" onClick={saveDraft}>{translate("script.save")}</Button></>}>
            {draft ? <div className="space-y-4">
                <Field label={translate("script.entryType")} required><Select className="w-full" value={draft.item.itemType} options={getWorldItemTypes(translate).map(([value, label]) => ({ value, label }))} onChange={(itemType) => updateDraft({ itemType })} /></Field>
                <Field label={translate("script.name")} required><Input maxLength={160} value={draft.item.name} onChange={(event) => updateDraft({ name: event.target.value })} /></Field>
                <Field label={translate("script.description")}><Input.TextArea rows={5} value={draft.item.description} onChange={(event) => updateDraft({ description: event.target.value })} /></Field>
            </div> : null}
        </Modal>
    </>;
}

/** 场景地点：分页卡片展示。 */
function WorldLocationsTab({ items, onSave, onDelete }: { items: ScriptLocation[]; onSave: (item: ScriptLocation, isNew: boolean) => void; onDelete: (ids: string[]) => void }) {
    const translate = useTranslation();
    const [draft, setDraft] = useState<{ item: ScriptLocation; isNew: boolean } | null>(null);
    const updateDraft = (patch: Partial<ScriptLocation>) => setDraft((current) => current ? { ...current, item: { ...current.item, ...patch } } : current);
    const paging = useCardPaging(items);
    return <>
        <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
                {items.length ? <Checkbox checked={paging.selectedOnPage === paging.pagedItems.length} indeterminate={paging.selectedOnPage > 0 && paging.selectedOnPage < paging.pagedItems.length} onChange={paging.togglePage}>{translate("script.selectThisPage")}</Checkbox> : null}
                <Popconfirm title={translate("script.deleteCountSelectedLocations", { value0: paging.selectedCount })} description={translate("script.scenesReferencingADeletedLocationWillHaveTheirLocationCleared")} okText={translate("script.delete")} cancelText={translate("script.cancel")} okButtonProps={{ danger: true }} disabled={!paging.selectedCount} onConfirm={() => { onDelete(paging.selectedIds); paging.clear(); }}>
                    <Button danger disabled={!paging.selectedCount} icon={<Trash2 className="size-4" />}>{paging.selectedCount ? translate("script.deleteCount", { value0: paging.selectedCount }) : translate("script.delete")}</Button>
                </Popconfirm>
            </div>
            <Button icon={<Plus className="size-4" />} onClick={() => setDraft({ isNew: true, item: { id: nanoid(), name: translate("script.newLocation"), spacePurpose: "", narrativeRole: "", defaultTime: "", weather: "", atmosphere: "", keyObjects: "", mainEvents: "", sortOrder: items.length } })}>{translate("script.addLocation")}</Button>
        </div>
        {items.length ? <>
            <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-3 sm:gap-4">
                {paging.pagedItems.map((location) => <CardShell key={location.id} name={location.name} icon={<MapPin className="size-9" />} selected={paging.selectedSet.has(location.id)} onSelect={() => paging.toggle(location.id)} onOpen={() => setDraft({ isNew: false, item: { ...location } })}>
                    <div className="space-y-2 p-4"><div className="flex items-center gap-2"><strong className="truncate text-base text-[var(--studio-ink)]">{location.name || translate("script.unnamedLocation")}</strong>{location.defaultTime ? <span className="shrink-0 rounded bg-[var(--studio-surface-soft)] px-2 py-0.5 text-xs text-[var(--studio-muted)]">{location.defaultTime}</span> : null}</div>
                        <p className="truncate text-xs text-[var(--studio-muted)]">{[location.weather, location.narrativeRole].filter(Boolean).join(" · ") || translate("script.noNarrativeRoleYet")}</p>
                        <p className="line-clamp-3 min-h-[3.75rem] text-sm leading-5 text-[var(--studio-text)]">{location.atmosphere || location.spacePurpose || translate("script.noAtmosphereDefinedOpenThisCardToAddOne")}</p>
                    </div>
                </CardShell>)}
            </div>
            <div className="mt-4 flex justify-end"><Pagination size="small" current={paging.currentPage} pageSize={paging.pageSize} pageSizeOptions={PAGE_SIZE_OPTIONS} total={items.length} showSizeChanger onChange={paging.changePage} /></div>
        </> : <Empty className="py-12" description={translate("script.noLocationsYetAddOneUsingTheButtonAbove")} />}
        <Modal title={draft?.isNew ? translate("script.addLocation") : translate("script.editLocationCount", { value0: draft?.item.name || translate("script.unnamedLocation") })} open={Boolean(draft)} width={720} onCancel={() => setDraft(null)} destroyOnHidden
            footer={<><Button onClick={() => setDraft(null)}>{translate("script.cancel")}</Button><Button type="primary" onClick={() => { if (draft) { onSave({ ...draft.item, name: draft.item.name.trim() || translate("script.unnamedLocation") }, draft.isNew); setDraft(null); } }}>{translate("script.save")}</Button></>}>
            {draft ? <div className="max-h-[min(68vh,700px)] overflow-y-auto pr-1"><div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2"><Field label={translate("script.locationName")} required><Input maxLength={160} value={draft.item.name} onChange={(event) => updateDraft({ name: event.target.value })} /></Field></div>
                {getLocationFields(translate).map(([key, label, rows]) => <div key={key} className={rows ? "sm:col-span-2" : ""}>
                    <Field label={label}>{rows ? <Input.TextArea rows={rows} value={draft.item[key]} onChange={(event) => updateDraft({ [key]: event.target.value })} /> : <Input maxLength={120} value={draft.item[key]} onChange={(event) => updateDraft({ [key]: event.target.value })} />}</Field>
                </div>)}
            </div></div> : null}
        </Modal>
    </>;
}

function WorldEditor() {
    const translate = useTranslation();
    const project = useScriptStore((state) => state.project);
    const updateWorld = useScriptStore((state) => state.updateWorld);
    if (!project) return null;
    const setting = project.worldSetting;
    const items = project.worldItems;
    const locations = project.locations;
    const saveSetting = (patch: Partial<typeof setting>) => updateWorld({ ...setting, ...patch }, items, locations);
    const saveItem = (item: WorldItem, isNew: boolean) => updateWorld(setting,
        isNew ? [...items, item] : items.map((current) => current.id === item.id ? item : current), locations);
    const saveLocation = (location: ScriptLocation, isNew: boolean) => updateWorld(setting, items,
        isNew ? [...locations, location] : locations.map((current) => current.id === location.id ? location : current));
    const removeItems = (ids: string[]) => updateWorld(setting,
        items.filter((item) => !ids.includes(item.id)).map((item, sortOrder) => ({ ...item, sortOrder })), locations);
    const removeLocations = (ids: string[]) => updateWorld(setting, items,
        locations.filter((location) => !ids.includes(location.id)).map((location, sortOrder) => ({ ...location, sortOrder })));
    return <section>
        <SectionHeader title={translate("script.worldAndLocations")} description={translate("script.recordStoryRulesBackgroundAndRecurringLocations")} />
        <div className="grid gap-4 md:grid-cols-2">
            <Field label={translate("script.era")}><Input maxLength={160} value={setting.era} onChange={(event) => saveSetting({ era: event.target.value })} /></Field>
            <Field label={translate("script.region")}><Input maxLength={240} value={setting.region} onChange={(event) => saveSetting({ region: event.target.value })} /></Field>
            <Field label={translate("script.socialBackground")}><Input.TextArea rows={4} value={setting.socialBackground} onChange={(event) => saveSetting({ socialBackground: event.target.value })} /></Field>
            <Field label={translate("script.overallTone")}><Input.TextArea rows={4} value={setting.overallTone} onChange={(event) => saveSetting({ overallTone: event.target.value })} /></Field>
        </div>
        <Tabs className="mt-6" items={[
            { key: "rules", label: translate("script.worldRules"), children: <WorldRulesTab items={items} onSave={saveItem} onDelete={removeItems} /> },
            { key: "locations", label: translate("script.sceneLocations"), children: <WorldLocationsTab items={locations} onSave={saveLocation} onDelete={removeLocations} /> },
        ]} />
    </section>;
}

export function EpisodeDetailEditor({ detail, sceneId, onChange, onDelete, onSelectScene }: { detail: EpisodeDetail; sceneId?: string; onChange: (detail: EpisodeDetail) => void; onDelete: () => void; onSelectScene: (sceneId: string) => void }) {
    const translate = useTranslation();
    const project = useScriptStore((state) => state.project)!;
    const setAiTarget = useScriptStore((state) => state.setAiTarget);
    const updateSummary = (patch: Partial<EpisodeDetail["episode"]>) => onChange({ ...detail, episode: { ...detail.episode, ...patch } });
    const updateScene = (sceneId: string, updater: (scene: ScriptScene) => ScriptScene) => onChange({ ...detail, scenes: detail.scenes.map((scene) => scene.id === sceneId ? updater(scene) : scene) });
    const moveScene = (index: number, direction: -1 | 1) => { const scenes = [...detail.scenes]; const target = index + direction; if (target < 0 || target >= scenes.length) return; [scenes[index], scenes[target]] = [scenes[target], scenes[index]]; onChange({ ...detail, scenes: scenes.map((scene, sortOrder) => ({ ...scene, sortOrder, sceneNumber: sortOrder + 1 })) }); };
    const addScene = () => { const scene = createScriptScene(detail.scenes.length, translate); onChange({ ...detail, scenes: [...detail.scenes, scene] }); onSelectScene(scene.id); };
    const episodeFields = [
        ["summary", translate("script.episodeSummary")], ["keyEvents", translate("script.keyEvents")], ["mainConflict", translate("script.centralConflict")],
        ["climax", translate("script.climax")], ["endingHook", translate("script.cliffhanger")],
    ] as const;
    const sceneFields = [
        ["sceneGoal", translate("script.sceneGoal")], ["actionSummary", translate("script.actionSummary")], ["transitionDescription", translate("script.transitionNotes")],
        ["previousRelation", translate("script.relationToPreviousScene")], ["nextRelation", translate("script.relationToNextScene")],
    ] as const;
    return <div className="space-y-5">
        {!sceneId ? <div className="rounded-xl border border-[var(--studio-line)] p-4">
            <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1"><Field label={translate("script.episodeTitle")}><Input value={detail.episode.title} onChange={(event) => updateSummary({ title: event.target.value })} /></Field></div>
                <Field label={translate("script.completionStatus")}><Select value={detail.episode.completionStatus} options={[{ value: "planning", label: translate("script.planning") }, { value: "draft", label: translate("script.draft") }, { value: "complete", label: translate("script.completed") }]} onChange={(completionStatus) => updateSummary({ completionStatus })} /></Field>
                <Button icon={<Sparkles className="size-4" />} onClick={() => setAiTarget({ targetType: "episode", targetId: detail.episode.id, label: detail.episode.title })}>{translate("script.setAsAiTarget")}</Button>
                <Button danger icon={<Trash2 className="size-4" />} onClick={onDelete}>{translate("script.deleteEpisode")}</Button>
            </div>
            <div className="mt-3 max-w-52"><Field label={translate("script.targetDurationSeconds")}><InputNumber className="w-full" min={0} max={86400} value={detail.episode.targetDurationSeconds} onChange={(value) => updateSummary({ targetDurationSeconds: value ?? 0 })} /></Field></div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">{episodeFields.map(([key, label]) => <Field key={key} label={label}>
                <Input.TextArea rows={3} value={detail.episode[key]} onChange={(event) => updateSummary({ [key]: event.target.value })} />
            </Field>)}</div>
        </div> : null}
        <div className="flex justify-end"><Button icon={<Plus className="size-4" />} onClick={addScene}>{translate("script.addScene_4ad10c")}</Button></div>
        {detail.scenes.filter((scene) => scene.id === sceneId).map((scene) => { const sceneIndex = detail.scenes.findIndex((item) => item.id === scene.id); return <article key={scene.id} className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-4">
            <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-44 flex-1"><Field label={translate("script.sceneCountTitle", { value0: scene.sceneNumber })}><Input value={scene.title} onChange={(event) => updateScene(scene.id, (current) => ({ ...current, title: event.target.value }))} /></Field></div>
                <Field label={translate("script.location")}><Select allowClear className="min-w-32" value={scene.locationId || undefined} options={project.locations.map((location) => ({ value: location.id, label: location.name }))} onChange={(locationId) => updateScene(scene.id, (current) => ({ ...current, locationId: locationId || null }))} /></Field>
                <Field label={translate("script.interiorExterior")}><Select value={scene.interiorExterior} options={[{ value: "interior", label: translate("script.interior") }, { value: "exterior", label: translate("script.exterior") }, { value: "mixed", label: translate("script.mixed") }]} onChange={(interiorExterior) => updateScene(scene.id, (current) => ({ ...current, interiorExterior }))} /></Field>
                <Button aria-label={translate("script.improveSceneWithAi")} icon={<Sparkles className="size-4" />} onClick={() => setAiTarget({ targetType: "scene", targetId: scene.id, label: `${detail.episode.title} · ${scene.title}` })} />
                <Button aria-label={translate("script.moveSceneUp")} icon={<ArrowUp className="size-4" />} disabled={!sceneIndex} onClick={() => moveScene(sceneIndex, -1)} />
                <Button aria-label={translate("script.moveSceneDown")} icon={<ArrowDown className="size-4" />} disabled={sceneIndex === detail.scenes.length - 1} onClick={() => moveScene(sceneIndex, 1)} />
                <Button danger aria-label={translate("script.deleteScene")} icon={<Trash2 className="size-4" />} onClick={() => { onSelectScene(detail.scenes[sceneIndex + 1]?.id || detail.scenes[sceneIndex - 1]?.id || ""); onChange({ ...detail,
                    scenes: detail.scenes.filter((item) => item.id !== scene.id).map((item, sortOrder) => ({ ...item, sortOrder, sceneNumber: sortOrder + 1 })) }); }} />
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Field label={translate("script.time")}><Input value={scene.timeDescription} onChange={(event) => updateScene(scene.id, (current) => ({ ...current, timeDescription: event.target.value }))} /></Field>
                <Field label={translate("script.charactersPresent")}><Select mode="multiple" className="w-full" value={scene.characterIds} options={project.characters.map((character) => ({ value: character.id, label: character.name }))}
                    onChange={(characterIds) => updateScene(scene.id, (current) => ({ ...current, characterIds,
                        blocks: synchronizeDialogueCharacters(current.blocks, characterIds) }))} /></Field>
                {sceneFields.map(([key, label]) => <Field key={key} label={label}><Input.TextArea rows={2} value={scene[key]}
                    onChange={(event) => updateScene(scene.id, (current) => ({ ...current, [key]: event.target.value }))} /></Field>)}
            </div>
            <div className="mt-4 space-y-2">{scene.blocks.map((block, blockIndex) => <ScriptBlockEditor key={block.id} block={block}
                characters={project.characters.filter((character) => scene.characterIds.includes(character.id))}
                onChange={(next) => updateScene(scene.id, (current) => ({ ...current, blocks: replaceScriptBlock(current.blocks, next) }))}
                onAi={() => setAiTarget({ targetType: "block", targetId: block.id, label: translate("script.countTextBlockCount", { value0: scene.title, value1: blockIndex + 1 }) })}
                onMove={(direction) => updateScene(scene.id, (current) => ({ ...current,
                    blocks: moveScriptBlock(current.blocks, blockIndex, direction) }))}
                onDelete={() => updateScene(scene.id, (current) => ({ ...current,
                    blocks: removeScriptBlock(current.blocks, block.id) }))} first={!blockIndex} last={blockIndex === scene.blocks.length - 1} />)}</div>
            <div className="mt-3 flex flex-wrap gap-2">{(["action", "dialogue", "narration", "transition"] as ScriptBlock["blockType"][]).map((blockType) =>
                <Button key={blockType} size="small" disabled={blockType === "dialogue" && !scene.characterIds.length}
                    onClick={() => updateScene(scene.id, (current) => ({ ...current, blocks: [...current.blocks, { id: nanoid(), blockType,
                        characterId: blockType === "dialogue" ? current.characterIds[0] : null, content: "", sortOrder: current.blocks.length }] }))}>{translate("script.addCount_802ee9", { value0: ({ action: translate("script.action"), dialogue: translate("script.dialogue"), narration: translate("script.narration"), transition: translate("script.transition") })[blockType] })}</Button>)}</div>
        </article>; })}
    </div>;
}

function ScriptBlockEditor({ block, characters, onChange, onAi, onMove, onDelete, first, last }: { block: ScriptBlock; characters: ScriptCharacter[]; onChange: (block: ScriptBlock) => void; onAi: () => void; onMove: (direction: -1 | 1) => void; onDelete: () => void; first: boolean; last: boolean }) {
    const translate = useTranslation();
    const labels = { action: translate("script.action"), dialogue: translate("script.dialogue"), narration: translate("script.narration"), transition: translate("script.transition") };
    return <div className="grid gap-2 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-3 md:grid-cols-[120px_1fr_auto]"><div><Select className="w-full" value={block.blockType} options={Object.entries(labels).map(([value, label]) => ({ value, label }))} onChange={(blockType) => onChange({ ...block, blockType, characterId: blockType === "dialogue" ? block.characterId || characters[0]?.id || null : null })} />{block.blockType === "dialogue" ? <Select className="mt-2 w-full" value={block.characterId || undefined} placeholder={translate("script.character")} options={characters.map((character) => ({ value: character.id, label: character.name }))} onChange={(characterId) => onChange({ ...block, characterId })} /> : null}</div><Input.TextArea autoSize={{ minRows: 2, maxRows: 10 }} value={block.content} placeholder={translate("script.enterCountContent", { value0: labels[block.blockType] })} onChange={(event) => onChange({ ...block, content: event.target.value })} /><div className="flex gap-1 md:flex-col"><Button size="small" aria-label={translate("script.improveTextBlockWithAi")} icon={<Sparkles className="size-3.5" />} onClick={onAi} /><Button size="small" aria-label={translate("script.moveTextBlockUp")} icon={<ArrowUp className="size-3.5" />} disabled={first} onClick={() => onMove(-1)} /><Button size="small" aria-label={translate("script.moveTextBlockDown")} icon={<ArrowDown className="size-3.5" />} disabled={last} onClick={() => onMove(1)} /><Button size="small" danger aria-label={translate("script.deleteTextBlock")} icon={<Trash2 className="size-3.5" />} onClick={onDelete} /></div></div>;
}
