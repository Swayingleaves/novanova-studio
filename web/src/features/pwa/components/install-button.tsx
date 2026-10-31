"use client";

import { useState } from "react";
import { Tooltip } from "antd";
import { Download, LoaderCircle } from "lucide-react";

import { useTranslation } from "@/features/locale/use-translation";
import { platformBrand } from "@/features/team/space-brand";

import { showInstallEntry } from "../install-policy";
import { pwaRequestInstall } from "../pwa-runtime";
import { usePwaStore } from "../use-pwa-store";

/**
 * 登录卡片右上角的折角安装入口（PRD 4.6.1）：
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
    const [tooltipOpen, setTooltipOpen] = useState(false);

    if (!entryVisible) return null;

    const label = translate("pwa.installApp", { value0: platformBrand.name });

    return (
        <Tooltip
            title={label}
            placement="bottomRight"
            align={{ offset: [-32, -42] }}
            // 焦点由组件管理，避免弹窗恢复焦点时触发 Tooltip 内部的同步刷新。
            trigger="hover"
            open={tooltipOpen}
            onOpenChange={setTooltipOpen}
            color="var(--studio-surface)"
            styles={{ container: { color: "var(--studio-ink)", border: "1px solid var(--studio-line-strong)" } }}
        >
            <button
                type="button"
                className="absolute right-0 top-0 z-10 size-20 cursor-pointer overflow-hidden rounded-tr-[inherit] border-0 bg-[var(--studio-primary-soft)] p-0 text-[var(--studio-action)]! transition-colors duration-200 [clip-path:polygon(0_0,100%_0,100%_100%)] hover:bg-[var(--studio-action)] hover:text-[var(--studio-action-foreground)]! focus-visible:bg-[var(--studio-action)] focus-visible:text-[var(--studio-action-foreground)]! focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-[var(--studio-action-foreground)] disabled:cursor-wait motion-reduce:transition-none"
                disabled={installing}
                aria-label={label}
                aria-busy={installing}
                onFocus={() => setTooltipOpen(true)}
                onBlur={() => setTooltipOpen(false)}
                onClick={() => {
                    setTooltipOpen(false);
                    void pwaRequestInstall();
                }}
                data-testid="pwa-login-install"
            >
                <svg aria-hidden="true" viewBox="0 0 80 80" className="pointer-events-none absolute inset-0 size-full opacity-25">
                    <path d="M0 0 80 80" fill="none" stroke="currentColor" />
                </svg>
                <span className="absolute right-3 top-3" aria-hidden="true">
                    {installing ? <LoaderCircle className="size-6 animate-spin motion-reduce:animate-none" /> : <Download className="size-6 rotate-20" />}
                </span>
            </button>
        </Tooltip>
    );
}
