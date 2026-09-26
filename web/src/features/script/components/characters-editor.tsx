"use client";

import { useState } from "react";
import { nanoid } from "nanoid";
import { App, Button, Empty, Input, InputNumber, Modal, Popconfirm, Select, Tabs } from "antd";
import { Plus, Trash2, Users } from "lucide-react";

import { useScriptStore } from "../stores/use-script-store";
import type { CharacterRelation, ScriptCharacter } from "../types";
import { CharacterRelationshipGraph } from "./character-relationship-graph";

const PROFILE_GROUPS: Array<{ title: string; fields: Array<{ key: keyof ScriptCharacter; label: string; maxLength: number }> }> = [
    { title: "性格与动机", fields: [
        { key: "personality", label: "性格", maxLength: 8000 }, { key: "valuesDescription", label: "价值观", maxLength: 8000 },
        { key: "goal", label: "外在目标", maxLength: 8000 }, { key: "desire", label: "内在欲望", maxLength: 8000 },
        { key: "fear", label: "恐惧", maxLength: 8000 }, { key: "motivation", label: "核心动机", maxLength: 8000 },
    ] },
    { title: "外貌与经历", fields: [
        { key: "appearanceDescription", label: "外貌文字描述", maxLength: 12000 }, { key: "habits", label: "习惯", maxLength: 8000 },
        { key: "speechStyle", label: "语言特点", maxLength: 8000 }, { key: "backgroundStory", label: "背景经历", maxLength: 16000 },
        { key: "characterArc", label: "人物弧光", maxLength: 16000 },
    ] },
];

/** 以人物卡片、详情草稿和关系图谱编辑正式剧本数据。 */
export function CharactersEditor() {
    const { message } = App.useApp();
    const project = useScriptStore((state) => state.project);
    const updateCharacters = useScriptStore((state) => state.updateCharacters);
    const deleteCharacterFromProject = useScriptStore((state) => state.deleteCharacter);
    const [draft, setDraft] = useState<ScriptCharacter | null>(null);
    const [isNew, setIsNew] = useState(false);
    const [deletingCharacterId, setDeletingCharacterId] = useState("");
    if (!project) return null;

    const characters = project.characters;
    const relations = project.characterRelations;
    const characterOptions = characters.map((character) => ({ value: character.id, label: character.name || "未命名人物" }));
    const editCharacter = (character: ScriptCharacter) => {
        setDraft({ ...character });
        setIsNew(false);
    };
    const addCharacter = () => {
        setDraft({ id: nanoid(), name: "", identity: "", age: "", occupation: "", roleType: "", personality: "", valuesDescription: "", goal: "", desire: "", fear: "", motivation: "", appearanceDescription: "", habits: "", speechStyle: "", backgroundStory: "", characterArc: "", graphPositionX: characters.length * 180, graphPositionY: characters.length % 2 * 120, sortOrder: characters.length });
        setIsNew(true);
    };
    const closeDetail = () => {
        setDraft(null);
        setIsNew(false);
    };
    const saveDetail = () => {
        if (!draft) return;
        const name = draft.name.trim();
        if (!name) {
            message.warning("请填写人物姓名");
            return;
        }
        const latestProject = useScriptStore.getState().project;
        if (!latestProject || latestProject.id !== project.id) {
            message.warning("当前剧本已切换，请重新打开人物详情");
            closeDetail();
            return;
        }
        if (!isNew && !latestProject.characters.some((character) => character.id === draft.id)) {
            message.warning("该人物已被删除，请重新打开人物列表");
            closeDetail();
            return;
        }
        const savedCharacter = { ...draft, name, sortOrder: isNew ? latestProject.characters.length : draft.sortOrder };
        updateCharacters(isNew ? [...latestProject.characters, savedCharacter] : latestProject.characters.map((character) => character.id === draft.id ? savedCharacter : character), latestProject.characterRelations);
        closeDetail();
    };
    const deleteCharacter = async (id: string) => {
        setDeletingCharacterId(id);
        try {
            await deleteCharacterFromProject(id);
            if (draft?.id === id) closeDetail();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除人物失败，请重试");
        } finally {
            setDeletingCharacterId("");
        }
    };
    const updateRelation = (id: string, patch: Partial<CharacterRelation>) => {
        const latestProject = useScriptStore.getState().project;
        if (!latestProject || latestProject.id !== project.id) return;
        const updatedRelations = latestProject.characterRelations.map((relation) => relation.id === id ? { ...relation, ...patch } : relation);
        const changedRelation = updatedRelations.find((relation) => relation.id === id);
        if (changedRelation && changedRelation.sourceCharacterId === changedRelation.targetCharacterId) {
            message.warning("人物关系不能指向同一人物");
            return;
        }
        updateCharacters(latestProject.characters, updatedRelations);
    };
    const addRelation = () => {
        const latestProject = useScriptStore.getState().project;
        if (!latestProject || latestProject.id !== project.id || latestProject.characters.length < 2) return;
        updateCharacters(latestProject.characters, [...latestProject.characterRelations, {
            id: nanoid(), sourceCharacterId: latestProject.characters[0].id, targetCharacterId: latestProject.characters[1].id,
            relationshipType: "关系", relationshipDirection: "bidirectional", storyStage: "", conflictDescription: "", description: "", sortOrder: latestProject.characterRelations.length,
        }]);
    };
    const deleteRelation = (id: string) => {
        const latestProject = useScriptStore.getState().project;
        if (!latestProject || latestProject.id !== project.id) return;
        updateCharacters(latestProject.characters, latestProject.characterRelations.filter((relation) => relation.id !== id).map((relation, sortOrder) => ({ ...relation, sortOrder })));
    };

    return <section className="min-w-0">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-[var(--studio-line)] pb-4">
            <div><h2 className="text-xl font-semibold text-[var(--studio-ink)]">人物与关系</h2><p className="mt-1 text-sm text-[var(--studio-muted)]">浏览人物设定，梳理故事中的人物关系。</p></div>
            <Button type="primary" icon={<Plus className="size-4" />} onClick={addCharacter}>添加人物</Button>
        </header>
        <Tabs items={[
            { key: "profiles", label: `人物列表（${characters.length}）`, children: characters.length ? <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-3 sm:gap-4">
                {characters.map((character) => <article key={character.id} className="group relative min-w-0 overflow-hidden rounded-lg border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] transition-colors hover:border-[var(--studio-primary-line)]">
                    <button type="button" className="block w-full cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--studio-primary)]" aria-label={`查看并编辑人物 ${character.name || "未命名人物"}`} onClick={() => editCharacter(character)}>
                        <div className="flex h-28 items-center justify-center border-b border-[var(--studio-line)] bg-[var(--studio-primary-soft)] text-4xl font-semibold text-[var(--studio-primary)]" aria-hidden="true">{character.name.trim().charAt(0) || <Users className="size-9" />}</div>
                        <div className="space-y-2 p-4"><div className="flex items-center gap-2"><strong className="truncate text-base text-[var(--studio-ink)]">{character.name || "未命名人物"}</strong>{character.roleType ? <span className="truncate rounded bg-[var(--studio-surface-soft)] px-2 py-0.5 text-xs text-[var(--studio-muted)]">{character.roleType}</span> : null}</div>
                            <p className="truncate text-xs text-[var(--studio-muted)]">{[character.age, character.identity, character.occupation].filter(Boolean).join(" · ") || "尚未填写身份信息"}</p>
                            <p className="line-clamp-3 min-h-[3.75rem] text-sm leading-5 text-[var(--studio-text)]">{character.personality || "尚未填写性格设定，点击卡片补充。"}</p>
                        </div>
                    </button>
                    <Popconfirm title={`删除人物「${character.name || "未命名人物"}」？`} description="关联关系会一起删除；人物若被场次或对白引用，服务端会拒绝删除。" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => void deleteCharacter(character.id)}>
                        <Button type="text" danger className="absolute right-1 top-1 !size-11" aria-label={`删除人物 ${character.name || "未命名人物"}`} loading={deletingCharacterId === character.id} disabled={Boolean(deletingCharacterId)} icon={<Trash2 className="size-4" />} />
                    </Popconfirm>
                </article>)}
            </div> : <Empty description="还没有人物，点击右上角添加人物" className="py-12" /> },
            { key: "relations", label: `关系图谱（${relations.length}）`, children: <div className="space-y-5">
                <CharacterRelationshipGraph />
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--studio-line)] pb-3"><div><h3 className="font-semibold text-[var(--studio-ink)]">关系设定</h3><p className="mt-1 text-xs text-[var(--studio-muted)]">拖动图中人物可调整布局，关系内容在下方编辑。</p></div><Button icon={<Plus className="size-4" />} disabled={characters.length < 2} onClick={addRelation}>添加关系</Button></div>
                {relations.length ? <div className="grid gap-3 lg:grid-cols-2">{relations.map((relation) => {
                    const sourceName = characters.find((character) => character.id === relation.sourceCharacterId)?.name || "未命名人物";
                    const targetName = characters.find((character) => character.id === relation.targetCharacterId)?.name || "未命名人物";
                    return <article key={relation.id} className="min-w-0 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-4">
                        <div className="mb-4 flex items-start justify-between gap-2"><div className="min-w-0"><h4 className="truncate font-medium text-[var(--studio-ink)]">{sourceName} {relation.relationshipDirection === "directed" ? "→" : "↔"} {targetName}</h4><p className="mt-1 text-xs text-[var(--studio-muted)]">{relation.relationshipType || "未命名关系"}</p></div><Popconfirm title="删除这条人物关系？" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => deleteRelation(relation.id)}><Button type="text" danger className="!size-11" aria-label={`删除人物关系 ${sourceName} 与 ${targetName}`} icon={<Trash2 className="size-4" />} /></Popconfirm></div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <label className="min-w-0 text-sm text-[var(--studio-text)]">起点人物<Select className="mt-1 w-full" value={relation.sourceCharacterId} options={characterOptions} onChange={(value) => updateRelation(relation.id, { sourceCharacterId: value })} /></label>
                            <label className="min-w-0 text-sm text-[var(--studio-text)]">终点人物<Select className="mt-1 w-full" value={relation.targetCharacterId} options={characterOptions} onChange={(value) => updateRelation(relation.id, { targetCharacterId: value })} /></label>
                            <label className="min-w-0 text-sm text-[var(--studio-text)]">关系类型<Input className="mt-1" maxLength={120} value={relation.relationshipType} onChange={(event) => updateRelation(relation.id, { relationshipType: event.target.value })} /></label>
                            <label className="min-w-0 text-sm text-[var(--studio-text)]">关系方向<Select className="mt-1 w-full" value={relation.relationshipDirection} options={[{ value: "bidirectional", label: "双向关系" }, { value: "directed", label: "单向关系" }]} onChange={(value) => updateRelation(relation.id, { relationshipDirection: value })} /></label>
                            <label className="min-w-0 text-sm text-[var(--studio-text)]">故事阶段<Input className="mt-1" maxLength={120} value={relation.storyStage} onChange={(event) => updateRelation(relation.id, { storyStage: event.target.value })} /></label>
                            <label className="min-w-0 text-sm text-[var(--studio-text)]">关系冲突<Input.TextArea className="mt-1" rows={2} maxLength={8000} value={relation.conflictDescription} onChange={(event) => updateRelation(relation.id, { conflictDescription: event.target.value })} /></label>
                            <label className="min-w-0 text-sm text-[var(--studio-text)] sm:col-span-2">关系说明<Input.TextArea className="mt-1" rows={2} maxLength={8000} value={relation.description} onChange={(event) => updateRelation(relation.id, { description: event.target.value })} /></label>
                        </div>
                    </article>;
                })}</div> : <Empty description={characters.length < 2 ? "至少添加两个人物后才能建立关系" : "还没有人物关系，点击添加关系"} className="py-8" />}
            </div> },
        ]} />
        <Modal title={isNew ? "添加人物" : `编辑人物 · ${draft?.name || "未命名人物"}`} open={Boolean(draft)} width={860} onCancel={closeDetail} destroyOnHidden footer={<><Button onClick={closeDetail}>取消</Button><Button type="primary" onClick={saveDetail}>保存</Button></>}>
            {draft ? <div className="max-h-[min(68vh,700px)] space-y-6 overflow-y-auto pr-1">
                <section><h3 className="mb-3 border-b border-[var(--studio-line)] pb-2 font-semibold text-[var(--studio-ink)]">基本信息</h3><div className="grid gap-3 sm:grid-cols-2">
                    {([ ["name", "人物姓名", 120], ["roleType", "角色定位", 80], ["age", "年龄", 40], ["identity", "身份", 4000], ["occupation", "职业", 120] ] as const).map(([key, label, maxLength]) => <label key={key} className="min-w-0 text-sm text-[var(--studio-text)]">{label}<Input className="mt-1" maxLength={maxLength} value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /></label>)}
                </div></section>
                {PROFILE_GROUPS.map((group) => <section key={group.title}><h3 className="mb-3 border-b border-[var(--studio-line)] pb-2 font-semibold text-[var(--studio-ink)]">{group.title}</h3><div className="grid gap-3 sm:grid-cols-2">{group.fields.map(({ key, label, maxLength }) => <label key={key} className="min-w-0 text-sm text-[var(--studio-text)]">{label}<Input.TextArea className="mt-1" rows={3} maxLength={maxLength} value={String(draft[key])} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /></label>)}</div></section>)}
                <section><h3 className="mb-3 border-b border-[var(--studio-line)] pb-2 font-semibold text-[var(--studio-ink)]">关系图位置</h3><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm text-[var(--studio-text)]">横坐标<InputNumber className="mt-1 w-full" value={draft.graphPositionX} onChange={(value) => setDraft({ ...draft, graphPositionX: value ?? 0 })} /></label><label className="text-sm text-[var(--studio-text)]">纵坐标<InputNumber className="mt-1 w-full" value={draft.graphPositionY} onChange={(value) => setDraft({ ...draft, graphPositionY: value ?? 0 })} /></label></div></section>
            </div> : null}
        </Modal>
    </section>;
}
