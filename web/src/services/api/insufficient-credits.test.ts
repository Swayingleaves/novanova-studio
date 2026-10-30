import assert from "node:assert/strict";
import test from "node:test";
import { serverPost, ServerApiError, waitAiTask, subscribeAiTaskEvents } from "./server";
import { useInsufficientCreditsStore } from "@/features/credits/insufficient-credits";
import { useUserStore } from "@/features/auth/stores/use-user-store";

test("HTTP失败及成功状态中的业务错误触发弹框，继续抛出原错误", async () => {
    const originalFetch = globalThis.fetch;
    try {
        for (const status of [200, 500]) {
            useInsufficientCreditsStore.getState().setScope(`HTTP:${status}`);
            globalThis.fetch = async () => new Response(JSON.stringify({ code: 4000, msg: "积分不足，无法生成", data: null }), {
                status, headers: { "X-System-Message-Key": "business.insufficientCreditsToCreateGenerationTask" },
            });
            await assert.rejects(serverPost("/ai/task/createTask", {}), (error: unknown) => error instanceof ServerApiError && error.code === 4000 && error.status === status);
            assert.equal(useInsufficientCreditsStore.getState().prompt?.message, "积分不足，无法生成");
        }
        useInsufficientCreditsStore.getState().setScope("渠道额度");
        globalThis.fetch = async () => new Response(JSON.stringify({ code: 4003, msg: "insufficient_quota", data: null }), { status: 500 });
        await assert.rejects(serverPost("/ai/task/createTask", {}), ServerApiError);
        assert.equal(useInsufficientCreditsStore.getState().prompt, null);
    } finally { globalThis.fetch = originalFetch; }
});

test("空间切换后忽略旧HTTP错误", async () => {
    const originalFetch = globalThis.fetch;
    let respond!: (response: Response) => void;
    useInsufficientCreditsStore.getState().setScope("旧空间");
    globalThis.fetch = () => new Promise<Response>((resolve) => { respond = resolve; });
    try {
        const request = serverPost("/ai/task/createTask", {});
        useInsufficientCreditsStore.getState().setScope("新空间");
        respond(new Response(JSON.stringify({ code: 4000, msg: "旧空间积分不足" }), { status: 500, headers: { "X-System-Message-Key": "business.insufficientCreditsFor" } }));
        await assert.rejects(request, ServerApiError);
        assert.equal(useInsufficientCreditsStore.getState().prompt, null);
    } finally { globalThis.fetch = originalFetch; }
});

test("任务查询返回积分不足时提示，同一任务多次查询不重复弹出", async () => {
    const originalFetch = globalThis.fetch;
    useInsufficientCreditsStore.getState().setScope("异步任务");
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 0, msg: "成功", data: {
        id: "任务1", status: "failed", errorMessage: "任务积分不足", systemMessage: { key: "business.insufficientCreditsFor", arguments: [] },
    } }));
    try {
        await assert.rejects(waitAiTask("任务1"), { message: "任务积分不足" });
        assert.equal(useInsufficientCreditsStore.getState().prompt?.message, "任务积分不足");
        useInsufficientCreditsStore.getState().close();
        await assert.rejects(waitAiTask("任务1"));
        assert.equal(useInsufficientCreditsStore.getState().prompt, null);
    } finally { globalThis.fetch = originalFetch; }
});

test("在途任务查询在空间切换后不弹出旧任务的购买提示", async () => {
    const originalFetch = globalThis.fetch;
    let respond!: (response: Response) => void;
    useInsufficientCreditsStore.getState().setScope("旧任务空间");
    globalThis.fetch = () => new Promise<Response>((resolve) => { respond = resolve; });
    try {
        const request = waitAiTask("旧任务");
        useInsufficientCreditsStore.getState().setScope("新任务空间");
        respond(new Response(JSON.stringify({ code: 0, data: { id: "旧任务", status: "failed", systemMessage: { key: "business.insufficientCreditsFor", arguments: [] } } })));
        await assert.rejects(request);
        assert.equal(useInsufficientCreditsStore.getState().prompt, null);
    } finally { globalThis.fetch = originalFetch; }
});

test("任务事件触发一次提示并保持订阅回调，忽略旧空间迟到事件", () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const originalSource = Object.getOwnPropertyDescriptor(globalThis, "EventSource");
    const originalUser = useUserStore.getState();
    let source!: EventTarget;
    class TestEventSource extends EventTarget {
        constructor() { super(); source = this; }
        /** 测试事件源关闭时不建立真实连接。 */
        close() {}
    }
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { origin: "http://localhost:15555" } } });
    Object.defineProperty(globalThis, "EventSource", { configurable: true, value: TestEventSource });
    useUserStore.setState({ token: "测试令牌", expiresAt: "2099-01-01T00:00:00Z" });
    useInsufficientCreditsStore.getState().setScope("事件空间");
    let callbacks = 0;
    const unsubscribe = subscribeAiTaskEvents(() => { callbacks += 1; });
    const emit = (key: string) => source.dispatchEvent(new MessageEvent("task", { data: JSON.stringify({ task: { id: key, status: "failed", errorMessage: "任务积分不足", systemMessage: { key, arguments: [] } } }) }));
    try {
        emit("business.insufficientCreditsFor");
        assert.equal(callbacks, 1);
        assert.equal(useInsufficientCreditsStore.getState().prompt?.message, "任务积分不足");
        useInsufficientCreditsStore.getState().close();
        emit("business.insufficientCreditsFor");
        assert.equal(callbacks, 2);
        assert.equal(useInsufficientCreditsStore.getState().prompt, null);
        emit("insufficient_quota");
        assert.equal(useInsufficientCreditsStore.getState().prompt, null);
        useInsufficientCreditsStore.getState().setScope("另一个事件空间");
        emit("business.insufficientCreditsToCreateGenerationTask");
        assert.equal(useInsufficientCreditsStore.getState().prompt, null);
    } finally {
        unsubscribe();
        useUserStore.setState(originalUser);
        if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window");
        if (originalSource) Object.defineProperty(globalThis, "EventSource", originalSource); else Reflect.deleteProperty(globalThis, "EventSource");
    }
});
