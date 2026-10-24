"use client";

import { useEffect } from "react";
import { App, Modal } from "antd";

import { useTranslation } from "@/features/locale/use-translation";
import { platformBrand } from "@/features/team/space-brand";

import { pwaApplyUpdate } from "../pwa-runtime";
import { usePwaStore } from "../use-pwa-store";

/**
 * SW 更新提示（PRD 4.3.4）：
 * 发现新版本时弹窗征询用户，确认后向 waiting worker 发送激活消息；
 * 激活超时则给出失败提示（updateFailed 复位后等待下一次 updatefound）。
 */
export function PwaUpdateNotice() {
    const translate = useTranslation();
    const { message } = App.useApp();
    const updateReady = usePwaStore((state) => state.updateReady);
    const updating = usePwaStore((state) => state.updating);
    const updateFailed = usePwaStore((state) => state.updateFailed);
    const setUpdateReady = usePwaStore((state) => state.setUpdateReady);
    const setUpdateFailed = usePwaStore((state) => state.setUpdateFailed);

    useEffect(() => {
        if (!updateFailed) return;
        message.error(translate("pwa.updateFailed"));
        // 复位失败标记，下一次 updatefound 重新提示
        setUpdateFailed(false);
    }, [updateFailed, message, translate, setUpdateFailed]);

    return (
        <Modal
            open={updateReady}
            title={translate("pwa.updateTitle")}
            okText={translate("pwa.updateNow")}
            cancelText={translate("pwa.updateLater")}
            okButtonProps={{ loading: updating }}
            cancelButtonProps={{ disabled: updating }}
            closable={!updating}
            maskClosable={false}
            onOk={() => pwaApplyUpdate()}
            onCancel={() => setUpdateReady(false)}
            data-testid="pwa-update-notice"
        >
            <p className="text-sm leading-6 text-[var(--studio-muted)]">
                {translate("pwa.updateDescription", { value0: platformBrand.name })}
            </p>
        </Modal>
    );
}
