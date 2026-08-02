"use client";

import { Button } from "antd";
import { ArrowLeft, ExternalLink, ShoppingCart } from "lucide-react";
import Link from "next/link";

const CREDIT_STORE_URL = "https://pay.ldxp.cn/shop/novanovastudio";

/**
 * 渲染积分购买页。
 *
 * @returns 发卡店铺嵌入页面
 */
export default function CreditPurchasePage() {
    return (
        <main className="studio-page h-full overflow-auto">
            <div className="mx-auto flex min-h-full w-full max-w-[1440px] flex-col px-4 py-5 sm:px-6 lg:px-8">
                <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--studio-line)] pb-5">
                    <div className="flex items-center gap-3">
                        <Link href="/credits" className="grid size-9 place-items-center rounded-md text-[var(--studio-muted)] transition hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]" aria-label="返回积分" title="返回积分">
                            <ArrowLeft className="size-4" />
                        </Link>
                        <div>
                            <h1 className="flex items-center gap-2 text-xl font-semibold text-[var(--studio-ink)]"><ShoppingCart className="size-5 text-[var(--studio-primary)]" />购买积分</h1>
                            <p className="mt-1 text-sm text-[var(--studio-muted)]">Novanova Studio 积分店铺</p>
                        </div>
                    </div>
                    <a href={CREDIT_STORE_URL} target="_blank" rel="noreferrer">
                        <Button icon={<ExternalLink className="size-4" />}>新窗口购买</Button>
                    </a>
                </header>
                <section className="mt-5 min-h-[min(720px,calc(100dvh-170px))] flex-1 overflow-hidden border border-[var(--studio-line)] bg-[var(--studio-surface)]" aria-label="积分购买店铺">
                    <iframe title="Novanova Studio 积分购买店铺" src={CREDIT_STORE_URL} className="h-full min-h-[min(720px,calc(100dvh-170px))] w-full border-0" referrerPolicy="strict-origin-when-cross-origin" />
                </section>
            </div>
        </main>
    );
}
