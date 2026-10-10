import assert from "node:assert/strict";
import test from "node:test";
import type { ModelChannel } from "@/features/settings/stores/use-config-store";
import type { ServerModelConfig } from "@/services/api/server";
import { blockingModelConfigDependencyIssues, createDraftModelConfigs, modelConfigDependencyIssues, reconcileModelConfigDraft, updateModelConfigSelection } from "./model-config-draft";

/** 构造模型配置，测试保留用户配置内容及服务器标识。 */
function configuration(id: string, modelName: string, patch: Partial<ServerModelConfig> = {}): ServerModelConfig {
    return {
        id,
        channelId: "channel",
        modelName,
        modelType: "text",
        capabilities: [],
        defaultModel: false,
        sortOrder: 0,
        creditCost: 0,
        creditUnit: "generation",
        thinkingEnabled: true,
        reasoningEffort: "high",
        requestConcurrency: 1,
        customBodyParameters: {},
        videoBillingConfiguration: null,
        displayName: null,
        modelIcon: null,
        isCustomModel: false,
        customModelConfig: {},
        ...patch,
    };
}

const channels: ModelChannel[] = [{ id: "channel", name: "已保存渠道", models: ["new-model"], apiKey: "", apiFormat: "openai", baseUrl: "" }];

test("失效旧模型不阻塞其他模型新增，修改失效模型或将其设为默认仍被明确阻止", () => {
    const stale = configuration("persisted", "removed-model");
    const fresh = configuration("draft", "new-model");
    const sameContent = (first: ServerModelConfig, second: ServerModelConfig) => first.creditCost === second.creditCost;
    assert.deepEqual(blockingModelConfigDependencyIssues(channels, [stale, fresh], [stale], sameContent), []);
    assert.equal(blockingModelConfigDependencyIssues(channels, [{ ...stale, creditCost: 20 }, fresh], [stale], sameContent)[0].configuration.modelName, "removed-model");
    assert.equal(blockingModelConfigDependencyIssues(channels, [{ ...stale, defaultModel: true }], [stale], sameContent).length, 1);
    assert.equal(blockingModelConfigDependencyIssues(channels, [configuration("draft", "removed-model")], [stale], sameContent).length, 1);
    assert.deepEqual(blockingModelConfigDependencyIssues(channels, [fresh], [stale], sameContent), []);
});

test("失效旧配置明确列出，但正常新增模型不被误报为渠道未保存", () => {
    const stale = configuration("persisted", "removed-model");
    const fresh = configuration("draft", "new-model");
    assert.deepEqual(modelConfigDependencyIssues(channels, [stale, fresh]), [{ configuration: stale, channelName: "已保存渠道", reason: "模型已不在渠道列表中" }]);
    assert.equal(modelConfigDependencyIssues(channels, [fresh]).length, 0);
    const missingChannel = configuration("draft", "new-model", { channelId: "unsaved" });
    assert.equal(modelConfigDependencyIssues(channels, [missingChannel])[0].reason, "所属渠道尚未保存或已不存在");
});

test("取消并重新选择已保存模型时复用标识、价格和自定义参数，不再次创建", async () => {
    const baseline = configuration("server-id", "provider::model", { creditCost: 20, customBodyParameters: { temperature: 0.5 } });
    const selected = updateModelConfigSelection([], [baseline], "text", ["channel::provider::model"], () => {
        throw new Error("已有模型不应创建新草稿");
    });
    assert.deepEqual(selected, [baseline]);
    await createDraftModelConfigs(
        selected,
        [baseline],
        async () => {
            throw new Error("已有模型不应发起新增请求");
        },
        () => {},
    );
});

test("新模型名称含双冒号时保留完整名称及渠道标识", () => {
    const selected = updateModelConfigSelection([], [], "text", ["channel::provider::model"], (channelId, modelName) => configuration("draft", modelName, { channelId }));
    assert.equal(selected[0].channelId, "channel");
    assert.equal(selected[0].modelName, "provider::model");
});

test("重新选择原默认模型时不覆盖草稿中新选择的默认模型", () => {
    const originalDefault = configuration("original", "old-default", { defaultModel: true });
    const chosenDefault = configuration("chosen", "new-default", { defaultModel: true });
    const selected = updateModelConfigSelection([chosenDefault], [originalDefault, { ...chosenDefault, defaultModel: false }], "text", ["channel::old-default", "channel::new-default"], () => {
        throw new Error("不应新增模型");
    });
    assert.deepEqual(
        selected.filter((configuration) => configuration.defaultModel).map((configuration) => configuration.id),
        ["chosen"],
    );
});

test("批量创建中途失败仍保留成功标识，重试只创建剩余模型", async () => {
    let drafts = [configuration("draft-first", "first"), configuration("draft-second", "second")];
    const baseline: ServerModelConfig[] = [];
    await assert.rejects(
        createDraftModelConfigs(
            drafts,
            baseline,
            async (draft) => {
                if (draft.modelName === "second") throw new Error("第二个模型保存失败");
                return { ...draft, id: "server-first" };
            },
            (nextDrafts, saved) => {
                drafts = nextDrafts;
                baseline.push(saved);
            },
        ),
        /第二个模型保存失败/,
    );
    assert.equal(drafts[0].id, "server-first");
    const requested: string[] = [];
    drafts = await createDraftModelConfigs(
        drafts,
        baseline,
        async (draft) => {
            requested.push(draft.modelName);
            return { ...draft, id: "server-second" };
        },
        () => {},
    );
    assert.deepEqual(requested, ["second"]);
    assert.deepEqual(
        drafts.map((draft) => draft.id),
        ["server-first", "server-second"],
    );
});

test("响应丢失或并发新增后以真实配置恢复标识，保留用户修改及删除意图", () => {
    const draft = configuration("temporary", "same-name", { creditCost: 99 });
    const persisted = configuration("server-id", "same-name", { creditCost: 1 });
    const otherType = configuration("image-id", "same-name", { modelType: "image" });
    assert.deepEqual(reconcileModelConfigDraft([draft], [persisted, otherType]), [{ ...draft, id: "server-id" }]);
    assert.deepEqual(reconcileModelConfigDraft([], [persisted]), []);
});
