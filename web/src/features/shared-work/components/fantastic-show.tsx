"use client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Alert, App, Button, Empty, Input, Tag } from "antd";
import { Copy, Heart, Loader2, PanelRightClose, PanelRightOpen, Play, Search, X } from "lucide-react";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { useCopyText } from "@/shared/hooks/use-copy-text";
import { FANTASTIC_SHOW_CATEGORIES } from "@/features/homepage/lib/fantastic-show";
import { loadHomepageMedia } from "@/features/homepage/lib/homepage-media-cache";
import { CanvasProjectPreview } from "@/features/canvas/components/canvas-project-preview";
import type { CanvasDocument } from "@/features/canvas/types";
import { SharedCanvasViewer } from "@/features/shared-work/components/shared-content";
import { getSharedWork, listFantasticWorks, sharedWorkTypeNames, toggleFantasticLike, type FantasticWork, type SharedSnapshot, type SharedWorkDetail } from "@/services/api/shared-work";

/**
 * 首页官方作品与用户作品统一由服务端筛选、排序和分页；
 * 前端把每一页追加进瀑布流，滚动到底部时继续取下一页，不再展示分页器。
 */
export function FantasticShow() {
    const { message } = App.useApp();
    const [type, setType] = useState("");
    const [category, setCategory] = useState("");
    const [keyword, setKeyword] = useState("");
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [items, setItems] = useState<FantasticWork[]>([]);
    const [hasMore, setHasMore] = useState(true);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState("");
    const [revision, setRevision] = useState(0);
    const [retry, setRetry] = useState(0);
    const [liking, setLiking] = useState<string[]>([]);
    const sentinelRef = useRef<HTMLDivElement>(null);
    const lastLoadedAt = useRef(0);
    const columnCount = useSyncExternalStore(subscribeColumnQueries, getColumnCount, () => 2);
    const columns = useMemo(() => distributeColumns(items, columnCount), [items, columnCount]);
    useEffect(() => {
        const timer = setTimeout(() => {
            setSearch(keyword.trim());
            setPage(1);
        }, 300);
        return () => clearTimeout(timer);
    }, [keyword]);
    useEffect(() => {
        const controller = new AbortController();
        const firstPage = page === 1;
        if (firstPage) {
            setItems([]);
            setHasMore(true);
            setLoading(true);
        } else {
            setLoadingMore(true);
        }
        setError("");
        lastLoadedAt.current = Date.now();
        void listFantasticWorks(type, category, search, page, controller.signal)
            .then((result) => {
                if (controller.signal.aborted) return;
                // 服务端按点赞数排序，翻页期间点赞变化可能让同一条作品重复出现，追加时按 id 去重。
                setItems((list) => {
                    const seen = new Set(list.map((entry) => entry.id));
                    return firstPage ? result.items : [...list, ...result.items.filter((entry) => !seen.has(entry.id))];
                });
                setHasMore(result.items.length > 0 && page * result.pageSize < result.total);
            })
            .catch((failure) => {
                if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "作品暂不可用");
            })
            .finally(() => {
                if (controller.signal.aborted) return;
                setLoading(false);
                setLoadingMore(false);
            });
        return () => controller.abort();
    }, [type, category, search, page, revision, retry]);
    // 哨兵进入滚动视口就追加下一页；每批数据落地后重建观察器，视口没填满时会自动继续加载。
    useEffect(() => {
        const node = sentinelRef.current;
        if (!node || !hasMore || loading || loadingMore || error) return;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) setPage((value) => value + 1);
        }, { root: findScrollRoot(node), rootMargin: "600px 0px" });
        observer.observe(node);
        return () => observer.disconnect();
    }, [hasMore, loading, loadingMore, error, items.length, columnCount]);
    // 作品墙的媒体是临时地址，长时间停留或回到前台时低频重新拉取一次（回到首批，继续滚动会补齐后续页）。
    useEffect(() => {
        const refreshIfStale = () => {
            if (document.visibilityState === "visible" && Date.now() - lastLoadedAt.current > 15 * 60_000) {
                setPage(1);
                setRevision((value) => value + 1);
            }
        };
        const timer = window.setInterval(refreshIfStale, 20 * 60_000);
        document.addEventListener("visibilitychange", refreshIfStale);
        return () => {
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", refreshIfStale);
        };
    }, []);
    const toggleLike = (item: FantasticWork) => {
        const store = useUserStore.getState();
        if (!store.token) {
            store.openAuthModal();
            return;
        }
        if (liking.includes(item.id)) return;
        const liked = !item.liked;
        const patch = (likeCount: number, nextLiked: boolean) => setItems((list) => list.map((entry) => (entry.id === item.id ? { ...entry, likeCount, liked: nextLiked } : entry)));
        setLiking((value) => [...value, item.id]);
        patch(item.likeCount + (liked ? 1 : -1), liked);
        void toggleFantasticLike(item.id)
            .then((result) => patch(result.likeCount, result.liked))
            .catch((failure) => {
                patch(item.likeCount, item.liked);
                message.error(failure instanceof Error ? failure.message : "点赞失败");
            })
            .finally(() => setLiking((value) => value.filter((id) => id !== item.id)));
    };
    const typeOptions = [{ value: "", label: "全部类型" }, ...Object.entries(sharedWorkTypeNames).map(([value, label]) => ({ value, label }))];
    return (
        <section className="mt-10" aria-label="作品">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-5">
                    <div className="flex shrink-0 items-center gap-3" role="group" aria-label="作品类型">
                        {typeOptions.map((option) => (
                            <FilterText
                                key={option.label}
                                active={type === option.value}
                                onClick={() => {
                                    setType(option.value);
                                    setPage(1);
                                }}
                            >
                                {option.label}
                            </FilterText>
                        ))}
                    </div>
                    <span className="hidden h-3 w-px bg-[var(--studio-line-strong)] sm:block" aria-hidden="true" />
                    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1" role="group" aria-label="作品分类">
                        {FANTASTIC_SHOW_CATEGORIES.map((value) => (
                            <FilterText
                                key={value}
                                active={(value === "全部" ? "" : value) === category}
                                onClick={() => {
                                    setCategory(value === "全部" ? "" : value);
                                    setPage(1);
                                }}
                            >
                                {value}
                            </FilterText>
                        ))}
                    </div>
                </div>
                <div className="w-full md:w-56 md:shrink-0">
                    <Input prefix={<Search className="size-4" />} type="search" aria-label="搜索作品或作者" placeholder="搜索作品或作者" maxLength={200} value={keyword} onChange={(event) => setKeyword(event.target.value)} allowClear />
                </div>
            </div>
            {error && !items.length ? (
                <Alert className="mt-4" type="error" showIcon title={error} action={<Button onClick={() => setRetry((value) => value + 1)}>重试</Button>} />
            ) : null}
            {loading ? (
                <div className="mt-4 grid grid-cols-2 items-start gap-3 sm:grid-cols-3 xl:grid-cols-5">
                    {["3/4", "16/9", "9/16", "1/1", "4/5", "16/10", "3/4", "9/16"].map((ratio, index) => (
                        <div key={index} className="studio-skeleton rounded-xl" style={{ aspectRatio: ratio }} />
                    ))}
                </div>
            ) : items.length ? (
                <div className="mt-4 flex items-start gap-3">
                    {columns.map((column, index) => (
                        <div key={index} className="flex min-w-0 flex-1 flex-col gap-3">
                            {column.map((item) => (
                                <FantasticCard key={item.id} item={item} pending={liking.includes(item.id)} onToggleLike={() => toggleLike(item)} />
                            ))}
                        </div>
                    ))}
                </div>
            ) : error ? null : (
                <div className="py-10">
                    <Empty description="暂无符合条件的作品" />
                </div>
            )}
            <div ref={sentinelRef} aria-hidden="true" className="h-px" />
            {loadingMore ? (
                <div className="mt-5 flex items-center justify-center gap-2 text-xs text-[var(--studio-muted)]">
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    正在加载更多作品
                </div>
            ) : null}
            {error && items.length ? (
                <div className="mt-5 flex flex-col items-center gap-2 text-xs text-[var(--studio-muted)]">
                    <span>{error}</span>
                    <Button size="small" onClick={() => setRetry((value) => value + 1)}>重试加载</Button>
                </div>
            ) : null}
            {!loading && !loadingMore && !hasMore && items.length > 8 ? (
                <p className="mt-5 text-center text-xs text-[var(--studio-faint)]">已经看完全部作品</p>
            ) : null}
        </section>
    );
}

/** 与原 CSS 多列断点保持一致：2 / 3 / 5 列。 */
const columnQueries = ["(min-width: 640px)", "(min-width: 1280px)"] as const;

function subscribeColumnQueries(onChange: () => void) {
    const lists = columnQueries.map((query) => window.matchMedia(query));
    lists.forEach((list) => list.addEventListener("change", onChange));
    return () => lists.forEach((list) => list.removeEventListener("change", onChange));
}

function getColumnCount() {
    if (typeof window === "undefined") return 2;
    if (window.matchMedia(columnQueries[1]).matches) return 5;
    if (window.matchMedia(columnQueries[0]).matches) return 3;
    return 2;
}

/**
 * 按卡片占位宽高比估算高度，依次放进当前最短的列。
 * <p>
 * 分配对前缀稳定：追加一页时已展示卡片的列归属不会变化，不会像 CSS 多列那样整墙重排、留出大片空白。
 */
function distributeColumns(items: FantasticWork[], count: number) {
    const columns: FantasticWork[][] = Array.from({ length: count }, () => []);
    const heights = Array.from({ length: count }, () => 0);
    for (const item of items) {
        let target = 0;
        for (let index = 1; index < count; index++) if (heights[index] < heights[target]) target = index;
        columns[target].push(item);
        // 以列宽为 1：图片默认 3/4、视频与画布 16/9，另加标题与作者两行。
        heights[target] += (item.workType === "image" ? 4 / 3 : 9 / 16) + 0.14;
    }
    return columns;
}

/** 首页内容在独立滚动容器里，观察器必须以它为 root，rootMargin 的预加载才会生效。 */
function findScrollRoot(node: Element) {
    let parent = node.parentElement;
    while (parent) {
        const overflowY = getComputedStyle(parent).overflowY;
        if ((overflowY === "auto" || overflowY === "scroll") && parent.scrollHeight > parent.clientHeight + 1) return parent;
        parent = parent.parentElement;
    }
    return null;
}

function FilterText({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
    return (
        <button type="button" aria-pressed={active} className={`text-sm transition ${active ? "font-medium text-[var(--studio-ink)]" : "text-[var(--studio-muted)] hover:text-[var(--studio-ink)]"}`} onClick={onClick}>
            {children}
        </button>
    );
}

/**
 * 首页作品媒体。
 * <p>
 * 按对象存储返回的原始字节缓存到本地，命中后不再请求；读取失败时回退到原始地址，不影响展示。
 */
function CachedWorkMedia({ src, alt, className, onReady }: { src?: string; alt?: string; className?: string; onReady?: (width: number, height: number) => void }) {
    const [resolved, setResolved] = useState<string>();
    useEffect(() => {
        const url = src?.trim();
        if (!url) {
            setResolved(undefined);
            return;
        }
        let active = true;
        let objectUrl = "";
        void loadHomepageMedia(url).then((blob) => {
            if (!active) return;
            if (!blob) {
                setResolved(url);
                return;
            }
            objectUrl = URL.createObjectURL(blob);
            setResolved(objectUrl);
        });
        return () => {
            active = false;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [src]);
    return <img src={resolved} alt={alt || ""} loading="lazy" className={className} onLoad={(event) => onReady?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} />;
}

function FantasticCard({ item, pending, onToggleLike }: { item: FantasticWork; pending: boolean; onToggleLike: () => void }) {
    const isVideo = item.workType === "video";
    const isCanvas = item.workType === "canvas";
    const [previewing, setPreviewing] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [ratio, setRatio] = useState<number | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const cover = item.thumbnailUrl?.trim() || "";
    // 卡片本身只展示封面，鼠标停在中部播放按钮上才挂载并播放；没有封面的视频同样不预载，避免一进首页就拉整段视频。
    const showVideo = isVideo && playing;
    const openPreview = () => setPreviewing(true);
    const stopVideo = () => {
        const video = videoRef.current;
        if (!video) return;
        video.pause();
        video.currentTime = 0;
    };
    const rememberRatio = (width: number, height: number) => {
        if (width > 0 && height > 0) setRatio(width / height);
    };
    useEffect(() => {
        if (!playing || !showVideo) return;
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        void videoRef.current?.play().catch(() => undefined);
    }, [playing, showVideo]);
    return (
        <>
            <article
                className="min-w-0 cursor-pointer rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--studio-action)]"
                role="button"
                tabIndex={0}
                aria-label={`预览 ${item.title}`}
                onClick={() => {
                    stopVideo();
                    openPreview();
                }}
                onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openPreview();
                    }
                }}
            >
                <div
                    className="group relative overflow-hidden rounded-xl bg-[var(--studio-media)]"
                    style={{ aspectRatio: isCanvas ? 16 / 9 : ratio ?? (isVideo ? 16 / 9 : 3 / 4) }}
                    onMouseLeave={() => {
                        setPlaying(false);
                        stopVideo();
                    }}
                >
                    {isCanvas ? (
                        <FantasticCanvasPreview code={item.shareCode} title={item.title} />
                    ) : isVideo && showVideo ? (
                        <video ref={videoRef} src={item.mediaUrl} poster={cover || undefined} muted loop playsInline preload="metadata" className="pointer-events-none size-full object-cover" onLoadedMetadata={(event) => rememberRatio(event.currentTarget.videoWidth, event.currentTarget.videoHeight)} />
                    ) : (
                        <CachedWorkMedia
                            src={isVideo ? cover : item.thumbnailUrl?.trim() || item.mediaUrl}
                            className="size-full object-cover transition-transform group-hover:scale-[1.025] motion-reduce:transform-none"
                            onReady={rememberRatio}
                        />
                    )}
                    {isVideo ? (
                        <span className={`pointer-events-none absolute inset-0 grid place-items-center transition motion-reduce:transition-none ${playing ? "opacity-0" : ""}`}>
                            <span
                                className="pointer-events-auto grid size-12 cursor-pointer place-items-center rounded-full border border-white/35 bg-black/55 text-white backdrop-blur-sm"
                                onMouseEnter={() => setPlaying(true)}
                                onMouseLeave={() => setPlaying(false)}
                                aria-hidden="true"
                            >
                                <Play className="size-5 fill-current" />
                            </span>
                        </span>
                    ) : null}
                    {isCanvas ? (
                        <span className="absolute left-2 top-2">
                            <Tag>画布</Tag>
                        </span>
                    ) : null}
                    <button
                        type="button"
                        aria-pressed={item.liked}
                        aria-label={item.liked ? "取消点赞" : "点赞"}
                        title={item.liked ? "取消点赞" : "点赞"}
                        disabled={pending}
                        className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-full border border-white/25 bg-black/45 px-2 py-1 text-[11px]! font-medium tabular-nums text-white! backdrop-blur-sm transition hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-progress"
                        onClick={(event) => {
                            event.stopPropagation();
                            onToggleLike();
                        }}
                        onKeyDown={(event) => event.stopPropagation()}
                    >
                        <Heart className={item.liked ? "size-3.5 fill-rose-400 text-rose-400" : "size-3.5 text-white"} strokeWidth={1.8} aria-hidden="true" />
                        {item.likeCount}
                    </button>
                </div>
                <div className="mt-2 space-y-0.5">
                    <h3 className="truncate text-sm text-[var(--studio-ink)]">{item.title}</h3>
                    <p className="truncate text-xs text-[var(--studio-muted)]">{item.creatorName}</p>
                </div>
            </article>
            {previewing ? (
                <FantasticFullscreenModal
                    item={item}
                    pending={pending}
                    onToggleLike={onToggleLike}
                    onClose={() => setPreviewing(false)}
                />
            ) : null}
        </>
    );
}

const generationFieldLabels: Record<string, string> = {
    prompt: "提示词",
    generationPrompt: "实际生成提示词",
    modelName: "模型",
    quality: "质量",
    imageResolution: "分辨率",
    resolution: "分辨率",
    size: "尺寸",
    count: "数量",
    seconds: "时长（秒）",
    videoSeconds: "时长（秒）",
    vquality: "视频质量",
    videoWatermark: "水印",
    videoGenerationMode: "视频模式",
};
const generationFieldOrder = Object.keys(generationFieldLabels);

/**
 * 沉浸式全屏作品预览弹窗：左侧（或全屏）为暗色影院级媒体舞台，右侧为独立滚动的玻璃态详情抽屉并支持一键收起。
 */
function FantasticFullscreenModal({ item, pending, onToggleLike, onClose }: { item: FantasticWork; pending: boolean; onToggleLike: () => void; onClose: () => void }) {
    const copyText = useCopyText();
    const needsDetail = item.source === "user" && Boolean(item.shareCode);
    const [detail, setDetail] = useState<SharedWorkDetail | null>(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(needsDetail);
    const [infoOpen, setInfoOpen] = useState(true);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        window.addEventListener("keydown", handleKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [onClose]);

    useEffect(() => {
        if (!needsDetail) return;
        const controller = new AbortController();
        setLoading(true);
        setError("");
        void getSharedWork(item.shareCode, true, controller.signal)
            .then((result) => {
                if (!controller.signal.aborted) setDetail(result);
            })
            .catch((failure) => {
                if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "作品内容暂不可用");
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, [item.shareCode, needsDetail]);

    const entries = loading ? [] : generationEntries(detail?.snapshot.generation, item.promptContent);
    const promptEntries = entries.filter((entry) => entry.key === "prompt" || entry.key === "generationPrompt");
    const metaEntries = entries.filter((entry) => entry.key !== "prompt" && entry.key !== "generationPrompt");
    const ambientImage = item.thumbnailUrl?.trim() || (item.workType === "image" ? item.mediaUrl?.trim() : "");

    if (typeof document === "undefined") return null;

    return createPortal(
        <div
            role="dialog"
            aria-modal="true"
            aria-label={item.title}
            className="fixed inset-0 z-[1050] flex flex-col bg-black text-white lg:flex-row"
        >
            {/* 主舞台：铺满全屏视口，带氛围柔光背景与悬浮控制栏 */}
            <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black">
                {ambientImage && item.workType !== "canvas" ? (
                    <img
                        src={ambientImage}
                        alt=""
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 size-full scale-110 object-cover opacity-30 blur-3xl saturate-150"
                    />
                ) : null}
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/65 via-black/15 to-black/70" aria-hidden="true" />

                {/* 顶部悬浮玻璃条：标题与快捷操作 */}
                <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
                    <div className="pointer-events-auto flex min-w-0 items-center gap-2.5">
                        <h2 className="truncate text-base font-semibold tracking-tight text-white drop-shadow-sm sm:text-lg">
                            {item.title}
                        </h2>
                        <span className="shrink-0 rounded-full border border-white/15 bg-white/10 px-2.5 py-0.5 text-[11px] font-medium text-white/90 backdrop-blur-md">
                            {sharedWorkTypeNames[item.workType]}
                        </span>
                        {item.category ? (
                            <span className="hidden shrink-0 rounded-full border border-white/15 bg-white/10 px-2.5 py-0.5 text-[11px] font-medium text-white/80 backdrop-blur-md sm:inline-flex">
                                {item.category}
                            </span>
                        ) : null}
                    </div>
                    <div className="pointer-events-auto flex shrink-0 items-center gap-2">
                        <button
                            type="button"
                            aria-pressed={item.liked}
                            aria-label={item.liked ? "取消点赞" : "点赞"}
                            title={item.liked ? "取消点赞" : "点赞"}
                            disabled={pending}
                            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3.5 text-xs! font-medium tabular-nums text-white! backdrop-blur-md transition hover:bg-white/20 disabled:cursor-progress"
                            onClick={onToggleLike}
                        >
                            <Heart className={item.liked ? "size-4 fill-rose-400 text-rose-400" : "size-4 text-white"} strokeWidth={1.8} aria-hidden="true" />
                            <span>{item.likeCount}</span>
                        </button>
                        <button
                            type="button"
                            aria-label={infoOpen ? "收起作品信息" : "展开作品信息"}
                            title={infoOpen ? "收起信息，全屏观看" : "展开作品信息"}
                            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 text-xs! font-medium text-white! backdrop-blur-md transition hover:bg-white/20"
                            onClick={() => setInfoOpen((value) => !value)}
                        >
                            {infoOpen ? <PanelRightClose className="size-4" aria-hidden="true" /> : <PanelRightOpen className="size-4" aria-hidden="true" />}
                            <span className="hidden sm:inline">{infoOpen ? "全屏" : "详情"}</span>
                        </button>
                        <button
                            type="button"
                            aria-label="关闭预览"
                            title="关闭 (Esc)"
                            className="grid size-9 cursor-pointer place-items-center rounded-full border border-white/15 bg-white/10 text-white! backdrop-blur-md transition hover:bg-white/25"
                            onClick={onClose}
                        >
                            <X className="size-4" aria-hidden="true" />
                        </button>
                    </div>
                </div>

                {/* 媒体内容区：居中自适应充满整个舞台，无多余留白 */}
                <div className="relative z-10 flex size-full items-center justify-center p-3 pt-16 sm:p-6 sm:pt-16">
                    <FantasticPreviewMedia item={item} snapshot={detail?.snapshot ?? null} loading={loading} />
                </div>
            </div>

            {/* 右侧独立滚动的作品详情抽屉 */}
            {infoOpen ? (
                <aside className="thin-scrollbar flex max-h-[42dvh] w-full shrink-0 flex-col gap-5 overflow-y-auto border-t border-white/10 bg-zinc-950/95 p-5 text-white backdrop-blur-xl lg:h-full lg:max-h-none lg:w-[360px] lg:border-l lg:border-t-0 xl:w-[400px]">
                    <div className="space-y-3 border-b border-white/10 pb-4">
                        <div className="text-base font-semibold leading-snug text-white">{item.title}</div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-white/60">
                            <span>{item.source === "user" ? "分享人" : "作者"}：{item.creatorName}</span>
                            {item.category ? (
                                <>
                                    <span aria-hidden="true">·</span>
                                    <span>{item.category}</span>
                                </>
                            ) : null}
                        </div>
                        {item.description ? (
                            <p className="whitespace-pre-wrap break-words text-sm leading-6 text-white/80">{item.description}</p>
                        ) : null}
                    </div>

                    {loading ? (
                        <div className="flex items-center gap-2 text-sm text-white/60">
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                            <span>正在读取提示词和作品信息</span>
                        </div>
                    ) : null}
                    {error ? <Alert type="warning" showIcon title={error} /> : null}

                    {metaEntries.length ? (
                        <div className="flex flex-wrap gap-2">
                            {metaEntries.map((entry) => (
                                <div key={entry.key} className="rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1.5">
                                    <div className="text-[10px] text-white/50">{entry.label}</div>
                                    <div className="mt-0.5 text-xs font-medium text-white/90">{entry.text}</div>
                                </div>
                            ))}
                        </div>
                    ) : null}

                    {promptEntries.map((entry) => (
                        <div key={entry.key} className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-medium text-white/60">{entry.label}</span>
                                <button
                                    type="button"
                                    className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[11px]! text-white/80! transition hover:bg-white/15 hover:text-white!"
                                    onClick={() => copyText(entry.text, "已复制提示词")}
                                >
                                    <Copy className="size-3" aria-hidden="true" />
                                    <span>复制</span>
                                </button>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3.5">
                                <p className="whitespace-pre-wrap break-words text-[13px] leading-6 text-white/85">{entry.text}</p>
                            </div>
                        </div>
                    ))}
                </aside>
            ) : null}
        </div>,
        document.body,
    );
}

function FantasticPreviewMedia({ item, snapshot, loading }: { item: FantasticWork; snapshot: SharedSnapshot | null; loading: boolean }) {
    if (item.workType === "canvas") {
        if (snapshot?.scene) {
            return (
                <div className="size-full overflow-hidden rounded-xl border border-white/10 bg-black">
                    <SharedCanvasViewer snapshot={snapshot} />
                </div>
            );
        }
        return <div className="grid size-full place-items-center text-sm text-white/60">{loading ? "正在读取画布" : "预览暂不可用"}</div>;
    }
    if (!item.mediaUrl) return <div className="grid size-full place-items-center text-sm text-white/60">暂无媒体</div>;
    if (item.workType === "video") {
        return (
            <video
                src={item.mediaUrl}
                poster={item.thumbnailUrl || undefined}
                controls
                autoPlay
                playsInline
                className="max-h-full max-w-full rounded-xl bg-black object-contain shadow-2xl"
            />
        );
    }
    return <CachedWorkMedia src={item.mediaUrl} alt={item.title} className="max-h-full max-w-full rounded-xl object-contain shadow-2xl" />;
}

function generationEntries(generation: SharedSnapshot["generation"], fallbackPrompt: string) {
    const source: Record<string, string | number | boolean> = { ...generation };
    if (!String(source.prompt ?? "").trim() && fallbackPrompt.trim()) source.prompt = fallbackPrompt.trim();
    if (String(source.prompt ?? "").trim() && String(source.prompt).trim() === String(source.generationPrompt ?? "").trim()) delete source.generationPrompt;
    const keys = [...generationFieldOrder.filter((key) => key in source), ...Object.keys(source).filter((key) => !generationFieldOrder.includes(key))];
    return keys.flatMap((key) => {
        const value = source[key];
        if (value === "" || value === undefined) return [];
        return [{ key, label: generationFieldLabels[key] || key, text: typeof value === "boolean" ? (value ? "是" : "否") : String(value) }];
    });
}

function FantasticCanvasPreview({ code, title }: { code: string; title: string }) {
    const [snapshot, setSnapshot] = useState<SharedSnapshot | null>(null);
    const [error, setError] = useState(false);
    useEffect(() => {
        const controller = new AbortController();
        void getSharedWork(code, true, controller.signal)
            .then((detail) => setSnapshot(detail.snapshot))
            .catch(() => {
                if (!controller.signal.aborted) setError(true);
            });
        return () => controller.abort();
    }, [code]);
    if (!snapshot?.scene) return <div className="grid aspect-video w-full place-items-center text-sm text-[var(--studio-muted)]">{error ? "预览暂不可用" : "正在读取画布"}</div>;
    const document: CanvasDocument = {
        identity: { id: code, title, createdAt: "", updatedAt: "" },
        scene: snapshot.scene,
        preferences: snapshot.preferences || { background: "dots", showImageInformation: true },
        conversation: { sessions: [], activeSessionId: null },
    };
    return (
        <div className="flex size-full items-center">
            <CanvasProjectPreview document={document} />
        </div>
    );
}
