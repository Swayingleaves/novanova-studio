"use client";

import { useState } from "react";
import type { MenuProps } from "antd";
import { History, LogOut, ShoppingCart, Ticket, UserCircle, Users, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { App, Dropdown } from "antd";

import { useUserStore } from "@/features/auth/stores/use-user-store";
import { logoutCurrentUser } from "@/services/api/server";
import { cn } from "@/shared/lib/utils";

const creditNumberFormatter = new Intl.NumberFormat("zh-CN");

type UserCreditMenuProps = {
    className?: string;
};

/**
 * 右上角用户入口：积分（左）与头像（右）合并为一个 chip；hover 弹出合并下拉菜单（用户信息 + 购买/兑换 + 用户菜单）。
 * <p>
 * 未登录时显示「登录」按钮（点击打开 AuthModal）。
 * 积分实时值直接订阅 useUserStore，SSE 刷新由 client-root-init 驱动，无需额外接入。
 */
export function UserCreditMenu({ className }: UserCreditMenuProps) {
    const pathname = usePathname();
    const router = useRouter();
    const { message } = App.useApp();
    const user = useUserStore((state) => state.user);
    const clearSession = useUserStore((state) => state.clearSession);
    const [menuOpen, setMenuOpen] = useState(false);

    const creditBalance = user && Number.isInteger(user.creditBalance) ? user.creditBalance : null;

    const handleLogout = async () => {
        try {
            await logoutCurrentUser();
        } catch {
            // 后端使用无状态 Token，退出登录以清理本地会话为准。
        }
        clearSession();
        message.success("已退出登录");
        router.replace("/");
    };

    // 未登录：右上角保留登录入口
    if (!user) {
        return (
            <button
                type="button"
                className={cn(
                    "studio-glass inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[var(--studio-muted)] transition hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--studio-action)]",
                    className,
                )}
                onClick={() => useUserStore.getState().openAuthModal()}
                aria-label="登录"
            >
                <UserCircle className="size-4" />
                <span className="text-xs font-medium">登录</span>
            </button>
        );
    }

    const items: MenuProps["items"] = [
        {
            key: "profile",
            label: (
                <Link
                    href="/profile"
                    onClick={() => setMenuOpen(false)}
                    className="block max-w-56 py-1"
                >
                    <div className="truncate text-sm font-medium text-[var(--studio-ink)]">{user.displayName}</div>
                    <div className="mt-1 truncate text-xs text-[var(--studio-muted)]">{user.email}</div>
                </Link>
            ),
        },
        { type: "divider" },
        {
            key: "purchase",
            icon: <ShoppingCart className="size-4" />,
            label: (
                <Link
                    href="/credits/purchase"
                    onClick={() => setMenuOpen(false)}
                    className={cn("text-sm", pathname === "/credits/purchase" && "text-[var(--studio-ink)]")}
                >
                    购买
                </Link>
            ),
        },
        {
            key: "redeem",
            icon: <Ticket className="size-4" />,
            label: (
                <Link
                    href="/credits/redeem"
                    onClick={() => setMenuOpen(false)}
                    className={cn("text-sm", pathname === "/credits/redeem" && "text-[var(--studio-ink)]")}
                >
                    兑换
                </Link>
            ),
        },
        {
            key: "transactions",
            icon: <History className="size-4" />,
            label: (
                <Link
                    href="/credits"
                    onClick={() => setMenuOpen(false)}
                    className={cn("text-sm", pathname === "/credits" && "text-[var(--studio-ink)]")}
                >
                    积分记录
                </Link>
            ),
        },
        ...(user.role === "admin"
            ? [
                  {
                      key: "adminSystem",
                      icon: <Users className="size-4" />,
                      label: (
                          <Link href="/admin/system" onClick={() => setMenuOpen(false)} className="text-sm">
                              系统管理
                          </Link>
                      ),
                  },
              ]
            : []),
        { type: "divider" },
        {
            key: "logout",
            icon: <LogOut className="size-4" />,
            label: "退出登录",
            onClick: () => void handleLogout(),
        },
    ];

    return (
        <Dropdown open={menuOpen} onOpenChange={setMenuOpen} trigger={["hover"]} placement="bottomRight" mouseEnterDelay={0} menu={{ items }}>
            <button
                type="button"
                className={cn(
                    "studio-glass inline-flex h-9 items-center gap-1.5 rounded-lg px-2 transition hover:bg-[var(--studio-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--studio-action)]",
                    className,
                )}
                aria-label="用户菜单"
            >
                {creditBalance !== null ? (
                    <span className="inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums text-[var(--studio-primary)]">
                        <Zap className="size-3 fill-current" strokeWidth={2.4} />
                        <span className="max-w-14 truncate">{creditNumberFormatter.format(creditBalance)}</span>
                    </span>
                ) : null}
                <span className="inline-flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full">
                    {user.avatarUrl ? <img src={user.avatarUrl} alt="" className="size-full object-cover" /> : <UserCircle className="size-4" aria-hidden />}
                </span>
            </button>
        </Dropdown>
    );
}
