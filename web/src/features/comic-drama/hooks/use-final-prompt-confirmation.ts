"use client";

import { useEffect, useRef } from "react";
import { App } from "antd";
import { useTranslation } from "@/features/locale/use-translation";
import { creditAmount, creditText, type CreditAmount } from "@/shared/lib/credit-amounts";
import { useComicDramaStore } from "../stores/use-comic-drama-store";

/** 三个提示词入口共用费用确认；取消、离开阶段或切换项目均不启动生成。 */
export function useFinalPromptConfirmation(projectId: string | undefined) {
    const { modal, message } = App.useApp();
    const translate = useTranslation();
    const confirmation = useRef<{ destroy: () => void } | null>(null);

    useEffect(() => () => {
        confirmation.current?.destroy();
        confirmation.current = null;
    }, [projectId]);

    return (shotCount: number, unitPrice: CreditAmount, onConfirm: () => Promise<void>) => {
        if (!projectId || confirmation.current) return;
        let started = false;
        const current = { destroy: () => {} };
        confirmation.current = current;
        const dialog = modal.confirm({
            title: translate("comicDrama.finalPromptPricingConfirmationTitle"),
            content: translate("comicDrama.finalPromptPricingConfirmationContent", {
                value0: shotCount,
                value1: creditText(unitPrice),
                value2: creditText(creditAmount(unitPrice).mul(shotCount).toFixed()),
            }),
            okText: translate("comicDrama.confirmAndGenerate"),
            cancelText: translate("comicDrama.cancel"),
            afterClose: () => {
                if (confirmation.current === current) confirmation.current = null;
            },
            onOk: async () => {
                if (started || confirmation.current !== current) return;
                if (useComicDramaStore.getState().workspace?.projectId !== projectId) {
                    message.warning(translate("comicDrama.finalPromptProjectChanged"));
                    return;
                }
                started = true;
                await onConfirm();
            },
        });
        current.destroy = dialog.destroy;
    };
}
