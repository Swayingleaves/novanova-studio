"use client";

import { useState } from "react";
import { Tooltip } from "antd";
import { Download } from "lucide-react";

import { useTranslation } from "@/features/locale/use-translation";
import { platformBrand } from "@/features/team/space-brand";

import { ClientDownloadModal } from "./client-download-modal";

/**
 * 登录卡片右上角的折角客户端下载入口：点击弹出平台选择弹窗（macOS / Windows）。
 */
export function PwaInstallButton() {
    const translate = useTranslation();
    const [tooltipOpen, setTooltipOpen] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);

    const label = translate("pwa.downloadApp", { value0: platformBrand.name });

    return (
        <>
            <Tooltip
                title={label}
                placement="bottomRight"
                align={{ offset: [-32, -42] }}
                trigger="hover"
                open={tooltipOpen}
                onOpenChange={setTooltipOpen}
                color="var(--studio-surface)"
                styles={{ container: { color: "var(--studio-ink)", border: "1px solid var(--studio-line-strong)" } }}
            >
                <button
                    type="button"
                    className="absolute right-0 top-0 z-10 size-20 cursor-pointer overflow-hidden rounded-tr-[inherit] border-0 bg-[var(--studio-primary-soft)] p-0 text-[var(--studio-action)]! transition-colors duration-200 [clip-path:polygon(0_0,100%_0,100%_100%)] hover:bg-[var(--studio-action)] hover:text-[var(--studio-action-foreground)]! focus-visible:bg-[var(--studio-action)] focus-visible:text-[var(--studio-action-foreground)]! focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-[var(--studio-action-foreground)] motion-reduce:transition-none"
                    aria-label={label}
                    onFocus={() => setTooltipOpen(true)}
                    onBlur={() => setTooltipOpen(false)}
                    onClick={() => {
                        setTooltipOpen(false);
                        setModalOpen(true);
                    }}
                    data-testid="pwa-login-install"
                >
                    <svg aria-hidden="true" viewBox="0 0 80 80" className="pointer-events-none absolute inset-0 size-full opacity-25">
                        <path d="M0 0 80 80" fill="none" stroke="currentColor" />
                    </svg>
                    <span className="absolute right-3 top-3" aria-hidden="true">
                        <Download className="size-6 rotate-20" />
                    </span>
                </button>
            </Tooltip>
            <ClientDownloadModal open={modalOpen} onClose={() => setModalOpen(false)} />
        </>
    );
}
