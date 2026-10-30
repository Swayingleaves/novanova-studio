"use client";

import { Tooltip } from "antd";
import { Download } from "lucide-react";

import { useTranslation } from "@/features/locale/use-translation";
import { platformBrand } from "@/features/team/space-brand";

import { showInstallEntry } from "../install-policy";
import { pwaRequestInstall } from "../pwa-runtime";
import { usePwaStore } from "../use-pwa-store";

/**
 * 侧边栏安装入口（PRD 4.6.3）：
 * 登录后的应用壳内复用同一 store 与 requestInstall，与登录页入口行为一致。
 */
export function SidebarInstallEntry() {
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

    const label = translate("pwa.installApp", { value0: platformBrand.name });

    return (
        <Tooltip title={label} placement="right">
            <button
                type="button"
                className="sidebar-rail-action"
                disabled={installing}
                aria-label={label}
                onClick={() => void pwaRequestInstall()}
                data-testid="pwa-sidebar-install"
            >
                <Download className="size-4.5" />
            </button>
        </Tooltip>
    );
}
