"use client";

import { useSpaceBrand } from "@/features/team/use-space-brand";
import { Modal } from "antd";

import { AuthForm } from "@/features/auth/components/auth-form";
import { useUserStore } from "@/features/auth/stores/use-user-store";

export function AuthModal() {
    const brand = useSpaceBrand();
    const showAuthModal = useUserStore((state) => state.showAuthModal);
    const pendingRedirect = useUserStore((state) => state.pendingRedirect);
    const closeAuthModal = useUserStore((state) => state.closeAuthModal);

    return (
        <Modal open={showAuthModal} onCancel={closeAuthModal} footer={null} width={420} destroyOnHidden centered>
            {brand.isTeam ? <div className="mb-5 flex items-center gap-3"><img src={brand.logoUrl} alt="" className="size-10 shrink-0 object-contain" /><div className="min-w-0 wrap-anywhere"><strong>{brand.name}</strong><p className="studio-subtitle">{brand.introduction}</p></div></div> : null}
            <AuthForm onSuccess={closeAuthModal} redirectPath={pendingRedirect || (typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}${window.location.hash}`)} />
        </Modal>
    );
}
