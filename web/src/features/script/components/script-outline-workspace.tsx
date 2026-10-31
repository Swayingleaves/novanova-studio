"use client";

import { translateMessage } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";

import { useEffect, useRef, useState } from "react";
import { Button } from "antd";
import { BookOpenText, Pencil, RotateCcw } from "lucide-react";

import { useScriptStore } from "../stores/use-script-store";
import { ScriptSectionEditor } from "./section-editors";
import styles from "./script-outline-workspace.module.css";

const getSaveStatusLabels = (translate = translateMessage) => ({
    idle: translate("script.noChanges"),
    dirty: translate("script.unsavedChanges"),
    saving: translate("script.saving"),
    saved: translate("script.saved"),
    error: translate("script.saveFailed"),
    conflict: translate("script.versionConflict"),
} as const);

const getSectionTypeLabels = (translate = translateMessage): Record<string, string> => ({
    act: translate("script.actStructure"),
    mainPlot: translate("script.mainPlot_342ed9"),
    subplot: translate("script.subplot"),
    characterArc: translate("script.characterArc_e1a811"),
});

const getEventTypeLabels = (translate = translateMessage): Record<string, string> => ({
    plot: translate("script.plot"),
    conflict: translate("script.conflict"),
    suspense: translate("script.suspense"),
    twist: translate("script.twist"),
    climax: translate("script.climax"),
    ending: translate("script.ending_2de9b9"),
});

/** 以阅读版式展示故事大纲，并保留原有结构化编辑入口。 */
export function ScriptOutlineWorkspace({ onOpenAiGeneration }: { onOpenAiGeneration: () => void }) {
    const translate = useTranslation();
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

    return <section className={styles.workspace} aria-label={translate("script.storyOutline")}>
        <header className={styles.toolbar}>
            <div className={styles.heading}>
                <BookOpenText className="size-4" aria-hidden="true" />
                <h2>{translate("script.storyOutline")}</h2>
                <span className={styles.saveStatus} role="status">{getSaveStatusLabels(translate)[saveStatus]}</span>
                {saveStatus === "error" ? <Button size="small" type="link" onClick={retrySave}>{translate("script.retrySave")}</Button> : null}
            </div>
            <div className={styles.actions}>
                {/* 宽屏下右侧常驻「AI剧本助手」，这个入口只在窄屏（面板隐藏时）保留 */}
                <Button className="xl:hidden" size="small" icon={<RotateCcw className="size-3.5" />} onClick={onOpenAiGeneration}>{translate("script.regenerate")}</Button>
                <Button size="small" icon={editing ? <BookOpenText className="size-3.5" /> : <Pencil className="size-3.5" />} onClick={() => setEditing((current) => !current)}>
                    {editing ? translate("script.backToReading") : translate("script.edit")}
                </Button>
            </div>
        </header>
        {!editing ? <div className={styles.progressTrack} aria-hidden="true"><div ref={progressRef} className={styles.progressBar} /></div> : null}

        {editing ? <div className={styles.editorScroll}><div className={styles.editorPanel}><ScriptSectionEditor section="outline" /></div></div> :
            <div ref={scrollAreaRef} className={styles.scrollArea}>
                <div className={styles.layout}>
                    <aside className={styles.toc} aria-label={translate("script.outlineContents")}>
                        <div className={styles.tocLabel}>{translate("script.contents")}</div>
                        <nav>
                            {sections.map((section, index) => {
                                const targetId = `outline-${section.id}`;
                                return <button key={section.id} type="button" className={`${styles.tocItem} ${activeSectionId === targetId ? styles.tocItemActive : ""}`} aria-current={activeSectionId === targetId ? "location" : undefined} onClick={() => navigateToSection(targetId)}>
                                    <span className={styles.tocNumber}>{String(index + 1).padStart(2, "0")}</span>
                                    <span className={styles.tocTitle}>{section.title || translate("script.untitledOutlineSection")}</span>
                                </button>;
                            })}
                            {unlinkedEvents.length ? <button type="button" className={`${styles.tocItem} ${activeSectionId === "outline-unlinked" ? styles.tocItemActive : ""}`} aria-current={activeSectionId === "outline-unlinked" ? "location" : undefined} onClick={() => navigateToSection("outline-unlinked")}>
                                <span className={styles.tocNumber}>—</span><span className={styles.tocTitle}>{translate("script.uncategorizedEvents")}</span>
                            </button> : null}
                        </nav>
                    </aside>

                    <article ref={paperRef} className={styles.paper}>
                        <div className={styles.eyebrow}>STORY OUTLINE</div>
                        <h3 className={styles.storyTitle}>{project.overview.title || translate("script.projectNameNotSet")}</h3>
                        {project.overview.logline?.trim() ? <p className={styles.logline}>{project.overview.logline}</p> : null}
                        <div className={styles.chips}>
                            {project.overview.genre?.trim() ? <span className={styles.chip}>{project.overview.genre}</span> : null}
                            {project.overview.targetEpisodeCount > 0 ? <span className={styles.chip}>{translate("script.targetCountEpisodes_0e9583", { value0: project.overview.targetEpisodeCount })}</span> : null}
                            <span className={styles.chip}>{translate("script.countOutlineSections_76c013", { value0: sections.length })}</span>
                        </div>

                        {project.characters.length ? <section className={styles.roles} aria-label={translate("script.storyCharacters")}>
                            {project.characters.map((character) => {
                                const metadata = [character.identity, character.age ? translate("script.countYearsOld", { value0: character.age }) : "", character.occupation].filter(Boolean).join(" · ");
                                return <div key={character.id} className={styles.role}>
                                    <div className={styles.roleName}>{character.name || translate("script.unnamedCharacter")}{character.roleType ? <span>{character.roleType}</span> : null}</div>
                                    {metadata ? <p className={styles.roleDescription}>{metadata}</p> : null}
                                    {character.goal ? <p className={styles.roleDescription}>{translate("script.goalCount_d0b084", { value0: character.goal })}</p> : null}
                                </div>;
                            })}
                        </section> : null}

                        {!sections.length && !unlinkedEvents.length ? <div className={styles.emptyState}><p>{translate("script.theStoryOutlineIsEmpty")}</p><Button onClick={() => setEditing(true)}>{translate("script.startEditing")}</Button></div> : null}

                        {sections.map((section, index) => {
                            const relatedEvents = events.filter((event) => event.outlineSectionId === section.id);
                            const relatedEpisodes = project.episodes.filter((episode) => relatedEvents.some((event) => event.episodeId === episode.id));
                            return <section key={section.id} id={`outline-${section.id}`} data-outline-section className={styles.chapter}>
                                <header className={styles.chapterHeader}>
                                    <span className={styles.chapterIndex}>{translate("script.chapterCount_ae0805", { value0: String(index + 1).padStart(2, "0") })}</span>
                                    <h4 className={styles.chapterTitle}>{section.title || translate("script.untitledOutlineSection")}</h4>
                                    {getSectionTypeLabels(translate)[section.sectionType] ? <span className={styles.chapterType}>{getSectionTypeLabels(translate)[section.sectionType]}</span> : null}
                                </header>
                                {relatedEpisodes.length ? <div className={styles.episodeLinks}>{relatedEpisodes.map((episode) => <span key={episode.id}>{translate("script.episodeCount_0399e1", { value0: episode.episodeNumber })}</span>)}</div> : null}
                                {section.content?.trim() ? section.content.trim().split(/\n\s*\n/).map((paragraph, paragraphIndex) => <p key={paragraphIndex} className={styles.paragraph}>{paragraph}</p>) : <p className={styles.emptyChapter}>{translate("script.thisSectionHasNoTextYet")}</p>}
                                {relatedEvents.map((event) => <div key={event.id} className={styles.beat}>
                                    <span className={styles.beatType}>{getEventTypeLabels(translate)[event.eventType] || event.eventType}</span>
                                    <div><strong>{event.title || translate("script.untitledEvent")}</strong>{event.description ? <p>{event.description}</p> : null}</div>
                                </div>)}
                            </section>;
                        })}

                        {unlinkedEvents.length ? <section id="outline-unlinked" data-outline-section className={styles.chapter}>
                            <header className={styles.chapterHeader}><h4 className={styles.chapterTitle}>{translate("script.uncategorizedEvents")}</h4></header>
                            {unlinkedEvents.map((event) => {
                                const episode = project.episodes.find((item) => item.id === event.episodeId);
                                return <div key={event.id} className={styles.beat}>
                                    <span className={styles.beatType}>{getEventTypeLabels(translate)[event.eventType] || event.eventType}</span>
                                    <div><strong>{event.title || translate("script.untitledEvent")}</strong>{episode ? <span className={styles.eventEpisode}>{translate("script.episodeCount_0399e1", { value0: episode.episodeNumber })}</span> : null}{event.description ? <p>{event.description}</p> : null}</div>
                                </div>;
                            })}
                        </section> : null}
                        {sections.length || unlinkedEvents.length ? <div className={styles.endMark}>{translate("script.endOfOutline")}</div> : null}
                    </article>
                </div>
            </div>}
    </section>;
}
