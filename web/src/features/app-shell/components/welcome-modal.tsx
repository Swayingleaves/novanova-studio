"use client";
import { currentLanguageTag } from "@/features/locale/translate";

import { useTranslation } from "@/features/locale/use-translation";


import { useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Modal } from "antd";
import { ArrowRight } from "lucide-react";

import { useUserStore } from "@/features/auth/stores/use-user-store";
import { acknowledgeWelcome } from "@/services/api/server";

export function WelcomeModal() {
    const translate = useTranslation();
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
            message.error(error instanceof Error ? error.message : translate("appShell.failedToMarkWelcomeReadRetry"));
        } finally {
            setAcknowledging(false);
        }
    };

    if (!user || user.welcomeRead) return null;
    const creditBalanceText = user.creditBalance.toLocaleString(currentLanguageTag());

    return (
        <Modal open closable={!acknowledging} footer={null} centered width={520} mask={{ closable: false }} keyboard={false} onCancel={() => void acknowledge()} styles={{ body: { padding: 0 } }}>
            <section className="px-6 pb-6 pt-10 text-center sm:px-8 sm:pb-8" aria-label={translate("appShell.welcomeToNovanovaStudio")}>
                <img src="/images/welcome.png" alt={translate("appShell.welcomeIllustration")} className="mx-auto mb-4 h-auto w-54 object-contain" />

                <h2 className="text-balance text-xl font-semibold text-[var(--studio-ink)]">Welcome to Novanova Studio</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--studio-muted)]">{translate("appShell.professionalAIAgentWorkspaceForVisualCreators")}</p>

                <div className="mt-5 border-t border-[var(--studio-line)] pt-4">
                    <div className="flex items-center gap-3 rounded-lg bg-[var(--studio-primary-soft)] px-3 py-3 text-left">
                        <img src="/images/gift.png" alt="" aria-hidden="true" className="size-30 shrink-0 object-contain" />
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-[var(--studio-primary)]">
                                {creditBalanceText} Credits <span className="ml-1 text-[var(--studio-ink)]">{translate("appShell.credited")}</span>
                            </p>
                            <p className="mt-0.5 text-xs leading-5 text-[var(--studio-muted)]">{translate("appShell.exploreAIVisualCreation")}</p>
                        </div>
                    </div>
                </div>

                <div className="mt-5 space-y-2">
                    <Button type="primary" size="large" block loading={acknowledging} icon={<ArrowRight className="size-4" />} iconPlacement="end" onClick={() => void acknowledge("/canvas")}>
                        {translate("appShell.startCreating")}</Button>
                    <Button type="text" size="large" block disabled={acknowledging} onClick={() => void acknowledge()}>
                        {translate("appShell.maybeLater")}</Button>
                </div>
            </section>
        </Modal>
    );
}
