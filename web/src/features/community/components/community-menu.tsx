"use client";

import { useTranslation } from "@/features/locale/use-translation";

import { Image, Popover } from "antd";
import { QrCode } from "lucide-react";
import { useEffect, useState } from "react";

import { useCommunityStore } from "@/features/community/stores/use-community-store";

/**
 * 右上角社群入口：悬停、聚焦或点击后逐行展示社群名称与二维码。
 * <p>
 * 没有配置时不渲染入口；应用重新载入或回到前台时重新读取，保证后台保存后能及时生效。
 */
export function CommunityMenu({ className }: { className?: string }) {
    const translate = useTranslation();
    const configs = useCommunityStore((state) => state.configs);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        void useCommunityStore.getState().refresh();
        const reload = () => {
            if (document.visibilityState !== "hidden") void useCommunityStore.getState().refresh();
        };
        window.addEventListener("focus", reload);
        document.addEventListener("visibilitychange", reload);
        return () => {
            window.removeEventListener("focus", reload);
            document.removeEventListener("visibilitychange", reload);
        };
    }, []);

    if (!configs.length) return null;

    return (
        <Popover
            open={open}
            onOpenChange={setOpen}
            trigger={["hover", "focus", "click"]}
            placement="bottomRight"
            content={
                <div className="w-[23rem] max-w-[calc(100vw-3rem)]">
                    <div className="flex items-baseline justify-between gap-2 border-b border-[var(--studio-line)] pb-2">
                        <span className="text-sm font-semibold text-[var(--studio-ink)]">{translate("appShell.community")}</span>
                        <span className="text-xs text-[var(--studio-muted)]">{translate("appShell.communityScanHint")}</span>
                    </div>
                    <div className="max-h-[min(70vh,30rem)] divide-y divide-[var(--studio-line)] overflow-y-auto">
                        {configs.map((config) => (
                            <div key={`${config.name}-${config.sortOrder}`} className="flex items-center gap-3 py-3">
                                <div className="shrink-0 rounded-lg border border-[var(--studio-line)] bg-white p-1.5">
                                    <Image
                                        src={config.imageUrl}
                                        alt={translate("appShell.communityQrCodeAlt", { name: config.name })}
                                        width={180}
                                        height={180}
                                        className="rounded"
                                        style={{ objectFit: "contain" }}
                                        preview={{ mask: <span className="px-1 text-xs">{translate("appShell.communityQrPreview")}</span> }}
                                    />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="break-words text-sm font-medium text-[var(--studio-ink)]">{config.name}</div>
                                    <div className="mt-1 text-xs text-[var(--studio-muted)]">{translate("appShell.communityQrPreview")}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            }
        >
            <button
                type="button"
                className={className}
                aria-label={translate("appShell.community")}
                aria-haspopup="dialog"
                aria-expanded={open}
            >
                <QrCode className="size-4" aria-hidden="true" />
            </button>
        </Popover>
    );
}
