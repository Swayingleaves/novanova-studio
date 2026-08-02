"use client";

import { useEffect, useState } from "react";
import type { MenuProps } from "antd";
import { Bell, LogOut, Cog, ShoppingCart, Ticket, UserCircle, Users, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { App, Dropdown, Popover, Tooltip } from "antd";

import { ThemePreferenceMenu } from "@/features/theme/components/theme-preference-menu";
import { navigationTools, type NavigationToolSlug } from "@/shared/constants/navigation-tools";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { cn } from "@/shared/lib/utils";
import { useConfigStore } from "@/features/settings/stores/use-config-store";
import { useNotificationStore } from "@/features/notification/stores/use-notification-store";
import { NotificationDetailModal } from "@/features/notification/components/notification-detail-modal";
import { logoutCurrentUser } from "@/services/api/server";

const creditNumberFormatter = new Intl.NumberFormat("zh-CN");

export function AppSidebar() {
    const pathname = usePathname();
    const router = useRouter();
    const { message } = App.useApp();
    const user = useUserStore((state) => state.user);
    const clearSession = useUserStore((state) => state.clearSession);
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
    const creditBalance = user && Number.isInteger(user.creditBalance) ? user.creditBalance : null;
    const creditMenuContent = (
        <div className="flex min-w-28 flex-col gap-1 p-0.5">
            <Link href="/credits/purchase" className={cn("flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-[var(--studio-muted)] transition hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]", pathname === "/credits/purchase" && "bg-[var(--studio-primary-soft)] text-[var(--studio-ink)]")}>
                <ShoppingCart className="size-4" />
                <span>购买</span>
            </Link>
            <Link href="/credits/redeem" className={cn("flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-[var(--studio-muted)] transition hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]", pathname === "/credits/redeem" && "bg-[var(--studio-primary-soft)] text-[var(--studio-ink)]")}>
                <Ticket className="size-4" />
                <span>兑换</span>
            </Link>
        </div>
    );

    const handleLogoutCurrentUser = async () => {
        try {
            await logoutCurrentUser();
        } catch {
            // 后端使用无状态 Token，退出登录以清理本地会话为准。
        }
        clearSession();
        message.success("已退出登录");
        router.replace("/");
    };

    const userMenuItems: MenuProps["items"] = user
        ? [
              {
                  key: "profile",
                  disabled: true,
                  label: (
                      <div className="max-w-56 py-1">
                          <div className="truncate text-sm font-medium text-[var(--studio-ink)]">{user.displayName}</div>
                          <div className="mt-1 truncate text-xs text-[var(--studio-muted)]">{user.email}</div>
                      </div>
                  ),
              },
              ...(user.role === "admin"
                  ? [
                        {
                            key: "adminSystem",
                            icon: <Users className="size-4" />,
                            label: <Link href="/admin/system">系统管理</Link>,
                        },
                    ]
                  : []),
              {
                  type: "divider" as const,
              },
              {
                  key: "logout",
                  icon: <LogOut className="size-4" />,
                  label: "退出登录",
                  onClick: () => void handleLogoutCurrentUser(),
              },
          ]
        : [];

    const renderNavItem = (tool: (typeof navigationTools)[number]) => {
        const Icon = tool.icon;
        const active = tool.slug === activeSlug;

        return (
            <Link key={tool.slug} href={`/${tool.slug}`} className={cn("sidebar-rail-item", active ? "sidebar-rail-item-active" : "sidebar-rail-item-inactive")} aria-current={active ? "page" : undefined}>
                <span className="sidebar-rail-icon">
                    <Icon className="size-5" />
                </span>
                <span className="sidebar-rail-label">{tool.label}</span>
            </Link>
        );
    };

    const notificationContent = (
        <div className="w-72">
            <div className="border-b border-[var(--studio-line)] px-3 py-2 text-sm font-semibold text-[var(--studio-ink)]">系统公告</div>
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
                    <div className="px-3 py-8 text-center text-xs text-[var(--studio-faint)]">暂无公告</div>
                )}
            </div>
        </div>
    );

    return (
        <>
            <NotificationDetailModal notification={detailNotification} onClose={() => setDetailNotification(null)} />
            <aside className="studio-sidebar-rail flex h-dvh w-[88px] shrink-0 flex-col">
                <div className="flex h-[72px] items-center justify-center border-b border-[var(--studio-line)]">
                    <Tooltip title="Novanova Studio" placement="right">
                        <Link href="/" className="sidebar-brand-mark" aria-label="Novanova Studio 首页">
                            <img src="/logo/novanovastudio.svg" alt="" aria-hidden="true" className="size-10 object-contain" />
                        </Link>
                    </Tooltip>
                </div>

                <nav className="hide-scrollbar flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto px-2 pb-3">{visibleTools.map(renderNavItem)}</nav>

                <div className="flex flex-col items-center gap-2 border-t border-[var(--studio-line)] px-2 py-2">
                    {creditBalance !== null ? (
                        <Popover placement="right" trigger="hover" arrow={false} content={creditMenuContent}>
                            <Link href="/credits" className={cn("sidebar-credit-balance", pathname.startsWith("/credits") && "sidebar-rail-item-active")} aria-current={pathname.startsWith("/credits") ? "page" : undefined} aria-label={`查看积分，当前可用 ${creditNumberFormatter.format(creditBalance)}`}>
                                <Zap className="size-3.5 fill-current" strokeWidth={2.4} />
                                <span className="max-w-[52px] truncate">{creditNumberFormatter.format(creditBalance)}</span>
                            </Link>
                        </Popover>
                    ) : null}
                    {user ? (
                        <Dropdown placement="topLeft" trigger={["hover"]} menu={{ items: userMenuItems }}>
                            <Link href="/profile" className="sidebar-user-dot sidebar-user-dot-emphasis" aria-label="个人信息" title={user.displayName || user.email}>
                                <span className="flex size-full items-center justify-center">
                                    {user.avatarUrl ? <img src={user.avatarUrl} alt="" className="block size-full rounded-[inherit] object-cover" /> : <UserCircle className="size-5" aria-hidden />}
                                </span>
                            </Link>
                        </Dropdown>
                    ) : (
                        <Tooltip title="登录" placement="right">
                            <button type="button" className="sidebar-rail-action" onClick={() => useUserStore.getState().openAuthModal()} aria-label="登录">
                                <UserCircle className="size-4.5" />
                            </button>
                        </Tooltip>
                    )}
                    <Tooltip title="系统公告" placement="right">
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
                                <button type="button" className="sidebar-rail-action sidebar-rail-action-emphasis relative" aria-label="公告">
                                    <Bell className="size-4.5" />
                                    {unreadCount ? <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-[var(--studio-primary)]" /> : null}
                                </button>
                            </Popover>
                        ) : (
                            <button type="button" className="sidebar-rail-action sidebar-rail-action-emphasis relative" onClick={() => useUserStore.getState().openAuthModal()} aria-label="公告">
                                <Bell className="size-4.5" />
                            </button>
                        )}
                    </Tooltip>
                    {user?.role === "admin" ? (
                        <Tooltip title="配置" placement="right">
                            <button type="button" className="sidebar-rail-action sidebar-rail-action-emphasis" onClick={() => openConfigDialog(false)} aria-label="配置">
                                <Cog className="size-4.5" />
                            </button>
                        </Tooltip>
                    ) : null}
                    <ThemePreferenceMenu />
                </div>
            </aside>
        </>
    );
}
