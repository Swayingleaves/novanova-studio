"use client";

import { creditText, type CreditAmount } from "@/shared/lib/credit-amounts";
import { useTranslation } from "@/features/locale/use-translation";

import Image from "next/image";
import { Button, Modal } from "antd";
import { Gift, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * 首充赠送弹窗：动效与签到奖励弹窗一致（3D 翻转 + 延迟退场），内容只展示后台配置的赠送比例。
 * <p>
 * 关闭即视为已展示，由调用方写入用户档案；关闭不会消耗赠送资格。
 */
export function FirstPurchaseBonusModal({ percent, onClose }: { percent: CreditAmount; onClose: () => void }) {
    const translate = useTranslation();
    const [visible, setVisible] = useState(false);
    const [reduceMotion, setReduceMotion] = useState(false);
    const closingRef = useRef(false);
    const closeTimerRef = useRef<number | null>(null);

    useEffect(() => {
        const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
        const updateReduceMotion = () => setReduceMotion(mediaQuery.matches);
        updateReduceMotion();
        mediaQuery.addEventListener("change", updateReduceMotion);
        return () => mediaQuery.removeEventListener("change", updateReduceMotion);
    }, []);

    useEffect(() => {
        const frame = window.requestAnimationFrame(() => setVisible(true));
        return () => window.cancelAnimationFrame(frame);
    }, []);

    useEffect(() => {
        return () => {
            if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
        };
    }, []);

    const handleClose = () => {
        if (closingRef.current) return;
        closingRef.current = true;
        setVisible(false);
        if (reduceMotion) {
            onClose();
            return;
        }
        closeTimerRef.current = window.setTimeout(onClose, 650);
    };

    return (
        <Modal
            open
            centered
            width={520}
            footer={null}
            closable={false}
            keyboard
            destroyOnHidden
            mask={{ closable: true }}
            onCancel={handleClose}
            title={<span className="sr-only">{translate("credits.firstPurchaseBonusTitle")}</span>}
            styles={{
                mask: { backdropFilter: "blur(8px)" },
                container: { padding: 0, overflow: "hidden", background: "transparent", boxShadow: "none" },
                header: { height: 0, margin: 0 },
                body: { overflow: "hidden", background: "transparent" },
            }}
        >
            <div className="max-h-[calc(100dvh-32px)] overflow-x-hidden overflow-y-auto [&::-webkit-scrollbar]:hidden" style={{ perspective: "1400px", scrollbarWidth: "none" }}>
                <div
                    className="relative overflow-hidden rounded-xl border border-[var(--studio-line-strong)] bg-[var(--studio-surface)] shadow-2xl"
                    style={{
                        backfaceVisibility: "hidden",
                        opacity: visible ? 1 : 0,
                        transform: visible ? "translateY(0) scale(1) rotateY(0deg)" : "translateY(18px) scale(0.72) rotateY(-82deg)",
                        transformOrigin: "center center",
                        transformStyle: "preserve-3d",
                        transition: reduceMotion
                            ? "none"
                            : visible
                              ? "transform 900ms cubic-bezier(0.16, 1, 0.3, 1), opacity 480ms ease-out"
                              : "transform 620ms cubic-bezier(0.4, 0, 0.8, 1), opacity 420ms ease-in",
                        willChange: "transform, opacity",
                    }}
                >
                    <section
                        className="relative min-h-[270px] overflow-hidden px-6 pb-8 pt-7 text-[var(--studio-brand-shine)] sm:min-h-[296px] sm:px-8 sm:pb-10 sm:pt-9"
                        style={{
                            background:
                                "radial-gradient(circle at 78% 52%, var(--studio-primary-line), transparent 32%), linear-gradient(135deg, color-mix(in srgb, var(--studio-composer-submit-foreground) 84%, var(--studio-action)) 0%, var(--studio-composer-submit-foreground) 62%, color-mix(in srgb, var(--studio-composer-submit-foreground) 80%, var(--studio-accent)) 100%)",
                        }}
                    >
                        <div className="relative z-10 max-w-[62%] sm:max-w-[58%]">
                            <div className="flex items-center gap-3">
                                <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--studio-action)] text-[var(--studio-action-foreground)] shadow-[var(--studio-shadow)]">
                                    <Gift className="size-6" strokeWidth={2.4} aria-hidden />
                                </span>
                                <h2 className="text-[28px] font-semibold leading-tight sm:text-[34px]">{translate("credits.firstPurchaseBonusTitle")}</h2>
                            </div>

                            <div className="mt-7 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                <strong className="text-5xl font-semibold leading-none tabular-nums text-[var(--studio-action)] sm:text-6xl">
                                    {translate("credits.firstPurchaseBonusPercentValue", { value0: creditText(percent) })}
                                </strong>
                            </div>

                            <p className="mt-4 text-sm font-medium" style={{ color: "color-mix(in srgb, var(--studio-brand-shine) 82%, transparent)" }}>
                                {translate("credits.firstPurchaseBonusSubtitle")}
                            </p>
                            <p className="mt-3 flex max-w-[15rem] items-start gap-2 text-xs leading-5" style={{ color: "color-mix(in srgb, var(--studio-brand-shine) 68%, transparent)" }}>
                                <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden />
                                <span>{translate("credits.firstPurchaseBonusOnlyOnce")}</span>
                            </p>
                        </div>

                        <div className="pointer-events-none absolute -bottom-3 -right-5 z-0 w-[176px] sm:-bottom-5 sm:right-1 sm:w-[246px]" aria-hidden>
                            <div
                                className="absolute bottom-4 left-1/2 h-14 w-32 -translate-x-1/2 rounded-full blur-2xl sm:h-20 sm:w-44"
                                style={{ background: "color-mix(in srgb, var(--studio-action) 25%, transparent)" }}
                            />
                            <Image src="/images/gift.png" alt="" width={1024} height={1024} className="relative h-auto w-full drop-shadow-2xl" sizes="(max-width: 640px) 176px, 246px" />
                        </div>
                        <Sparkles className="pointer-events-none absolute right-[42%] top-8 size-5 text-[var(--studio-action)] sm:right-[44%]" aria-hidden />
                    </section>

                    <section className="relative px-5 pb-5 pt-7 sm:px-8 sm:pb-8 sm:pt-8">
                        <div className="pointer-events-none absolute -top-7 left-[-5%] h-12 w-[110%] rounded-[50%] bg-[var(--studio-surface)]" aria-hidden />
                        <Button type="primary" size="large" block className="relative min-h-12" icon={<Gift className="size-5" aria-hidden />} onClick={handleClose}>
                            {translate("credits.firstPurchaseBonusAcknowledge")}
                        </Button>
                    </section>

                    <button
                        type="button"
                        onClick={handleClose}
                        aria-label={translate("credits.firstPurchaseBonusClose")}
                        className="absolute right-3 top-3 z-20 inline-flex size-11 items-center justify-center rounded-full border border-[var(--studio-brand-shine-soft)] bg-[var(--studio-brand-shine-soft)] text-[var(--studio-brand-shine)] transition hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-action)] motion-reduce:transition-none sm:right-4 sm:top-4"
                    >
                        <X className="size-5" strokeWidth={2} aria-hidden />
                    </button>
                </div>
            </div>
        </Modal>
    );
}
