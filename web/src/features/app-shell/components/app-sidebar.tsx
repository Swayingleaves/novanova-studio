"use client";
import { useTranslation } from "@/features/locale/use-translation";


import { useEffect, useState } from "react";
import { Bell, Cog } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Popover, Tooltip } from "antd";

import { LanguageMenu } from "@/features/locale/components/language-menu";
import { ThemePreferenceMenu } from "@/features/theme/components/theme-preference-menu";
import { navigationTools, type NavigationToolSlug } from "@/shared/constants/navigation-tools";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { cn } from "@/shared/lib/utils";
import { useConfigStore } from "@/features/settings/stores/use-config-store";
import { useNotificationStore } from "@/features/notification/stores/use-notification-store";
import { NotificationDetailModal } from "@/features/notification/components/notification-detail-modal";

export function AppSidebar() {
    const translate = useTranslation();
    const pathname = usePathname();
    const user = useUserStore((state) => state.user);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const { notifications, unreadCount, loadNotifications } = useNotificationStore();
    const [detailNotification, setDetailNotification] = useState<(typeof notifications)[number] | null>(null);

    useEffect(() => {
        if (user) void loadNotifications();
    }, [user, loadNotifications]);

    const pathSlug = pathname.split("/").filter(Boolean).slice(0, 2).join("/");
    const slug = pathSlug.startsWith("admin/") ? pathSlug : pathname.split("/").filter(Boolean)[0];

    const visibleTools = navigationTools.filter((tool) => !tool.adminOnly || user?.role === "admin");
    const activeSlug = navigationTools.some((tool) => tool.slug === slug) ? (slug as NavigationToolSlug) : undefined;

    const renderNavItem = (tool: (typeof navigationTools)[number]) => {
        const Icon = tool.icon;
        const active = tool.slug === activeSlug;

        return (
            <Link key={tool.slug} href={`/${tool.slug}`} className={cn("sidebar-rail-item", active ? "sidebar-rail-item-active" : "sidebar-rail-item-inactive")} aria-current={active ? "page" : undefined}>
                <span className="sidebar-rail-icon">
                    <Icon className="size-5" />
                </span>
                <span className="sidebar-rail-label">{translate(tool.labelKey)}</span>
                {tool.pro ? <span className="pro-badge right-0.5 top-0.5" title={translate("common.enterpriseFeature")}>PRO</span> : null}
            </Link>
        );
    };

    const notificationContent = (
        <div className="w-72">
            <div className="border-b border-[var(--studio-line)] px-3 py-2 text-sm font-semibold text-[var(--studio-ink)]">{translate("appShell.announcements")}</div>
            <div className="max-h-72 overflow-y-auto">
                {notifications.length ? (
                    notifications.map((notification) => (
                        <button
                            key={notification.id}
                            type="button"
                            className={cn("block w-full border-b border-[var(--studio-line)] px-3 py-2.5 text-left transition hover:bg-[var(--studio-surface-hover)]", !notification.read && "bg-[var(--studio-primary-soft)]")}
                            onClick={() => {
                                setDetailNotification(notification);
                            }}
                        >
                            <span className="flex items-start justify-between gap-2">
                                <span className="line-clamp-1 text-sm font-medium text-[var(--studio-ink)]">{notification.title}</span>
                                {!notification.read ? <span className="mt-1 size-1.5 shrink-0 rounded-full bg-[var(--studio-primary)]" /> : null}
                            </span>
                            {notification.content ? <span className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--studio-muted)]">{notification.content}</span> : null}
                        </button>
                    ))
                ) : (
                    <div className="px-3 py-8 text-center text-xs text-[var(--studio-faint)]">{translate("appShell.noAnnouncements")}</div>
                )}
            </div>
        </div>
    );

    return (
        <>
            <NotificationDetailModal notification={detailNotification} onClose={() => setDetailNotification(null)} />
            <aside className={cn("studio-sidebar-rail flex h-dvh shrink-0 flex-col", translate.locale === "en" ? "w-28" : "w-[88px]")}>
                <div className="flex h-[72px] shrink-0 items-center justify-center border-b border-[var(--studio-line)]">
                    <Tooltip title="Novanova Studio" placement="right">
                        <Link href="/" className="sidebar-brand-mark" aria-label={translate("appShell.novanovaStudioHome")}>
                            <img src="/logo/novanovastudio.svg" alt="" aria-hidden="true" className="size-10 object-contain" />
                        </Link>
                    </Tooltip>
                </div>

                <nav className="hide-scrollbar flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto px-2 pb-3">{visibleTools.map(renderNavItem)}</nav>

                <div className="flex shrink-0 flex-col items-center gap-2 border-t border-[var(--studio-line)] px-2 py-2">
                    <Tooltip title={translate("appShell.announcements")} placement="right">
                        {user ? (
                            <Popover
                                placement="rightBottom"
                                content={notificationContent}
                                trigger="click"
                                arrow={false}
                                onOpenChange={(open) => {
                                    if (open) void loadNotifications();
                                }}
                            >
                                <button type="button" className="sidebar-rail-action sidebar-rail-action-emphasis relative" aria-label={translate("appShell.announcements_069c0e")}>
                                    <Bell className="size-4.5" />
                                    {unreadCount ? <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-[var(--studio-primary)]" /> : null}
                                </button>
                            </Popover>
                        ) : (
                            <button type="button" className="sidebar-rail-action sidebar-rail-action-emphasis relative" onClick={() => useUserStore.getState().openAuthModal()} aria-label={translate("appShell.announcements_069c0e")}>
                                <Bell className="size-4.5" />
                            </button>
                        )}
                    </Tooltip>
                    {user?.role === "admin" ? (
                        <Tooltip title={translate("appShell.configure")} placement="right">
                            <button type="button" className="sidebar-rail-action sidebar-rail-action-emphasis" onClick={() => openConfigDialog(false)} aria-label={translate("appShell.configure")}>
                                <Cog className="size-4.5" />
                            </button>
                        </Tooltip>
                    ) : null}
                    <LanguageMenu />
                    <ThemePreferenceMenu />
                </div>
            </aside>
        </>
    );
}
