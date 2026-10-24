"use client";

import type { InstallController } from "./install-controller";
import type { ServiceWorkerLifecycle } from "./sw-lifecycle";

/**
 * PWA 运行时单例：由 PwaProvider 挂载与清理，
 * 安装按钮 / 侧边栏入口 / 更新提示等 UI 组件只读取触发动作，
 * 避免在组件间层层传递 controller 与 lifecycle 实例。
 */
let installController: InstallController | null = null;
let swLifecycle: ServiceWorkerLifecycle | null = null;

/** 写入或清空运行时引用（仅 PwaProvider 调用） */
export function setPwaRuntime(
    controller: InstallController | null,
    lifecycle: ServiceWorkerLifecycle | null,
): void {
    installController = controller;
    swLifecycle = lifecycle;
}

/** 安装入口点击：触发浏览器原生安装弹窗，或降级打开手动安装引导 */
export function pwaRequestInstall(): Promise<void> {
    return installController?.requestInstall() ?? Promise.resolve();
}

/** 用户确认后激活等待中的新 SW 版本（对应 PRD 4.3.4） */
export function pwaApplyUpdate(): void {
    swLifecycle?.applyUpdate();
}
