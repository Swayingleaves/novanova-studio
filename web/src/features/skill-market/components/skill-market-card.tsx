"use client";

import type { ReactNode } from "react";
import { Heart } from "lucide-react";

import { useTranslation } from "@/features/locale/use-translation";
import { cn } from "@/shared/lib/utils";
import type { SkillMarketCard } from "@/services/api/server";

type SkillMarketCardViewProps = {
    item: SkillMarketCard;
    onOpen: () => void;
    onFavorite?: () => void;
    status?: ReactNode;
    extra?: ReactNode;
};

export function SkillMarketCardView({ item, onOpen, onFavorite, status, extra }: SkillMarketCardViewProps) {
    const translate = useTranslation();
    const author = item.official || !item.authorName ? translate("skillMarket.official") : item.authorName;
    const summary = item.subtitle || item.description;
    return (
        <article className="studio-panel-solid flex flex-col overflow-hidden">
            <button type="button" className="block text-left" onClick={onOpen}>
                {item.coverUrl ? (
                    <img src={item.coverUrl} alt="" className="aspect-[4/3] w-full object-cover" />
                ) : (
                    <div className="studio-empty flex aspect-[4/3] items-center justify-center px-4 text-center text-sm">{item.name}</div>
                )}
                <div className="p-4">
                    <div className="flex items-start justify-between gap-2">
                        <h2 className="studio-title line-clamp-1 text-sm font-semibold">{item.name}</h2>
                        {status}
                    </div>
                    {summary ? <p className="studio-subtitle mt-2 line-clamp-2 text-xs leading-5">{summary}</p> : null}
                </div>
            </button>
            <footer className="mt-auto flex items-center justify-between gap-2 px-4 pb-4">
                <span className="studio-caption truncate text-xs">{author}</span>
                {onFavorite ? (
                    <button
                        type="button"
                        className="inline-flex size-8 items-center justify-center rounded-md text-[var(--studio-muted)] hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]"
                        aria-label={item.favorited ? translate("skillMarket.unfavorite") : translate("skillMarket.favorite")}
                        onClick={onFavorite}
                    >
                        <Heart className={cn("size-4", item.favorited && "fill-[var(--studio-action)] text-[var(--studio-action)]")} />
                    </button>
                ) : null}
            </footer>
            {extra ? <div className="flex flex-wrap gap-2 px-4 pb-4">{extra}</div> : null}
        </article>
    );
}
