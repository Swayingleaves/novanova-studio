"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Modal } from "antd";
import { ArrowRight } from "lucide-react";

import { useUserStore } from "@/features/auth/stores/use-user-store";
import { acknowledgeWelcome } from "@/services/api/server";

export function WelcomeModal() {
    const router = useRouter();
    const { message } = App.useApp();
    const user = useUserStore((state) => state.user);
    const markWelcomeRead = useUserStore((state) => state.markWelcomeRead);
    const [acknowledging, setAcknowledging] = useState(false);

    const acknowledge = async (destination?: "/canvas") => {
        if (acknowledging) return;
        setAcknowledging(true);
        try {
            await acknowledgeWelcome();
            markWelcomeRead();
            if (destination) router.push(destination);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "标记欢迎引导已读失败，请重试");
        } finally {
            setAcknowledging(false);
        }
    };

    if (!user || user.welcomeRead) return null;

    return (
        <Modal open closable={!acknowledging} footer={null} centered width={520} mask={{ closable: false }} keyboard={false} onCancel={() => void acknowledge()} styles={{ body: { padding: 0 } }}>
            <section className="px-6 pb-6 pt-10 text-center sm:px-8 sm:pb-8" aria-label="欢迎来到 Novanova Studio">
                <img src="/images/welcome.png" alt="欢迎插画" className="mx-auto mb-4 h-auto w-54 object-contain" />

                <h2 className="text-balance text-xl font-semibold text-[var(--studio-ink)]">Welcome to Novanova Studio</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--studio-muted)]">给视觉创作者的专业AI Agent工作台</p>

                <div className="mt-5 border-t border-[var(--studio-line)] pt-4">
                    <div className="flex items-center gap-3 rounded-lg bg-[var(--studio-primary-soft)] px-3 py-3 text-left">
                        <img src="/images/gift.png" alt="" aria-hidden="true" className="size-30 shrink-0 object-contain" />
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-[var(--studio-primary)]">
                                100 Credits <span className="ml-1 text-[var(--studio-ink)]">已到账</span>
                            </p>
                            <p className="mt-0.5 text-xs leading-5 text-[var(--studio-muted)]">用于体验 AI 视觉创作</p>
                        </div>
                    </div>
                </div>

                <div className="mt-5 space-y-2">
                    <Button type="primary" size="large" block loading={acknowledging} icon={<ArrowRight className="size-4" />} iconPlacement="end" onClick={() => void acknowledge("/canvas")}>
                        开始创作
                    </Button>
                    <Button type="text" size="large" block disabled={acknowledging} onClick={() => void acknowledge()}>
                        稍后再说
                    </Button>
                </div>
            </section>
        </Modal>
    );
}
