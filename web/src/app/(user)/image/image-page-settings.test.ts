import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const imagePageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

test("历史任务的更多设置回显该轮模型渠道", () => {
    assert.ok(imagePageSource.includes('const historyModel = !imageDraftSettingsModified && activeId && latestRound?.config ? latestRound.config.imageModel || latestRound.config.model || "" : "";'), "历史任务模型未从该轮配置读取");
    assert.ok(imagePageSource.includes("value={historyModel || model}"), "更多设置模型未优先使用历史任务模型");
});
