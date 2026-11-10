"use client";

import { useCallback, useEffect, useState } from "react";
import { App, Empty, Input, Pagination, Spin } from "antd";

import { SkillMarketCardView } from "@/features/skill-market/components/skill-market-card";
import { SkillMarketSectionNav } from "@/features/skill-market/components/skill-market-section-nav";
import { useTranslation } from "@/features/locale/use-translation";
import { useRouter } from "@/shared/lib/team-navigation";
import { cn } from "@/shared/lib/utils";
import { favoriteSkill, listMarketSkills, unfavoriteSkill, type SkillMarketCard } from "@/services/api/server";

const categories = ["all", "image", "video", "ecommerce", "portrait", "viralReplica"] as const;

export default function SkillMarketPage() {
    const translate = useTranslation();
    const router = useRouter();
    const { message } = App.useApp();
    const [category, setCategory] = useState<(typeof categories)[number]>("all");
    const [keyword, setKeyword] = useState("");
    const [query, setQuery] = useState("");
    const [page, setPage] = useState(1);
    const [skills, setSkills] = useState<SkillMarketCard[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setQuery(keyword.trim());
            setPage(1);
        }, 300);
        return () => window.clearTimeout(timer);
    }, [keyword]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const result = await listMarketSkills({
                category: category === "all" ? undefined : category,
                keyword: query || undefined,
                page,
                pageSize: 12,
            });
            setSkills(result.skills);
            setTotal(result.total);
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("skillMarket.loadFailed"));
        } finally {
            setLoading(false);
        }
    }, [category, message, page, query, translate]);

    useEffect(() => {
        void load();
    }, [load]);

    const toggleFavorite = async (item: SkillMarketCard) => {
        try {
            if (item.favorited) {
                await unfavoriteSkill(item.id);
                message.success(translate("skillMarket.unfavoritedSuccess"));
            } else {
                await favoriteSkill(item.id);
                message.success(translate("skillMarket.favoritedSuccess"));
            }
            setSkills((current) => current.map((skill) => (skill.id === item.id ? { ...skill, favorited: !skill.favorited } : skill)));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("skillMarket.loadFailed"));
        }
    };

    return (
        <main className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6 sm:px-6">
            <header>
                <h1 className="studio-title text-2xl font-semibold">{translate("common.skillMarket")}</h1>
                <p className="studio-subtitle mt-2 text-sm">{translate("skillMarket.marketHint")}</p>
                <SkillMarketSectionNav />
            </header>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap gap-2">
                    {categories.map((item) => (
                        <button
                            key={item}
                            type="button"
                            className={cn("rounded-full border px-3 py-1 text-sm", category === item ? "border-[var(--studio-action)] bg-[var(--studio-action)] text-[var(--studio-action-foreground)]" : "border-[var(--studio-line)] bg-[var(--studio-surface)] text-[var(--studio-muted)] hover:text-[var(--studio-ink)]")}
                            onClick={() => {
                                setCategory(item);
                                setPage(1);
                            }}
                        >
                            {translate(`skillMarket.${item}`)}
                        </button>
                    ))}
                </div>
                <Input.Search value={keyword} allowClear placeholder={translate("skillMarket.searchPlaceholder")} className="w-full lg:max-w-xs" onChange={(event) => setKeyword(event.target.value)} />
            </div>
            {loading ? <div className="flex h-60 items-center justify-center"><Spin /></div> : null}
            {!loading && skills.length ? (
                <section className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {skills.map((skill) => (
                        <SkillMarketCardView key={skill.id} item={skill} onOpen={() => router.push(`/skill-market/${skill.id}`)} onFavorite={() => void toggleFavorite(skill)} />
                    ))}
                </section>
            ) : null}
            {!loading && !skills.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={translate("skillMarket.empty")} className="py-16" /> : null}
            {total > 12 ? <Pagination current={page} pageSize={12} total={total} showSizeChanger={false} onChange={setPage} className="self-center" /> : null}
        </main>
    );
}
