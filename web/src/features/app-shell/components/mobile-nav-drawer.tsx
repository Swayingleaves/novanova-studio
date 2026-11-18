"use client";
import { useTranslation } from "@/features/locale/use-translation";


import { Drawer } from "antd";
import Link from "@/shared/lib/team-navigation";

import { LanguageMenu } from "@/features/locale/components/language-menu";
import { ThemePreferenceMenu } from "@/features/theme/components/theme-preference-menu";
import { navigationTools, type NavigationTool, type NavigationToolSlug } from "@/shared/constants/navigation-tools";
import { resolveVisibleNavigationTools } from "@/features/navigation-menu/lib/navigation-menu-config";
import { useNavigationMenuStore } from "@/features/navigation-menu/stores/use-navigation-menu-store";
import { cn } from "@/shared/lib/utils";
import { canManageCurrentSpace, useTeamStore } from "@/features/team/stores/use-team-store";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { useEffect } from "react";

type MobileNavDrawerProps = {
    open: boolean;
    activeToolSlug?: NavigationToolSlug;
    onClose: () => void;
};

export function MobileNavDrawer({ open, activeToolSlug, onClose }: MobileNavDrawerProps) {
    const translate = useTranslation();
    const user = useUserStore((state) => state.user);
    const team = useTeamStore((state) => state.team);
    const menuConfigs = useNavigationMenuStore((state) => state.configs);
    const menuLoaded = useNavigationMenuStore((state) => state.loaded);
    const visibleNavigationTools = resolveVisibleNavigationTools(menuConfigs, canManageCurrentSpace());
    const regularTools = visibleNavigationTools.filter((tool) => !tool.adminOnly);
    const adminTools = visibleNavigationTools.filter((tool) => Boolean(tool.adminOnly));

    useEffect(() => {
        if (open) void useNavigationMenuStore.getState().refresh();
    }, [open]);

    const renderToolCard = (tool: NavigationTool) => {
        const Icon = tool.icon;
        const active = tool.slug === activeToolSlug;
        return (
            <Link
                key={tool.slug}
                href={`/${tool.slug}`}
                onClick={onClose}
                className={cn(
                    "relative flex min-h-20 flex-col justify-between rounded-lg border p-3 transition",
                    active
                        ? "border-[var(--studio-primary-line)] bg-[var(--studio-primary-soft)] font-medium text-[var(--studio-ink)]"
                        : "border-[var(--studio-line)] bg-[var(--studio-surface-soft)] text-[var(--studio-muted)] hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]",
                )}
            >
                <Icon className="size-5" />
                <span className="text-sm">{translate(tool.labelKey)}</span>
                {tool.isNew ? <span className="new-badge right-2 top-2" title={translate("common.newFeature")}>NEW</span> : null}
            </Link>
        );
    };

    return (
        <Drawer title={translate("appShell.navigation")} placement="left" size={292} open={open} onClose={onClose} className="md:hidden">
            <div className="space-y-5">
                {menuLoaded && regularTools.length ? (
                    <section>
                        <div className="grid grid-cols-2 gap-2">
                            {regularTools.map(renderToolCard)}
                        </div>
                    </section>
                ) : null}
                {menuLoaded && adminTools.length ? (
                    <section>
                        <div className="mb-2 px-1 text-xs font-medium text-[var(--studio-faint)]">{translate("common.settings")}</div>
                        <div className="grid grid-cols-2 gap-2">
                            {adminTools.map(renderToolCard)}
                        </div>
                    </section>
                ) : null}
                <section className="border-t border-[var(--studio-line)] pt-5">
                    <div className="mb-2 px-1 text-xs font-medium text-[var(--studio-faint)]">{translate("appShell.theme")}</div>
                    <LanguageMenu />
                    <ThemePreferenceMenu variant="drawer" onAfterSelect={onClose} />
                </section>
            </div>
        </Drawer>
    );
}
