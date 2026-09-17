"use client";

import { useState } from "react";
import { Button, Modal } from "antd";
import { MessageCircle } from "lucide-react";

export function ContactMe() {
    const [open, setOpen] = useState(false);

    return (
        <section className="mt-10 flex flex-col items-center border-t border-[var(--studio-line)] pt-8 text-center" aria-labelledby="edition-contact-title">
            <h2 id="edition-contact-title" className="text-xl font-semibold text-[var(--studio-ink)]">
                还有其他问题？
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--studio-muted)]">企业版授权、私有化部署与定制开发，扫码直接联系我。</p>
            <Button className="mt-5" type="primary" size="large" icon={<MessageCircle className="size-4" />} onClick={() => setOpen(true)}>
                联系我
            </Button>

            <Modal open={open} onCancel={() => setOpen(false)} footer={null} centered width={360} title="联系我">
                <div className="flex flex-col items-center gap-3 py-2">
                    <img src="/images/wechat_me.png" alt="微信二维码" className="size-64 rounded-lg border border-[var(--studio-line)] object-contain" />
                    <p className="text-sm text-[var(--studio-muted)]">微信扫一扫，添加我为好友</p>
                </div>
            </Modal>
        </section>
    );
}
