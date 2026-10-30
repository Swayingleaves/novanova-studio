"use client";

import { useUserStore } from "@/features/auth/stores/use-user-store";
import { useConfigStore } from "@/features/settings/stores/use-config-store";
import { useTeamStore } from "./stores/use-team-store";
import { creditAmount, type CreditAmount } from "@/shared/lib/credit-amounts";
import { hasInsufficientCredits } from "@/features/credits/insufficient-credits";

/** 工作流按真实提供方合并同钱包费用，避免将不同钱包的阶段总价与单个钱包比较。 */
export function modelCreditRequirement(charges: { model?: string | null; credits?: CreditAmount | null }[]) {
    const team = useTeamStore.getState().team;
    const costs = useConfigStore.getState().config.modelCosts;
    const wallets = new Map<number, { requiredCredits: string; availableCredits: CreditAmount | undefined }>();
    let unknown = charges.length === 0;
    for (const charge of charges) {
        const owner = team ? costs.find((item) => item.model === charge.model)?.ownerTeamId : 0;
        if (!charge.model || charge.credits == null || owner === undefined) { unknown = true; continue; }
        const previous = wallets.get(owner);
        wallets.set(owner, { requiredCredits: creditAmount(previous?.requiredCredits ?? 0).plus(charge.credits).toFixed(), availableCredits: modelCreditBalance(charge.model) });
    }
    const requirements = [...wallets.values()];
    return requirements.find((item) => hasInsufficientCredits(item.requiredCredits, item.availableCredits))
        ?? { requiredCredits: unknown || requirements.some((item) => item.availableCredits === undefined) ? undefined : "0", availableCredits: "0" };
}

/** 模型的费用只能与实际提供方的钱包比较，未知归属或尚未加载钱包时等待服务端校验。 */
export function modelCreditBalance(model: string) {
    const team = useTeamStore.getState();
    if (!team.team) return useUserStore.getState().user?.creditBalance;
    const cost = useConfigStore.getState().config.modelCosts.find((item) => item.model === model);
    if (cost?.ownerTeamId === undefined || !team.wallets) return undefined;
    return cost.ownerTeamId === 0 ? team.wallets.platformBalance : team.wallets.teamBalance;
}

/** 图片和视频页面订阅当前所选模型对应的钱包。 */
export function useModelCreditBalance(capability: "image" | "video" | "text") {
    useTeamStore((state) => state.wallets);
    useUserStore((state) => state.user?.creditBalance);
    const model = useConfigStore((state) => state.config[`${capability}Model`]);
    return modelCreditBalance(model);
}
