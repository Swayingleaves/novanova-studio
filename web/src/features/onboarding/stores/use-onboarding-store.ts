"use client";

import { create } from "zustand";

type OnboardingStore = {
    /** 引导是否正在展示。 */
    active: boolean;
    /** 当前步骤下标。 */
    step: number;
    start: () => void;
    setStep: (step: number) => void;
    stop: () => void;
};

/**
 * 首次登录引导的 UI 状态。
 * <p>
 * 两个消费者分处不同子树：引导组件在外壳层、积分不足弹窗在 Provider 层。
 */
export const useOnboardingStore = create<OnboardingStore>()((set) => ({
    active: false,
    step: 0,
    start: () => set({ active: true, step: 0 }),
    setStep: (step) => set({ step }),
    stop: () => set({ active: false, step: 0 }),
}));
