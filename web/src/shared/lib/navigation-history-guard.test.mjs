import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHistoryLeaveGuard, trackNavigationHistory } from "./navigation-history-guard.ts";

test("历史导航兼容重复挂载和 Next.js 包装，取消恢复原位，同页不确认，确认后允许后退与前进", async () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const browser = new EventTarget();
    const entries = [{ state: { __NA: true, tree: "首页" }, address: "/" }];
    let pointer = 0;
    const accepted = [];
    const history = {
        get state() { return entries[pointer].state; },
        pushState(state, _unused, address) { entries.splice(pointer + 1); entries.push({ state, address }); pointer += 1; },
        replaceState(state, _unused, address) { entries[pointer] = { state, address: address ?? entries[pointer].address }; },
        go(distance) {
            pointer += distance;
            const event = new Event("popstate");
            Object.defineProperty(event, "state", { value: entries[pointer].state });
            browser.dispatchEvent(event);
        },
    };
    browser.history = history;
    Object.defineProperty(browser, "location", { get: () => new URL(entries[pointer].address, "http://localhost:15555") });
    Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
    const disposeTransient = trackNavigationHistory();
    disposeTransient();
    const dispose = trackNavigationHistory();
    // 模拟 Next.js 在被保护页面的根组件完成挂载后包装原生历史方法。
    const originalPush = history.pushState;
    history.pushState = function (state, unused, address) { originalPush.call(this, { ...state, __NA: true }, unused, address); };
    await new Promise((resolve) => setImmediate(resolve));
    browser.addEventListener("popstate", () => accepted.push(entries[pointer].address));
    let unregister = () => {};
    try {
        history.pushState({ __NA: true, tree: "图片" }, "", "/image");
        history.pushState({ __NA: true, tree: "后台" }, "", "/admin/system");
        history.replaceState({ ...history.state, tree: "配置" }, "", "/admin/system");
        assert.equal(history.state.__NA, true);
        assert.equal(history.state.tree, "配置");
        assert.equal(history.state.novanovaNavigation.position, 2);
        let respond;
        let calls = 0;
        unregister = registerHistoryLeaveGuard(() => { calls += 1; return new Promise((resolve) => { respond = resolve; }); });
        history.pushState({ tree: "同页参数" }, "", "/admin/system?tab=configuration");
        history.go(-1);
        assert.equal(calls, 0);
        assert.equal(pointer, 2);
        assert.deepEqual(accepted, ["/admin/system"]);
        accepted.length = 0;
        history.go(-1);
        assert.equal(pointer, 2);
        assert.deepEqual(accepted, []);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(calls, 1);
        respond(false);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(pointer, 2);
        history.go(-1);
        await new Promise((resolve) => setImmediate(resolve));
        respond(true);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(pointer, 1);
        assert.deepEqual(accepted, ["/image"]);
        history.go(1);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(pointer, 1);
        respond(false);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(pointer, 1);
        unregister();
        history.go(1);
        assert.equal(pointer, 2);
        assert.deepEqual(accepted, ["/image", "/admin/system"]);
    } finally {
        unregister(); dispose();
        if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
        else Reflect.deleteProperty(globalThis, "window");
    }
});
