"use client";

import { create } from "zustand";

import type { InstallGuideKind, InstallPlatform } from "./install-policy";

/** PWA 安装与更新的 UI 状态（对应 PRD 4.5 状态清单） */
export interface PwaState {
    /** 平台探测结果，unsupported 时不显示入口 */
    platform: InstallPlatform;
    /** 手动安装引导类型 */
    guideKind: InstallGuideKind | null;
    /** 是否以 standalone（已安装）模式运行 */
    standalone: boolean;
    /** 是否已拦截到 beforeinstallprompt 事件（可调原生弹窗） */
    canPrompt: boolean;
    /** 原生安装弹窗进行中 */
    installing: boolean;
    /** 手动安装引导弹窗是否打开 */
    guideOpen: boolean;
    /** 本次会话内已通过 appinstalled 确认安装成功 */
    installedThisSession: boolean;
    /** SW 检测到新版本待用户确认 */
    updateReady: boolean;
    /** 用户已确认更新，等待新 SW 接管 */
    updating: boolean;
    /** 激活更新超时或失败 */
    updateFailed: boolean;

    /** 写入 start() 探测到的平台与 standalone 结果 */
    applyDetection: (detection: { platform: InstallPlatform; guideKind: InstallGuideKind | null; standalone: boolean }) => void;
    setCanPrompt: (canPrompt: boolean) => void;
    setInstalling: (installing: boolean) => void;
    setGuideOpen: (guideOpen: boolean) => void;
    setInstalledThisSession: (installed: boolean) => void;
    setStandalone: (standalone: boolean) => void;
    setUpdateReady: (updateReady: boolean) => void;
    setUpdating: (updating: boolean) => void;
    setUpdateFailed: (updateFailed: boolean) => void;
    /** 重置全部状态（测试与 stop 场景使用） */
    reset: () => void;
}

const initialState = {
    platform: "unsupported" as InstallPlatform,
    guideKind: null,
    standalone: false,
    canPrompt: false,
    installing: false,
    guideOpen: false,
    installedThisSession: false,
    updateReady: false,
    updating: false,
    updateFailed: false,
};

export const usePwaStore = create<PwaState>((set) => ({
    ...initialState,
    applyDetection({ platform, guideKind, standalone }) {
        set({ platform, guideKind, standalone });
    },
    setCanPrompt(canPrompt) {
        set({ canPrompt });
    },
    setInstalling(installing) {
        set({ installing });
    },
    setGuideOpen(guideOpen) {
        set({ guideOpen });
    },
    setInstalledThisSession(installedThisSession) {
        set({ installedThisSession });
    },
    setStandalone(standalone) {
        set({ standalone });
    },
    setUpdateReady(updateReady) {
        set({ updateReady });
    },
    setUpdating(updating) {
        set({ updating });
    },
    setUpdateFailed(updateFailed) {
        set({ updateFailed });
    },
    reset() {
        set(initialState);
    },
}));
