"use client";

import { detectInstallPlatform, showInstallEntry } from "./install-policy";
import { usePwaStore } from "./use-pwa-store";

/** 浏览器 beforeinstallprompt 事件对象（非标准 API，需自行声明） */
export interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

/** 控制器依赖的环境抽象（浏览器实现由 browserEnv 提供，单测注入假实现） */
export interface InstallControllerEnv {
    readonly userAgent: string;
    readonly isSecureContext: boolean;
    readonly maxTouchPoints: number;
    /** iOS Safari 的 navigator.standalone 标记（其余平台 undefined） */
    readonly standaloneFlag: boolean;
    matchMedia(query: string): MediaQueryListLike;
    addEventListener(type: string, listener: (event: Event) => void): void;
    removeEventListener(type: string, listener: (event: Event) => void): void;
}

/** matchMedia 返回对象的最小接口 */
export interface MediaQueryListLike {
    readonly matches: boolean;
    addEventListener(type: "change", listener: () => void): void;
    removeEventListener(type: "change", listener: () => void): void;
}

/** standalone / fullscreen 两种已安装展示模式 */
const DISPLAY_MODE_QUERIES = ["(display-mode: standalone)", "(display-mode: fullscreen)"] as const;

export interface InstallController {
    /** 探测平台、写入初始状态并挂载全部监听 */
    start(): void;
    /** 移除全部监听并清理 deferred */
    stop(): void;
    /** 安装入口点击处理：原生弹窗或降级手动引导 */
    requestInstall(): Promise<void>;
}

/**
 * 创建安装控制器（对应 PRD 4.5 节）。
 *
 * 核心策略：拦截 beforeinstallprompt 事件延后到用户手势触发；
 * 安装成功的唯一证据是 appinstalled 事件或 display-mode 变化。
 */
export function createInstallController(env: InstallControllerEnv): InstallController {
    let deferred: BeforeInstallPromptEvent | null = null;
    const mqls: MediaQueryListLike[] = [];
    const windowListeners: Array<{ type: string; listener: (event: Event) => void }> = [];

    function isEntryVisible() {
        const state = usePwaStore.getState();
        return showInstallEntry({
            platform: state.platform,
            standalone: state.standalone,
            installedThisSession: state.installedThisSession,
        });
    }

    function computeStandalone() {
        return DISPLAY_MODE_QUERIES.some((query) => env.matchMedia(query).matches) || env.standaloneFlag === true;
    }

    function onBeforeInstallPrompt(event: Event) {
        if (!isEntryVisible()) {
            return;
        }
        // 阻止浏览器默认安装横幅，延后到用户手势触发
        event.preventDefault?.();
        deferred = event as BeforeInstallPromptEvent;
        usePwaStore.getState().setCanPrompt(true);
    }

    function onAppInstalled() {
        deferred = null;
        const store = usePwaStore.getState();
        store.setInstalledThisSession(true);
        store.setCanPrompt(false);
    }

    function onDisplayModeChange() {
        // 只有进入 standalone 才视为安装成功，退出不回滚已安装标记
        if (!computeStandalone()) {
            return;
        }
        deferred = null;
        const store = usePwaStore.getState();
        store.setStandalone(true);
        store.setCanPrompt(false);
    }

    return {
        start() {
            const info = detectInstallPlatform(env.userAgent, env.isSecureContext, env.maxTouchPoints);
            const standalone = computeStandalone();
            usePwaStore.getState().applyDetection({
                platform: info.platform,
                guideKind: info.guideKind,
                standalone,
            });

            for (const type of ["beforeinstallprompt", "appinstalled"] as const) {
                const listener = type === "beforeinstallprompt" ? onBeforeInstallPrompt : onAppInstalled;
                env.addEventListener(type, listener);
                windowListeners.push({ type, listener });
            }
            for (const query of DISPLAY_MODE_QUERIES) {
                const mql = env.matchMedia(query);
                mql.addEventListener("change", onDisplayModeChange);
                mqls.push(mql);
            }
        },

        stop() {
            for (const { type, listener } of windowListeners) {
                env.removeEventListener(type, listener);
            }
            windowListeners.length = 0;
            for (const mql of mqls) {
                mql.removeEventListener("change", onDisplayModeChange);
            }
            mqls.length = 0;
            deferred = null;
        },

        async requestInstall() {
            const store = usePwaStore.getState();
            // 入口不可见或原生弹窗进行中 → 直接返回
            if (!isEntryVisible() || store.installing) {
                return;
            }
            // 未拦截到事件（Safari 等不触发 beforeinstallprompt 的浏览器）→ 降级手动引导
            if (!deferred) {
                store.setGuideOpen(true);
                return;
            }
            const event = deferred;
            store.setInstalling(true);
            try {
                // prompt() 必须紧贴用户手势的同步栈调用，中间不能有 await
                const prompted = event.prompt();
                await prompted;
                await event.userChoice;
            } catch {
                // prompt 抛异常（如浏览器策略拒绝）→ 降级手动引导
                usePwaStore.getState().setGuideOpen(true);
            } finally {
                usePwaStore.getState().setInstalling(false);
            }
        },
    };
}

/** 从当前浏览器窗口构造控制器环境 */
export function createBrowserInstallController(): InstallController {
    const env: InstallControllerEnv = {
        userAgent: navigator.userAgent,
        isSecureContext: window.isSecureContext,
        maxTouchPoints: navigator.maxTouchPoints ?? 0,
        standaloneFlag: (navigator as Navigator & { standalone?: boolean }).standalone === true,
        matchMedia: (query) => window.matchMedia(query),
        addEventListener: (type, listener) => window.addEventListener(type, listener),
        removeEventListener: (type, listener) => window.removeEventListener(type, listener),
    };
    return createInstallController(env);
}
