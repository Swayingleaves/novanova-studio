"use client";

import { Modal } from "antd";
import { Clapperboard, Layers, LayoutGrid, Sparkles } from "lucide-react";

import { AuthForm } from "@/features/auth/components/auth-form";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { useTranslation } from "@/features/locale/use-translation";
import { useSpaceBrand } from "@/features/team/use-space-brand";

const SHOWCASE_FEATURES = [
    { icon: LayoutGrid, title: "auth.featureCanvasTitle", description: "auth.featureCanvasDescription" },
    { icon: Clapperboard, title: "auth.featureVideoTitle", description: "auth.featureVideoDescription" },
    { icon: Sparkles, title: "auth.featureAgentTitle", description: "auth.featureAgentDescription" },
    { icon: Layers, title: "auth.featureLibraryTitle", description: "auth.featureLibraryDescription" },
];

export function AuthModal() {
    const translate = useTranslation();
    const brand = useSpaceBrand();
    const showAuthModal = useUserStore((state) => state.showAuthModal);
    const pendingRedirect = useUserStore((state) => state.pendingRedirect);
    const closeAuthModal = useUserStore((state) => state.closeAuthModal);

    return (
        <Modal open={showAuthModal} onCancel={closeAuthModal} footer={null} width={1000} destroyOnHidden centered className="auth-modal">
            <div className="grid lg:min-h-[620px] lg:grid-cols-[55%_45%]">
                <AuthShowcase />
                <div className="flex min-w-0 flex-col justify-center px-6 pb-8 pt-12 lg:px-9 lg:pb-9 lg:pt-11">
                    <h2 className="wrap-anywhere text-xl font-semibold tracking-tight text-[var(--studio-ink)]">{translate("auth.welcomeTo", { value0: brand.name })}</h2>
                    <AuthForm onSuccess={closeAuthModal} redirectPath={pendingRedirect || (typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}${window.location.hash}`)} />
                </div>
            </div>
        </Modal>
    );
}

/** 弹窗左侧品牌面板：品牌、标语与能力卡片，配色全部跟随主题变量。 */
function AuthShowcase() {
    const translate = useTranslation();
    const brand = useSpaceBrand();

    return (
        <aside className="auth-showcase relative hidden flex-col justify-between gap-9 p-9 lg:flex">
            <span className="auth-showcase-glow" aria-hidden="true" />
            <div className="relative flex items-center gap-2.5">
                <img src={brand.logoUrl} alt="" className="size-9 shrink-0 object-contain" />
                <span className="wrap-anywhere text-base font-semibold tracking-tight text-[var(--studio-ink)]">{brand.name}</span>
            </div>
            <div className="relative">
                <h3 className="text-[34px] font-semibold leading-[1.25] tracking-tight text-[var(--studio-ink)]">{translate("auth.heroTitle")}</h3>
                <p className="mt-3 text-sm leading-relaxed text-[var(--studio-muted)]">{brand.introduction || translate("auth.heroSubtitle")}</p>
            </div>
            <div className="relative grid grid-cols-2 gap-2.5">
                {SHOWCASE_FEATURES.map(({ icon: Icon, title, description }) => (
                    <div key={title} className="auth-showcase-card rounded-lg p-3.5">
                        <div className="flex items-center gap-2">
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--studio-surface-hover)] text-[var(--studio-text)]">
                                <Icon className="size-4" aria-hidden="true" />
                            </span>
                            <p className="text-[13px] font-medium text-[var(--studio-ink)]">{translate(title)}</p>
                        </div>
                        <p className="mt-2 text-xs leading-relaxed text-[var(--studio-muted)]">{translate(description)}</p>
                    </div>
                ))}
            </div>
        </aside>
    );
}
