"use client";
import { useTranslation } from "@/features/locale/use-translation";


import { useState, type ReactNode } from "react";
import { usePathname } from "@/shared/lib/team-navigation";
import Link from "@/shared/lib/team-navigation";
import { BookOpen, Layers3, Menu } from "lucide-react";

import { AppSidebar } from "@/features/app-shell/components/app-sidebar";
import { CommunityMenu } from "@/features/community/components/community-menu";
import { GitHubLink } from "@/features/app-shell/components/github-link";
import { UserCreditMenu } from "@/features/app-shell/components/user-credit-menu";
import { WelcomeModal } from "@/features/app-shell/components/welcome-modal";
import { AuthModal } from "@/features/auth/components/auth-modal";
import { MobileNavDrawer } from "@/features/app-shell/components/mobile-nav-drawer";
import { ProductTour } from "@/features/onboarding/components/product-tour";
import { navigationTools, type NavigationToolSlug } from "@/shared/constants/navigation-tools";
import { useTeamStore } from "@/features/team/stores/use-team-store";

export function AppShell({ children }: { children: ReactNode }) {
    const translate = useTranslation();
    const pathname = usePathname();
    const team = useTeamStore((state) => state.team);
    const teamSpaceLabel = team ? translate("appShell.currentTeamSpace", { name: team.name }) : "";
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
                        aria-label={translate("appShell.openNavigation")}
                    >
                        <Menu className="size-4" />
                    </button>
                    <MobileNavDrawer open={mobileNavOpen} activeToolSlug={activeToolSlug} onClose={() => setMobileNavOpen(false)} />
                </>
            )}

            {!hideSidebar ? (
                <div className="fixed right-3 top-3 z-40 flex max-w-[calc(100vw-4.5rem)] items-center gap-2 md:max-w-[calc(100vw-7rem)]">
                    {team ? <span role="status" title={teamSpaceLabel} className="mr-1 min-w-0 max-w-80 truncate text-xs text-[var(--studio-muted)]">{teamSpaceLabel}</span> : null}
                    <div data-tour="header-links" className="flex items-center gap-2">
                        <CommunityMenu className="studio-glass inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-[var(--studio-muted)] transition hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--studio-action)]" />
                        <Link
                            href="/editions"
                            className="studio-glass inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-[var(--studio-muted)] transition hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--studio-action)]"
                            aria-label={translate("appShell.compareEditions")}
                            title={translate("appShell.compareEditions")}
                        >
                            <Layers3 className="size-4" aria-hidden="true" />
                        </Link>
                        <Link
                            href={`/docs/${translate.locale}`}
                            className="studio-glass inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-[var(--studio-muted)] transition hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--studio-action)]"
                            aria-label={translate("appShell.docs")}
                            title={translate("appShell.docs")}
                        >
                            <BookOpen className="size-4" aria-hidden="true" />
                        </Link>
                        <GitHubLink className="studio-glass inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-[var(--studio-muted)] hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--studio-action)]" />
                    </div>
                    <UserCreditMenu className="shrink-0" tourAnchor="user-menu" />
                </div>
            ) : null}

            {/* Main content */}
            <div className="relative z-10 flex min-w-0 flex-1 flex-col">
                <div className={`min-h-0 flex-1 ${hideSidebar ? "overflow-hidden" : "overflow-y-auto"}`}>{children}</div>
            </div>

            <AuthModal />
            <WelcomeModal />
            <ProductTour />
        </div>
    );
}
