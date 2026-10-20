"use client";

import { creditAmount, creditText } from "@/shared/lib/credit-amounts";
import { currentLanguageTag } from "@/features/locale/translate";

import { useTranslation } from "@/features/locale/use-translation";

import { useEffect, useState } from "react";
import type { MenuProps } from "antd";
import { CalendarCheck, Cloud, History, LogOut, ShoppingCart, Ticket, UserCircle, Users, Zap } from "lucide-react";
import Link from "@/shared/lib/team-navigation";
import { usePathname, useRouter } from "@/shared/lib/team-navigation";
import { App, Dropdown } from "antd";

import { canManageCurrentSpace, useTeamStore } from "@/features/team/stores/use-team-store";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { logoutCurrentUser } from "@/services/api/server";
import { cn } from "@/shared/lib/utils";
import { confirmPageNavigation } from "@/shared/lib/navigation-history-guard";
import { useStorageCapacity } from "@/features/storage/use-storage-capacity";
import { formatStorageGigabytes } from "@/features/storage/capacity-format";

const creditNumberFormatter = { format: (value: number) => new Intl.NumberFormat(currentLanguageTag()).format(value) };

type UserCreditMenuProps = {
    className?: string;
};

/**
 * 右上角用户入口：积分（左）与头像（右）合并为一个 chip；hover 弹出合并下拉菜单（用户信息 + 购买/兑换 + 用户菜单）。
 * <p>
 * 未登录时显示「登录」按钮，平台打开弹窗，团队进入对应登录页。
 * 积分实时值直接订阅 useUserStore，SSE 刷新由 client-root-init 驱动，无需额外接入。
 */
export function UserCreditMenu({ className }: UserCreditMenuProps) {
    const translate = useTranslation();
    const pathname = usePathname();
    const router = useRouter();
    const { message } = App.useApp();
    const user = useUserStore((state) => state.user);
    const clearSession = useUserStore((state) => state.clearSession);
    const [menuOpen, setMenuOpen] = useState(false);
    const [keyboardMenu, setKeyboardMenu] = useState(false);
    const capacity = useStorageCapacity();
    const closeMenu = () => {
        setMenuOpen(false);
        setKeyboardMenu(false);
    };
    useEffect(() => {
        if (!menuOpen || !user) return;
        void capacity.refetch();
        const timer = window.setInterval(() => {
            void capacity.refetch();
        }, 15_000);
        return () => window.clearInterval(timer);
    }, [menuOpen, user?.id]);

    const team = useTeamStore((state) => state.team);
    const wallets = useTeamStore((state) => state.wallets);
    const creditBalance = user ? user.creditBalance : null;

    const handleLogout = async () => {
        if (!(await confirmPageNavigation())) return;
        try {
            await logoutCurrentUser();
        } catch {
            // 后端使用无状态 Token，退出登录以清理本地会话为准。
        }
        clearSession();
        message.success(translate("appShell.signedOut"));
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
                aria-label={translate("appShell.signIn")}
            >
                <UserCircle className="size-4" />
                <span className="text-xs font-medium">{translate("appShell.signIn")}</span>
            </button>
        );
    }

    const items: MenuProps["items"] = [
        {
            key: "profile",
            label: (
                <Link href="/profile" onClick={closeMenu} className="block max-w-56 py-1">
                    <div className="truncate text-sm font-medium text-[var(--studio-ink)]">{user.displayName}</div>
                    <div className="mt-1 truncate text-xs text-[var(--studio-muted)]">{user.email}</div>
                </Link>
            ),
        },
        { type: "divider" },
        {
            key: "storageCapacity",
            icon: <Cloud className="size-4" aria-hidden />,
            label: (
                <div className="flex flex-col gap-1 py-1">
                    <span>{translate("storage.cloudStorage")}</span>
                    <span className="text-xs tabular-nums text-[var(--studio-muted)]">
                        {capacity.data ? `${formatStorageGigabytes(capacity.data.usedBytes)} / ${formatStorageGigabytes(capacity.data.totalBytes)} G` : translate(capacity.isError ? "storage.capacityLoadFailed" : "storage.capacityLoading")}
                    </span>
                </div>
            ),
            onClick: () => {
                closeMenu();
                router.push("/assets?tab=cloudFiles");
            },
        },
        { type: "divider" },
        {
            key: "account",
            icon: <UserCircle className="size-4" />,
            label: (
                <Link href="/profile" onClick={closeMenu} className={cn("text-sm", pathname === "/profile" && "text-[var(--studio-ink)]")}>
                    {translate("appShell.profile")}
                </Link>
            ),
        },
        { type: "divider" },
        {
            key: "checkIn",
            icon: <CalendarCheck className="size-4" />,
            label: (
                <Link href="/check-in" onClick={closeMenu} className={cn("text-sm", pathname === "/check-in" && "text-[var(--studio-ink)]")}>
                    {translate("appShell.checkIn")}
                </Link>
            ),
        },
        { type: "divider" },
        {
            key: "purchase",
            icon: <ShoppingCart className="size-4" />,
            label: (
                <Link href="/credits/purchase" onClick={closeMenu} className={cn("text-sm", pathname === "/credits/purchase" && "text-[var(--studio-ink)]")}>
                    {translate("appShell.purchase")}
                </Link>
            ),
        },
        {
            key: "redeem",
            icon: <Ticket className="size-4" />,
            label: (
                <Link href="/credits/redeem" onClick={closeMenu} className={cn("text-sm", pathname === "/credits/redeem" && "text-[var(--studio-ink)]")}>
                    {translate("appShell.redeem")}
                </Link>
            ),
        },
        {
            key: "transactions",
            icon: <History className="size-4" />,
            label: (
                <Link href="/credits" onClick={closeMenu} className={cn("text-sm", pathname === "/credits" && "text-[var(--studio-ink)]")}>
                    {translate("appShell.creditRecords")}
                </Link>
            ),
        },
        ...(canManageCurrentSpace()
            ? [
                  {
                      key: "adminSystem",
                      icon: <Users className="size-4" />,
                      label: (
                          <Link href="/admin/system" onClick={closeMenu} className="text-sm">
                              {translate("appShell.systemManagement")}
                          </Link>
                      ),
                  },
              ]
            : []),
        { type: "divider" },
        {
            key: "logout",
            icon: <LogOut className="size-4" />,
            label: translate("appShell.signOut"),
            onClick: () => void handleLogout(),
        },
    ];

    return (
        <>
            <Dropdown
                open={menuOpen}
                onOpenChange={(open) => {
                    setMenuOpen(open);
                    if (!open) setKeyboardMenu(false);
                }}
                autoFocus={keyboardMenu}
                trigger={["hover", "click"]}
                placement="bottomRight"
                mouseEnterDelay={0}
                menu={{ items: team ? items.filter((item) => !item || !("key" in item) || !["checkIn", "purchase", "redeem", "invitation"].includes(String(item.key))) : items }}
            >
                <button
                    type="button"
                    className={cn(
                        "studio-glass inline-flex h-9 items-center gap-1.5 rounded-lg px-2 transition hover:bg-[var(--studio-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--studio-action)]",
                        className,
                    )}
                    aria-label={translate("appShell.userMenu")}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onKeyDown={(event) => {
                        if (event.key === "ArrowDown") {
                            event.preventDefault();
                            setKeyboardMenu(true);
                            setMenuOpen(true);
                        }
                    }}
                >
                    {creditBalance !== null ? (
                        <span className="inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums text-[var(--studio-primary)]">
                            <Zap className="size-3 fill-current" strokeWidth={2.4} />
                            <span title={team ? "平台积分 / 团队积分" : "平台积分"} className="max-w-40 truncate">
                                {creditText(wallets?.platformBalance || creditBalance)}
                                {team ? ` / ${wallets ? creditText(wallets.teamBalance) : "加载中"}` : ""}
                            </span>
                        </span>
                    ) : null}
                    <span className="inline-flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full">
                        {user.avatarUrl ? <img src={user.avatarUrl} alt="" className="size-full object-cover" /> : <UserCircle className="size-4" aria-hidden />}
                    </span>
                </button>
            </Dropdown>
        </>
    );
}
