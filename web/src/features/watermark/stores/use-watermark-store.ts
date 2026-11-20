"use client";
import { create } from "zustand";
import { readWatermarkSettings, writeWatermarkSettings, type WatermarkSettings } from "../lib/watermark-settings";

type WatermarkStore = {
    /** 已保存的设置，仅用于展示，下载时以 localStorage 实时读取为准。 */
    settings: WatermarkSettings;
    /** 设置弹窗是否打开，由下载拦截或个人中心入口触发。 */
    dialogOpen: boolean;
    /** 下载被弹窗拦住时暂存 Promise 的完成回调。 */
    resolvePending: ((settings: WatermarkSettings) => void) | null;
    /** 下载前确认：已确认过直接返回设置，否则打开弹窗等待保存。 */
    requestChoice: () => Promise<WatermarkSettings>;
    /** 从个人中心打开设置，不阻塞任何下载。 */
    openDialog: () => void;
    /** 保存开关并放行本次下载。 */
    save: (removeWatermark: boolean) => void;
    /** 关闭弹窗，按已保存的设置继续下载。 */
    closeDialog: () => void;
};

export const useWatermarkStore = create<WatermarkStore>((set, get) => ({
    settings: readWatermarkSettings(),
    dialogOpen: false,
    resolvePending: null,
    requestChoice: () => {
        const settings = readWatermarkSettings();
        if (settings.acknowledged) return Promise.resolve(settings);
        return new Promise<WatermarkSettings>((resolve) => {
            set({ dialogOpen: true, resolvePending: resolve });
        });
    },
    openDialog: () => set({ dialogOpen: true, settings: readWatermarkSettings() }),
    save: (removeWatermark) => {
        const settings: WatermarkSettings = { removeWatermark, acknowledged: true };
        writeWatermarkSettings(settings);
        const resolve = get().resolvePending;
        set({ settings, dialogOpen: false, resolvePending: null });
        resolve?.(settings);
    },
    closeDialog: () => {
        const settings = readWatermarkSettings();
        const resolve = get().resolvePending;
        set({ dialogOpen: false, resolvePending: null });
        resolve?.(settings);
    },
}));
