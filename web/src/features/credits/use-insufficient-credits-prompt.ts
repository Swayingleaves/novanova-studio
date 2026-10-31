"use client";

import { useEffect, useRef } from "react";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { useTeamStore } from "@/features/team/stores/use-team-store";
import { creditText, type CreditAmount } from "@/shared/lib/credit-amounts";
import { useTranslation } from "@/features/locale/use-translation";
import { hasInsufficientCredits, showInsufficientCredits } from "./insufficient-credits";

/** 观察当前可见操作的有效报价，只在进入不足状态时自动提示。 */
export function useInsufficientCreditsPrompt({ enabled = true, requiredCredits, availableCredits, message, contextKey = "" }: {
    enabled?: boolean;
    requiredCredits: CreditAmount | null | undefined;
    availableCredits: CreditAmount | null | undefined;
    message?: string;
    contextKey?: string;
}) {
    const translate = useTranslation();
    const userId = useUserStore((state) => state.user?.id);
    const teamId = useTeamStore((state) => state.team?.id);
    // 读取钱包的调用方也会在余额变化后重新计算报价对应的钱包。
    useUserStore((state) => state.user?.creditBalance);
    useTeamStore((state) => state.wallets);
    const previous = useRef({ scope: "", insufficient: false });
    const scope = `${userId ?? "visitor"}:${teamId ?? 0}:${contextKey}`;
    const insufficient = hasInsufficientCredits(requiredCredits, availableCredits);

    useEffect(() => {
        if (previous.current.scope !== scope || !enabled || !userId) previous.current = { scope, insufficient: false };
        if (!enabled || !userId || insufficient === undefined) return;
        if (insufficient && !previous.current.insufficient) {
            showInsufficientCredits(message ?? translate("credits.insufficientForOperation", { required: creditText(requiredCredits!), available: creditText(availableCredits!) }));
        }
        previous.current.insufficient = insufficient;
    }, [enabled, insufficient, message, requiredCredits, availableCredits, scope, userId, translate]);

    return enabled && insufficient === true;
}
