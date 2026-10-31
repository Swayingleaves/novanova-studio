"use client";

import { usePwaStore } from "./use-pwa-store";

/** ServiceWorker 的最小接口抽象（单测注入假实现） */
export interface ServiceWorkerLike {
    readonly state: string;
    readonly scriptURL?: string;
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
    postMessage(message: unknown): void;
}

export interface ServiceWorkerRegistrationLike {
    readonly scope: string;
    readonly installing: ServiceWorkerLike | null;
    readonly waiting: ServiceWorkerLike | null;
    readonly active: ServiceWorkerLike | null;
    update(): Promise<unknown>;
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
}

export interface ServiceWorkerContainerLike {
    readonly controller: ServiceWorkerLike | null;
    register(url: string, options: { scope: string; updateViaCache: "none" }): Promise<ServiceWorkerRegistrationLike>;
    getRegistration(scope?: string): Promise<ServiceWorkerRegistrationLike | undefined>;
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
}

/** lifecycle 模块依赖的环境（浏览器实现由 browserEnv 提供） */
export interface ServiceWorkerLifecycleEnv {
    /** 是否生产构建（dev 绝不注册 SW） */
    readonly isProd: boolean;
    readonly isSecureContext: boolean;
    readonly supportsServiceWorker: boolean;
    readonly onLine: boolean;
    readonly serviceWorker: ServiceWorkerContainerLike;
    reload(): void;
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
    setTimeout(handler: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
    setInterval(handler: () => void, ms: number): unknown;
    clearInterval(handle: unknown): void;
}

export interface ServiceWorkerLifecycleOptions {
    /** SW 脚本绝对地址（相对 origin 的路径） */
    readonly swPath: string;
    /** 注册 scope */
    readonly scope: string;
    /** 激活更新超时（毫秒），默认 10s */
    readonly activateTimeoutMs?: number;
    /** 后台检查更新轮询间隔（毫秒），默认 30 分钟 */
    readonly updatePollMs?: number;
}

export interface ServiceWorkerLifecycle {
    /** 用户确认后激活等待中的新版本 */
    applyUpdate(): void;
    /** 移除全部监听与定时器 */
    destroy(): void;
}

const DEFAULT_ACTIVATE_TIMEOUT_MS = 10_000;
const DEFAULT_UPDATE_POLL_MS = 30 * 60 * 1000;

/**
 * 启动 SW 注册与更新生命周期（对应 PRD 4.3 节），返回控制句柄。
 *
 * - 仅生产 + 安全上下文 + 支持 serviceWorker 时注册；
 * - 已有注册若非本应用 SW 则跳过不接管；
 * - 更新需用户确认（PWA_ACTIVATE 消息），超时置 updateFailed；
 * - 注册失败静默降级，不影响安装引导功能。
 */
export function startServiceWorkerLifecycle(
    env: ServiceWorkerLifecycleEnv,
    options: ServiceWorkerLifecycleOptions,
): ServiceWorkerLifecycle {
    const { swPath, scope } = options;
    const activateTimeoutMs = options.activateTimeoutMs ?? DEFAULT_ACTIVATE_TIMEOUT_MS;
    const updatePollMs = options.updatePollMs ?? DEFAULT_UPDATE_POLL_MS;

    let registration: ServiceWorkerRegistrationLike | null = null;
    let activateTimeoutHandle: unknown = null;
    const containerListeners: Array<{ type: string; listener: () => void }> = [];
    const windowListeners: Array<{ type: string; listener: () => void }> = [];
    const workerStateListeners = new Map<ServiceWorkerLike, () => void>();
    let pollHandle: unknown = null;
    let destroyed = false;

    function onControllerChange() {
        if (activateTimeoutHandle !== null) {
            env.clearTimeout(activateTimeoutHandle);
            activateTimeoutHandle = null;
        }
        env.reload();
    }

    function watchWorkerState(newWorker: ServiceWorkerLike) {
        const listener = () => {
            if (newWorker.state !== "installed") {
                return;
            }
            // 首次安装没有已接管的 controller，不算"发现新版本"
            if (env.serviceWorker.controller) {
                usePwaStore.getState().setUpdateReady(true);
            }
        };
        newWorker.addEventListener("statechange", listener);
        workerStateListeners.set(newWorker, listener);
    }

    function onUpdateFound() {
        const installing = registration?.installing ?? null;
        if (installing) {
            watchWorkerState(installing);
        }
    }

    function attachRegistration(reg: ServiceWorkerRegistrationLike) {
        registration = reg;
        reg.addEventListener("updatefound", onUpdateFound);
        if (reg.installing) {
            watchWorkerState(reg.installing);
        }
    }

    /** 是否为本应用自身的 SW 注册（scriptURL 与预期一致） */
    function isOwnRegistration(reg: ServiceWorkerRegistrationLike): boolean {
        const worker = reg.active ?? reg.waiting ?? reg.installing;
        if (!worker?.scriptURL) {
            // 没有任何 worker 的空注册视作可接管
            return true;
        }
        try {
            return new URL(worker.scriptURL).pathname === new URL(swPath, "https://example.invalid").pathname;
        } catch {
            return false;
        }
    }

    async function checkForUpdate() {
        if (!env.onLine || !registration) {
            return;
        }
        try {
            await registration.update();
        } catch {
            // 后台检查失败静默忽略
        }
    }

    async function register() {
        try {
            const existing = await env.serviceWorker.getRegistration(scope);
            if (existing && !isOwnRegistration(existing)) {
                // 残留了其他应用的 SW，跳过不接管
                return;
            }
            const reg = await env.serviceWorker.register(swPath, { scope, updateViaCache: "none" });
            if (destroyed) {
                return;
            }
            attachRegistration(reg);
        } catch {
            // 注册失败静默降级：安装引导仍可用，不阻塞应用
        }
    }

    if (env.isProd && env.isSecureContext && env.supportsServiceWorker) {
        register();

        containerListeners.push({ type: "controllerchange", listener: onControllerChange });
        env.serviceWorker.addEventListener("controllerchange", onControllerChange);

        const onlineListener = () => void checkForUpdate();
        const focusListener = () => void checkForUpdate();
        for (const { type, listener } of [
            { type: "online", listener: onlineListener },
            { type: "focus", listener: focusListener },
        ]) {
            env.addEventListener(type, listener);
            windowListeners.push({ type, listener });
        }
        pollHandle = env.setInterval(() => void checkForUpdate(), updatePollMs);
    }

    return {
        applyUpdate() {
            const waiting = registration?.waiting ?? env.serviceWorker.controller;
            if (!waiting) {
                return;
            }
            usePwaStore.getState().setUpdateReady(false);
            usePwaStore.getState().setUpdating(true);
            usePwaStore.getState().setUpdateFailed(false);
            waiting.postMessage({ type: "PWA_ACTIVATE" });
            activateTimeoutHandle = env.setTimeout(() => {
                activateTimeoutHandle = null;
                usePwaStore.getState().setUpdateFailed(true);
                usePwaStore.getState().setUpdating(false);
            }, activateTimeoutMs);
        },

        destroy() {
            destroyed = true;
            if (activateTimeoutHandle !== null) {
                env.clearTimeout(activateTimeoutHandle);
                activateTimeoutHandle = null;
            }
            if (pollHandle !== null) {
                env.clearInterval(pollHandle);
                pollHandle = null;
            }
            for (const { type, listener } of containerListeners) {
                env.serviceWorker.removeEventListener(type, listener);
            }
            for (const { type, listener } of windowListeners) {
                env.removeEventListener(type, listener);
            }
            if (registration) {
                registration.removeEventListener("updatefound", onUpdateFound);
            }
            for (const [worker, listener] of workerStateListeners) {
                worker.removeEventListener("statechange", listener);
            }
            workerStateListeners.clear();
        },
    };
}

/** 从当前浏览器环境构造 lifecycle 并启动 */
export function startBrowserServiceWorkerLifecycle(
    swPath: string,
    scope: string,
): ServiceWorkerLifecycle {
    const env: ServiceWorkerLifecycleEnv = {
        isProd: process.env.NODE_ENV === "production",
        isSecureContext: window.isSecureContext,
        supportsServiceWorker: "serviceWorker" in navigator,
        onLine: navigator.onLine,
        serviceWorker: navigator.serviceWorker as unknown as ServiceWorkerContainerLike,
        reload: () => window.location.reload(),
        addEventListener: (type, listener) => window.addEventListener(type, listener),
        removeEventListener: (type, listener) => window.removeEventListener(type, listener),
        setTimeout: (handler, ms) => window.setTimeout(handler, ms),
        clearTimeout: (handle) => window.clearTimeout(handle as number | undefined),
        setInterval: (handler, ms) => window.setInterval(handler, ms),
        clearInterval: (handle) => window.clearInterval(handle as number | undefined),
    };
    return startServiceWorkerLifecycle(env, { swPath, scope });
}
