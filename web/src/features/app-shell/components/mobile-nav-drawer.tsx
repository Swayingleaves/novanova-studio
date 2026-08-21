"use client";

import { Drawer } from "antd";
import Link from "next/link";

import { ThemePreferenceMenu } from "@/features/theme/components/theme-preference-menu";
import { NAV_GROUPS, navigationTools, type NavigationToolSlug } from "@/shared/constants/navigation-tools";
import { cn } from "@/shared/lib/utils";
import { useUserStore } from "@/features/auth/stores/use-user-store";

type MobileNavDrawerProps = {
    open: boolean;
    activeToolSlug?: NavigationToolSlug;
    onClose: () => void;
};

export function MobileNavDrawer({ open, activeToolSlug, onClose }: MobileNavDrawerProps) {
    const user = useUserStore((state) => state.user);
    const visibleNavigationTools = navigationTools.filter((tool) => !tool.adminOnly || user?.role === "admin");

    return (
        <Drawer title="创作导航" placement="left" size={292} open={open} onClose={onClose} className="md:hidden">
            <div className="space-y-5">
                {NAV_GROUPS.map((group) => {
                    const tools = visibleNavigationTools.filter((tool) => tool.group === group.key);
                    if (!tools.length) return null;
                    return (
                        <section key={group.key}>
                            <div className="mb-2 px-1 text-xs font-medium text-[var(--studio-faint)]">{group.label}</div>
                            <div className="grid grid-cols-2 gap-2">
                                {tools.map((tool) => {
                                    const Icon = tool.icon;
                                    const active = tool.slug === activeToolSlug;
                                    return (
                                        <Link
                                            key={tool.slug}
                                            href={`/${tool.slug}`}
                                            onClick={onClose}
                                            className={cn(
                                                "flex min-h-20 flex-col justify-between rounded-lg border p-3 transition",
                                                active
                                                    ? "border-[var(--studio-primary-line)] bg-[var(--studio-primary-soft)] font-medium text-[var(--studio-ink)]"
                                                    : "border-[var(--studio-line)] bg-[var(--studio-surface-soft)] text-[var(--studio-muted)] hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]",
                                            )}
                                        >
                                            <Icon className="size-5" />
                                            <span className="text-sm">{tool.label}</span>
                                        </Link>
                                    );
                                })}
                            </div>
                        </section>
                    );
                })}
                <section className="border-t border-[var(--studio-line)] pt-5">
                    <div className="mb-2 px-1 text-xs font-medium text-[var(--studio-faint)]">界面主题</div>
                    <ThemePreferenceMenu variant="drawer" onAfterSelect={onClose} />
                </section>
            </div>
        </Drawer>
    );
}
