"use client";

import { useEffect } from "react";
import { App } from "antd";
import { useRouter } from "@/shared/lib/team-navigation";
import { useTranslation } from "@/features/locale/use-translation";
import { registerConfigurationLeaveGuard } from "./configuration-leave-guard";

/** 后台各页签共用当前组件的草稿，只有真正离开后台才确认放弃。 */
export function useConfigurationLeaveGuard(hasUnsavedChanges: boolean) {
    const { modal } = App.useApp();
    const translate = useTranslation();
    const router = useRouter();
    useEffect(() => {
        if (!hasUnsavedChanges) return;
        return registerConfigurationLeaveGuard(() => new Promise<boolean>((resolve) => {
            modal.confirm({
                title: translate("appShell.discardUnsavedChanges"),
                content: translate("appShell.leavingDiscardsConfigurationChanges"),
                okText: translate("appShell.discardChanges"),
                okButtonProps: { danger: true },
                cancelText: translate("appShell.continueEditing"),
                onOk: () => resolve(true),
                onCancel: () => resolve(false),
            });
        }), (destination) => {
            const target = new URL(destination);
            if (target.origin === window.location.origin) router.push(`${target.pathname}${target.search}${target.hash}`);
            else window.location.assign(destination);
        });
    }, [hasUnsavedChanges, modal, router, translate]);
}
