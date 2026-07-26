"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { ArrowUp, ArrowUpRight, Bot, BookOpenText, Clapperboard, ImageIcon, Images, Paperclip, Pause, Play, Search, SendToBack, SlidersHorizontal, Sparkles } from "lucide-react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";

import { useUserStore } from "@/features/auth/stores/use-user-store";
import { getHomepageTargetPath, homepageFallbackEditorialShowcaseId, homepageFallbackEditorialVideoUrls } from "@/features/homepage/api/homepage-showcases";
import { useHomepageShowcases } from "@/features/homepage/hooks/use-homepage-showcases";
import { FANTASTIC_SHOW_CATEGORIES, creatorMonogram, filterFantasticShowcases, getFantasticShowcases, type FantasticShowCategory } from "@/features/homepage/lib/fantastic-show";
import { usePromptOptimization } from "@/features/generation/hooks/use-prompt-optimization";
import type { HomepageShowcase } from "@/services/api/server";

const primaryEntries = [
    { href: "/image", label: "图片创作", description: "构图、风格、材质与批量方案探索", icon: ImageIcon },
    { href: "/video", label: "视频创作", description: "镜头语言、运动控制与概念成片", icon: Clapperboard },
    { href: "/canvas", label: "无限画布", description: "组合、比较并沉淀完整创作过程", icon: SendToBack },
] as const;

const promptSuggestions = ["一组具有工业未来感的黑银产品海报，冷白硬光，精密材质细节", "为独立音乐人设计一支低饱和电影感概念短片，克制构图与缓慢镜头", "建立一套前卫时装品牌视觉语言，并在无限画布中排列灵感、构图和成片"];
const studioInterfaceFont = { fontFamily: "var(--studio-interface-font)" } as const;
const studioWordmarkFont = { fontFamily: "var(--studio-wordmark-font)" } as const;
const studioWordmarkText = { ...studioWordmarkFont, fontWeight: 720 } as const;
const studioLockupFont = { ...studioInterfaceFont, fontWeight: 420 } as const;
const showcaseCardPositions = ["col-span-2 aspect-[4/3] lg:col-[1/8] lg:row-[1/10] lg:aspect-auto", "aspect-[4/5] lg:col-[8/13] lg:row-[2/7] lg:aspect-auto", "aspect-[4/5] lg:col-[8/13] lg:row-[7/13] lg:aspect-auto"];
const icpRecordNumber = process.env.NEXT_PUBLIC_ICP_RECORD_NUMBER?.trim();

export default function IndexPage() {
    const [prompt, setPrompt] = useState("");
    const user = useUserStore((state) => state.user);
    const openAuthModal = useUserStore((state) => state.openAuthModal);
    const showcases = useHomepageShowcases();
    const { optimizingOperationId, optimizePrompt } = usePromptOptimization();
    const isPromptOptimizing = optimizingOperationId === "homepage-image";

    const submitAgent = () => {
        const value = prompt.trim();
        if (!value) return;
        const target = `/image?initialPrompt=${encodeURIComponent(value)}`;
        if (!user) {
            openAuthModal(target);
            return;
        }
        window.location.assign(target);
    };

    return (
        <main className="studio-page h-full overflow-y-auto">
            <div className="mx-auto w-full max-w-[1580px] px-4 pb-10 md:px-8 lg:px-[34px]">
                <section className="grid min-h-[calc(100dvh-90px)] items-center gap-12 py-7 lg:grid-cols-[minmax(380px,0.9fr)_minmax(560px,1.1fr)] lg:gap-[clamp(44px,5vw,88px)] lg:py-[clamp(28px,3vw,48px)]">
                    <div className="min-w-0">
                        <div style={studioInterfaceFont} className="mb-6 flex items-center gap-2.5 text-[11px] font-semibold uppercase text-[var(--studio-action)]">
                            <span className="text-[var(--studio-faint)]">01</span>
                            AI Visual Creation Studio
                        </div>
                        <BrandMark />
                        <p className="mt-7 max-w-[520px] text-base leading-7 text-[var(--studio-text)] md:text-lg">
                            <strong className="font-semibold text-[var(--studio-ink)]">一句话，调度完整视觉工作流。</strong> 从构思、生成、比较到无限画布编排，让 Agent 把创意推进到成片。
                        </p>

                        <div className="mt-8 overflow-hidden rounded-[8px] border border-[var(--studio-line-strong)] bg-[var(--studio-surface)] shadow-[var(--studio-shadow)] transition duration-300 focus-within:-translate-y-0.5 focus-within:border-[var(--studio-action)] motion-reduce:transform-none">
                            <div className="flex items-center justify-between gap-4 border-b border-[var(--studio-line)] px-3.5 py-3 text-[11px] text-[var(--studio-muted)]">
                                <span style={studioInterfaceFont} className="flex items-center gap-2 font-semibold text-[var(--studio-action)]">
                                    <Bot className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
                                    Novanova Agent
                                </span>
                                <span>{prompt.length} / 2000</span>
                            </div>
                            <textarea
                                value={prompt}
                                maxLength={2000}
                                rows={4}
                                aria-label="描述你想要的图片视觉结果"
                                placeholder="描述你想要的视觉结果，例如：为未来城市展览设计一组冷感电影海报……"
                                onChange={(event) => setPrompt(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                                        event.preventDefault();
                                        submitAgent();
                                    }
                                }}
                                className="block min-h-28 w-full resize-none bg-transparent px-4 py-4 text-[15px] leading-6 text-[var(--studio-ink)] outline-none placeholder:text-[var(--studio-faint)]"
                            />
                            <div className="flex items-center justify-between gap-3 border-t border-[var(--studio-line)] p-2.5">
                                <div className="flex min-w-0 items-center gap-1">
                                    <Link
                                        href="/assets"
                                        className="inline-flex h-9 items-center gap-2 rounded-[6px] px-2 text-xs text-[var(--studio-muted)] transition hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]"
                                        title="添加参考素材"
                                    >
                                        <Paperclip className="size-4" strokeWidth={1.6} aria-hidden="true" />
                                        <span className="hidden sm:inline">参考素材</span>
                                    </Link>
                                    <Link
                                        href="/assets"
                                        className="inline-flex h-9 items-center gap-2 rounded-[6px] px-2 text-xs text-[var(--studio-muted)] transition hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]"
                                        title="从资产库选择"
                                    >
                                        <Images className="size-4" strokeWidth={1.6} aria-hidden="true" />
                                        <span className="hidden sm:inline">资产库</span>
                                    </Link>
                                    <Link
                                        href="/prompts"
                                        className="inline-flex h-9 items-center gap-2 rounded-[6px] px-2 text-xs text-[var(--studio-muted)] transition hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]"
                                        title="打开提示词库"
                                    >
                                        <BookOpenText className="size-4" strokeWidth={1.6} aria-hidden="true" />
                                        <span className="hidden md:inline">提示词库</span>
                                    </Link>
                                    <Link
                                        href="/image"
                                        className="inline-flex size-9 items-center justify-center rounded-[6px] text-[var(--studio-muted)] transition hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]"
                                        title="图片设置"
                                        aria-label="图片设置"
                                    >
                                        <SlidersHorizontal className="size-4" strokeWidth={1.6} aria-hidden="true" />
                                    </Link>
                                </div>
                                <div className="flex shrink-0 items-center gap-1.5">
                                    <button
                                        type="button"
                                        className="inline-flex size-9 items-center justify-center rounded-[6px] text-[var(--studio-muted)] transition hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-action)] disabled:cursor-not-allowed disabled:opacity-40"
                                        aria-label="AI 优化提示词"
                                        title="AI 优化提示词"
                                        disabled={!prompt.trim() || isPromptOptimizing}
                                        onClick={() => void optimizePrompt({ operationId: "homepage-image", generationType: "image", prompt, onSuccess: setPrompt })}
                                    >
                                        <Sparkles className={`size-4 ${isPromptOptimizing ? "animate-pulse" : ""}`} strokeWidth={1.6} aria-hidden="true" />
                                    </button>
                                    <button
                                        type="button"
                                        className="creation-composer-submit-trigger inline-flex size-10 items-center justify-center transition active:scale-95 disabled:cursor-not-allowed motion-reduce:transform-none"
                                        aria-label="开始图片创作"
                                        title="开始图片创作"
                                        disabled={!prompt.trim()}
                                        onClick={submitAgent}
                                    >
                                        <ArrowUp className="size-[18px] shrink-0" strokeWidth={2.1} aria-hidden="true" />
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
                            {promptSuggestions.map((suggestion) => (
                                <button key={suggestion} type="button" className="inline-flex items-center gap-1.5 py-1 text-left text-[11px] text-[var(--studio-faint)] transition hover:text-[var(--studio-action)]" onClick={() => setPrompt(suggestion)}>
                                    <span className="text-sm leading-none" aria-hidden="true">
                                        +
                                    </span>
                                    {suggestion.slice(0, 11)}
                                </button>
                            ))}
                        </div>
                    </div>

                    <ShowcaseWall {...showcases} />
                </section>

                <section className="border-t border-[var(--studio-line)] pt-8">
                    <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between md:gap-6">
                        <h2 className="text-2xl font-medium text-[var(--studio-ink)]">选择创作方式</h2>
                        <p className="max-w-[420px] text-sm leading-6 text-[var(--studio-muted)] md:text-right">延续图片、视频和无限画布三条主工作流，Agent 负责在它们之间传递创作上下文。</p>
                    </div>
                    <div className="grid border-t border-[var(--studio-line)] md:grid-cols-3">
                        {primaryEntries.map((entry, index) => (
                            <Link
                                key={entry.href}
                                href={entry.href}
                                className="group grid min-h-40 grid-cols-[auto_1fr_auto] gap-4 border-b border-[var(--studio-line)] px-3 py-6 transition hover:-translate-y-0.5 hover:bg-[var(--studio-surface)] motion-reduce:transform-none md:border-b-0 md:border-r md:px-5 last:md:border-r-0"
                            >
                                <span className="text-[10px] text-[var(--studio-faint)]">0{index + 1}</span>
                                <span>
                                    <entry.icon className="mb-5 size-5 text-[var(--studio-action)]" strokeWidth={1.4} aria-hidden="true" />
                                    <strong className="block text-lg font-medium text-[var(--studio-ink)]">{entry.label}</strong>
                                    <span className="mt-1.5 block text-xs leading-5 text-[var(--studio-muted)]">{entry.description}</span>
                                </span>
                                <ArrowUpRight className="size-4 text-[var(--studio-faint)] transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[var(--studio-action)]" strokeWidth={1.5} aria-hidden="true" />
                            </Link>
                        ))}
                    </div>
                </section>

                <FantasticShow {...showcases} />

                <footer className="mt-9 flex flex-col gap-2 border-t border-[var(--studio-line)] pt-4 text-[10px] text-[var(--studio-faint)] sm:flex-row sm:items-center sm:justify-between">
                    <span className="uppercase">Novanova Studio / AI Visual Agent</span>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {icpRecordNumber ? (
                            <a
                                href="https://beian.miit.gov.cn/"
                                target="_blank"
                                rel="noreferrer"
                                className="transition hover:text-[var(--studio-muted)]"
                            >
                                {icpRecordNumber}
                            </a>
                        ) : null}
                        <span>© 2026 All rights reserved</span>
                    </div>
                </footer>
            </div>
        </main>
    );
}

function BrandMark() {
    return (
        <h1 aria-label="Novanova Studio" style={studioWordmarkFont} className="m-0 max-w-[720px] pb-[14px] pt-1 text-[var(--studio-ink)] uppercase">
            <span className="flex items-start gap-[14px]">
                <span style={studioWordmarkText} className="whitespace-nowrap text-[clamp(72px,7.6vw,128px)] leading-[0.82]">Nova</span>
                <span style={studioInterfaceFont} className="mt-1.5 min-w-7 text-[11px] font-semibold text-[var(--studio-action)]">N / 01</span>
            </span>
            <span className="flex items-start gap-[14px]">
                <span style={studioWordmarkText} className="whitespace-nowrap text-[clamp(72px,7.6vw,128px)] leading-[0.82] text-transparent [-webkit-text-stroke:1px_var(--studio-ink)]">nova</span>
                <span style={studioInterfaceFont} className="mt-1.5 min-w-7 text-[11px] font-semibold text-[var(--studio-action)]">N / 02</span>
            </span>
            <span className="mt-5 flex items-center gap-3 normal-case">
                <img src="/logo/novanovastudio.svg" alt="" aria-hidden="true" className="size-[52px] object-contain" />
                <span style={studioLockupFont} className="text-[clamp(25px,2.5vw,39px)] leading-none">Studio</span>
                <span className="h-px w-[120px] max-w-[18vw] bg-[var(--studio-line-strong)]" aria-hidden="true" />
            </span>
        </h1>
    );
}

function ShowcaseWall({ items, loading, error, reload }: ReturnType<typeof useHomepageShowcases>) {
    const visibleItems = useMemo(() => items.slice(0, 3), [items]);
    if (loading) {
        return (
            <div className="grid min-h-[510px] grid-cols-2 gap-3 lg:grid-cols-12 lg:grid-rows-12" aria-label="正在加载精选作品">
                <div className="studio-skeleton col-span-2 lg:col-[1/8] lg:row-[1/10]" />
                <div className="studio-skeleton lg:col-[8/13] lg:row-[2/7]" />
                <div className="studio-skeleton lg:col-[8/13] lg:row-[7/13]" />
            </div>
        );
    }
    if (error) {
        return (
            <div className="flex min-h-[420px] flex-col items-center justify-center border border-[var(--studio-line)] bg-[var(--studio-surface)] p-8 text-center">
                <p className="text-sm text-[var(--studio-muted)]">精选作品暂时无法加载</p>
                <button type="button" className="mt-4 rounded-[6px] border border-[var(--studio-line-strong)] px-3 py-2 text-sm text-[var(--studio-ink)] transition hover:border-[var(--studio-action)]" onClick={() => void reload()}>
                    重试
                </button>
            </div>
        );
    }
    return (
        <div className="relative min-w-0">
            <div className="mb-[14px] flex items-end justify-between gap-4">
                <h2 style={studioInterfaceFont} className="text-sm font-semibold text-[var(--studio-ink)]">Selected Output</h2>
                <span style={studioInterfaceFont} className="text-[10px] uppercase text-[var(--studio-faint)]">Agent Curated / {String(visibleItems.length).padStart(3, "0")}</span>
            </div>
            <div className="grid min-h-[510px] grid-cols-2 gap-2.5 lg:h-[clamp(510px,60vw,690px)] lg:min-h-0 lg:grid-cols-12 lg:grid-rows-12">
                {visibleItems.map((item, index) => (
                    <ShowcaseCard key={item.id} item={item} index={index} />
                ))}
                <div className="col-span-2 flex min-h-28 items-center justify-between gap-5 border-t border-[var(--studio-line)] px-1 lg:col-[1/8] lg:row-[10/13]">
                    <strong style={studioLockupFont} className="text-[clamp(24px,2.6vw,42px)] leading-none text-[var(--studio-ink)]">
                        Ideas
                        <br />
                        into form.
                    </strong>
                    <span className="max-w-56 text-right text-[11px] leading-5 text-[var(--studio-muted)]">Agent 自动串联提示词、参考素材与历史资产，持续保留创作上下文。</span>
                </div>
            </div>
            <span className="absolute -right-4 top-12 hidden size-10 place-items-center rounded-full border border-[var(--studio-line-strong)] bg-[var(--studio-page)] text-[10px] text-[var(--studio-action)] lg:grid">A1</span>
            <span className="absolute -left-12 bottom-14 hidden size-10 place-items-center rounded-full border border-[var(--studio-line-strong)] bg-[var(--studio-page)] text-[10px] text-[var(--studio-action)] lg:grid">B3</span>
        </div>
    );
}

function ShowcaseCard({ item, index }: { item: HomepageShowcase; index: number }) {
    const position = showcaseCardPositions[index] || showcaseCardPositions[2];
    const targetPath = item.targetPath || getHomepageTargetPath(item.targetType);
    const href = item.promptContent ? `${targetPath}${targetPath.includes("?") ? "&" : "?"}initialPrompt=${encodeURIComponent(item.promptContent)}` : targetPath;
    if (item.id === homepageFallbackEditorialShowcaseId && item.mediaType === "video") {
        return <EditorialVideoCarousel item={item} href={href} position={position} />;
    }
    return <ShowcaseMediaCard item={item} index={index} href={href} position={position} />;
}

function ShowcaseMediaCard({ item, index, href, position }: { item: HomepageShowcase; index: number; href: string; position: string }) {
    const videoElementReference = useRef<HTMLVideoElement>(null);
    const [isVideoPlaying, setIsVideoPlaying] = useState(false);
    const toggleVideoPlayback = (event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        const videoElement = videoElementReference.current;
        if (!videoElement) return;
        if (videoElement.paused) {
            void videoElement.play();
            return;
        }
        videoElement.pause();
    };
    return (
        <figure className={`group relative m-0 overflow-hidden rounded-[8px] border border-[var(--studio-line)] bg-[var(--studio-media)] ${position}`}>
            <Link href={href} className="absolute inset-0 block" aria-label={`打开作品：${item.title}`}>
                {item.mediaType === "video" ? (
                    <video
                        ref={videoElementReference}
                        src={item.mediaUrl}
                        poster={item.thumbnailUrl || undefined}
                        autoPlay
                        muted
                        loop
                        playsInline
                        aria-label={item.title}
                        onPlay={() => setIsVideoPlaying(true)}
                        onPause={() => setIsVideoPlaying(false)}
                        onClick={(event) => event.stopPropagation()}
                        className="size-full object-cover saturate-[0.72] contrast-[1.06] transition duration-700 group-hover:scale-[1.035] group-hover:saturate-100 motion-reduce:transition-none"
                    />
                ) : (
                    <img
                        src={item.mediaUrl}
                        alt={item.title}
                        loading={index === 0 ? "eager" : "lazy"}
                        className="size-full object-cover saturate-[0.72] contrast-[1.06] transition duration-700 group-hover:scale-[1.035] group-hover:saturate-100 motion-reduce:transition-none"
                    />
                )}
            </Link>
            {item.mediaType === "video" ? (
                <VideoPlaybackButton isVideoPlaying={isVideoPlaying} onClick={toggleVideoPlayback} />
            ) : null}
            <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex min-h-10 items-center justify-between gap-3 border-t border-white/15 bg-black/70 px-3 py-2 text-[11px] text-white">
                <span className="truncate">{item.title}</span>
                {item.mediaType === "video" ? <Play className="size-3.5 shrink-0 text-[var(--studio-action)]" aria-hidden="true" /> : <span style={studioInterfaceFont} className="shrink-0 text-[var(--studio-action)]">0{index + 1}</span>}
            </figcaption>
        </figure>
    );
}

function EditorialVideoCarousel({ item, href, position }: { item: HomepageShowcase; href: string; position: string }) {
    const videoElementReferences = useRef<Array<HTMLVideoElement | null>>([]);
    const [activeVideoIndex, setActiveVideoIndex] = useState(0);
    const [isVideoPlaying, setIsVideoPlaying] = useState(false);
    const reduceMotion = useReducedMotion();

    useEffect(() => {
        if (!isVideoPlaying) return;
        const timer = window.setTimeout(() => {
            setActiveVideoIndex((currentIndex) => (currentIndex + 1) % homepageFallbackEditorialVideoUrls.length);
        }, 5000);
        return () => window.clearTimeout(timer);
    }, [activeVideoIndex, isVideoPlaying]);

    const toggleVideoPlayback = (event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        const activeVideoElement = videoElementReferences.current[activeVideoIndex];
        if (!activeVideoElement) return;
        if (activeVideoElement.paused) {
            void activeVideoElement.play();
            return;
        }
        activeVideoElement.pause();
    };

    const promotePreviewVideo = (event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        setActiveVideoIndex((currentIndex) => (currentIndex + 1) % homepageFallbackEditorialVideoUrls.length);
    };

    return (
        <figure className={`group relative m-0 overflow-hidden rounded-[8px] ${position}`} aria-roledescription="轮播图" aria-label={item.title}>
            <div className="absolute inset-0">
                {homepageFallbackEditorialVideoUrls.map((videoUrl, videoIndex) => {
                    const isActive = videoIndex === activeVideoIndex;
                    return (
                        <motion.div
                            key={videoUrl}
                            className="absolute inset-y-0 left-0 w-[84%] overflow-hidden rounded-[8px]"
                            initial={false}
                            animate={{ x: isActive ? "0%" : "28%", scale: isActive ? 1 : 0.88, opacity: isActive ? 1 : 0.82 }}
                            transition={reduceMotion ? { duration: 0 } : { duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                            style={{ zIndex: isActive ? 2 : 1, transformOrigin: "left center" }}
                            aria-hidden={!isActive}
                        >
                            <video
                                key={`${videoUrl}-${isActive ? "active" : "preview"}`}
                                ref={(element) => {
                                    videoElementReferences.current[videoIndex] = element;
                                }}
                                src={videoUrl}
                                autoPlay={isActive}
                                muted
                                playsInline
                                preload={isActive ? "auto" : "metadata"}
                                onPlay={() => {
                                    if (isActive) setIsVideoPlaying(true);
                                }}
                                onPause={() => {
                                    if (isActive) setIsVideoPlaying(false);
                                }}
                                className={`size-full object-cover transition duration-500 motion-reduce:transition-none ${isActive ? "saturate-[0.8] contrast-[1.06] group-hover:saturate-100" : "brightness-75 saturate-[0.45]"}`}
                            />
                        </motion.div>
                    );
                })}
            </div>
            <button type="button" className="absolute inset-y-0 right-0 z-20 m-0 w-[16%] cursor-pointer border-0 bg-transparent p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--studio-action)]" aria-label="切换到下一段视频" title="切换到下一段视频" onClick={promotePreviewVideo} />
            <Link href={href} className="absolute inset-0 z-10 block" aria-label={`打开作品：${item.title}`} />
            <VideoPlaybackButton isVideoPlaying={isVideoPlaying} onClick={toggleVideoPlayback} />
            <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex min-h-10 items-center border-t border-white/15 bg-black/70 px-3 py-2 text-[11px] text-white">
                <span className="truncate">{item.title}</span>
            </figcaption>
        </figure>
    );
}

function VideoPlaybackButton({ isVideoPlaying, onClick }: { isVideoPlaying: boolean; onClick: (event: MouseEvent<HTMLButtonElement>) => void }) {
    return (
        <button
            type="button"
            className="pointer-events-none absolute left-1/2 top-1/2 z-30 inline-flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/35 bg-black/55 text-white opacity-0 transition duration-200 hover:bg-black/75 focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-action)] group-hover:pointer-events-auto group-hover:opacity-100 motion-reduce:transition-none"
            aria-label={isVideoPlaying ? "暂停视频" : "播放视频"}
            title={isVideoPlaying ? "暂停视频" : "播放视频"}
            onClick={onClick}
        >
            {isVideoPlaying ? <Pause className="size-4" fill="currentColor" aria-hidden="true" /> : <Play className="size-4" fill="currentColor" aria-hidden="true" />}
        </button>
    );
}

function FantasticShow({ items, loading, error, reload }: ReturnType<typeof useHomepageShowcases>) {
    const [category, setCategory] = useState<FantasticShowCategory>("全部");
    const [keyword, setKeyword] = useState("");
    const showcases = useMemo(() => getFantasticShowcases(items), [items]);
    const filteredShowcases = useMemo(() => filterFantasticShowcases(showcases, category, keyword), [category, keyword, showcases]);

    return (
        <section className="mt-12 border-t border-[var(--studio-line)] pt-8" aria-labelledby="fantastic-show-heading">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <h2 id="fantastic-show-heading" style={studioInterfaceFont} className="text-2xl font-medium text-[var(--studio-ink)]">
                        Fantastic Show
                    </h2>
                    <p className="mt-2 text-sm text-[var(--studio-muted)]">从作品中继续发现下一轮创作的方向。</p>
                </div>
                <label className="flex h-10 w-full items-center gap-2 border border-[var(--studio-line-strong)] bg-[var(--studio-surface)] px-3 text-[var(--studio-muted)] lg:w-80">
                    <Search className="size-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
                    <input
                        type="search"
                        value={keyword}
                        onChange={(event) => setKeyword(event.target.value)}
                        placeholder="搜索作品或创作者"
                        aria-label="搜索精彩创作"
                        className="min-w-0 flex-1 bg-transparent text-sm text-[var(--studio-ink)] outline-none placeholder:text-[var(--studio-faint)]"
                    />
                </label>
            </div>

            <div className="mt-6 overflow-x-auto pb-1">
                <div className="flex min-w-max gap-2" role="tablist" aria-label="精彩创作分类">
                    {FANTASTIC_SHOW_CATEGORIES.map((item) => {
                        const selected = item === category;
                        return (
                            <button
                                key={item}
                                type="button"
                                role="tab"
                                aria-selected={selected}
                                className={`h-9 rounded-[6px] border px-3 text-sm transition ${selected ? "border-[var(--studio-action)] bg-[var(--studio-surface-raised)] text-[var(--studio-action)]" : "border-[var(--studio-line)] bg-transparent text-[var(--studio-muted)] hover:border-[var(--studio-line-strong)] hover:bg-[var(--studio-surface)] hover:text-[var(--studio-ink)]"}`}
                                onClick={() => setCategory(item)}
                            >
                                {item}
                            </button>
                        );
                    })}
                </div>
            </div>

            {loading ? (
                <div className="mt-6 grid gap-x-4 gap-y-7 md:grid-cols-2 xl:grid-cols-4" aria-label="正在加载精彩创作">
                    {Array.from({ length: 8 }, (_, index) => (
                        <div key={index} className="space-y-3">
                            <div className="studio-skeleton aspect-[4/3]" />
                            <div className="studio-skeleton h-4 w-2/5" />
                            <div className="studio-skeleton h-3 w-3/5" />
                        </div>
                    ))}
                </div>
            ) : error ? (
                <div className="mt-6 flex min-h-56 flex-col items-center justify-center border border-[var(--studio-line)] bg-[var(--studio-surface)] px-6 text-center">
                    <p className="text-sm text-[var(--studio-muted)]">精彩创作暂时无法加载</p>
                    <button type="button" className="mt-4 h-9 border border-[var(--studio-line-strong)] px-3 text-sm text-[var(--studio-ink)] transition hover:border-[var(--studio-action)] hover:text-[var(--studio-action)]" onClick={() => void reload()}>
                        重试
                    </button>
                </div>
            ) : filteredShowcases.length ? (
                <div className="mt-6 grid gap-x-4 gap-y-7 md:grid-cols-2 xl:grid-cols-4">
                    {filteredShowcases.map((item) => (
                        <FantasticShowCard key={item.id} item={item} />
                    ))}
                </div>
            ) : (
                <div className="mt-6 flex min-h-56 items-center justify-center border border-dashed border-[var(--studio-line-strong)] px-6 text-center text-sm text-[var(--studio-muted)]">
                    没有符合条件的精彩创作
                </div>
            )}
        </section>
    );
}

function FantasticShowCard({ item }: { item: HomepageShowcase }) {
    const targetPath = item.targetPath || getHomepageTargetPath(item.targetType);
    const href = item.promptContent ? `${targetPath}${targetPath.includes("?") ? "&" : "?"}initialPrompt=${encodeURIComponent(item.promptContent)}` : targetPath;

    return (
        <article className="min-w-0">
            <Link href={href} className="group block overflow-hidden rounded-[8px] border border-[var(--studio-line)] bg-[var(--studio-media)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--studio-action)]">
                <div className="relative aspect-[4/3] overflow-hidden">
                    {item.mediaType === "video" ? (
                        <video src={item.mediaUrl} poster={item.thumbnailUrl || undefined} muted playsInline preload="metadata" className="size-full object-cover" aria-label={item.title} />
                    ) : (
                        <img src={item.mediaUrl} alt={item.title} loading="lazy" className="size-full object-cover transition duration-300 group-hover:scale-[1.025] motion-reduce:transition-none" />
                    )}
                    {item.mediaType === "video" ? <span className="absolute right-3 top-3 grid size-8 place-items-center rounded-full border border-white/20 bg-black/70 text-white"><Play className="size-3.5 fill-current" aria-hidden="true" /></span> : null}
                </div>
            </Link>
            <div className="mt-3 flex min-w-0 gap-2.5">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--studio-surface-hover)] text-[10px] font-semibold text-[var(--studio-ink)]" aria-hidden="true">
                    {creatorMonogram(item.creatorName)}
                </span>
                <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--studio-ink)]">{item.creatorName}</p>
                    <p className="mt-0.5 truncate text-xs text-[var(--studio-muted)]">{item.title}</p>
                </div>
            </div>
        </article>
    );
}
