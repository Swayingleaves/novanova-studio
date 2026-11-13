"use client";

import { useTranslation } from "@/features/locale/use-translation";
import Link, { usePathname } from "@/shared/lib/team-navigation";
import { cn } from "@/shared/lib/utils";

/** 放在页面说明文字下方，切换市场列表和我的技能。 */
export function SkillMarketSectionNav() {
    const translate = useTranslation();
    const pathname = usePathname();
    const mine = pathname.startsWith("/skill-market/mine");
    const itemClass = (active: boolean) => cn(
        "inline-flex items-center border-b-2 pb-1.5 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--studio-action)]",
        active ? "border-[var(--studio-ink)] font-medium text-[var(--studio-ink)]" : "border-transparent text-[var(--studio-muted)] hover:text-[var(--studio-text)]",
    );

    return (
        <nav className="mt-3 flex items-center gap-6" aria-label={translate("common.skillMarket")}>
            <Link href="/skill-market" className={itemClass(pathname === "/skill-market")} aria-current={pathname === "/skill-market" ? "page" : undefined}>
                {translate("common.skillMarket")}
            </Link>
            <Link href="/skill-market/mine" className={itemClass(mine)} aria-current={mine ? "page" : undefined}>
                {translate("skillMarket.mine")}
            </Link>
        </nav>
    );
}
