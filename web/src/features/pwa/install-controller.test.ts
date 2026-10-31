import assert from "node:assert/strict";
import test from "node:test";

import { createInstallController, type InstallControllerEnv, type MediaQueryListLike } from "./install-controller.ts";
import { usePwaStore } from "./use-pwa-store.ts";

const CHROME_UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

interface FakeMediaQueryList {
    matches: boolean;
    addEventListener(type: "change", listener: () => void): void;
    removeEventListener(type: "change", listener: () => void): void;
    /** 模拟 display-mode 变化并通知监听者 */
    setMatches(matches: boolean): void;
}

function createFakeMediaQueryList(initialMatches: boolean): FakeMediaQueryList {
    const listeners = new Set<() => void>();
    return {
        matches: initialMatches,
        addEventListener(_type, listener) {
            listeners.add(listener);
        },
        removeEventListener(_type, listener) {
            listeners.delete(listener);
        },
        setMatches(matches) {
            this.matches = matches;
            for (const listener of listeners) {
                listener();
            }
        },
    };
}

interface FakeEnv extends InstallControllerEnv {
    /** 手动触发一次窗口事件 */
    dispatch(type: string, event: unknown): void;
    /** display-mode 媒体查询（standalone 查询） */
    standaloneQuery: FakeMediaQueryList;
}

function createFakeEnv(overrides?: Partial<InstallControllerEnv>): FakeEnv {
    const windowListeners = new Map<string, Set<(event: Event) => void>>();
    const standaloneQuery = createFakeMediaQueryList(false);
    const env: FakeEnv = {
        userAgent: CHROME_UA,
        isSecureContext: true,
        maxTouchPoints: 0,
        standaloneFlag: false,
        matchMedia(query) {
            if (query === "(display-mode: standalone)") {
                return standaloneQuery;
            }
            return createFakeMediaQueryList(false) as MediaQueryListLike;
        },
        addEventListener(type, listener) {
            const set = windowListeners.get(type) ?? new Set();
            set.add(listener);
            windowListeners.set(type, set);
        },
        removeEventListener(type, listener) {
            windowListeners.get(type)?.delete(listener);
        },
        dispatch(type, event) {
            for (const listener of windowListeners.get(type) ?? []) {
                listener(event as Event);
            }
        },
        standaloneQuery,
        ...overrides,
    };
    return env;
}

interface FakePromptEvent {
    preventDefaultCount: number;
    promptCallCount: number;
    userChoiceOutcome: "accepted" | "dismissed";
    promptError: Error | null;
    preventDefault(): void;
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function createFakePromptEvent(options?: { outcome?: "accepted" | "dismissed"; promptError?: Error }): FakePromptEvent {
    const event: FakePromptEvent = {
        preventDefaultCount: 0,
        promptCallCount: 0,
        userChoiceOutcome: options?.outcome ?? "accepted",
        promptError: options?.promptError ?? null,
        preventDefault() {
            event.preventDefaultCount += 1;
        },
        prompt() {
            event.promptCallCount += 1;
            if (event.promptError) {
                return Promise.reject(event.promptError);
            }
            return Promise.resolve();
        },
        get userChoice() {
            return Promise.resolve({ outcome: event.userChoiceOutcome, platform: "web" });
        },
    };
    return event;
}

function resetStore() {
    usePwaStore.getState().reset();
}

test("start 探测平台并写入 store 初始状态", () => {
    resetStore();
    const env = createFakeEnv();
    const controller = createInstallController(env);

    controller.start();

    const state = usePwaStore.getState();
    assert.equal(state.platform, "chromium-desktop");
    assert.equal(state.guideKind, "chrome-menu");
    assert.equal(state.standalone, false);

    controller.stop();
    resetStore();
});

test("start 时 matchMedia 已是 standalone 则写入 standalone 并隐藏入口", () => {
    resetStore();
    const env = createFakeEnv();
    env.standaloneQuery.matches = true;
    const controller = createInstallController(env);

    controller.start();

    assert.equal(usePwaStore.getState().standalone, true);

    controller.stop();
    resetStore();
});

test("beforeinstallprompt：preventDefault 被调用并置 canPrompt", () => {
    resetStore();
    const env = createFakeEnv();
    const controller = createInstallController(env);
    controller.start();

    const event = createFakePromptEvent();
    env.dispatch("beforeinstallprompt", event);

    assert.equal(event.preventDefaultCount, 1);
    assert.equal(usePwaStore.getState().canPrompt, true);

    controller.stop();
    resetStore();
});

test("standalone 模式下 beforeinstallprompt 被忽略（不 preventDefault）", () => {
    resetStore();
    const env = createFakeEnv();
    env.standaloneQuery.matches = true;
    const controller = createInstallController(env);
    controller.start();

    const event = createFakePromptEvent();
    env.dispatch("beforeinstallprompt", event);

    assert.equal(event.preventDefaultCount, 0);
    assert.equal(usePwaStore.getState().canPrompt, false);

    controller.stop();
    resetStore();
});

test("requestInstall：无 deferred 时降级打开手动引导弹窗", async () => {
    resetStore();
    const env = createFakeEnv();
    const controller = createInstallController(env);
    controller.start();

    await controller.requestInstall();

    assert.equal(usePwaStore.getState().guideOpen, true);
    assert.equal(usePwaStore.getState().installing, false);

    controller.stop();
    resetStore();
});

test("requestInstall：deferred 存在时 prompt 被同步调用（紧贴用户手势栈）且 installing 复位", async () => {
    resetStore();
    const env = createFakeEnv();
    const controller = createInstallController(env);
    controller.start();

    const event = createFakePromptEvent();
    env.dispatch("beforeinstallprompt", event);

    // 不 await，先断言 prompt 已在同步栈内被调用
    const pending = controller.requestInstall();
    assert.equal(event.promptCallCount, 1);
    assert.equal(usePwaStore.getState().installing, true);

    await pending;
    assert.equal(usePwaStore.getState().installing, false);
    assert.equal(usePwaStore.getState().guideOpen, false);

    controller.stop();
    resetStore();
});

test("requestInstall：prompt 抛异常时降级打开引导弹窗", async () => {
    resetStore();
    const env = createFakeEnv();
    const controller = createInstallController(env);
    controller.start();

    const event = createFakePromptEvent({ promptError: new Error("not allowed") });
    env.dispatch("beforeinstallprompt", event);

    await controller.requestInstall();

    assert.equal(usePwaStore.getState().guideOpen, true);
    assert.equal(usePwaStore.getState().installing, false);

    controller.stop();
    resetStore();
});

test("appinstalled：清空 deferred、置 installedThisSession 并隐藏入口", async () => {
    resetStore();
    const env = createFakeEnv();
    const controller = createInstallController(env);
    controller.start();

    const event = createFakePromptEvent();
    env.dispatch("beforeinstallprompt", event);
    assert.equal(usePwaStore.getState().canPrompt, true);

    env.dispatch("appinstalled", {});
    assert.equal(usePwaStore.getState().installedThisSession, true);
    assert.equal(usePwaStore.getState().canPrompt, false);

    // 已安装后再次点击入口：直接返回，不再触发 prompt 或引导
    await controller.requestInstall();
    assert.equal(event.promptCallCount, 0);
    assert.equal(usePwaStore.getState().guideOpen, false);

    controller.stop();
    resetStore();
});

test("display-mode 变为 standalone：置 standalone 并清空 deferred", () => {
    resetStore();
    const env = createFakeEnv();
    const controller = createInstallController(env);
    controller.start();

    const event = createFakePromptEvent();
    env.dispatch("beforeinstallprompt", event);
    assert.equal(usePwaStore.getState().canPrompt, true);

    env.standaloneQuery.setMatches(true);

    assert.equal(usePwaStore.getState().standalone, true);
    assert.equal(usePwaStore.getState().canPrompt, false);

    controller.stop();
    resetStore();
});

test("stop：移除全部监听，后续事件不再影响 store", () => {
    resetStore();
    const env = createFakeEnv();
    const controller = createInstallController(env);
    controller.start();
    controller.stop();

    const event = createFakePromptEvent();
    env.dispatch("beforeinstallprompt", event);
    env.dispatch("appinstalled", {});
    env.standaloneQuery.setMatches(true);

    const state = usePwaStore.getState();
    assert.equal(event.preventDefaultCount, 0);
    assert.equal(state.canPrompt, false);
    assert.equal(state.installedThisSession, false);
    assert.equal(state.standalone, false);

    resetStore();
});

test("installing 进行中重复 requestInstall 直接返回", async () => {
    resetStore();
    const env = createFakeEnv();
    const controller = createInstallController(env);
    controller.start();

    // 构造一个 pending 的 prompt
    let resolvePrompt: () => void = () => {};
    const event = {
        preventDefaultCount: 0,
        promptCallCount: 0,
        preventDefault() {
            event.preventDefaultCount += 1;
        },
        prompt() {
            event.promptCallCount += 1;
            return new Promise<void>((resolve) => {
                resolvePrompt = resolve;
            });
        },
        userChoice: Promise.resolve({ outcome: "accepted" as const, platform: "web" }),
    };
    env.dispatch("beforeinstallprompt", event);

    const first = controller.requestInstall();
    assert.equal(event.promptCallCount, 1);

    const second = controller.requestInstall();
    await second;
    // 第二次调用未再次触发 prompt
    assert.equal(event.promptCallCount, 1);

    resolvePrompt();
    await first;
    assert.equal(usePwaStore.getState().installing, false);

    controller.stop();
    resetStore();
});
