"use client";

import { useLayoutEffect } from "react";
import { Modal } from "antd";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { useTeamStore } from "@/features/team/stores/use-team-store";
import { useRouter } from "@/shared/lib/team-navigation";
import { useTranslation } from "@/features/locale/use-translation";
import { useOnboardingStore } from "@/features/onboarding/stores/use-onboarding-store";
import { useInsufficientCreditsStore } from "./insufficient-credits";

/** 全局购买引导沿用当前主题、团队导航与页面离开确认。 */
export function InsufficientCreditsModal() {
    const translate = useTranslation();
    const router = useRouter();
    const userId = useUserStore((state) => state.user?.id);
    const teamId = useTeamStore((state) => state.team?.id);
    const prompt = useInsufficientCreditsStore((state) => state.prompt);
    const close = useInsufficientCreditsStore((state) => state.close);
    const onboardingActive = useOnboardingStore((state) => state.tour !== null);

    useLayoutEffect(() => {
        useInsufficientCreditsStore.getState().setScope(`${userId ?? "visitor"}:${teamId ?? 0}`);
    }, [userId, teamId]);

    return (
        <Modal
            title={translate("credits.insufficientTitle")}
            open={!!userId && !!prompt && !onboardingActive}
            centered
            width={420}
            style={{ maxWidth: "calc(100vw - 32px)" }}
            mask={{ closable: true }}
            zIndex={2000}
            onCancel={close}
            cancelText={translate("credits.purchaseLater")}
            okText={translate("credits.buyCredits")}
            onOk={() => { close(); router.push("/credits/purchase"); }}
        >
            <p className="text-[var(--studio-text)]">{prompt?.message || translate("credits.insufficientPurchaseSuggestion")}</p>
        </Modal>
    );
}
