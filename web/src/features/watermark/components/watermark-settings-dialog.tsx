"use client";
import { useEffect, useState } from "react";
import { Button, Modal, Switch } from "antd";
import { useTranslation } from "@/features/locale/use-translation";
import { useWatermarkStore } from "../stores/use-watermark-store";

/**
 * AI 生成水印设置弹窗。
 * <p>
 * 两个入口共用：下载图片前首次拦截、个人中心的设置卡片。保存后立即生效，并放行被拦住的下载。
 */
export function WatermarkSettingsDialog() {
    const translate = useTranslation();
    const open = useWatermarkStore((state) => state.dialogOpen);
    const settings = useWatermarkStore((state) => state.settings);
    const save = useWatermarkStore((state) => state.save);
    const closeDialog = useWatermarkStore((state) => state.closeDialog);
    const [removeWatermark, setRemoveWatermark] = useState(settings.removeWatermark);
    // 每次打开都回填已保存的值，避免上一次未保存的勾选残留。
    useEffect(() => {
        if (open) setRemoveWatermark(settings.removeWatermark);
    }, [open, settings.removeWatermark]);
    return (
        <Modal open={open} title={translate("common.aiWatermarkTitle")} footer={null} width={520} centered onCancel={closeDialog} mask={{ closable: true }} destroyOnHidden>
            <div className="space-y-4 pt-1">
                <p className="text-sm leading-6 text-[var(--studio-muted)]">{translate("common.aiWatermarkLegalNotice")}</p>
                <p className="text-sm leading-6 text-[var(--studio-muted)]">{translate("common.aiWatermarkRemoveNotice")}</p>
                <div className="flex items-start gap-3 rounded-lg border border-[var(--studio-line)] p-3">
                    <Switch checked={removeWatermark} onChange={setRemoveWatermark} aria-label={translate("common.aiWatermarkRemoveLabel")} />
                    <div className="min-w-0">
                        <p className="text-sm text-[var(--studio-ink)]">{translate("common.aiWatermarkRemoveLabel")}</p>
                        <p className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">{translate("common.aiWatermarkSaveHint")}</p>
                    </div>
                </div>
                <div className="flex justify-end">
                    <Button type="primary" onClick={() => save(removeWatermark)}>{translate("common.aiWatermarkSave")}</Button>
                </div>
            </div>
        </Modal>
    );
}
