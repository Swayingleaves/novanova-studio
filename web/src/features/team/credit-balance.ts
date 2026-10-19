"use client";

import { useUserStore } from "@/features/auth/stores/use-user-store";
import { useConfigStore } from "@/features/settings/stores/use-config-store";
import { useTeamStore } from "./stores/use-team-store";

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
