"use client";
import { translateMessage as translate } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";


import { App } from "antd";
import copy from "copy-to-clipboard";

export function useCopyText() {
    const translate = useTranslation();
    const { message } = App.useApp();

    return (value: string, successText = translate("common.copied")): boolean => {
        const copied = copy(value);
        if (!copied) {
            message.error(translate("common.copyFailedCopyManually"));
            return false;
        }
        message.success(successText);
        return true;
    };
}
