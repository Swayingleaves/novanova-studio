"use client";

import { type CSSProperties, useEffect, useState } from "react";
import type { MenuProps } from "antd";
import { Bell, Keyboard, LogOut, Cog, UserCircle, Users } from "lucide-react";
import { App, Badge, Dropdown, Popover } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { GitHubLink } from "@/features/app-shell/components/github-link";
import { canvasThemes } from "@/shared/lib/canvas-theme";
import { useThemeStore } from "@/features/theme/stores/use-theme-store";
import { logoutCurrentUser } from "@/services/api/server";
import { useConfigStore } from "@/features/settings/stores/use-config-store";
import { useNotificationStore } from "@/features/notification/stores/use-notification-store";
import { NotificationDetailModal } from "@/features/notification/components/notification-detail-modal";
import { useUserStore } from "@/features/auth/stores/use-user-store";

type UserStatusActionsProps = {
    showConfig?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
};

export function UserStatusActions({ showConfig = true, variant = "default", onOpenShortcuts }: UserStatusActionsProps) {
    const router = useRouter();
    const { message } = App.useApp();
    const user = useUserStore((state) => state.user);
    const clearSession = useUserStore((state) => state.clearSession);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const { notifications, unreadCount, loadNotifications } = useNotificationStore();
    const [detailNotification, setDetailNotification] = useState<typeof notifications[number] | null>(null);
    const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
    const canvasTheme = canvasThemes[resolvedTheme];
    const naturalIconClass = "inline-flex size-7 shrink-0 items-center justify-center text-[var(--studio-muted)] transition hover:text-[var(--studio-ink)] [&_svg]:size-4";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;
    const gitHubClassName = "size-7 text-base";
    const gitHubStyle = iconStyle;
    const showCanvasSecondaryActions = variant !== "canvas";

    useEffect(() => {
        if (user) void loadNotifications();
    }, [user, loadNotifications]);

    const logout = async () => {
        try {
            await logoutCurrentUser();
        } catch {
            // 后端使用无状态 Token，退出登录以清理本地会话为准。
        }
        clearSession();
        message.success("已退出登录");
        router.replace("/auth");
    };
    const userMenuItems: MenuProps["items"] = user
        ? [
              {
                  key: "profile",
                  disabled: true,
                  label: (
                      <div className="max-w-56 py-1">
                          <div className="truncate text-sm font-medium">{user.displayName}</div>
                          <div className="studio-caption mt-1 truncate text-xs">{user.email}</div>
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
                  key: "logout",
                  icon: <LogOut className="size-4" />,
                  label: "退出登录",
                  onClick: () => void logout(),
              },
          ]
        : [];

    const notificationContent = (
        <div className="w-80">
            <div className="border-b border-[var(--studio-line)] px-4 py-2.5 text-sm font-semibold text-[var(--studio-ink)]">
                系统公告
                {unreadCount > 0 ? <span className="ml-2 text-xs font-normal text-[var(--studio-primary)]">{unreadCount} 条未读</span> : null}
            </div>
            <div className="max-h-80 overflow-y-auto">
                {notifications.length === 0 ? (
                    <div className="studio-caption px-4 py-8 text-center text-xs">暂无公告</div>
                ) : (
                    notifications.map((n) => (
                        <button
                            key={n.id}
                            type="button"
                            className={`block w-full border-b border-[var(--studio-line)] px-4 py-3 text-left transition hover:bg-[var(--studio-surface-hover)] ${!n.read ? "bg-[var(--studio-primary-soft)]" : ""}`}
                            onClick={() => setDetailNotification(n)}
                        >
                            <div className="flex items-start justify-between gap-2">
                                <span className="studio-title text-sm font-medium">{n.title}</span>
                                {!n.read ? <span className="mt-0.5 size-2 shrink-0 rounded-full bg-[var(--studio-primary)]" /> : null}
                            </div>
                            {n.content ? <div className="studio-subtitle mt-1 text-xs leading-5 line-clamp-2">{n.content}</div> : null}
                            <div className="studio-caption mt-1 text-[10px]">{n.publishedAt ? new Date(n.publishedAt).toLocaleString() : n.createdAt ? new Date(n.createdAt).toLocaleString() : ""}</div>
                        </button>
                    ))
                )}
            </div>
        </div>
    );

    return (
        <>
            <NotificationDetailModal notification={detailNotification} onClose={() => setDetailNotification(null)} />
            <div className="inline-flex shrink-0 items-center gap-1">
                {showConfig && user?.role === "admin" ? (
                    <button type="button" className={naturalIconClass} style={iconStyle} onClick={() => openConfigDialog(false)} aria-label="配置" title="配置">
                        <Cog className="size-4" />
                    </button>
                ) : null}
                <GitHubLink className={`${gitHubClassName} bg-transparent hover:bg-transparent`} style={gitHubStyle} />
                {onOpenShortcuts ? (
                    <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenShortcuts} aria-label="快捷键" title="快捷键">
                        <Keyboard className="size-4" />
                    </button>
                ) : null}
                {showCanvasSecondaryActions && user ? (
                    <Popover placement="bottomRight" content={notificationContent} trigger="click" arrow={false} onOpenChange={(open) => { if (open) void loadNotifications(); }}>
                        <button type="button" className={naturalIconClass} style={iconStyle} aria-label="公告" title="公告">
                            <Badge count={unreadCount} size="small" offset={[2, -2]}>
                                <Bell className="size-4" />
                            </Badge>
                        </button>
                    </Popover>
                ) : null}
                {showCanvasSecondaryActions && user ? (
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: userMenuItems,
                        }}
                    >
                        <button type="button" className={naturalIconClass} style={iconStyle} aria-label="用户菜单" title={user.displayName}>
                            <UserCircle className="size-4" />
                        </button>
                    </Dropdown>
                ) : null}
            </div>
        </>
    );
}
