"use client";

import { nanoid } from "nanoid";
import { Button, Input, InputNumber, Popconfirm, Select } from "antd";
import { ArrowDown, ArrowUp, Plus, Sparkles, Trash2 } from "lucide-react";

import { createScriptScene, moveScriptBlock, removeScriptBlock, replaceScriptBlock, synchronizeDialogueCharacters } from "../lib/script-episode-editing";
import { useScriptStore } from "../stores/use-script-store";
import type { EpisodeDetail, ScriptBlock, ScriptCharacter, ScriptOverview, ScriptScene, ScriptWorkspaceSection } from "../types";
import { CharactersEditor } from "./characters-editor";
import { ScriptAnalysisVersions } from "./script-analysis-versions";

type ScriptSectionEditorProps = { section: Exclude<ScriptWorkspaceSection, "episodes"> };

const CONTENT_TYPE_OPTIONS = [
    { value: "comicDrama", label: "漫剧" },
    { value: "liveActionShort", label: "真人短剧" },
    { value: "animation", label: "动画" },
    { value: "advertisement", label: "广告 / 宣传片" },
    { value: "musicVideo", label: "音乐视频" },
    { value: "storyShort", label: "故事短片" },
] as const;

/** 渲染工作台当前剧本区块。 */
export function ScriptSectionEditor({ section }: ScriptSectionEditorProps) {
    if (section === "overview") return <OverviewEditor />;
    if (section === "outline") return <OutlineEditor />;
    if (section === "characters") return <CharactersEditor />;
    if (section === "world") return <WorldEditor />;
    return <ScriptAnalysisVersions mode={section} />;
}

function SectionHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
    return <header className="mb-5 flex items-start justify-between gap-4 border-b border-[var(--studio-line)] pb-4"><div><h2 className="text-xl font-semibold text-[var(--studio-ink)]">{title}</h2><p className="mt-1 text-sm text-[var(--studio-muted)]">{description}</p></div>{action}</header>;
}

function Field({ label, required = false, requirement, children }: {
    label: string;
    required?: boolean;
    requirement?: string;
    children: React.ReactNode;
}) {
    return <label className="flex min-w-0 flex-col gap-2 text-sm text-[var(--studio-text)]"><span className="flex flex-wrap items-center gap-1.5 font-medium"><span>{label}{required ? <><span aria-hidden="true" className="ml-1 text-[var(--studio-danger)]">*</span><span className="sr-only">（必填）</span></> : null}</span>{requirement ? <span className="text-xs font-normal text-[var(--studio-muted)]">{requirement}</span> : null}</span>{children}</label>;
}

function OverviewEditor() {
    const project = useScriptStore((state) => state.project);
    const updateOverview = useScriptStore((state) => state.updateOverview);
    if (!project) return null;
    const update = <K extends keyof ScriptOverview>(key: K, value: ScriptOverview[K]) => updateOverview({ ...project.overview, [key]: value });
    const textAreas: Array<[keyof ScriptOverview, string, number]> = [
        ["logline", "一句话创意", 2], ["synopsis", "故事梗概", 5],
        ["theme", "故事主题", 3], ["mainPlot", "主线剧情", 6],
        ["mainConflict", "主要冲突", 4], ["endingDirection", "结局方向", 4], ["narrativeStyle", "叙事风格", 3],
    ];
    return <section><SectionHeader title="故事概览" description="先把故事目标、主要冲突和最终方向写清楚。" /><p id="script-overview-story-requirement" className="mb-4 text-xs leading-5 text-[var(--studio-muted)]"><span aria-hidden="true" className="font-medium text-[var(--studio-danger)]">*</span> 为必填项；一句话创意与故事梗概至少填写一项，才能生成候选故事方向或故事大纲。</p><div className="grid gap-4 md:grid-cols-2"><Field label="项目名称" required><Input aria-required="true" value={project.overview.title} maxLength={120} onChange={(event) => update("title", event.target.value)} /></Field><Field label="内容形式" required><Select aria-required="true" value={project.overview.contentType} options={[...CONTENT_TYPE_OPTIONS]} onChange={(value) => update("contentType", value)} /></Field><Field label="题材"><Input value={project.overview.genre} maxLength={80} onChange={(event) => update("genre", event.target.value)} /></Field><Field label="目标集数"><InputNumber className="w-full" min={1} max={1000} value={project.overview.targetEpisodeCount} onChange={(value) => update("targetEpisodeCount", value || 1)} /></Field><Field label="目标总时长（秒）"><InputNumber className="w-full" min={0} value={project.overview.targetDurationSeconds} onChange={(value) => update("targetDurationSeconds", value || 0)} /></Field>{textAreas.map(([key, label, rows]) => { const isStoryPrerequisite = key === "logline" || key === "synopsis"; return <div key={key} className={key === "logline" ? "" : "md:col-span-2"}><Field label={label} requirement={isStoryPrerequisite ? "（至少填一项）" : undefined}><Input.TextArea aria-describedby={isStoryPrerequisite ? "script-overview-story-requirement" : undefined} value={String(project.overview[key] || "")} rows={rows} onChange={(event) => update(key, event.target.value as never)} /></Field></div>; })}</div></section>;
}

function OutlineEditor() {
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
    const episodeOptions = project.episodes.map((episode) => ({ value: episode.id, label: `第 ${episode.episodeNumber} 集 · ${episode.title}` }));
    const eventTypes = [
        ["plot", "剧情"], ["conflict", "冲突"], ["suspense", "悬念"],
        ["twist", "反转"], ["climax", "高潮"], ["ending", "结局"],
    ];
    return <section><SectionHeader title="故事大纲" description="按幕、主线、支线或人物成长线组织剧情骨架。" action={<Button icon={<Plus className="size-4" />} onClick={() => updateOutline([...sections, { id: nanoid(), sectionType: "act", title: `结构段 ${sections.length + 1}`, content: "", sortOrder: sections.length }], events)}>添加结构段</Button>} /><div className="space-y-4">{sections.map((item, index) => <article key={item.id} className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4"><div className="flex flex-wrap gap-2"><Input className="min-w-48 flex-1" value={item.title} onChange={(event) => replaceSection(item.id, { title: event.target.value })} /><Select value={item.sectionType} className="w-36" onChange={(sectionType) => replaceSection(item.id, { sectionType })} options={[{ value: "act", label: "幕结构" }, { value: "mainPlot", label: "主线" }, { value: "subplot", label: "支线" }, { value: "characterArc", label: "人物成长线" }]} /><Button aria-label="上移" icon={<ArrowUp className="size-4" />} disabled={!index} onClick={() => moveSection(index, -1)} /><Button aria-label="下移" icon={<ArrowDown className="size-4" />} disabled={index === sections.length - 1} onClick={() => moveSection(index, 1)} /><Popconfirm title="删除这个结构段？" onConfirm={() => removeSection(item.id)}><Button danger aria-label="删除" icon={<Trash2 className="size-4" />} /></Popconfirm></div><Input.TextArea className="mt-3" rows={6} value={item.content} onChange={(event) => replaceSection(item.id, { content: event.target.value })} placeholder="写下这一段的剧情推进、人物选择和关键结果" /></article>)}</div><div className="mt-8"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold text-[var(--studio-ink)]">关键事件</h3><Button size="small" icon={<Plus className="size-4" />} onClick={() => updateOutline(sections, [...events, { id: nanoid(), outlineSectionId: sections[0]?.id || null, episodeId: null, sceneId: null, eventType: "plot", title: "新事件", description: "", sortOrder: events.length }])}>添加事件</Button></div><div className="space-y-3">{events.map((event) => {
        const selectedEpisode = event.episodeId ? episodes[event.episodeId] : undefined;
        const sceneOptions = selectedEpisode?.scenes.map((scene) => ({ value: scene.id, label: `第 ${scene.sceneNumber} 场 · ${scene.title || "未命名场次"}` })) || [];
        return <div key={event.id} className="grid gap-2 rounded-lg border border-[var(--studio-line)] p-3 md:grid-cols-2 xl:grid-cols-[140px_180px_180px_180px_1fr_auto]"><Select aria-label="事件类型" value={event.eventType} onChange={(eventType) => updateEvent(event.id, { eventType })} options={eventTypes.map(([value, label]) => ({ value, label }))} /><Select aria-label="所属结构段" allowClear value={event.outlineSectionId || undefined} placeholder="所属结构段" options={sections.map((section) => ({ value: section.id, label: section.title }))} onChange={(outlineSectionId) => updateEvent(event.id, { outlineSectionId: outlineSectionId || null })} /><Select aria-label="关联分集" allowClear value={event.episodeId || undefined} placeholder="关联分集（可选）" options={episodeOptions} onChange={(episodeId) => updateEvent(event.id, { episodeId: episodeId || null, sceneId: null })} /><Select aria-label="关联场次" allowClear disabled={!event.episodeId || !selectedEpisode} value={event.sceneId || undefined} placeholder={!event.episodeId ? "先选择分集" : selectedEpisode ? "关联场次（可选）" : "请先加载该分集"} options={sceneOptions} onChange={(sceneId) => updateEvent(event.id, { sceneId: sceneId || null })} /><div><Input aria-label="事件标题" value={event.title} onChange={(input) => updateEvent(event.id, { title: input.target.value })} /><Input.TextArea aria-label="事件说明" className="mt-2" rows={2} value={event.description} onChange={(input) => updateEvent(event.id, { description: input.target.value })} /></div><Button danger aria-label="删除事件" icon={<Trash2 className="size-4" />} onClick={() => updateOutline(sections, events.filter((item) => item.id !== event.id).map((item, sortOrder) => ({ ...item, sortOrder })))} /></div>;
    })}</div><p className="mt-2 text-xs text-[var(--studio-faint)]">关联场次前请先在“分集剧本”中打开该分集，以加载场次列表。</p></div></section>;
}

function WorldEditor() {
    const project = useScriptStore((state) => state.project);
    const updateWorld = useScriptStore((state) => state.updateWorld);
    if (!project) return null;
    const setting = project.worldSetting;
    const items = project.worldItems;
    const locations = project.locations;
    const updateItem = (id: string, patch: Partial<(typeof items)[number]>) => updateWorld(setting,
        items.map((item) => item.id === id ? { ...item, ...patch } : item), locations);
    const updateLocation = (id: string, patch: Partial<(typeof locations)[number]>) => updateWorld(setting, items,
        locations.map((location) => location.id === id ? { ...location, ...patch } : location));
    const locationFields = [
        ["spacePurpose", "空间用途"], ["narrativeRole", "叙事作用"], ["defaultTime", "默认时间"],
        ["weather", "天气"], ["atmosphere", "空间氛围"], ["keyObjects", "关键物件"], ["mainEvents", "主要事件"],
    ] as const;
    const itemTypes = [
        ["rule", "规则"], ["organization", "组织"], ["faction", "势力"],
        ["hierarchy", "等级"], ["restriction", "限制"], ["history", "历史事件"],
    ] as const;
    return <section>
        <SectionHeader title="世界观与地点" description="记录故事规则、时代背景和反复出现的重要地点。" />
        <div className="grid gap-4 md:grid-cols-2">
            <Field label="时代"><Input value={setting.era} onChange={(event) => updateWorld({ ...setting, era: event.target.value }, items, locations)} /></Field>
            <Field label="地域"><Input value={setting.region} onChange={(event) => updateWorld({ ...setting, region: event.target.value }, items, locations)} /></Field>
            <Field label="社会背景"><Input.TextArea rows={4} value={setting.socialBackground} onChange={(event) => updateWorld({ ...setting, socialBackground: event.target.value }, items, locations)} /></Field>
            <Field label="整体基调"><Input.TextArea rows={4} value={setting.overallTone} onChange={(event) => updateWorld({ ...setting, overallTone: event.target.value }, items, locations)} /></Field>
        </div>
        <div className="mt-8 flex items-center justify-between"><h3 className="font-semibold text-[var(--studio-ink)]">世界规则</h3>
            <Button size="small" icon={<Plus className="size-4" />} onClick={() => updateWorld(setting,
                [...items, { id: nanoid(), itemType: "rule", name: "新规则", description: "", sortOrder: items.length }], locations)}>添加条目</Button>
        </div>
        <div className="mt-3 space-y-3">{items.map((item) => <article key={item.id} className="grid gap-3 rounded-lg border border-[var(--studio-line)] p-3 md:grid-cols-[150px_1fr_auto]">
            <Field label="条目类型"><Select value={item.itemType} options={itemTypes.map(([value, label]) => ({ value, label }))}
                onChange={(itemType) => updateItem(item.id, { itemType })} /></Field>
            <div className="space-y-3"><Field label="名称"><Input value={item.name} onChange={(event) => updateItem(item.id, { name: event.target.value })} /></Field>
                <Field label="说明"><Input.TextArea rows={2} value={item.description} onChange={(event) => updateItem(item.id, { description: event.target.value })} /></Field></div>
            <Button danger aria-label={`删除条目 ${item.name}`} icon={<Trash2 className="size-4" />} onClick={() => updateWorld(setting,
                items.filter((current) => current.id !== item.id).map((current, sortOrder) => ({ ...current, sortOrder })), locations)} />
        </article>)}</div>
        <div className="mt-8 flex items-center justify-between"><h3 className="font-semibold text-[var(--studio-ink)]">场景地点</h3>
            <Button size="small" icon={<Plus className="size-4" />} onClick={() => updateWorld(setting, items,
                [...locations, { id: nanoid(), name: "新地点", spacePurpose: "", narrativeRole: "", defaultTime: "", weather: "",
                    atmosphere: "", keyObjects: "", mainEvents: "", sortOrder: locations.length }])}>添加地点</Button>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">{locations.map((location) => <article key={location.id} className="rounded-lg border border-[var(--studio-line)] p-3">
            <div className="flex gap-2"><div className="min-w-0 flex-1"><Field label="地点名称"><Input value={location.name} onChange={(event) => updateLocation(location.id, { name: event.target.value })} /></Field></div>
                <Button danger aria-label={`删除地点 ${location.name}`} icon={<Trash2 className="size-4" />} onClick={() => updateWorld(setting, items,
                    locations.filter((item) => item.id !== location.id).map((item, sortOrder) => ({ ...item, sortOrder })))} /></div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">{locationFields.map(([key, label]) => <div key={key} className={key === "defaultTime" || key === "weather" ? "" : "sm:col-span-2"}>
                <Field label={label}>{key === "defaultTime" || key === "weather"
                    ? <Input value={location[key]} onChange={(event) => updateLocation(location.id, { [key]: event.target.value })} />
                    : <Input.TextArea rows={2} value={location[key]} onChange={(event) => updateLocation(location.id, { [key]: event.target.value })} />}</Field>
            </div>)}</div>
        </article>)}</div>
    </section>;
}

export function EpisodeDetailEditor({ detail, sceneId, onChange, onDelete, onSelectScene }: { detail: EpisodeDetail; sceneId?: string; onChange: (detail: EpisodeDetail) => void; onDelete: () => void; onSelectScene: (sceneId: string) => void }) {
    const project = useScriptStore((state) => state.project)!;
    const setAiTarget = useScriptStore((state) => state.setAiTarget);
    const updateSummary = (patch: Partial<EpisodeDetail["episode"]>) => onChange({ ...detail, episode: { ...detail.episode, ...patch } });
    const updateScene = (sceneId: string, updater: (scene: ScriptScene) => ScriptScene) => onChange({ ...detail, scenes: detail.scenes.map((scene) => scene.id === sceneId ? updater(scene) : scene) });
    const moveScene = (index: number, direction: -1 | 1) => { const scenes = [...detail.scenes]; const target = index + direction; if (target < 0 || target >= scenes.length) return; [scenes[index], scenes[target]] = [scenes[target], scenes[index]]; onChange({ ...detail, scenes: scenes.map((scene, sortOrder) => ({ ...scene, sortOrder, sceneNumber: sortOrder + 1 })) }); };
    const addScene = () => { const scene = createScriptScene(detail.scenes.length); onChange({ ...detail, scenes: [...detail.scenes, scene] }); onSelectScene(scene.id); };
    const episodeFields = [
        ["summary", "分集梗概"], ["keyEvents", "关键事件"], ["mainConflict", "主要冲突"],
        ["climax", "高潮"], ["endingHook", "结尾悬念"],
    ] as const;
    const sceneFields = [
        ["sceneGoal", "场次目标"], ["actionSummary", "动作概述"], ["transitionDescription", "转场说明"],
        ["previousRelation", "与前一场次的关系"], ["nextRelation", "与后一场次的关系"],
    ] as const;
    return <div className="space-y-5">
        {!sceneId ? <div className="rounded-xl border border-[var(--studio-line)] p-4">
            <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1"><Field label="分集标题"><Input value={detail.episode.title} onChange={(event) => updateSummary({ title: event.target.value })} /></Field></div>
                <Field label="完成状态"><Select value={detail.episode.completionStatus} options={[{ value: "planning", label: "规划中" }, { value: "draft", label: "草稿" }, { value: "complete", label: "已完成" }]} onChange={(completionStatus) => updateSummary({ completionStatus })} /></Field>
                <Button icon={<Sparkles className="size-4" />} onClick={() => setAiTarget({ targetType: "episode", targetId: detail.episode.id, label: detail.episode.title })}>设为AI目标</Button>
                <Button danger icon={<Trash2 className="size-4" />} onClick={onDelete}>删除分集</Button>
            </div>
            <div className="mt-3 max-w-52"><Field label="目标时长（秒）"><InputNumber className="w-full" min={0} max={86400} value={detail.episode.targetDurationSeconds} onChange={(value) => updateSummary({ targetDurationSeconds: value ?? 0 })} /></Field></div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">{episodeFields.map(([key, label]) => <Field key={key} label={label}>
                <Input.TextArea rows={3} value={detail.episode[key]} onChange={(event) => updateSummary({ [key]: event.target.value })} />
            </Field>)}</div>
        </div> : null}
        <div className="flex justify-end"><Button icon={<Plus className="size-4" />} onClick={addScene}>添加场次</Button></div>
        {detail.scenes.filter((scene) => scene.id === sceneId).map((scene) => { const sceneIndex = detail.scenes.findIndex((item) => item.id === scene.id); return <article key={scene.id} className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-4">
            <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-44 flex-1"><Field label={`第 ${scene.sceneNumber} 场标题`}><Input value={scene.title} onChange={(event) => updateScene(scene.id, (current) => ({ ...current, title: event.target.value }))} /></Field></div>
                <Field label="地点"><Select allowClear className="min-w-32" value={scene.locationId || undefined} options={project.locations.map((location) => ({ value: location.id, label: location.name }))} onChange={(locationId) => updateScene(scene.id, (current) => ({ ...current, locationId: locationId || null }))} /></Field>
                <Field label="内外景"><Select value={scene.interiorExterior} options={[{ value: "interior", label: "内景" }, { value: "exterior", label: "外景" }, { value: "mixed", label: "混合" }]} onChange={(interiorExterior) => updateScene(scene.id, (current) => ({ ...current, interiorExterior }))} /></Field>
                <Button aria-label="AI优化场次" icon={<Sparkles className="size-4" />} onClick={() => setAiTarget({ targetType: "scene", targetId: scene.id, label: `${detail.episode.title} · ${scene.title}` })} />
                <Button aria-label="上移场次" icon={<ArrowUp className="size-4" />} disabled={!sceneIndex} onClick={() => moveScene(sceneIndex, -1)} />
                <Button aria-label="下移场次" icon={<ArrowDown className="size-4" />} disabled={sceneIndex === detail.scenes.length - 1} onClick={() => moveScene(sceneIndex, 1)} />
                <Button danger aria-label="删除场次" icon={<Trash2 className="size-4" />} onClick={() => { onSelectScene(detail.scenes[sceneIndex + 1]?.id || detail.scenes[sceneIndex - 1]?.id || ""); onChange({ ...detail,
                    scenes: detail.scenes.filter((item) => item.id !== scene.id).map((item, sortOrder) => ({ ...item, sortOrder, sceneNumber: sortOrder + 1 })) }); }} />
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Field label="发生时间"><Input value={scene.timeDescription} onChange={(event) => updateScene(scene.id, (current) => ({ ...current, timeDescription: event.target.value }))} /></Field>
                <Field label="出场人物"><Select mode="multiple" className="w-full" value={scene.characterIds} options={project.characters.map((character) => ({ value: character.id, label: character.name }))}
                    onChange={(characterIds) => updateScene(scene.id, (current) => ({ ...current, characterIds,
                        blocks: synchronizeDialogueCharacters(current.blocks, characterIds) }))} /></Field>
                {sceneFields.map(([key, label]) => <Field key={key} label={label}><Input.TextArea rows={2} value={scene[key]}
                    onChange={(event) => updateScene(scene.id, (current) => ({ ...current, [key]: event.target.value }))} /></Field>)}
            </div>
            <div className="mt-4 space-y-2">{scene.blocks.map((block, blockIndex) => <ScriptBlockEditor key={block.id} block={block}
                characters={project.characters.filter((character) => scene.characterIds.includes(character.id))}
                onChange={(next) => updateScene(scene.id, (current) => ({ ...current, blocks: replaceScriptBlock(current.blocks, next) }))}
                onAi={() => setAiTarget({ targetType: "block", targetId: block.id, label: `${scene.title} · 正文块 ${blockIndex + 1}` })}
                onMove={(direction) => updateScene(scene.id, (current) => ({ ...current,
                    blocks: moveScriptBlock(current.blocks, blockIndex, direction) }))}
                onDelete={() => updateScene(scene.id, (current) => ({ ...current,
                    blocks: removeScriptBlock(current.blocks, block.id) }))} first={!blockIndex} last={blockIndex === scene.blocks.length - 1} />)}</div>
            <div className="mt-3 flex flex-wrap gap-2">{(["action", "dialogue", "narration", "transition"] as ScriptBlock["blockType"][]).map((blockType) =>
                <Button key={blockType} size="small" disabled={blockType === "dialogue" && !scene.characterIds.length}
                    onClick={() => updateScene(scene.id, (current) => ({ ...current, blocks: [...current.blocks, { id: nanoid(), blockType,
                        characterId: blockType === "dialogue" ? current.characterIds[0] : null, content: "", sortOrder: current.blocks.length }] }))}>
                    添加{({ action: "动作", dialogue: "对白", narration: "旁白", transition: "转场" })[blockType]}</Button>)}</div>
        </article>; })}
    </div>;
}

function ScriptBlockEditor({ block, characters, onChange, onAi, onMove, onDelete, first, last }: { block: ScriptBlock; characters: ScriptCharacter[]; onChange: (block: ScriptBlock) => void; onAi: () => void; onMove: (direction: -1 | 1) => void; onDelete: () => void; first: boolean; last: boolean }) {
    const labels = { action: "动作", dialogue: "对白", narration: "旁白", transition: "转场" };
    return <div className="grid gap-2 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-3 md:grid-cols-[120px_1fr_auto]"><div><Select className="w-full" value={block.blockType} options={Object.entries(labels).map(([value, label]) => ({ value, label }))} onChange={(blockType) => onChange({ ...block, blockType, characterId: blockType === "dialogue" ? block.characterId || characters[0]?.id || null : null })} />{block.blockType === "dialogue" ? <Select className="mt-2 w-full" value={block.characterId || undefined} placeholder="人物" options={characters.map((character) => ({ value: character.id, label: character.name }))} onChange={(characterId) => onChange({ ...block, characterId })} /> : null}</div><Input.TextArea autoSize={{ minRows: 2, maxRows: 10 }} value={block.content} placeholder={`输入${labels[block.blockType]}内容`} onChange={(event) => onChange({ ...block, content: event.target.value })} /><div className="flex gap-1 md:flex-col"><Button size="small" aria-label="AI优化正文块" icon={<Sparkles className="size-3.5" />} onClick={onAi} /><Button size="small" aria-label="上移正文块" icon={<ArrowUp className="size-3.5" />} disabled={first} onClick={() => onMove(-1)} /><Button size="small" aria-label="下移正文块" icon={<ArrowDown className="size-3.5" />} disabled={last} onClick={() => onMove(1)} /><Button size="small" danger aria-label="删除正文块" icon={<Trash2 className="size-3.5" />} onClick={onDelete} /></div></div>;
}
