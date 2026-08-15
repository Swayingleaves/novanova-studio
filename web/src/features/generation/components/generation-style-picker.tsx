"use client";

import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button, Input, Popover, Skeleton, Tooltip } from "antd";
import { Check, ChevronDown, ImageOff, Palette, Search, X } from "lucide-react";

import { listGenerationStyles, type GenerationStyleOption, type GenerationStyleType } from "@/services/api/server";
import { ALL_GENERATION_STYLE_CATEGORY, collectGenerationStyleCategories, filterGenerationStyles, isGenerationStyleSelected, MAX_GENERATION_STYLE_SELECTION_COUNT, usesGenerationStyleDefaultCover } from "@/features/generation/lib/generation-style-library";

export type GenerationStyleSelection = GenerationStyleOption;

type GenerationStyleMenuProps = {
    styles: GenerationStyleSelection[];
    selected: GenerationStyleSelection[];
    loading?: boolean;
    error?: string | null;
    open: boolean;
    onOpenChange?: (open: boolean) => void;
    onSelect: (style: GenerationStyleSelection) => void;
    onSelectionLimit?: () => void;
    query?: string;
    onQueryChange?: (query: string) => void;
    highlightedIndex?: number;
    onHighlightedIndexChange?: (index: number) => void;
    grouped?: boolean;
    placement?: "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";
};

export function useGenerationStyles(generationType?: GenerationStyleType) {
    const [styles, setStyles] = useState<GenerationStyleOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        setLoading(true);
        setError(null);
        const types = generationType ? [generationType] : (["image", "video"] as const);
        Promise.all(types.map((type) => listGenerationStyles(type)))
            .then((responses) => {
                if (!active) return;
                setStyles(responses.flatMap((response) => response.styles || []));
            })
            .catch((reason) => {
                if (!active) return;
                setStyles([]);
                setError(reason instanceof Error ? reason.message : "风格加载失败");
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [generationType]);

    return { styles, loading, error };
}

export function GenerationStyleChips({ styles, onRemove, className = "" }: { styles: GenerationStyleSelection[]; onRemove?: (id: number) => void; className?: string }) {
    if (!styles.length) return null;
    return (
        <div className={`flex flex-wrap gap-2 ${className}`}>
            {styles.map((style) => (
                <span key={style.id} className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-[var(--studio-line)] bg-[var(--studio-surface-raised)] px-2 py-1 text-xs text-[var(--studio-text)]">
                    <GenerationStyleCover style={style} className="size-5 shrink-0 overflow-hidden rounded-sm" />
                    <span className="max-w-40 truncate">{style.name}</span>
                    {onRemove ? (
                        <button
                            type="button"
                            className="grid size-4 place-items-center rounded-sm text-[var(--studio-muted)] hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]"
                            onClick={() => onRemove(style.id)}
                            aria-label={`移除风格${style.name}`}
                        >
                            <X className="size-3" />
                        </button>
                    ) : null}
                </span>
            ))}
        </div>
    );
}

/** 运营预置风格库的统一锚点浮层。 */
export function GenerationStyleMenu({
    styles,
    selected,
    loading = false,
    error,
    open,
    onOpenChange,
    onSelect,
    onSelectionLimit,
    query,
    onQueryChange,
    highlightedIndex = 0,
    onHighlightedIndexChange,
    grouped = false,
    placement = "topLeft",
}: GenerationStyleMenuProps) {
    const [internalQuery, setInternalQuery] = useState("");
    const [category, setCategory] = useState(ALL_GENERATION_STYLE_CATEGORY);
    const effectiveQuery = query ?? internalQuery;
    const categories = useMemo(() => collectGenerationStyleCategories(styles), [styles]);
    const filtered = useMemo(() => filterGenerationStyles(styles, effectiveQuery, category), [category, effectiveQuery, styles]);

    useEffect(() => {
        if (!open) {
            setCategory(ALL_GENERATION_STYLE_CATEGORY);
            setInternalQuery("");
        }
    }, [open]);

    useEffect(() => {
        onHighlightedIndexChange?.(Math.min(highlightedIndex, Math.max(0, filtered.length - 1)));
    }, [filtered.length, highlightedIndex, onHighlightedIndexChange]);

    const updateQuery = (value: string) => {
        setInternalQuery(value);
        onQueryChange?.(value);
        onHighlightedIndexChange?.(0);
    };
    const close = () => {
        setCategory(ALL_GENERATION_STYLE_CATEGORY);
        setInternalQuery("");
        onQueryChange?.("");
        onHighlightedIndexChange?.(0);
        onOpenChange?.(false);
    };
    const handleOpenChange = (nextOpen: boolean) => {
        if (!nextOpen) {
            close();
            return;
        }
        onOpenChange?.(true);
    };
    const selectHighlighted = () => {
        const style = filtered[highlightedIndex];
        if (style) selectStyle(style);
    };
    const selectStyle = (style: GenerationStyleSelection) => {
        if (isGenerationStyleSelected(style.id, selected)) return;
        if (selected.length >= MAX_GENERATION_STYLE_SELECTION_COUNT) {
            onSelectionLimit?.();
            return;
        }
        onSelect(style);
    };
    const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            onHighlightedIndexChange?.(Math.min(highlightedIndex + 1, Math.max(0, filtered.length - 1)));
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            onHighlightedIndexChange?.(Math.max(highlightedIndex - 1, 0));
        } else if (event.key === "Enter") {
            event.preventDefault();
            selectHighlighted();
        } else if (event.key === "Escape") {
            event.preventDefault();
            close();
        }
    };

    const content = (
        <div
            className="w-[min(34rem,calc(100vw-24px))] p-1"
            role="dialog"
            aria-label="风格库"
            onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                close();
            }}
        >
            <div className="flex items-center justify-between gap-3 px-2 pb-2 pt-1">
                <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[var(--studio-ink)]">
                    <Palette className="size-4 shrink-0 text-[var(--studio-action)]" />
                    <span>风格库</span>
                </div>
                <span className="text-xs text-[var(--studio-muted)]">最多 {MAX_GENERATION_STYLE_SELECTION_COUNT} 个</span>
            </div>
            <Input
                value={effectiveQuery}
                prefix={<Search className="size-3.5 text-[var(--studio-muted)]" />}
                placeholder={grouped ? "搜索图片或视频风格" : "搜索风格名、分类"}
                className="mb-2"
                autoFocus
                onChange={(event) => updateQuery(event.target.value)}
                onKeyDown={handleSearchKeyDown}
            />
            <div className="thin-scrollbar mb-3 flex gap-1 overflow-x-auto px-0.5 pb-1">
                <CategoryButton
                    active={category === ALL_GENERATION_STYLE_CATEGORY}
                    onClick={() => {
                        setCategory(ALL_GENERATION_STYLE_CATEGORY);
                        onHighlightedIndexChange?.(0);
                    }}
                >
                    全部
                </CategoryButton>
                {categories.map((item) => (
                    <CategoryButton
                        key={item}
                        active={category === item}
                        onClick={() => {
                            setCategory(item);
                            onHighlightedIndexChange?.(0);
                        }}
                    >
                        {item}
                    </CategoryButton>
                ))}
            </div>
            {loading ? (
                <StyleLibrarySkeleton />
            ) : error ? (
                <StyleLibraryState icon={<ImageOff className="size-5" />} text={error} />
            ) : filtered.length ? (
                <div className="thin-scrollbar grid max-h-[min(30rem,calc(100vh-190px))] grid-cols-3 gap-2 overflow-y-auto pr-1 min-[400px]:grid-cols-4 min-[520px]:grid-cols-5" role="listbox" aria-label="风格列表">
                    {filtered.map((style, index) => {
                        const isSelected = isGenerationStyleSelected(style.id, selected);
                        return (
                            <button
                                type="button"
                                key={style.id}
                                role="option"
                                aria-selected={isSelected}
                                aria-label={`${style.name}，${style.generationType === "video" ? "视频" : "图片"}风格${isSelected ? "，已选择" : ""}`}
                                className={`group relative min-w-0 overflow-hidden rounded-md border text-left transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-action)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--studio-surface)] ${isSelected ? "border-[var(--studio-action)] bg-[var(--studio-primary-soft)]" : index === highlightedIndex ? "border-[var(--studio-line-strong)] bg-[var(--studio-surface-hover)]" : "border-[var(--studio-line)] bg-[var(--studio-surface)] hover:border-[var(--studio-line-strong)] hover:bg-[var(--studio-surface-hover)]"}`}
                                onMouseEnter={() => onHighlightedIndexChange?.(index)}
                                onClick={() => selectStyle(style)}
                            >
                                <GenerationStyleCover style={style} className="aspect-[3/4] w-full" />
                                <span className="absolute inset-x-0 bottom-0 h-16 bg-[linear-gradient(to_top,var(--studio-surface),transparent)]" aria-hidden="true" />
                                <span className="absolute inset-x-0 bottom-0 p-2">
                                    <span className="min-w-0 truncate text-xs font-medium text-[var(--studio-ink)]">{style.name}</span>
                                </span>
                                {isSelected ? (
                                    <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-[var(--studio-action)] text-[var(--studio-action-foreground)]">
                                        <Check className="size-3.5" strokeWidth={2.5} />
                                    </span>
                                ) : null}
                            </button>
                        );
                    })}
                </div>
            ) : (
                <StyleLibraryState icon={<Search className="size-5" />} text="暂无匹配风格" />
            )}
        </div>
    );

    return (
        <Popover
            open={open}
            trigger="click"
            placement={placement}
            arrow={false}
            autoAdjustOverflow
            getPopupContainer={() => document.body}
            destroyOnHidden
            content={content}
            onOpenChange={handleOpenChange}
            styles={{
                root: { filter: "none" },
                container: { padding: 8, background: "var(--studio-surface)", border: "1px solid var(--studio-line)", borderRadius: 8, boxShadow: "var(--studio-shadow)" },
            }}
        >
            <span className="inline-flex">
                <Tooltip title="选择风格">
                    <Button size="small" className="creation-composer-action" icon={<Palette className="size-3.5" />} aria-expanded={open} aria-haspopup="dialog">
                        风格
                        <ChevronDown className="ml-0.5 size-3" />
                    </Button>
                </Tooltip>
            </span>
        </Popover>
    );
}

/** 风格封面，空地址和加载失败时使用统一中性默认图。 */
export function GenerationStyleCover({ style, className = "" }: { style: Pick<GenerationStyleSelection, "coverUrl" | "name">; className?: string }) {
    const [failed, setFailed] = useState(false);
    useEffect(() => setFailed(false), [style.coverUrl]);
    const useDefaultCover = failed || usesGenerationStyleDefaultCover(style);
    if (useDefaultCover) {
        return (
            <span className={`grid place-items-center bg-[var(--studio-surface-raised)] text-[var(--studio-muted)] ${className}`}>
                <ImageOff className="size-5" />
                <span className="sr-only">{style.name}默认封面</span>
            </span>
        );
    }
    return <img src={style.coverUrl} alt="" width={3} height={4} loading="lazy" decoding="async" className={`block object-cover ${className}`} onError={() => setFailed(true)} />;
}

function CategoryButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
    return (
        <button
            type="button"
            className={`shrink-0 rounded-md border px-2 py-1 text-xs transition ${active ? "border-[var(--studio-action)] bg-[var(--studio-primary-soft)] text-[var(--studio-ink)]" : "border-[var(--studio-line)] text-[var(--studio-muted)] hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-text)]"}`}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function StyleLibrarySkeleton() {
    return (
        <div className="grid grid-cols-3 gap-2 min-[400px]:grid-cols-4 min-[520px]:grid-cols-5">
            {Array.from({ length: 8 }, (_, index) => (
                <Skeleton.Image key={index} active className="!h-auto !w-full [&_.ant-skeleton-image]:aspect-[3/4] [&_.ant-skeleton-image]:h-auto [&_.ant-skeleton-image]:w-full" />
            ))}
        </div>
    );
}

function StyleLibraryState({ icon, text }: { icon: ReactNode; text: string }) {
    return (
        <div className="flex min-h-44 flex-col items-center justify-center gap-2 text-xs text-[var(--studio-muted)]">
            {icon}
            <span>{text}</span>
        </div>
    );
}
