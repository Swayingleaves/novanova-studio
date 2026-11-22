"use client";

import { useEffect, useState } from "react";
import { Button, Modal, Spin } from "antd";
import { Download, Laptop, Monitor } from "lucide-react";

import { useTranslation } from "@/features/locale/use-translation";
import { platformBrand } from "@/features/team/space-brand";
import { getClientDownloadSettings, type ClientDownloadSettings } from "@/services/api/client-download-settings";

type ClientDownloadModalProps = {
    open: boolean;
    onClose: () => void;
};

const EMPTY_SETTINGS: ClientDownloadSettings = {
    macIntelUrl: null,
    macAppleSiliconUrl: null,
    windowsUrl: null,
};

/**
 * 客户端下载平台选择弹窗，供侧边栏与登录页下载按钮共用。
 */
export function ClientDownloadModal({ open, onClose }: ClientDownloadModalProps) {
    const translate = useTranslation();
    const [loading, setLoading] = useState(false);
    const [settings, setSettings] = useState<ClientDownloadSettings>(EMPTY_SETTINGS);

    useEffect(() => {
        if (!open) return;
        let active = true;
        setLoading(true);
        void getClientDownloadSettings()
            .then((result) => {
                if (active && result) setSettings(result);
            })
            .catch(() => {
                if (active) setSettings(EMPTY_SETTINGS);
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [open]);

    const openDownload = (url: string | null) => {
        if (!url) return;
        window.open(url, "_blank", "noopener,noreferrer");
    };

    return (
        <Modal
            open={open}
            centered
            width={560}
            footer={null}
            destroyOnHidden
            onCancel={onClose}
            title={translate("pwa.downloadClientTitle", { value0: platformBrand.name })}
        >
            <p className="mb-4 text-xs leading-5 text-[var(--studio-muted)]">
                {translate("pwa.downloadClientSubtitle")}
            </p>
            {loading ? (
                <div className="flex h-36 items-center justify-center">
                    <Spin />
                </div>
            ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                    <section className="flex flex-col justify-between rounded-xl border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4">
                        <div>
                            <div className="flex items-center gap-2.5">
                                <span className="flex size-9 items-center justify-center rounded-lg bg-[var(--studio-panel)] text-[var(--studio-ink)]">
                                    <Laptop className="size-4.5" />
                                </span>
                                <div>
                                    <div className="text-sm font-semibold text-[var(--studio-ink)]">macOS</div>
                                    <div className="text-xs text-[var(--studio-muted)]">{translate("pwa.macPlatformHint")}</div>
                                </div>
                            </div>
                        </div>
                        <div className="mt-4 space-y-2">
                            <Button
                                type="primary"
                                block
                                icon={<Download className="size-3.5" />}
                                disabled={!settings.macAppleSiliconUrl}
                                onClick={() => openDownload(settings.macAppleSiliconUrl)}
                            >
                                {settings.macAppleSiliconUrl ? translate("pwa.macAppleSiliconDownload") : `${translate("pwa.macAppleSilicon")}（${translate("pwa.notConfigured")}）`}
                            </Button>
                            <Button
                                block
                                icon={<Download className="size-3.5" />}
                                disabled={!settings.macIntelUrl}
                                onClick={() => openDownload(settings.macIntelUrl)}
                            >
                                {settings.macIntelUrl ? translate("pwa.macIntelDownload") : `${translate("pwa.macIntel")}（${translate("pwa.notConfigured")}）`}
                            </Button>
                        </div>
                    </section>

                    <section className="flex flex-col justify-between rounded-xl border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4">
                        <div>
                            <div className="flex items-center gap-2.5">
                                <span className="flex size-9 items-center justify-center rounded-lg bg-[var(--studio-panel)] text-[var(--studio-ink)]">
                                    <Monitor className="size-4.5" />
                                </span>
                                <div>
                                    <div className="text-sm font-semibold text-[var(--studio-ink)]">Windows</div>
                                    <div className="text-xs text-[var(--studio-muted)]">{translate("pwa.windowsPlatformHint")}</div>
                                </div>
                            </div>
                        </div>
                        <div className="mt-4">
                            <Button
                                type="primary"
                                block
                                icon={<Download className="size-3.5" />}
                                disabled={!settings.windowsUrl}
                                onClick={() => openDownload(settings.windowsUrl)}
                            >
                                {settings.windowsUrl ? translate("pwa.windowsDownload") : `Windows（${translate("pwa.notConfigured")}）`}
                            </Button>
                        </div>
                    </section>
                </div>
            )}
        </Modal>
    );
}
