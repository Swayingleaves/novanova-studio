"use client";

import { Button } from "antd";
import { Download } from "lucide-react";

import { useTranslation } from "@/features/locale/use-translation";
import { platformBrand } from "@/features/team/space-brand";

import { showInstallEntry } from "../install-policy";
import { pwaRequestInstall } from "../pwa-runtime";
import { usePwaStore } from "../use-pwa-store";

/**
 * 登录页安装入口按钮（PRD 4.6.1）：
 * 平台支持且未安装时显示，点击触发原生安装弹窗或降级手动引导。
 */
export function PwaInstallButton() {
    const translate = useTranslation();
    const entryVisible = usePwaStore((state) =>
        showInstallEntry({
            platform: state.platform,
            standalone: state.standalone,
            installedThisSession: state.installedThisSession,
        }),
    );
    const installing = usePwaStore((state) => state.installing);

    if (!entryVisible) return null;

    return (
        <Button
            variant="outlined"
            block
            className="mt-6 min-h-11"
            icon={<Download className="size-4" aria-hidden="true" />}
            loading={installing}
            onClick={() => void pwaRequestInstall()}
            data-testid="pwa-login-install"
        >
            {translate("pwa.installApp", { value0: platformBrand.name })}
        </Button>
    );
}
