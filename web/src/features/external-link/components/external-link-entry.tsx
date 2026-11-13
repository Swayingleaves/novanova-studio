"use client";

import { useTranslation } from "@/features/locale/use-translation";

import { Button, Modal } from "antd";
import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";

import { useExternalLinkStore } from "@/features/external-link/stores/use-external-link-store";

/**
 * 右上角展示外链入口：只展示标题，点击后弹窗展示封面、说明并提供「前往」按钮。
 * <p>
 * 没有配置时不渲染入口；应用重新载入或回到前台时重新读取，保证后台保存后能及时生效。
 */
export function ExternalLinkEntry() {
    const translate = useTranslation();
    const config = useExternalLinkStore((state) => state.config);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        void useExternalLinkStore.getState().refresh();
        const reload = () => {
            if (document.visibilityState !== "hidden") void useExternalLinkStore.getState().refresh();
        };
        window.addEventListener("focus", reload);
        document.addEventListener("visibilitychange", reload);
        return () => {
            window.removeEventListener("focus", reload);
            document.removeEventListener("visibilitychange", reload);
        };
    }, []);

    if (!config) return null;

    const goToTarget = () => {
        window.open(config.url, "_blank", "noopener,noreferrer");
        setOpen(false);
    };

    return (
        <>
            <button
                type="button"
                className="hidden h-9 shrink-0 items-center rounded-lg px-3 text-xs! font-medium text-[var(--studio-primary)]! transition hover:bg-[var(--studio-primary-hover)] hover:text-[var(--studio-action-foreground)]! focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--studio-action)] sm:inline-flex"
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={() => {
                    setOpen(true);
                    // 签名地址默认一小时过期，打开前刷新一次，保证弹窗里拿到的是刚签发的封面地址。
                    void useExternalLinkStore.getState().refresh();
                }}
            >
                <span className="max-w-40 truncate">{config.title}</span>
            </button>
            <Modal
                open={open}
                onCancel={() => setOpen(false)}
                centered
                width={520}
                title={<span className="block truncate pr-6 text-base font-semibold text-[var(--studio-ink)]">{config.title}</span>}
                footer={[
                    <Button key="cancel" onClick={() => setOpen(false)}>
                        {translate("appShell.cancel")}
                    </Button>,
                    <Button key="go" type="primary" icon={<ExternalLink className="size-3.5" />} onClick={goToTarget}>
                        {translate("appShell.externalLinkGo")}
                    </Button>,
                ]}
            >
                <div className="space-y-4">
                    {config.coverUrl ? (
                        <img
                            src={config.coverUrl}
                            alt=""
                            className="max-h-[38vh] w-full rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] object-contain"
                        />
                    ) : null}
                    {config.description ? (
                        <p className="max-h-[30vh] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 text-[var(--studio-muted)]">{config.description}</p>
                    ) : null}
                </div>
            </Modal>
        </>
    );
}
