"use client";

import { create } from "zustand";

/** 引导分两种：全局四步、创作页三步，同一时刻只允许一个在跑。 */
export type OnboardingTour = "global" | "creation";

type OnboardingStore = {
    /** 当前展示的引导，null 表示没有引导。 */
    tour: OnboardingTour | null;
    /** 当前步骤下标。 */
    step: number;
    start: (tour: OnboardingTour) => void;
    setStep: (step: number) => void;
    stop: () => void;
};

/**
 * 产品导览的 UI 状态。
 * <p>
 * 两个消费者分处不同子树：引导组件在外壳层、积分不足弹窗在 Provider 层。
 */
export const useOnboardingStore = create<OnboardingStore>()((set) => ({
    tour: null,
    step: 0,
    start: (tour) => set({ tour, step: 0 }),
    setStep: (step) => set({ step }),
    stop: () => set({ tour: null, step: 0 }),
}));
