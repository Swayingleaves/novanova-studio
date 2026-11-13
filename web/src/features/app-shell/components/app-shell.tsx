"use client";
import { useTranslation } from "@/features/locale/use-translation";


import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "@/shared/lib/team-navigation";
import Link from "@/shared/lib/team-navigation";
import { BookOpen, Layers3, Menu } from "lucide-react";

import { AppSidebar } from "@/features/app-shell/components/app-sidebar";
import { CommunityMenu } from "@/features/community/components/community-menu";
import { CreditSymbol } from "@/features/generation/constants/credits";
import { GitHubLink } from "@/features/app-shell/components/github-link";
import { UserCreditMenu } from "@/features/app-shell/components/user-credit-menu";
import { WelcomeModal } from "@/features/app-shell/components/welcome-modal";
import { AuthModal } from "@/features/auth/components/auth-modal";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { MobileNavDrawer } from "@/features/app-shell/components/mobile-nav-drawer";
import { ProductTour } from "@/features/onboarding/components/product-tour";
import { navigationTools, type NavigationToolSlug } from "@/shared/constants/navigation-tools";
import { creditAmount } from "@/shared/lib/credit-amounts";
import { useTeamStore } from "@/features/team/stores/use-team-store";
import { ShareWorkDialog } from "@/features/shared-work/components/share-work-dialog";

export function AppShell({ children }: { children: ReactNode }) {
    const translate = useTranslation();
    const pathname = usePathname();
    const team = useTeamStore((state) => state.team);
    const creditBalance = useUserStore((state) => state.user?.creditBalance ?? null);
    const emphasizePurchase = !creditBalance || creditAmount(creditBalance).lte(0);
    const teamSpaceLabel = team ? translate("appShell.currentTeamSpace", { name: team.name }) : "";
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const floatingActionsRef = useRef<HTMLDivElement>(null);
    const hideSidebar = /^\/canvas\/[^/]+/.test(pathname);

    useLayoutEffect(() => {
        const element = floatingActionsRef.current;
        if (!element) {
            document.documentElement.style.removeProperty("--studio-floating-actions-width");
            return;
        }
        const applyWidth = () => {
            const width = Math.ceil(element.getBoundingClientRect().width) + 28;
            document.documentElement.style.setProperty("--studio-floating-actions-width", `${width}px`);
        };
        applyWidth();
        const observer = new ResizeObserver(applyWidth);
        observer.observe(element);
        return () => {
            observer.disconnect();
            document.documentElement.style.removeProperty("--studio-floating-actions-width");
        };
    }, [hideSidebar]);

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
                <div ref={floatingActionsRef} className="fixed right-3 top-3 z-40 flex max-w-[calc(100vw-4.5rem)] items-center gap-2 md:max-w-[calc(100vw-7rem)]">
                    {team ? <span role="status" title={teamSpaceLabel} className="mr-1 min-w-0 max-w-80 truncate text-xs text-[var(--studio-muted)]">{teamSpaceLabel}</span> : null}
                    <div data-tour="header-links" className="flex items-center gap-2">
                        {!team && (
                            <Link
                                href="/credits/purchase"
                                data-emphasis={emphasizePurchase ? "high" : undefined}
                                className="credit-entry-shine inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--studio-primary)] px-3 text-[var(--studio-action-foreground)] transition hover:bg-[var(--studio-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--studio-action)]"
                                aria-label={translate("appShell.purchaseCredits")}
                                title={translate("appShell.purchaseCredits")}
                            >
                                <CreditSymbol className="text-sm" aria-hidden="true" />
                                <span className="hidden text-xs font-medium sm:inline">{translate("appShell.purchaseCredits")}</span>
                            </Link>
                        )}
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
            <ShareWorkDialog />
            <WelcomeModal />
            <ProductTour />
        </div>
    );
}
