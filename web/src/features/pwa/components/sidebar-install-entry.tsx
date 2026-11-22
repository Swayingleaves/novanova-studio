"use client";

import { useState } from "react";
import { Tooltip } from "antd";
import { Download } from "lucide-react";

import { useTranslation } from "@/features/locale/use-translation";
import { platformBrand } from "@/features/team/space-brand";

import { ClientDownloadModal } from "./client-download-modal";

/**
 * 侧边栏底部客户端下载入口：点击弹出平台选择弹窗（macOS / Windows）。
 */
export function SidebarInstallEntry() {
    const translate = useTranslation();
    const [open, setOpen] = useState(false);

    const label = translate("pwa.downloadApp", { value0: platformBrand.name });

    return (
        <>
            <Tooltip title={label} placement="right">
                <button
                    type="button"
                    className="sidebar-rail-action"
                    aria-label={label}
                    onClick={() => setOpen(true)}
                    data-testid="pwa-sidebar-install"
                >
                    <Download className="size-4.5" />
                </button>
            </Tooltip>
            <ClientDownloadModal open={open} onClose={() => setOpen(false)} />
        </>
    );
}
