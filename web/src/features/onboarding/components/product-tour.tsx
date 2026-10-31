"use client";

import { useEffect, useRef, useState } from "react";
import { Tour } from "antd";

import { usePathname } from "@/shared/lib/team-navigation";
import { useTranslation } from "@/features/locale/use-translation";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { useSpaceBrand } from "@/features/team/use-space-brand";
import { completeCreationTour, completeOnboarding } from "@/services/api/server";

import {
    CREATION_TOUR_STEPS,
    CREATION_TOUR_VERSION,
    ONBOARDING_STEPS,
    ONBOARDING_TOUR_Z_INDEX,
    ONBOARDING_VERSION,
    hidesSidebar,
    isDesktopViewport,
    shouldStartCreationTour,
    shouldStartOnboarding,
} from "../onboarding-steps";
import { waitForElement } from "../wait-for-element";
import { useOnboardingStore } from "../stores/use-onboarding-store";

/**
 * 产品导览：首次登录的全局四步，以及首次进入图片/视频创作页的三步。
 * <p>
 * 全局引导优先，创作页导览等它完成后才会启动；两者不会同时占屏。
 * 启动前会等所有锚点就绪，任一锚点超时就整体放弃且不标记完成。
 */
export function ProductTour() {
    const translate = useTranslation();
    const pathname = usePathname();
    const brand = useSpaceBrand();
    const user = useUserStore((state) => state.user);
    const markOnboardingCompleted = useUserStore((state) => state.markOnboardingCompleted);
    const markCreationTourCompleted = useUserStore((state) => state.markCreationTourCompleted);
    const tour = useOnboardingStore((state) => state.tour);
    const step = useOnboardingStore((state) => state.step);
    const start = useOnboardingStore((state) => state.start);
    const setStep = useOnboardingStore((state) => state.setStep);
    const stop = useOnboardingStore((state) => state.stop);
    const [mounted, setMounted] = useState(false);
    const [ready, setReady] = useState(false);
    /** 当前这一轮已经触发过完成，避免 onFinish 与 onClose 连续触发时重复落库。 */
    const finishedRef = useRef(false);
    /**
     * 本次挂载彻底放弃。
     * <p>
     * 锚点超时、落库失败、进入画布详情页都会让 `eligible` 仍为 true，
     * 没有这个开关会在 `stop()` 之后被定时器反复拉起。
     */
    const failedRef = useRef(false);

    // 首屏 HTML 必须是不带引导的，挂载后再判定，避免 hydration 抖动。
    useEffect(() => setMounted(true), []);

    const globalEligible =
        mounted &&
        shouldStartOnboarding({
            user: user ? { welcomeRead: user.welcomeRead, onboardingVersion: user.onboardingVersion } : null,
            isTeam: brand.isTeam,
            pathname,
            desktop: isDesktopViewport(),
        });

    const creationEligible =
        mounted &&
        shouldStartCreationTour({
            user: user
                ? {
                      welcomeRead: user.welcomeRead,
                      onboardingVersion: user.onboardingVersion,
                      creationTourVersion: user.creationTourVersion,
                  }
                : null,
            isTeam: brand.isTeam,
            pathname,
            // 创作页会话栏在 lg 以下隐藏，窄屏放不出这一步。
            desktop: isDesktopViewport(1024),
        });

    // 全局引导先跑；创作页导览要求全局已完成，两者不会同时成立。
    // 延迟用于覆盖欢迎弹窗退场动画与「开始创作」的跳转。
    useEffect(() => {
        if (tour || failedRef.current) return;
        const kind = globalEligible ? "global" : creationEligible ? "creation" : null;
        if (!kind) return;
        const timer = window.setTimeout(
            () => {
                finishedRef.current = false;
                start(kind);
            },
            kind === "global" ? 500 : 800,
        );
        return () => window.clearTimeout(timer);
    }, [globalEligible, creationEligible, tour, pathname, start]);

    // 锚点未就绪时 Tour 会退化成居中展示，所以先等齐再开演。
    useEffect(() => {
        if (!tour) {
            setReady(false);
            return;
        }
        const steps = tour === "creation" ? CREATION_TOUR_STEPS : ONBOARDING_STEPS;
        let cancelled = false;
        void Promise.all(steps.map((item) => waitForElement(item.target))).then((found) => {
            if (cancelled) return;
            if (found.some((element) => !element)) {
                failedRef.current = true;
                stop();
                return;
            }
            setReady(true);
        });
        return () => {
            cancelled = true;
        };
    }, [tour, stop]);

    // 引导期间压掉侧栏 Tooltip，避免它盖在引导卡片上。
    useEffect(() => {
        if (!tour) return;
        document.body.dataset.onboarding = "active";
        return () => {
            delete document.body.dataset.onboarding;
        };
    }, [tour]);

    // 进入画布详情页后侧栏整块消失，引导无法继续。
    useEffect(() => {
        if (!tour || !hidesSidebar(pathname)) return;
        failedRef.current = true;
        stop();
    }, [tour, pathname, stop]);

    const finish = async () => {
        if (finishedRef.current) return;
        finishedRef.current = true;
        try {
            if (tour === "creation") {
                await completeCreationTour(CREATION_TOUR_VERSION);
                markCreationTourCompleted(CREATION_TOUR_VERSION);
            } else {
                // 先等接口成功再写本地，避免资料回刷把版本号拨回 0。
                await completeOnboarding(ONBOARDING_VERSION);
                markOnboardingCompleted(ONBOARDING_VERSION);
            }
        } catch {
            // 落库失败就放弃本轮，避免关掉后被定时器立刻重新拉起。
            failedRef.current = true;
        } finally {
            stop();
        }
    };

    const stepDefs = tour === "creation" ? CREATION_TOUR_STEPS : ONBOARDING_STEPS;
    const steps = stepDefs.map((item) => ({
        target: () => document.querySelector<HTMLElement>(item.target) as HTMLElement,
        title: translate(item.titleKey),
        description: translate(item.descriptionKey),
        placement: item.placement,
    }));

    return (
        <Tour
            open={tour !== null && ready}
            current={step}
            zIndex={ONBOARDING_TOUR_Z_INDEX}
            steps={steps}
            onChange={(next) => setStep(next)}
            onClose={() => void finish()}
            onFinish={() => void finish()}
        />
    );
}
