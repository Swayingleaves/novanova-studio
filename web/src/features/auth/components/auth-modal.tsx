"use client";

import { useRouter } from "next/navigation";
import { Modal } from "antd";

import { AuthForm } from "@/features/auth/components/auth-form";
import { useUserStore } from "@/features/auth/stores/use-user-store";

export function AuthModal() {
    const router = useRouter();
    const showAuthModal = useUserStore((state) => state.showAuthModal);
    const pendingRedirect = useUserStore((state) => state.pendingRedirect);
    const closeAuthModal = useUserStore((state) => state.closeAuthModal);

    const handleSuccess = () => {
        closeAuthModal();
        if (pendingRedirect) {
            router.push(pendingRedirect);
        }
    };

    return (
        <Modal open={showAuthModal} onCancel={closeAuthModal} footer={null} width={420} destroyOnHidden centered>
            <AuthForm onSuccess={handleSuccess} redirectPath={pendingRedirect} />
        </Modal>
    );
}
