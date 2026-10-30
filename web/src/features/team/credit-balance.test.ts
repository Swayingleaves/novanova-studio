import assert from "node:assert/strict";
import test from "node:test";
import { modelCreditBalance, modelCreditRequirement } from "./credit-balance";
import { useTeamStore } from "./stores/use-team-store";
import { useConfigStore } from "@/features/settings/stores/use-config-store";

test("工作流按真实钱包合计费用，未知钱包不提前判定", () => {
    const originalTeam = useTeamStore.getState();
    const originalConfig = useConfigStore.getState().config;
    try {
        useTeamStore.setState({ team: { id: 7, teamSlug: "测试团队", name: "测试团队", logoUrl: "", enabled: true }, wallets: { platformBalance: "5", teamBalance: "8" } });
        useConfigStore.setState({ config: { ...originalConfig, modelCosts: [
            { model: "平台图片", taskType: "image", credits: "3", unit: "generation", ownerTeamId: 0 },
            { model: "团队视频", taskType: "video", credits: "7", unit: "generation", ownerTeamId: 7 },
        ] } });
        assert.equal(modelCreditBalance("平台图片"), "5");
        assert.equal(modelCreditBalance("团队视频"), "8");
        assert.equal(modelCreditBalance("未知模型"), undefined);
        const enough = modelCreditRequirement([{ model: "平台图片", credits: "3" }, { model: "团队视频", credits: "7" }]);
        assert.equal(enough.requiredCredits, "0");
        const insufficient = modelCreditRequirement([{ model: "平台图片", credits: "3" }, { model: "平台图片", credits: "3" }, { model: "团队视频", credits: "7" }]);
        assert.deepEqual(insufficient, { requiredCredits: "6", availableCredits: "5" });
        assert.equal(modelCreditRequirement([{ model: "未知模型", credits: "10" }]).requiredCredits, undefined);
        useTeamStore.setState({ wallets: null });
        assert.equal(modelCreditRequirement([{ model: "平台图片", credits: "3" }]).requiredCredits, undefined);
    } finally {
        useTeamStore.setState(originalTeam);
        useConfigStore.setState({ config: originalConfig });
    }
});
