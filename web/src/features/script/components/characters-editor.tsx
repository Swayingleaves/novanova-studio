"use client";

import { useState } from "react";
import { nanoid } from "nanoid";
import { App, Button, Checkbox, Empty, Input, Modal, Pagination, Popconfirm } from "antd";
import { Plus, Trash2, Users } from "lucide-react";

import { useScriptStore } from "../stores/use-script-store";
import type { ScriptCharacter } from "../types";

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];

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

/** 以人物卡片和详情草稿编辑正式剧本人物数据，支持分页与勾选批量删除。 */
export function CharactersEditor() {
    const { message } = App.useApp();
    const project = useScriptStore((state) => state.project);
    const updateCharacters = useScriptStore((state) => state.updateCharacters);
    const deleteCharactersFromProject = useScriptStore((state) => state.deleteCharacters);
    const [draft, setDraft] = useState<ScriptCharacter | null>(null);
    const [isNew, setIsNew] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    if (!project) return null;

    const characters = project.characters;
    const selectedSet = new Set(selectedIds);
    const selectedCount = characters.filter((character) => selectedSet.has(character.id)).length;
    const pageCount = Math.max(1, Math.ceil(characters.length / pageSize));
    const currentPage = Math.min(page, pageCount);
    const pagedCharacters = characters.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    const selectedOnPage = pagedCharacters.filter((character) => selectedSet.has(character.id)).length;
    const editCharacter = (character: ScriptCharacter) => {
        setDraft({ ...character });
        setIsNew(false);
    };
    const addCharacter = () => {
        setDraft({ id: nanoid(), name: "", identity: "", age: "", occupation: "", roleType: "", personality: "", valuesDescription: "", goal: "", desire: "", fear: "", motivation: "", appearanceDescription: "", habits: "", speechStyle: "", backgroundStory: "", characterArc: "", sortOrder: characters.length });
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
        // 新增的人物排在末尾，翻到最后一页让用户直接看到结果
        if (isNew) setPage(Math.ceil((latestProject.characters.length + 1) / pageSize));
        closeDetail();
    };
    const toggleCharacter = (characterId: string) => {
        setSelectedIds((ids) => ids.includes(characterId) ? ids.filter((id) => id !== characterId) : [...ids, characterId]);
    };
    const togglePage = () => {
        const pageIds = pagedCharacters.map((character) => character.id);
        setSelectedIds((ids) => selectedOnPage === pageIds.length
            ? ids.filter((id) => !pageIds.includes(id))
            : Array.from(new Set([...ids, ...pageIds])));
    };
    const deleteSelected = async () => {
        // 选中项可能来自其他分页或已被删除，只提交当前项目里仍存在的人物
        const ids = characters.filter((character) => selectedSet.has(character.id)).map((character) => character.id);
        setDeleting(true);
        try {
            await deleteCharactersFromProject(ids);
            if (draft && ids.includes(draft.id)) closeDetail();
            setSelectedIds([]);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除人物失败，请重试");
        } finally {
            setDeleting(false);
        }
    };

    return <section className="min-w-0">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-[var(--studio-line)] pb-4">
            <div><h2 className="text-xl font-semibold text-[var(--studio-ink)]">人物设定</h2><p className="mt-1 text-sm text-[var(--studio-muted)]">浏览与完善剧本中的人物设定。</p></div>
            <div className="flex flex-wrap items-center gap-3">
                {characters.length ? <Checkbox checked={selectedOnPage === pagedCharacters.length} indeterminate={selectedOnPage > 0 && selectedOnPage < pagedCharacters.length} onChange={togglePage}>本页全选</Checkbox> : null}
                <Popconfirm title={`删除选中的 ${selectedCount} 个人物？`} description="关联关系会一起删除；人物若被场次或对白引用，服务端会拒绝删除。" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} disabled={!selectedCount} onConfirm={() => void deleteSelected()}>
                    <Button danger disabled={!selectedCount || deleting} loading={deleting} icon={<Trash2 className="size-4" />}>{selectedCount ? `删除 (${selectedCount})` : "删除"}</Button>
                </Popconfirm>
                <Button type="primary" icon={<Plus className="size-4" />} onClick={addCharacter}>添加人物</Button>
            </div>
        </header>
        {characters.length ? <>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-3 sm:gap-4">
                {pagedCharacters.map((character) => <article key={character.id} className={`group relative min-w-0 overflow-hidden rounded-lg border bg-[var(--studio-panel-solid)] transition-colors ${selectedSet.has(character.id) ? "border-[var(--studio-primary)]" : "border-[var(--studio-line)] hover:border-[var(--studio-primary-line)]"}`}>
                    <div className="absolute left-2 top-2 z-10"><Checkbox aria-label={`选择人物 ${character.name || "未命名人物"}`} checked={selectedSet.has(character.id)} onChange={() => toggleCharacter(character.id)} /></div>
                    <button type="button" className="block w-full cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--studio-primary)]" aria-label={`查看并编辑人物 ${character.name || "未命名人物"}`} onClick={() => editCharacter(character)}>
                        <div className="flex h-28 items-center justify-center border-b border-[var(--studio-line)] bg-[var(--studio-primary-soft)] text-4xl font-semibold text-[var(--studio-primary)]" aria-hidden="true">{character.name.trim().charAt(0) || <Users className="size-9" />}</div>
                        <div className="space-y-2 p-4"><div className="flex items-center gap-2"><strong className="truncate text-base text-[var(--studio-ink)]">{character.name || "未命名人物"}</strong>{character.roleType ? <span className="truncate rounded bg-[var(--studio-surface-soft)] px-2 py-0.5 text-xs text-[var(--studio-muted)]">{character.roleType}</span> : null}</div>
                            <p className="truncate text-xs text-[var(--studio-muted)]">{[character.age, character.identity, character.occupation].filter(Boolean).join(" · ") || "尚未填写身份信息"}</p>
                            <p className="line-clamp-3 min-h-[3.75rem] text-sm leading-5 text-[var(--studio-text)]">{character.personality || "尚未填写性格设定，点击卡片补充。"}</p>
                        </div>
                    </button>
                </article>)}
            </div>
            <div className="mt-4 flex justify-end">
                <Pagination size="small" current={currentPage} pageSize={pageSize} pageSizeOptions={PAGE_SIZE_OPTIONS} total={characters.length} showSizeChanger onChange={(nextPage, nextPageSize) => { if (nextPageSize !== pageSize) { setPageSize(nextPageSize); setPage(1); } else setPage(nextPage); }} />
            </div>
        </> : <Empty description="还没有人物，点击右上角添加人物" className="py-12" />}
        <Modal title={isNew ? "添加人物" : `编辑人物 · ${draft?.name || "未命名人物"}`} open={Boolean(draft)} width={860} onCancel={closeDetail} destroyOnHidden footer={<><Button onClick={closeDetail}>取消</Button><Button type="primary" onClick={saveDetail}>保存</Button></>}>
            {draft ? <div className="max-h-[min(68vh,700px)] space-y-6 overflow-y-auto pr-1">
                <section><h3 className="mb-3 border-b border-[var(--studio-line)] pb-2 font-semibold text-[var(--studio-ink)]">基本信息</h3><div className="grid gap-3 sm:grid-cols-2">
                    {([ ["name", "人物姓名", 120], ["roleType", "角色定位", 80], ["age", "年龄", 40], ["identity", "身份", 4000], ["occupation", "职业", 120] ] as const).map(([key, label, maxLength]) => <label key={key} className="min-w-0 text-sm text-[var(--studio-text)]">{label}<Input className="mt-1" maxLength={maxLength} value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /></label>)}
                </div></section>
                {PROFILE_GROUPS.map((group) => <section key={group.title}><h3 className="mb-3 border-b border-[var(--studio-line)] pb-2 font-semibold text-[var(--studio-ink)]">{group.title}</h3><div className="grid gap-3 sm:grid-cols-2">{group.fields.map(({ key, label, maxLength }) => <label key={key} className="min-w-0 text-sm text-[var(--studio-text)]">{label}<Input.TextArea className="mt-1" rows={3} maxLength={maxLength} value={String(draft[key])} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /></label>)}</div></section>)}
            </div> : null}
        </Modal>
    </section>;
}
