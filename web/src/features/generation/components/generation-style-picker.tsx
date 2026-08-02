"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Tooltip } from "antd";
import { ChevronDown, LoaderCircle, Palette, X } from "lucide-react";

import { listGenerationStyles, type GenerationStyleOption, type GenerationStyleType } from "@/services/api/server";

export type GenerationStyleSelection = GenerationStyleOption;

export function useGenerationStyles(generationType?: GenerationStyleType) {
    const [styles, setStyles] = useState<GenerationStyleOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        setLoading(true);
        setError(null);
        const types = generationType ? [generationType] : ["image", "video"] as const;
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
                <span key={style.id} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-xs">
                    <Palette className="size-3.5 shrink-0" />
                    <span className="max-w-40 truncate">{style.name}</span>
                    {onRemove ? <button type="button" className="grid size-4 place-items-center" onClick={() => onRemove(style.id)} aria-label={`移除风格${style.name}`}><X className="size-3" /></button> : null}
                </span>
            ))}
        </div>
    );
}

export function GenerationStyleMenu({ styles, selected, loading, error, open, onToggle, onSelect, grouped = false, query, onQueryChange }: {
    styles: GenerationStyleSelection[];
    selected: GenerationStyleSelection[];
    loading?: boolean;
    error?: string | null;
    open: boolean;
    onToggle: () => void;
    onSelect: (style: GenerationStyleSelection) => void;
    grouped?: boolean;
    query?: string;
    onQueryChange?: (query: string) => void;
}) {
    const [internalQuery, setInternalQuery] = useState("");
    const [highlighted, setHighlighted] = useState(0);
    const filtered = useMemo(() => {
        const normalized = (query ?? internalQuery).trim().toLowerCase();
        return styles.filter((style) => !normalized || style.name.toLowerCase().includes(normalized));
    }, [internalQuery, query, styles]);
    useEffect(() => setHighlighted((value) => Math.min(value, Math.max(0, filtered.length - 1))), [filtered.length]);

    return (
        <div className="relative">
            <Tooltip title="选择风格">
                <Button size="small" icon={<Palette className="size-3.5" />} onClick={onToggle} aria-expanded={open} aria-haspopup="listbox">风格<ChevronDown className="size-3" /></Button>
            </Tooltip>
            {open ? (
                <div className="absolute bottom-full left-0 z-50 mb-2 w-72 rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-2 shadow-[var(--studio-shadow)]" role="listbox">
                    <input autoFocus value={query ?? internalQuery} onChange={(event) => { setInternalQuery(event.target.value); onQueryChange?.(event.target.value); }} placeholder={grouped ? "搜索图片或视频风格" : "搜索风格"} className="mb-1 w-full rounded-lg border border-[var(--studio-line)] bg-transparent px-2 py-1.5 text-xs outline-none" onKeyDown={(event) => {
                        if (event.key === "ArrowDown") { event.preventDefault(); setHighlighted((value) => Math.min(value + 1, Math.max(0, filtered.length - 1))); }
                        if (event.key === "ArrowUp") { event.preventDefault(); setHighlighted((value) => Math.max(0, value - 1)); }
                        if (event.key === "Enter") { event.preventDefault(); if (filtered[highlighted]) onSelect(filtered[highlighted]); }
                        if (event.key === "Escape") { event.preventDefault(); onToggle(); }
                    }} />
                    {loading ? <div className="flex items-center gap-2 px-2 py-3 text-xs text-[var(--studio-muted)]"><LoaderCircle className="size-3.5 animate-spin" />加载风格...</div> : error ? <div className="px-2 py-3 text-xs text-[var(--studio-muted)]">{error}</div> : filtered.length ? (
                        <div className="max-h-56 overflow-auto">
                            {(grouped ? (["image", "video"] as const) : ["all"] as const).map((type) => {
                                const items = grouped ? filtered.filter((style) => style.generationType === type) : filtered;
                                if (!items.length) return null;
                                return <div key={grouped ? type : "all"}>{grouped ? <div className="px-2 pb-1 pt-2 text-[11px] text-[var(--studio-muted)]">{type === "image" ? "图片风格" : "视频风格"}</div> : null}{items.map((style) => {
                                    const index = filtered.indexOf(style);
                                    const isSelected = selected.some((item) => item.id === style.id);
                                    return <button type="button" key={style.id} className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm ${index === highlighted ? "bg-[var(--studio-primary-soft)]" : "hover:bg-[var(--studio-primary-soft)]"}`} onMouseEnter={() => setHighlighted(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => onSelect(style)}><span className="truncate">{style.name}</span>{isSelected ? <span className="text-[11px] text-[var(--studio-muted)]">已选</span> : null}</button>;
                                })}</div>;
                            })}
                        </div>
                    ) : <div className="px-2 py-3 text-xs text-[var(--studio-muted)]">暂无匹配风格</div>}
                </div>
            ) : null}
        </div>
    );
}
