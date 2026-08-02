"use client";

import { Avatar, Drawer } from "antd";
import { ShoppingCart, Ticket, Zap } from "lucide-react";
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
                {user ? (
                    <div className="border-b border-[var(--studio-line)] pb-5">
                        <Link href="/profile" onClick={onClose} className="flex items-center gap-3 px-1 text-[var(--studio-ink)]">
                            <Avatar size={40} src={user.avatarUrl || undefined}>
                                {(user.displayName || user.email || "?").charAt(0).toUpperCase()}
                            </Avatar>
                            <span className="min-w-0">
                                <span className="block truncate text-sm font-medium">{user.displayName}</span>
                                <span className="mt-0.5 block truncate text-xs text-[var(--studio-muted)]">个人信息</span>
                            </span>
                        </Link>
                        <Link href="/credits" onClick={onClose} className="mt-4 flex items-center justify-between border-t border-[var(--studio-line)] px-1 pt-4 text-sm text-[var(--studio-text)]">
                            <span className="inline-flex items-center gap-2"><Zap className="size-4 fill-current text-[var(--studio-primary)]" />积分</span>
                            <span className="tabular-nums text-[var(--studio-ink)]">{user.creditBalance.toLocaleString("zh-CN")}</span>
                        </Link>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                            <Link href="/credits/purchase" onClick={onClose} className="flex items-center justify-center gap-2 rounded-md border border-[var(--studio-line)] px-3 py-2.5 text-sm text-[var(--studio-muted)] transition hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]">
                                <ShoppingCart className="size-4" />购买
                            </Link>
                            <Link href="/credits/redeem" onClick={onClose} className="flex items-center justify-center gap-2 rounded-md border border-[var(--studio-line)] px-3 py-2.5 text-sm text-[var(--studio-muted)] transition hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]">
                                <Ticket className="size-4" />兑换
                            </Link>
                        </div>
                    </div>
                ) : null}
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
