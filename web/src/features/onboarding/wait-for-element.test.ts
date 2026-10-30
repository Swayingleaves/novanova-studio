import assert from "node:assert/strict";
import test from "node:test";
import { waitForElement } from "./wait-for-element";

test("元素已存在时立即返回，不进入轮询", async () => {
    const element = { id: "target" } as unknown as Element;
    let calls = 0;
    const result = await waitForElement('[data-tour="x"]', {
        query: () => {
            calls += 1;
            return element;
        },
    });
    assert.equal(result, element);
    assert.equal(calls, 1);
});

test("超时未出现时返回 null，并停止轮询", async () => {
    let calls = 0;
    const result = await waitForElement('[data-tour="x"]', {
        timeoutMs: 40,
        intervalMs: 10,
        query: () => {
            calls += 1;
            return null;
        },
    });
    assert.equal(result, null);
    const callsAtTimeout = calls;
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(calls, callsAtTimeout);
});

test("元素在轮询过程中出现时返回该元素并停止轮询", async () => {
    const element = { id: "late" } as unknown as Element;
    let calls = 0;
    const result = await waitForElement('[data-tour="x"]', {
        timeoutMs: 500,
        intervalMs: 10,
        query: () => {
            calls += 1;
            return calls >= 2 ? element : null;
        },
    });
    assert.equal(result, element);
    const callsAtResolve = calls;
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(calls, callsAtResolve);
});
