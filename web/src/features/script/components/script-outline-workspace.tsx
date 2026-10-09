"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "antd";
import { BookOpenText, Pencil, RotateCcw } from "lucide-react";

import { useScriptStore } from "../stores/use-script-store";
import { ScriptSectionEditor } from "./section-editors";
import styles from "./script-outline-workspace.module.css";

const saveStatusLabels = {
    idle: "暂无修改",
    dirty: "有未保存修改",
    saving: "保存中",
    saved: "已保存",
    error: "保存失败",
    conflict: "版本冲突",
} as const;

const sectionTypeLabels: Record<string, string> = {
    act: "幕结构",
    mainPlot: "主线",
    subplot: "支线",
    characterArc: "人物成长线",
};

const eventTypeLabels: Record<string, string> = {
    plot: "剧情",
    conflict: "冲突",
    suspense: "悬念",
    twist: "反转",
    climax: "高潮",
    ending: "结局",
};

/** 以阅读版式展示故事大纲，并保留原有结构化编辑入口。 */
export function ScriptOutlineWorkspace({ onOpenAiGeneration }: { onOpenAiGeneration: () => void }) {
    const project = useScriptStore((state) => state.project);
    const saveStatus = useScriptStore((state) => state.saveStatus);
    const retrySave = useScriptStore((state) => state.retrySave);
    const [editing, setEditing] = useState(false);
    const [activeSectionId, setActiveSectionId] = useState("");
    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const paperRef = useRef<HTMLElement>(null);
    const progressRef = useRef<HTMLDivElement>(null);

    const sections = [...(project?.outlineSections || [])].sort((first, second) => first.sortOrder - second.sortOrder);
    const events = [...(project?.storyEvents || [])].sort((first, second) => first.sortOrder - second.sortOrder);
    const unlinkedEvents = events.filter((event) => !sections.some((section) => section.id === event.outlineSectionId));
    const sectionIds = sections.map((section) => section.id).join("|");

    useEffect(() => {
        if (editing) return;
        const scrollArea = scrollAreaRef.current;
        if (!scrollArea) return;
        let frame = 0;
        const updateReadingPosition = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                const scrollableHeight = scrollArea.scrollHeight - scrollArea.clientHeight;
                const progress = scrollableHeight > 0 ? Math.min(1, scrollArea.scrollTop / scrollableHeight) : 0;
                if (progressRef.current) progressRef.current.style.transform = `scaleX(${progress})`;

                const chapterElements = scrollArea.querySelectorAll<HTMLElement>("[data-outline-section]");
                const readingLine = scrollArea.getBoundingClientRect().top + 112;
                let currentId = chapterElements[0]?.id || "";
                chapterElements.forEach((chapter) => {
                    if (chapter.getBoundingClientRect().top <= readingLine) currentId = chapter.id;
                });
                setActiveSectionId((current) => current === currentId ? current : currentId);
            });
        };
        scrollArea.addEventListener("scroll", updateReadingPosition, { passive: true });
        window.addEventListener("resize", updateReadingPosition);
        const resizeObserver = new ResizeObserver(updateReadingPosition);
        resizeObserver.observe(scrollArea);
        if (paperRef.current) resizeObserver.observe(paperRef.current);
        updateReadingPosition();
        return () => {
            cancelAnimationFrame(frame);
            scrollArea.removeEventListener("scroll", updateReadingPosition);
            window.removeEventListener("resize", updateReadingPosition);
            resizeObserver.disconnect();
        };
    }, [editing, sectionIds, unlinkedEvents.length, project?.revision]);

    if (!project) return null;

    const navigateToSection = (sectionId: string) => {
        const scrollArea = scrollAreaRef.current;
        const chapter = [...(scrollArea?.querySelectorAll<HTMLElement>("[data-outline-section]") || [])].find((item) => item.id === sectionId);
        if (!scrollArea || !chapter) return;
        scrollArea.scrollTo({ top: scrollArea.scrollTop + chapter.getBoundingClientRect().top - scrollArea.getBoundingClientRect().top - 26 });
    };

    return <section className={styles.workspace} aria-label="故事大纲">
        <header className={styles.toolbar}>
            <div className={styles.heading}>
                <BookOpenText className="size-4" aria-hidden="true" />
                <h2>故事大纲</h2>
                <span className={styles.saveStatus} role="status">{saveStatusLabels[saveStatus]}</span>
                {saveStatus === "error" ? <Button size="small" type="link" onClick={retrySave}>重试保存</Button> : null}
            </div>
            <div className={styles.actions}>
                <Button size="small" icon={<RotateCcw className="size-3.5" />} onClick={onOpenAiGeneration}>重新生成</Button>
                <Button size="small" icon={editing ? <BookOpenText className="size-3.5" /> : <Pencil className="size-3.5" />} onClick={() => setEditing((current) => !current)}>
                    {editing ? "返回阅读" : "编辑"}
                </Button>
            </div>
        </header>
        {!editing ? <div className={styles.progressTrack} aria-hidden="true"><div ref={progressRef} className={styles.progressBar} /></div> : null}

        {editing ? <div className={styles.editorScroll}><div className={styles.editorPanel}><ScriptSectionEditor section="outline" /></div></div> :
            <div ref={scrollAreaRef} className={styles.scrollArea}>
                <div className={styles.layout}>
                    <aside className={styles.toc} aria-label="大纲章节目录">
                        <div className={styles.tocLabel}>目 录</div>
                        <nav>
                            {sections.map((section, index) => {
                                const targetId = `outline-${section.id}`;
                                return <button key={section.id} type="button" className={`${styles.tocItem} ${activeSectionId === targetId ? styles.tocItemActive : ""}`} aria-current={activeSectionId === targetId ? "location" : undefined} onClick={() => navigateToSection(targetId)}>
                                    <span className={styles.tocNumber}>{String(index + 1).padStart(2, "0")}</span>
                                    <span className={styles.tocTitle}>{section.title || "未命名结构段"}</span>
                                </button>;
                            })}
                            {unlinkedEvents.length ? <button type="button" className={`${styles.tocItem} ${activeSectionId === "outline-unlinked" ? styles.tocItemActive : ""}`} aria-current={activeSectionId === "outline-unlinked" ? "location" : undefined} onClick={() => navigateToSection("outline-unlinked")}>
                                <span className={styles.tocNumber}>—</span><span className={styles.tocTitle}>未归类事件</span>
                            </button> : null}
                        </nav>
                    </aside>

                    <article ref={paperRef} className={styles.paper}>
                        <div className={styles.eyebrow}>STORY OUTLINE</div>
                        <h3 className={styles.storyTitle}>{project.overview.title || "未填写项目名称"}</h3>
                        {project.overview.logline?.trim() ? <p className={styles.logline}>{project.overview.logline}</p> : null}
                        <div className={styles.chips}>
                            {project.overview.genre?.trim() ? <span className={styles.chip}>{project.overview.genre}</span> : null}
                            {project.overview.targetEpisodeCount > 0 ? <span className={styles.chip}>目标 {project.overview.targetEpisodeCount} 集</span> : null}
                            <span className={styles.chip}>共 {sections.length} 个结构段</span>
                        </div>

                        {project.characters.length ? <section className={styles.roles} aria-label="故事人物">
                            {project.characters.map((character) => {
                                const metadata = [character.identity, character.age ? `${character.age} 岁` : "", character.occupation].filter(Boolean).join(" · ");
                                return <div key={character.id} className={styles.role}>
                                    <div className={styles.roleName}>{character.name || "未命名人物"}{character.roleType ? <span>{character.roleType}</span> : null}</div>
                                    {metadata ? <p className={styles.roleDescription}>{metadata}</p> : null}
                                    {character.goal ? <p className={styles.roleDescription}>目标：{character.goal}</p> : null}
                                </div>;
                            })}
                        </section> : null}

                        {!sections.length && !unlinkedEvents.length ? <div className={styles.emptyState}><p>故事大纲尚无内容</p><Button onClick={() => setEditing(true)}>开始编辑</Button></div> : null}

                        {sections.map((section, index) => {
                            const relatedEvents = events.filter((event) => event.outlineSectionId === section.id);
                            const relatedEpisodes = project.episodes.filter((episode) => relatedEvents.some((event) => event.episodeId === episode.id));
                            return <section key={section.id} id={`outline-${section.id}`} data-outline-section className={styles.chapter}>
                                <header className={styles.chapterHeader}>
                                    <span className={styles.chapterIndex}>第 {String(index + 1).padStart(2, "0")} 章</span>
                                    <h4 className={styles.chapterTitle}>{section.title || "未命名结构段"}</h4>
                                    {sectionTypeLabels[section.sectionType] ? <span className={styles.chapterType}>{sectionTypeLabels[section.sectionType]}</span> : null}
                                </header>
                                {relatedEpisodes.length ? <div className={styles.episodeLinks}>{relatedEpisodes.map((episode) => <span key={episode.id}>第 {episode.episodeNumber} 集</span>)}</div> : null}
                                {section.content?.trim() ? section.content.trim().split(/\n\s*\n/).map((paragraph, paragraphIndex) => <p key={paragraphIndex} className={styles.paragraph}>{paragraph}</p>) : <p className={styles.emptyChapter}>这一段尚未填写正文。</p>}
                                {relatedEvents.map((event) => <div key={event.id} className={styles.beat}>
                                    <span className={styles.beatType}>{eventTypeLabels[event.eventType] || event.eventType}</span>
                                    <div><strong>{event.title || "未命名事件"}</strong>{event.description ? <p>{event.description}</p> : null}</div>
                                </div>)}
                            </section>;
                        })}

                        {unlinkedEvents.length ? <section id="outline-unlinked" data-outline-section className={styles.chapter}>
                            <header className={styles.chapterHeader}><h4 className={styles.chapterTitle}>未归类事件</h4></header>
                            {unlinkedEvents.map((event) => {
                                const episode = project.episodes.find((item) => item.id === event.episodeId);
                                return <div key={event.id} className={styles.beat}>
                                    <span className={styles.beatType}>{eventTypeLabels[event.eventType] || event.eventType}</span>
                                    <div><strong>{event.title || "未命名事件"}</strong>{episode ? <span className={styles.eventEpisode}>第 {episode.episodeNumber} 集</span> : null}{event.description ? <p>{event.description}</p> : null}</div>
                                </div>;
                            })}
                        </section> : null}
                        {sections.length || unlinkedEvents.length ? <div className={styles.endMark}>大纲完</div> : null}
                    </article>
                </div>
            </div>}
    </section>;
}
