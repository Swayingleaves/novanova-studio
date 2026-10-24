import assert from "node:assert/strict";
import test from "node:test";

import {
    startServiceWorkerLifecycle,
    type ServiceWorkerContainerLike,
    type ServiceWorkerLifecycleEnv,
    type ServiceWorkerLike,
    type ServiceWorkerRegistrationLike,
} from "./sw-lifecycle.ts";
import { usePwaStore } from "./use-pwa-store.ts";

const SW_PATH = "/novanova-sw.js";
const SCOPE = "/";
const ORIGIN = "https://app.example.com";

function createFakeWorker(state: string, scriptURL = `${ORIGIN}${SW_PATH}`) {
    const listeners = new Map<string, Set<() => void>>();
    return {
        state,
        scriptURL,
        messages: [] as Array<Record<string, unknown>>,
        postMessage(message: Record<string, unknown>) {
            this.messages.push(message);
        },
        addEventListener(type: string, listener: () => void) {
            const set = listeners.get(type) ?? new Set();
            set.add(listener);
            listeners.set(type, set);
        },
        removeEventListener(type: string, listener: () => void) {
            listeners.get(type)?.delete(listener);
        },
        setState(state: string) {
            this.state = state;
            for (const listener of listeners.get("statechange") ?? []) {
                listener();
            }
        },
    };
}

function createFakeRegistration(scriptURL = `${ORIGIN}${SW_PATH}`) {
    const listeners = new Map<string, Set<() => void>>();
    return {
        scope: SCOPE,
        scriptURL,
        installing: null as ReturnType<typeof createFakeWorker> | null,
        waiting: null as ReturnType<typeof createFakeWorker> | null,
        active: null as ReturnType<typeof createFakeWorker> | null,
        updateCalls: 0,
        async update() {
            this.updateCalls += 1;
            return this;
        },
        addEventListener(type: string, listener: () => void) {
            const set = listeners.get(type) ?? new Set();
            set.add(listener);
            listeners.set(type, set);
        },
        removeEventListener(type: string, listener: () => void) {
            listeners.get(type)?.delete(listener);
        },
        dispatch(type: string) {
            for (const listener of listeners.get(type) ?? []) {
                listener();
            }
        },
    };
}

interface FakeEnv extends ServiceWorkerLifecycleEnv {
    /** 测试中需要切换在线状态，覆盖基接口的只读声明 */
    onLine: boolean;
    serviceWorker: ServiceWorkerContainerLike & {
        controller: ServiceWorkerLike | null;
        existingRegistration: ServiceWorkerRegistrationLike | undefined;
        registrationToReturn: ServiceWorkerRegistrationLike | undefined;
        registerCalls: Array<{ url: string; options: { scope: string; updateViaCache: string } }>;
        dispatch(type: string): void;
    };
    reloadCount: number;
    timeoutHandlers: Array<{ handler: () => void; ms: number }>;
    intervalHandlers: Array<{ handler: () => void; ms: number }>;
    dispatchWindow(type: string): void;
    fireTimeout(index: number): void;
    fireInterval(index: number): void;
}

function createFakeEnv(overrides?: Partial<ServiceWorkerLifecycleEnv>): FakeEnv {
    const containerListeners = new Map<string, Set<() => void>>();
    const windowListeners = new Map<string, Set<() => void>>();
    const env: FakeEnv = {
        isProd: true,
        isSecureContext: true,
        supportsServiceWorker: true,
        onLine: true,
        reloadCount: 0,
        timeoutHandlers: [],
        intervalHandlers: [],
        serviceWorker: {
            controller: null,
            existingRegistration: undefined,
            registrationToReturn: undefined,
            registerCalls: [],
            async getRegistration() {
                return env.serviceWorker.existingRegistration;
            },
            async register(url, options) {
                env.serviceWorker.registerCalls.push({ url, options: { ...options } });
                return env.serviceWorker.registrationToReturn!;
            },
            addEventListener(type, listener) {
                const set = containerListeners.get(type) ?? new Set();
                set.add(listener);
                containerListeners.set(type, set);
            },
            removeEventListener(type, listener) {
                containerListeners.get(type)?.delete(listener);
            },
            dispatch(type) {
                for (const listener of containerListeners.get(type) ?? []) {
                    listener();
                }
            },
        },
        reload() {
            env.reloadCount += 1;
        },
        addEventListener(type, listener) {
            const set = windowListeners.get(type) ?? new Set();
            set.add(listener);
            windowListeners.set(type, set);
        },
        removeEventListener(type, listener) {
            windowListeners.get(type)?.delete(listener);
        },
        setTimeout(handler, ms) {
            env.timeoutHandlers.push({ handler, ms });
            return env.timeoutHandlers.length - 1;
        },
        clearTimeout(handle) {
            if (typeof handle === "number") {
                delete env.timeoutHandlers[handle];
            }
        },
        setInterval(handler, ms) {
            env.intervalHandlers.push({ handler, ms });
            return env.intervalHandlers.length - 1;
        },
        clearInterval(handle) {
            if (typeof handle === "number") {
                delete env.intervalHandlers[handle];
            }
        },
        dispatchWindow(type) {
            for (const listener of windowListeners.get(type) ?? []) {
                listener();
            }
        },
        fireTimeout(index) {
            env.timeoutHandlers[index]?.handler();
        },
        fireInterval(index) {
            env.intervalHandlers[index]?.handler();
        },
        ...overrides,
    };
    return env;
}

function resetStore() {
    usePwaStore.getState().reset();
}

async function startDefault(env: FakeEnv) {
    const registration = createFakeRegistration();
    env.serviceWorker.registrationToReturn = registration;
    const lifecycle = startServiceWorkerLifecycle(env, {
        swPath: SW_PATH,
        scope: SCOPE,
        activateTimeoutMs: 10_000,
        updatePollMs: 30 * 60 * 1000,
    });
    // 等待异步注册完成
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { lifecycle, registration };
}

test("dev 环境绝不注册 SW", async () => {
    resetStore();
    const env = createFakeEnv({ isProd: false });
    const { lifecycle } = await startDefault(env);

    assert.equal(env.serviceWorker.registerCalls.length, 0);
    assert.equal(env.intervalHandlers.length, 0);

    lifecycle.destroy();
    resetStore();
});

test("非安全上下文或无 SW 支持时不注册", async () => {
    resetStore();
    for (const overrides of [{ isSecureContext: false }, { supportsServiceWorker: false }] as const) {
        const env = createFakeEnv(overrides);
        const { lifecycle } = await startDefault(env);
        assert.equal(env.serviceWorker.registerCalls.length, 0);
        lifecycle.destroy();
    }
    resetStore();
});

test("满足条件时按预期参数注册 SW", async () => {
    resetStore();
    const env = createFakeEnv();
    const { lifecycle } = await startDefault(env);

    assert.equal(env.serviceWorker.registerCalls.length, 1);
    assert.deepEqual(env.serviceWorker.registerCalls[0], {
        url: SW_PATH,
        options: { scope: SCOPE, updateViaCache: "none" },
    });

    lifecycle.destroy();
    resetStore();
});

test("已有其他应用的 SW 注册时跳过不接管", async () => {
    resetStore();
    const env = createFakeEnv();
    const foreign = createFakeRegistration(`${ORIGIN}/other-app-sw.js`);
    foreign.active = createFakeWorker("activated", `${ORIGIN}/other-app-sw.js`);
    env.serviceWorker.existingRegistration = foreign;
    const { lifecycle } = await startDefault(env);

    assert.equal(env.serviceWorker.registerCalls.length, 0);

    lifecycle.destroy();
    resetStore();
});

test("updatefound 后新 worker installed 且已有 controller 时置 updateReady", async () => {
    resetStore();
    const env = createFakeEnv();
    env.serviceWorker.controller = createFakeWorker("activated");
    const { lifecycle, registration } = await startDefault(env);

    const newWorker = createFakeWorker("installing");
    registration.installing = newWorker;
    registration.dispatch("updatefound");
    assert.equal(usePwaStore.getState().updateReady, false);

    newWorker.setState("installed");
    assert.equal(usePwaStore.getState().updateReady, true);

    lifecycle.destroy();
    resetStore();
});

test("首次安装（无 controller）不置 updateReady", async () => {
    resetStore();
    const env = createFakeEnv();
    const { lifecycle, registration } = await startDefault(env);

    const newWorker = createFakeWorker("installing");
    registration.installing = newWorker;
    registration.dispatch("updatefound");
    newWorker.setState("installed");

    assert.equal(usePwaStore.getState().updateReady, false);

    lifecycle.destroy();
    resetStore();
});

test("applyUpdate：向 waiting worker 发送激活消息并置 updating", async () => {
    resetStore();
    const env = createFakeEnv();
    const { lifecycle, registration } = await startDefault(env);

    const waiting = createFakeWorker("installed");
    registration.waiting = waiting;
    usePwaStore.getState().setUpdateReady(true);

    lifecycle.applyUpdate();

    assert.deepEqual(waiting.messages, [{ type: "PWA_ACTIVATE" }]);
    assert.equal(usePwaStore.getState().updating, true);
    assert.equal(usePwaStore.getState().updateReady, false);

    lifecycle.destroy();
    resetStore();
});

test("controllerchange 触发页面 reload", async () => {
    resetStore();
    const env = createFakeEnv();
    const { lifecycle, registration } = await startDefault(env);
    registration.waiting = createFakeWorker("installed");

    lifecycle.applyUpdate();
    env.serviceWorker.dispatch("controllerchange");

    assert.equal(env.reloadCount, 1);

    lifecycle.destroy();
    resetStore();
});

test("激活超时置 updateFailed 并复位 updating", async () => {
    resetStore();
    const env = createFakeEnv();
    const { lifecycle, registration } = await startDefault(env);
    registration.waiting = createFakeWorker("installed");

    lifecycle.applyUpdate();
    assert.equal(env.timeoutHandlers.length, 1);
    env.fireTimeout(0);

    const state = usePwaStore.getState();
    assert.equal(state.updateFailed, true);
    assert.equal(state.updating, false);

    lifecycle.destroy();
    resetStore();
});

test("online / focus / 定时轮询触发 registration.update，离线时不触发", async () => {
    resetStore();
    const env = createFakeEnv();
    const { lifecycle, registration } = await startDefault(env);
    assert.equal((registration as ReturnType<typeof createFakeRegistration>).updateCalls, 0);

    env.dispatchWindow("online");
    assert.equal(registration.updateCalls, 1);

    env.dispatchWindow("focus");
    assert.equal(registration.updateCalls, 2);

    env.fireInterval(0);
    assert.equal(registration.updateCalls, 3);

    env.onLine = false;
    env.dispatchWindow("online");
    assert.equal(registration.updateCalls, 3);

    lifecycle.destroy();
    resetStore();
});

test("destroy 后事件与轮询不再产生副作用", async () => {
    resetStore();
    const env = createFakeEnv();
    const { lifecycle, registration } = await startDefault(env);
    registration.waiting = createFakeWorker("installed");

    lifecycle.applyUpdate();
    lifecycle.destroy();

    env.dispatchWindow("online");
    env.fireInterval(0);
    env.serviceWorker.dispatch("controllerchange");
    env.fireTimeout(0);

    assert.equal(registration.updateCalls, 0);
    assert.equal(env.reloadCount, 0);
    assert.equal(usePwaStore.getState().updateFailed, false);

    resetStore();
});
