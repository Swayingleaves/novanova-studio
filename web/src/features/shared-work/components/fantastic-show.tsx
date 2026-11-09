"use client";
import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Empty, Input, Modal, Pagination, Tag } from "antd";
import { Heart, Play, Search } from "lucide-react";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { FANTASTIC_SHOW_CATEGORIES } from "@/features/homepage/lib/fantastic-show";
import { CanvasProjectPreview } from "@/features/canvas/components/canvas-project-preview";
import type { CanvasDocument } from "@/features/canvas/types";
import { SharedCanvasViewer } from "@/features/shared-work/components/shared-content";
import { getSharedWork, listFantasticWorks, sharedWorkTypeNames, toggleFantasticLike, type FantasticWork, type SharedSnapshot, type SharedWorkDetail } from "@/services/api/shared-work";

/** 首页官方作品与用户作品统一由服务端筛选、排序和分页。 */
export function FantasticShow() {
    const { message } = App.useApp();
    const [type, setType] = useState("");
    const [category, setCategory] = useState("");
    const [keyword, setKeyword] = useState("");
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [items, setItems] = useState<FantasticWork[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [revision, setRevision] = useState(0);
    const [liking, setLiking] = useState<string[]>([]);
    const lastLoadedAt = useRef(0);
    useEffect(() => {
        const timer = setTimeout(() => {
            setSearch(keyword.trim());
            setPage(1);
        }, 300);
        return () => clearTimeout(timer);
    }, [keyword]);
    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError("");
        lastLoadedAt.current = Date.now();
        void listFantasticWorks(type, category, search, page, controller.signal)
            .then((result) => {
                if (!controller.signal.aborted) {
                    setItems(result.items);
                    setTotal(result.total);
                }
            })
            .catch((failure) => {
                if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "作品暂不可用");
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, [type, category, search, page, revision]);
    // 作品墙的媒体是临时地址，长时间停留或回到前台时低频重新拉取一次。
    useEffect(() => {
        const refreshIfStale = () => {
            if (document.visibilityState === "visible" && Date.now() - lastLoadedAt.current > 15 * 60_000) setRevision((value) => value + 1);
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
            {error ? (
                <Alert className="mt-4" type="error" showIcon title={error} action={<Button onClick={() => setRevision((value) => value + 1)}>重试</Button>} />
            ) : loading ? (
                <div className={workWallClassName}>
                    {["3/4", "16/9", "9/16", "1/1", "4/5", "16/10", "3/4", "9/16"].map((ratio, index) => (
                        <div key={index} className="studio-skeleton mb-3 break-inside-avoid rounded-xl" style={{ aspectRatio: ratio }} />
                    ))}
                </div>
            ) : items.length ? (
                <div className={workWallClassName}>
                    {items.map((item) => (
                        <FantasticCard key={`${item.source}:${item.id}`} item={item} pending={liking.includes(item.id)} onToggleLike={() => toggleLike(item)} />
                    ))}
                </div>
            ) : (
                <div className="py-10">
                    <Empty description="暂无符合条件的作品" />
                </div>
            )}
            {total > 8 ? <Pagination className="mt-6" current={page} pageSize={8} total={total} showSizeChanger={false} onChange={setPage} align="center" /> : null}
        </section>
    );
}

const workWallClassName = "mt-4 columns-2 gap-3 sm:columns-3 xl:columns-5";

function FilterText({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
    return (
        <button type="button" aria-pressed={active} className={`text-sm transition ${active ? "font-medium text-[var(--studio-ink)]" : "text-[var(--studio-muted)] hover:text-[var(--studio-ink)]"}`} onClick={onClick}>
            {children}
        </button>
    );
}

function FantasticCard({ item, pending, onToggleLike }: { item: FantasticWork; pending: boolean; onToggleLike: () => void }) {
    const isVideo = item.workType === "video";
    const isCanvas = item.workType === "canvas";
    const [previewing, setPreviewing] = useState(false);
    const [ratio, setRatio] = useState<number | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const openPreview = () => setPreviewing(true);
    const playVideo = () => {
        const video = videoRef.current;
        if (!video || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        void video.play().catch(() => undefined);
    };
    const stopVideo = () => {
        const video = videoRef.current;
        if (!video) return;
        video.pause();
        video.currentTime = 0;
    };
    const rememberRatio = (width: number, height: number) => {
        if (width > 0 && height > 0) setRatio(width / height);
    };
    return (
        <>
            <article
                className="mb-3 min-w-0 cursor-pointer break-inside-avoid rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--studio-action)]"
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
                    onMouseEnter={isVideo ? playVideo : undefined}
                    onMouseLeave={isVideo ? stopVideo : undefined}
                >
                    {isCanvas ? (
                        <FantasticCanvasPreview code={item.shareCode} title={item.title} />
                    ) : isVideo ? (
                        <video ref={videoRef} src={item.mediaUrl} poster={item.thumbnailUrl || undefined} muted loop playsInline preload="metadata" className="pointer-events-none size-full object-cover" onLoadedMetadata={(event) => rememberRatio(event.currentTarget.videoWidth, event.currentTarget.videoHeight)} />
                    ) : (
                        <img
                            src={item.mediaUrl}
                            alt=""
                            loading="lazy"
                            className="size-full object-cover transition-transform group-hover:scale-[1.025] motion-reduce:transform-none"
                            ref={(node) => {
                                if (node?.complete) rememberRatio(node.naturalWidth, node.naturalHeight);
                            }}
                            onLoad={(event) => rememberRatio(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
                        />
                    )}
                    {isVideo ? (
                        <span className="pointer-events-none absolute inset-0 grid place-items-center transition group-hover:opacity-0 motion-reduce:transition-none">
                            <span className="grid size-12 place-items-center rounded-full border border-white/35 bg-black/55 text-white backdrop-blur-sm">
                                <Play className="size-5 fill-current" aria-hidden="true" />
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
                        className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-full border border-white/25 bg-black/45 px-2 py-1 text-[11px] font-medium tabular-nums text-white backdrop-blur-sm transition hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-progress"
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
            <Modal open={previewing} onCancel={() => setPreviewing(false)} footer={null} width={1080} centered destroyOnHidden mask={{ closable: true }} title={item.title} styles={{ body: { maxHeight: "calc(100dvh - 140px)", overflowY: "auto" } }}>
                {previewing ? <FantasticPreview item={item} pending={pending} onToggleLike={onToggleLike} /> : null}
            </Modal>
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

function FantasticPreview({ item, pending, onToggleLike }: { item: FantasticWork; pending: boolean; onToggleLike: () => void }) {
    const needsDetail = item.source === "user" && Boolean(item.shareCode);
    const [detail, setDetail] = useState<SharedWorkDetail | null>(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(needsDetail);
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
    return (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(260px,340px)]">
            <FantasticPreviewMedia item={item} snapshot={detail?.snapshot ?? null} loading={loading} />
            <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                    <Tag>{sharedWorkTypeNames[item.workType]}</Tag>
                    {item.category ? <Tag>{item.category}</Tag> : null}
                    <button
                        type="button"
                        aria-pressed={item.liked}
                        aria-label={item.liked ? "取消点赞" : "点赞"}
                        title={item.liked ? "取消点赞" : "点赞"}
                        disabled={pending}
                        className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-[var(--studio-line-strong)] px-3 py-1 text-xs font-medium tabular-nums text-[var(--studio-ink)] transition hover:border-[var(--studio-action)] hover:text-[var(--studio-action)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--studio-action)] disabled:cursor-progress"
                        onClick={onToggleLike}
                    >
                        <Heart className={item.liked ? "size-4 fill-rose-400 text-rose-400" : "size-4"} strokeWidth={1.8} aria-hidden="true" />
                        {item.likeCount}
                    </button>
                </div>
                <PreviewField label="标题" value={item.title} />
                <PreviewField label={item.source === "user" ? "分享人" : "作者"} value={item.creatorName} />
                {item.description ? <PreviewField label="简介" value={item.description} /> : null}
                {loading ? <p className="text-sm text-[var(--studio-muted)]">正在读取提示词和作品信息</p> : null}
                {error ? <Alert type="warning" showIcon title={error} /> : null}
                {entries.map((entry) => (
                    <PreviewField key={entry.key} label={entry.label} value={entry.text} />
                ))}
            </div>
        </div>
    );
}

function FantasticPreviewMedia({ item, snapshot, loading }: { item: FantasticWork; snapshot: SharedSnapshot | null; loading: boolean }) {
    if (item.workType === "canvas") {
        if (snapshot?.scene) return <SharedCanvasViewer snapshot={snapshot} />;
        return <div className="grid min-h-80 place-items-center rounded-lg bg-[var(--studio-media)] text-sm text-[var(--studio-muted)]">{loading ? "正在读取画布" : "预览暂不可用"}</div>;
    }
    if (!item.mediaUrl) return <div className="grid min-h-48 place-items-center rounded-lg bg-[var(--studio-media)] text-sm text-[var(--studio-muted)]">暂无媒体</div>;
    if (item.workType === "video") return <video src={item.mediaUrl} poster={item.thumbnailUrl || undefined} controls autoPlay playsInline className="max-h-[70vh] w-full rounded-lg bg-black object-contain" />;
    return <img src={item.mediaUrl} alt={item.title} className="max-h-[70vh] w-full rounded-lg bg-[var(--studio-media)] object-contain" />;
}

function PreviewField({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <div className="text-xs text-[var(--studio-muted)]">{label}</div>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{value}</p>
        </div>
    );
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
