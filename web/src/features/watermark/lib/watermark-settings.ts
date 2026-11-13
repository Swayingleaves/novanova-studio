/** AI 生成水印的本地设置，只存两个布尔值，按项目约定放 localStorage。 */

import { useUserStore } from "@/features/auth/stores/use-user-store";

const STORAGE_KEY = "novanova.ai-watermark";

export type WatermarkSettings = {
    /** 导出图片时去掉 “AI生成” 水印 */
    removeWatermark: boolean;
    /** 用户是否已在弹窗里确认过法律说明 */
    acknowledged: boolean;
};

const DEFAULT_SETTINGS: WatermarkSettings = { removeWatermark: false, acknowledged: false };

/** 同一浏览器上按用户隔离设置：换账号登录后未保存过的新用户会重新收到提示。 */
function resolveStorageKey(): string {
    const userId = useUserStore.getState().user?.id;
    return userId ? `${STORAGE_KEY}:${userId}` : STORAGE_KEY;
}

/** 读取设置，损坏或未写入时回落到“保留水印且未确认”。 */
export function readWatermarkSettings(): WatermarkSettings {
    if (typeof window === "undefined") return DEFAULT_SETTINGS;
    try {
        const raw = window.localStorage.getItem(resolveStorageKey());
        if (!raw) return DEFAULT_SETTINGS;
        const parsed = JSON.parse(raw) as Partial<WatermarkSettings>;
        return { removeWatermark: Boolean(parsed.removeWatermark), acknowledged: Boolean(parsed.acknowledged) };
    } catch {
        return DEFAULT_SETTINGS;
    }
}

/** 写入设置，隐私模式或配额不足时静默忽略，不阻断下载。 */
export function writeWatermarkSettings(settings: WatermarkSettings) {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(resolveStorageKey(), JSON.stringify(settings));
    } catch {
        // 写入失败时本次下载仍按调用方传入的设置执行。
    }
}
