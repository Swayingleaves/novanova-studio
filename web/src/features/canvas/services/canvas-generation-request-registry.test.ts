import assert from "node:assert/strict";
import test from "node:test";

import { createCanvasGenerationRequestRegistry } from "./canvas-generation-request-registry.ts";

test("启动同一目标的新请求会中止旧请求", () => {
    const registry = createCanvasGenerationRequestRegistry();
    const first = new AbortController();
    const second = new AbortController();

    registry.start("target", "origin", "running", first);
    registry.start("target", "origin", "running", second);

    assert.equal(first.signal.aborted, true);
    assert.equal(registry.finish("target", second), true);
    assert.equal(registry.isRunning("running"), false);
});

test("按运行节点停止会返回全部受影响节点", () => {
    const registry = createCanvasGenerationRequestRegistry();
    registry.start("child", "origin", "running", new AbortController());

    assert.deepEqual([...registry.stopByRunningId("running")].sort(), ["child", "origin"]);
    assert.equal(registry.isRunning("running"), false);
});

test("停止全部请求会中止控制器并清空注册表", () => {
    const registry = createCanvasGenerationRequestRegistry();
    const first = new AbortController();
    const second = new AbortController();
    registry.start("first", "origin", "running", first);
    registry.start("second", "origin", "running", second);

    registry.stopAll();

    assert.equal(first.signal.aborted, true);
    assert.equal(second.signal.aborted, true);
    assert.equal(registry.isRunning("running"), false);
});
