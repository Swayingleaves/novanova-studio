"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";

import { AppSidebar } from "@/features/app-shell/components/app-sidebar";
import { AppConfigModal } from "@/features/app-shell/components/app-config-modal";
import { WelcomeModal } from "@/features/app-shell/components/welcome-modal";
import { AuthModal } from "@/features/auth/components/auth-modal";
import { MobileNavDrawer } from "@/features/app-shell/components/mobile-nav-drawer";
import { navigationTools, type NavigationToolSlug } from "@/shared/constants/navigation-tools";

export function AppShell({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);

    const hideSidebar = /^\/canvas\/[^/]+/.test(pathname);
    const pathSlug = pathname.split("/").filter(Boolean).slice(0, 2).join("/");
    const slug = pathSlug.startsWith("admin/") ? pathSlug : pathname.split("/").filter(Boolean)[0];
    const activeToolSlug = navigationTools.some((tool) => tool.slug === slug) ? (slug as NavigationToolSlug) : undefined;

    return (
        <div className="studio-shell-bg relative flex h-dvh overflow-hidden">
            {/* Sidebar */}
            {!hideSidebar && (
                <>
                    <div className="hidden md:block">
                        <AppSidebar />
                    </div>
                    <button
                        type="button"
                        className="studio-glass fixed left-3 top-3 z-30 inline-flex size-9 items-center justify-center rounded-lg text-[var(--studio-muted)] transition hover:text-[var(--studio-ink)] md:hidden"
                        onClick={() => setMobileNavOpen(true)}
                        aria-label="打开导航菜单"
                    >
                        <Menu className="size-4" />
                    </button>
                    <MobileNavDrawer open={mobileNavOpen} activeToolSlug={activeToolSlug} onClose={() => setMobileNavOpen(false)} />
                </>
            )}

            {/* Main content */}
            <div className="relative z-10 flex min-w-0 flex-1 flex-col">
                <div className={`min-h-0 flex-1 ${hideSidebar ? "overflow-hidden" : "overflow-y-auto"}`}>{children}</div>
            </div>

            <AppConfigModal />
            <AuthModal />
            <WelcomeModal />
        </div>
    );
}
