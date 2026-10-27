"use client";

import { useEffect, useRef, useState } from "react";
import { Tour } from "antd";

import { usePathname } from "@/shared/lib/team-navigation";
import { useTranslation } from "@/features/locale/use-translation";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { useSpaceBrand } from "@/features/team/use-space-brand";
import { completeOnboarding } from "@/services/api/server";

import {
    ONBOARDING_STEPS,
    ONBOARDING_TOUR_Z_INDEX,
    ONBOARDING_VERSION,
    hidesSidebar,
    isDesktopViewport,
    shouldStartOnboarding,
} from "../onboarding-steps";
import { waitForElement } from "../wait-for-element";
import { useOnboardingStore } from "../stores/use-onboarding-store";

/**
 * 首次登录引导：欢迎弹窗消费完成后接上，共四步。
 * <p>
 * 启动前会等所有锚点就绪；任一锚点超时就整体放弃，且不标记完成，下次登录还能看到。
 */
export function ProductTour() {
    const translate = useTranslation();
    const pathname = usePathname();
    const brand = useSpaceBrand();
    const user = useUserStore((state) => state.user);
    const markOnboardingCompleted = useUserStore((state) => state.markOnboardingCompleted);
    const active = useOnboardingStore((state) => state.active);
    const step = useOnboardingStore((state) => state.step);
    const start = useOnboardingStore((state) => state.start);
    const setStep = useOnboardingStore((state) => state.setStep);
    const stop = useOnboardingStore((state) => state.stop);
    const [mounted, setMounted] = useState(false);
    const [ready, setReady] = useState(false);
    /**
     * 本次挂载内不再启动，也不再落库。
     * <p>
     * 请求失败或锚点超时时 `eligible` 仍可能为 true，没有这个开关会在
     * `stop()` 之后又被 500ms 定时器重新拉起，形成关不掉或反复重试的循环。
     */
    const stoppedRef = useRef(false);

    // 首屏 HTML 必须是不带引导的，挂载后再判定，避免 hydration 抖动。
    useEffect(() => setMounted(true), []);

    const eligible =
        mounted &&
        shouldStartOnboarding({
            user: user ? { welcomeRead: user.welcomeRead, onboardingVersion: user.onboardingVersion } : null,
            isTeam: brand.isTeam,
            pathname,
            desktop: isDesktopViewport(),
        });

    // 延迟 500ms 启动：覆盖欢迎弹窗退场动画，也让「开始创作」的跳转先落地。
    useEffect(() => {
        if (!eligible || active || stoppedRef.current) return;
        const timer = window.setTimeout(start, 500);
        return () => window.clearTimeout(timer);
    }, [eligible, pathname, active, start]);

    // 锚点未就绪时 Tour 会退化成居中展示，所以先等齐再开演。
    useEffect(() => {
        if (!active) {
            setReady(false);
            return;
        }
        let cancelled = false;
        void Promise.all(ONBOARDING_STEPS.map((item) => waitForElement(item.target))).then((found) => {
            if (cancelled) return;
            if (found.some((element) => !element)) {
                stoppedRef.current = true;
                stop();
                return;
            }
            setReady(true);
        });
        return () => {
            cancelled = true;
        };
    }, [active, stop]);

    // 引导期间压掉侧栏 Tooltip，避免它盖在引导卡片上。
    useEffect(() => {
        if (!active) return;
        document.body.dataset.onboarding = "active";
        return () => {
            delete document.body.dataset.onboarding;
        };
    }, [active]);

    // 进入画布详情页后侧栏整块消失，引导无法继续。
    useEffect(() => {
        if (!active || !hidesSidebar(pathname)) return;
        stoppedRef.current = true;
        stop();
    }, [active, pathname, stop]);

    const finish = async () => {
        if (stoppedRef.current) return;
        stoppedRef.current = true;
        try {
            // 先等接口成功再写本地，避免资料回刷把版本号拨回 0。
            await completeOnboarding(ONBOARDING_VERSION);
            markOnboardingCompleted(ONBOARDING_VERSION);
        } finally {
            stop();
        }
    };

    const steps = ONBOARDING_STEPS.map((item) => ({
        target: () => document.querySelector<HTMLElement>(item.target) as HTMLElement,
        title: translate(item.titleKey),
        description: translate(item.descriptionKey),
        placement: item.placement,
    }));

    return (
        <Tour
            open={active && ready}
            current={step}
            zIndex={ONBOARDING_TOUR_Z_INDEX}
            steps={steps}
            onChange={(next) => setStep(next)}
            onClose={() => void finish()}
            onFinish={() => void finish()}
        />
    );
}
