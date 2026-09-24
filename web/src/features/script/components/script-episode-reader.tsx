"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { App, Button, Empty, Spin, Tabs } from "antd";
import { ArrowLeft, ArrowRight, Bot } from "lucide-react";

import { useScriptStore } from "../stores/use-script-store";
import type { ScriptBlock, ScriptCharacter } from "../types";
import { EpisodeDetailEditor } from "./section-editors";
import styles from "./script-episode-reader.module.css";

const blockLabels: Record<ScriptBlock["blockType"], string> = { action: "动作", dialogue: "对白", narration: "旁白", transition: "转场" };
const statusLabels = { planning: "规划中", draft: "草稿", complete: "已完成" };

/** 按分集浏览封面与场次，并在当前页切换阅读和编辑。 */
export function ScriptEpisodeReader({ selectedEpisodeId, selectedSceneId, sceneEditRequestId, onSceneEditRequestHandled, onSelectEpisode, onSelectScene, onOpenAiGeneration }: { selectedEpisodeId: string; selectedSceneId: string; sceneEditRequestId: string; onSceneEditRequestHandled: () => void; onSelectEpisode: (episodeId: string) => void; onSelectScene: (sceneId: string, episodeId?: string) => void; onOpenAiGeneration: () => void }) {
    const { message, modal } = App.useApp();
    const project = useScriptStore((state) => state.project);
    const detail = useScriptStore((state) => selectedEpisodeId ? state.episodes[selectedEpisodeId] : undefined);
    const loadEpisode = useScriptStore((state) => state.loadEpisode);
    const updateEpisode = useScriptStore((state) => state.updateEpisode);
    const deleteEpisode = useScriptStore((state) => state.deleteEpisode);
    const [loadError, setLoadError] = useState("");
    const [mode, setMode] = useState<"read" | "edit">("read");
    const trackRef = useRef<HTMLDivElement>(null);
    const pageRefs = useRef<Array<HTMLElement | null>>([]);
    const scrollingRef = useRef(false);
    const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pageIndexRef = useRef(0);
    const scrolledEpisodeIdRef = useRef("");
    const selectionRef = useRef({ episodeId: selectedEpisodeId, sceneId: selectedSceneId });
    const currentEpisode = project?.episodes.find((episode) => episode.id === selectedEpisodeId);
    const currentEpisodeIndex = project?.episodes.findIndex((episode) => episode.id === selectedEpisodeId) ?? -1;
    const previousEpisode = currentEpisodeIndex > 0 ? project?.episodes[currentEpisodeIndex - 1] : undefined;
    const nextEpisode = currentEpisodeIndex >= 0 ? project?.episodes[currentEpisodeIndex + 1] : undefined;
    const scenes = detail?.scenes;
    const pageIndex = Math.max(0, (scenes?.findIndex((scene) => scene.id === selectedSceneId) ?? -1) + 1);
    const currentScene = pageIndex ? scenes?.[pageIndex - 1] : undefined;
    const totalPages = (scenes?.length || 0) + 1;
    pageIndexRef.current = pageIndex;
    selectionRef.current = { episodeId: selectedEpisodeId, sceneId: selectedSceneId };

    useEffect(() => {
        let active = true;
        setLoadError("");
        if (selectedEpisodeId && !detail) {
            void loadEpisode(selectedEpisodeId).catch((error: unknown) => {
                if (active) setLoadError(error instanceof Error ? error.message : "分集正文加载失败");
            });
        }
        return () => { active = false; };
    }, [detail, loadEpisode, selectedEpisodeId]);

    useEffect(() => {
        if (detail && selectedSceneId && !detail.scenes.some((scene) => scene.id === selectedSceneId)) onSelectScene("");
    }, [detail, onSelectScene, selectedSceneId]);

    useEffect(() => {
        if (sceneEditRequestId && sceneEditRequestId === selectedSceneId) {
            setMode("edit");
            onSceneEditRequestHandled();
        }
    }, [sceneEditRequestId, selectedSceneId, onSceneEditRequestHandled]);

    useLayoutEffect(() => {
        if (mode !== "read") return;
        const card = pageRefs.current[pageIndex];
        if (!card || !trackRef.current) return;
        scrollingRef.current = true;
        const track = trackRef.current;
        const target = card.offsetLeft - (track.clientWidth - card.clientWidth) / 2;
        const episodeChanged = scrolledEpisodeIdRef.current !== detail?.episode.id;
        scrolledEpisodeIdRef.current = detail?.episode.id || "";
        track.scrollTo({ left: target, behavior: episodeChanged || window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
        scrollTimerRef.current = setTimeout(() => { scrollingRef.current = false; }, 450);
        return () => { if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current); };
    }, [mode, pageIndex, detail?.episode.id]);

    useEffect(() => {
        const track = trackRef.current;
        if (mode !== "read" || !track || !scenes) return;
        const handleWheel = (event: WheelEvent) => {
            if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
            const body = event.target instanceof Element ? event.target.closest(`.${styles.body}`) : null;
            if (body && ((event.deltaY > 0 && body.scrollTop + body.clientHeight < body.scrollHeight - 2) || (event.deltaY < 0 && body.scrollTop > 2))) return;
            if (Math.abs(event.deltaY) < 6) return;
            event.preventDefault();
            if (wheelTimerRef.current) return;
            const next = Math.max(0, Math.min(pageIndexRef.current + (event.deltaY > 0 ? 1 : -1), scenes.length));
            onSelectScene(scenes[next - 1]?.id || "");
            wheelTimerRef.current = setTimeout(() => { wheelTimerRef.current = null; }, 520);
        };
        track.addEventListener("wheel", handleWheel, { passive: false });
        return () => { track.removeEventListener("wheel", handleWheel); if (wheelTimerRef.current) { clearTimeout(wheelTimerRef.current); wheelTimerRef.current = null; } };
    }, [mode, onSelectScene, scenes]);

    if (!project) return null;

    const selectPage = (index: number) => {
        const nextIndex = Math.max(0, Math.min(index, totalPages - 1));
        const scene = scenes?.[nextIndex - 1];
        onSelectScene(scene?.id || "");
        if (nextIndex === pageIndex && trackRef.current && pageRefs.current[nextIndex]) {
            const track = trackRef.current;
            const card = pageRefs.current[nextIndex];
            track.scrollTo({ left: card.offsetLeft - (track.clientWidth - card.clientWidth) / 2, behavior: "smooth" });
        }
    };

    const selectNextPage = () => {
        if (pageIndex < totalPages - 1) selectPage(pageIndex + 1);
        else if (nextEpisode) onSelectEpisode(nextEpisode.id);
    };

    const selectPreviousPage = async () => {
        if (pageIndex > 0) { selectPage(pageIndex - 1); return; }
        if (!previousEpisode) return;
        try {
            const previousDetail = await loadEpisode(previousEpisode.id);
            if (selectionRef.current.episodeId !== selectedEpisodeId || selectionRef.current.sceneId !== selectedSceneId) return;
            onSelectScene(previousDetail.scenes.at(-1)?.id || "", previousEpisode.id);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "上一集加载失败，请重试");
        }
    };

    const confirmDelete = () => {
        if (!detail) return;
        modal.confirm({
            title: "删除当前分集？", content: "该分集中的场次和正文也会被删除。", okText: "删除", okButtonProps: { danger: true }, cancelText: "取消",
            onOk: async () => {
                try {
                    await deleteEpisode(detail.episode.id);
                    onSelectEpisode(project.episodes.find((episode) => episode.id !== detail.episode.id)?.id || "");
                    message.success("分集已删除");
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "分集删除失败，请重试");
                    throw error;
                }
            },
        });
    };

    const onScroll = () => {
        if (scrollingRef.current || !trackRef.current || !detail) return;
        const bounds = trackRef.current.getBoundingClientRect();
        const center = bounds.left + bounds.width / 2;
        let nearest = 0;
        let distance = Infinity;
        pageRefs.current.slice(0, totalPages).forEach((card, index) => {
            if (!card) return;
            const rect = card.getBoundingClientRect();
            const nextDistance = Math.abs(rect.left + rect.width / 2 - center);
            if (nextDistance < distance) { nearest = index; distance = nextDistance; }
        });
        if (nearest !== pageIndex) selectPage(nearest);
    };

    const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
        if (event.target instanceof Element && event.target.closest("input, textarea, select, button, [contenteditable='true'], [role='tab']")) return;
        if (event.key === "ArrowRight" || event.key === "PageDown") { event.preventDefault(); selectNextPage(); }
        if (event.key === "ArrowLeft" || event.key === "PageUp") { event.preventDefault(); void selectPreviousPage(); }
        if (event.key === "Home") { event.preventDefault(); selectPage(0); }
        if (event.key === "End") { event.preventDefault(); selectPage(totalPages - 1); }
    };

    return <section className={styles.reader} onKeyDown={onKeyDown} tabIndex={-1} aria-label="分集剧本阅读器">
        <header className={styles.header}>
            <div className="min-w-0"><h2 className="truncate text-base font-semibold text-[var(--studio-ink)]">{detail ? `第 ${currentEpisode?.episodeNumber ?? detail.episode.episodeNumber} 集 · ${detail.episode.title}` : "分集剧本"}</h2><p className="mt-1 truncate text-xs text-[var(--studio-muted)]">{currentScene ? `第 ${currentScene.sceneNumber} 场 · ${currentScene.title}` : detail ? statusLabels[detail.episode.completionStatus] : "选择分集开始写作"}</p></div>
            <Button size="small" icon={<Bot className="size-4" />} onClick={onOpenAiGeneration}>AI生成</Button>
        </header>
        {!selectedEpisodeId ? <div className="flex min-h-0 flex-1 items-center justify-center"><Empty description="请从目录新增或选择分集" /></div>
            : loadError ? <div className="flex min-h-0 flex-1 items-center justify-center"><Empty description={loadError}><Button onClick={() => { setLoadError(""); void loadEpisode(selectedEpisodeId).catch((error: unknown) => setLoadError(error instanceof Error ? error.message : "分集正文加载失败")); }}>重新加载分集</Button></Empty></div>
                : !detail ? <div className="flex min-h-0 flex-1 items-center justify-center"><Spin /></div> : <>
                    <Tabs className={styles.tabs} activeKey={mode} onChange={(key) => setMode(key as "read" | "edit")} items={[{ key: "read", label: "阅读" }, { key: "edit", label: "编辑" }]} />
                    {mode === "read" ? <div className={styles.stage} tabIndex={0} aria-label="剧本卡片，使用左右方向键翻页">
                        <div ref={trackRef} className={styles.track} onScroll={onScroll}>
                            <article ref={(element) => { pageRefs.current[0] = element; }} className={`${styles.page} ${pageIndex === 0 ? styles.active : ""}`}>
                                <div className={`${styles.card} ${styles.cover}`}><span className={styles.eyebrow}>第 {currentEpisode?.episodeNumber ?? detail.episode.episodeNumber} 集</span><h3>{detail.episode.title || "未命名分集"}</h3><span className={styles.rule} /><p className={styles.synopsis}>{detail.episode.summary || "尚未填写分集梗概"}</p><div className={styles.tags}><span>{scenes?.length || 0} 场</span><span>{statusLabels[detail.episode.completionStatus]}</span>{detail.episode.targetDurationSeconds > 0 ? <span>目标时长 {Math.ceil(detail.episode.targetDurationSeconds / 60)} 分钟</span> : null}</div></div>
                                {pageIndex === 1 ? <button type="button" className={styles.previewTarget} aria-label="查看本集封面" onClick={() => selectPage(0)} /> : null}
                            </article>
                            {scenes?.map((scene, index) => <article key={scene.id} ref={(element) => { pageRefs.current[index + 1] = element; }} className={`${styles.page} ${pageIndex === index + 1 ? styles.active : ""}`}>
                                <div className={styles.card}><header className={styles.sceneHeader}><span className={styles.eyebrow}>第 {scene.sceneNumber} 场</span><h3>{scene.title || "未命名场次"}</h3><div className={styles.metadata}><span>{project.locations.find((location) => location.id === scene.locationId)?.name || "地点未设置"}</span><span>·</span><span>{scene.timeDescription || "时间未设置"}</span><span>·</span><span>{({ interior: "内景", exterior: "外景", mixed: "混合" })[scene.interiorExterior]}</span></div></header><div className={styles.body}>{scene.blocks.length ? scene.blocks.map((block) => <ScriptReadingBlock key={block.id} block={block} characters={project.characters} />) : <p className="text-sm text-[var(--studio-muted)]">本场尚无正文，切换到编辑开始写作。</p>}</div></div>
                                {Math.abs(pageIndex - index - 1) === 1 ? <button type="button" className={styles.previewTarget} aria-label={`查看第 ${scene.sceneNumber} 场`} onClick={() => selectPage(index + 1)} /> : null}
                            </article>)}
                        </div>
                        <button type="button" className={`${styles.sideArrow} ${styles.previous}`} aria-label="上一页" disabled={!pageIndex && !previousEpisode} onClick={() => void selectPreviousPage()}><ArrowLeft className="size-5" /></button>
                        <button type="button" className={`${styles.sideArrow} ${styles.next}`} aria-label="下一页" disabled={pageIndex === totalPages - 1 && !nextEpisode} onClick={selectNextPage}><ArrowRight className="size-5" /></button>
                    </div> : <div className={styles.editor}><EpisodeDetailEditor detail={currentEpisode ? { ...detail, episode: currentEpisode } : detail} sceneId={currentScene?.id} onChange={updateEpisode} onDelete={confirmDelete} onSelectScene={onSelectScene} /></div>}
                    <footer className={styles.footer}><Button aria-label="上一页" icon={<ArrowLeft className="size-4" />} disabled={!pageIndex && !previousEpisode} onClick={() => void selectPreviousPage()} /><input type="range" min={0} max={totalPages - 1} value={pageIndex} onChange={(event) => selectPage(Number(event.target.value))} aria-label="跳转到本集页码" className={styles.progress} /><span className="text-xs tabular-nums text-[var(--studio-muted)]">{pageIndex + 1} / {totalPages}</span><Button aria-label="下一页" icon={<ArrowRight className="size-4" />} disabled={pageIndex === totalPages - 1 && !nextEpisode} onClick={selectNextPage} /></footer>
                </>}
    </section>;
}

/** 根据正文块类型排版阅读内容。 */
function ScriptReadingBlock({ block, characters }: { block: ScriptBlock; characters: ScriptCharacter[] }) {
    const speaker = block.blockType === "dialogue" ? characters.find((character) => character.id === block.characterId)?.name || "未指定人物" : "";
    return <div className={`${styles.block} ${styles[block.blockType]}`}><span className={styles.blockLabel}>{speaker || blockLabels[block.blockType]}</span><p>{block.content || `尚未填写${blockLabels[block.blockType]}内容`}</p></div>;
}
