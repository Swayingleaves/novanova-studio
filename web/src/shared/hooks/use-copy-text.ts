"use client";

import { App } from "antd";
import copy from "copy-to-clipboard";

export function useCopyText() {
    const { message } = App.useApp();

    return (value: string, successText = "已复制"): boolean => {
        const copied = copy(value);
        if (!copied) {
            message.error("复制失败，请手动复制");
            return false;
        }
        message.success(successText);
        return true;
    };
}
