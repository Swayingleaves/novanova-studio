"use client";

import { useEffect } from "react";

import { createBrowserInstallController } from "../install-controller";
import { PWA_BASE_PATH, PWA_SCOPE, PWA_SW_PATH } from "../pwa-constants";
import { consumePwaLaunchParam } from "../pwa-launch";
import { setPwaRuntime } from "../pwa-runtime";
import { startBrowserServiceWorkerLifecycle } from "../sw-lifecycle";
import { InstallGuideModal } from "./install-guide-modal";
import { PwaUpdateNotice } from "./update-notice";

/**
 * PWA 运行时提供者（对应 PRD 4.3 / 4.5 / 4.6.4）：
 * 挂载安装控制器与 SW 生命周期、消费桌面图标启动标记，
 * 并渲染全局的安装引导弹窗与更新提示。
 *
 * 无 children：只做逻辑挂载与全局 UI，不侵入页面组件树。
 */
export function PwaProvider() {
    useEffect(() => {
        // 桌面图标启动：根路径时清除 ?pwa-launch=1，深层链接原样保留
        consumePwaLaunchParam(PWA_BASE_PATH);

        const controller = createBrowserInstallController();
        controller.start();
        const lifecycle = startBrowserServiceWorkerLifecycle(PWA_SW_PATH, PWA_SCOPE);
        setPwaRuntime(controller, lifecycle);

        return () => {
            controller.stop();
            lifecycle.destroy();
            setPwaRuntime(null, null);
        };
    }, []);

    return (
        <>
            <InstallGuideModal />
            <PwaUpdateNotice />
        </>
    );
}
