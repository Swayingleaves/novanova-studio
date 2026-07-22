import assert from "node:assert/strict";
import test from "node:test";

import { refreshModelConfigurationSnapshot } from "./model-configuration-refresh.ts";

test("渠道和模型配置全部返回后才应用一致性快照", async () => {
    let resolveChannels!: (value: { channels: string[] }) => void;
    type ModelConfiguration = { modelName: string; modelType: "image" | "video" | "text" };
    let resolveModelConfigurations!: (value: { modelConfigs: ModelConfiguration[] }) => void;
    const channelPromise = new Promise<{ channels: string[] }>((resolve) => {
        resolveChannels = resolve;
    });
    const modelConfigurationPromise = new Promise<{ modelConfigs: ModelConfiguration[] }>((resolve) => {
        resolveModelConfigurations = resolve;
    });
    const snapshots: Array<{ channels: string[]; modelConfigurations: ModelConfiguration[] }> = [];

    const refreshing = refreshModelConfigurationSnapshot(
        () => channelPromise,
        () => modelConfigurationPromise,
        (channels, modelConfigurations) => snapshots.push({ channels, modelConfigurations }),
    );

    const modelConfigurations: ModelConfiguration[] = [
        { modelName: "image-model", modelType: "image" },
        { modelName: "video-model", modelType: "video" },
        { modelName: "text-model", modelType: "text" },
    ];
    resolveModelConfigurations({ modelConfigs: modelConfigurations });
    await Promise.resolve();
    assert.deepEqual(snapshots, []);

    resolveChannels({ channels: ["channel"] });
    await refreshing;
    assert.deepEqual(snapshots, [{ channels: ["channel"], modelConfigurations }]);
});

test("任一加载失败时不应用不完整快照", async () => {
    let applied = false;

    await assert.rejects(
        () =>
            refreshModelConfigurationSnapshot(
                async () => ({ channels: ["channel"] }),
                async () => {
                    throw new Error("模型配置加载失败");
                },
                () => {
                    applied = true;
                },
            ),
        /模型配置加载失败/,
    );
    assert.equal(applied, false);
});
