"use client";
import { useTranslation } from "@/features/locale/use-translation";


import { useState } from "react";
import { Button, Modal } from "antd";
import { MessageCircle } from "lucide-react";

export function ContactMe() {
    const translate = useTranslation();
    const [open, setOpen] = useState(false);

    return (
        <section className="mt-10 flex flex-col items-center border-t border-[var(--studio-line)] pt-8 text-center" aria-labelledby="edition-contact-title">
            <h2 id="edition-contact-title" className="text-xl font-semibold text-[var(--studio-ink)]">
                {translate("editions.moreQuestions")}</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--studio-muted)]">{translate("editions.enterpriseLicensesPrivateDeploymentAndCustomDevelopmentScanTo")}</p>
            <Button className="mt-5" type="primary" size="large" icon={<MessageCircle className="size-4" />} onClick={() => setOpen(true)}>
                {translate("editions.contactMe")}</Button>

            <Modal open={open} onCancel={() => setOpen(false)} footer={null} centered width={360} title={translate("editions.contactMe")}>
                <div className="flex flex-col items-center gap-3 py-2">
                    <img src="/images/wechat_me.png" alt={translate("editions.weChatQRCode")} className="size-64 rounded-lg border border-[var(--studio-line)] object-contain" />
                    <p className="text-sm text-[var(--studio-muted)]">{translate("editions.scanWithWeChatToAddMe")}</p>
                </div>
            </Modal>
        </section>
    );
}
