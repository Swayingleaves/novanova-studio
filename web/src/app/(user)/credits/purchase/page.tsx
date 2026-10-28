"use client";

import { creditText } from "@/shared/lib/credit-amounts";

import { useTranslation } from "@/features/locale/use-translation";

import { Alert, App, Button, Empty, Modal, Skeleton, Tag } from "antd";
import { ArrowLeft, CheckCircle2, Clock, ExternalLink, LoaderCircle, QrCode, ScanLine, ShoppingCart, Ticket, WalletCards, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { cancelCreditOrder, createCreditPurchaseOrder, getCreditPurchaseOrderStatus, getCreditPurchasePayment, getCurrentUserInfo, listCreditProducts } from "@/services/api/server";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import Link, { useSearchParams } from "@/shared/lib/team-navigation";
import { cn } from "@/shared/lib/utils";

const creditStoreUrl = process.env.NEXT_PUBLIC_CREDIT_STORE_URL?.trim();

/**
 * 计算距目标时间的剩余秒数。
 *
 * @param target 目标时间文本
 * @returns 剩余秒数，时间无效或已过期时为 0
 */
function secondsUntil(target: string) {
    if (!target) return 0;
    const remaining = new Date(target).getTime() - Date.now();
    return Number.isNaN(remaining) ? 0 : Math.max(0, Math.floor(remaining / 1000));
}

/**
 * 渲染站内积分商品购买页面。
 *
 * @returns 积分商品和支付方式页面
 */
export default function CreditPurchasePage() {
    const translate = useTranslation();
    const { message, modal } = App.useApp();
    const searchParams = useSearchParams();
    const setUser = useUserStore((state) => state.setUser);
    const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
    const [paymentMethod, setPaymentMethod] = useState<"alipay" | "wechat">("alipay");
    const [submitting, setSubmitting] = useState(false);
    const [openingPayment, setOpeningPayment] = useState(false);
    const [orderNo, setOrderNo] = useState(() => searchParams.get("orderNo") || "");
    const [paymentUrl, setPaymentUrl] = useState("");
    const [paymentPriceAmount, setPaymentPriceAmount] = useState("");
    const [expiresAt, setExpiresAt] = useState("");
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [remainingSeconds, setRemainingSeconds] = useState(0);

    const productsQuery = useQuery({
        queryKey: ["credit-products"],
        queryFn: listCreditProducts,
        staleTime: 60_000,
    });
    const products = productsQuery.data?.products || [];
    const selectedProduct = useMemo(() => products.find((product) => product.id === selectedProductId) || null, [products, selectedProductId]);

    // 支付宝交易是在二维码页面被加载的那一刻才创建的，二维码没展示过就查单只会反复拿到“交易不存在”。
    const paymentShownRef = useRef(false);
    const orderStatusQuery = useQuery({
        queryKey: ["credit-purchase-order", orderNo],
        queryFn: () => getCreditPurchaseOrderStatus(orderNo),
        enabled: Boolean(orderNo),
        refetchInterval: (query) => {
            const status = query.state.data?.status;
            if (status !== "pending") return false;
            return paymentShownRef.current ? 2500 : false;
        },
    });
    const orderStatus = orderStatusQuery.data;

    useEffect(() => {
        if (selectedProductId === null && products.length) setSelectedProductId(products[0].id);
    }, [products, selectedProductId]);

    useEffect(() => {
        const returnedOrderNo = searchParams.get("orderNo") || "";
        if (returnedOrderNo && returnedOrderNo !== orderNo) setOrderNo(returnedOrderNo);
    }, [orderNo, searchParams]);

    useEffect(() => {
        if (orderStatus?.status !== "paid") return;
        void getCurrentUserInfo({ scope: "platform" })
            .then(setUser)
            .catch(() => undefined);
    }, [orderStatus?.status, setUser]);

    // 计算订单过期倒计时
    useEffect(() => {
        if (!isModalOpen || !expiresAt) return;
        setRemainingSeconds(secondsUntil(expiresAt));
        const timer = setInterval(() => {
            const current = secondsUntil(expiresAt);
            setRemainingSeconds(current);
            if (current <= 0) clearInterval(timer);
        }, 1000);
        return () => clearInterval(timer);
    }, [isModalOpen, expiresAt]);

    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    const timeLeftText = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

    const applyPayment = (response: { paymentUrl: string; priceAmount: string; expiresAt: string }, fallbackPriceAmount = "") => {
        setPaymentUrl(response.paymentUrl || "");
        paymentShownRef.current = Boolean(response.paymentUrl);
        setPaymentPriceAmount(response.priceAmount || fallbackPriceAmount);
        setExpiresAt(response.expiresAt || "");
        setRemainingSeconds(secondsUntil(response.expiresAt || ""));
        setIsModalOpen(true);
    };

    // 二维码一出现就开始轮询；取消后支付地址被清空，轮询自然停止。
    useEffect(() => {
        if (!paymentUrl || !orderNo) return;
        void orderStatusQuery.refetch();
    }, [paymentUrl, orderNo]);

    const submitOrder = async () => {
        if (!selectedProduct || paymentMethod !== "alipay") return;
        setSubmitting(true);
        try {
            const response = await createCreditPurchaseOrder({ productId: selectedProduct.id, paymentMethod });
            setOrderNo(response.orderNo);
            applyPayment(response, selectedProduct.priceAmount);
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("credits.paymentFailed"));
        } finally {
            setSubmitting(false);
        }
    };

    // 刷新页面或从支付宝跳回后手里没有支付地址，按订单号重新签发一次。
    const openPayment = async () => {
        if (paymentUrl) {
            setIsModalOpen(true);
            return;
        }
        if (!orderNo) return;
        setOpeningPayment(true);
        try {
            applyPayment(await getCreditPurchasePayment(orderNo));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("credits.paymentFailed"));
        } finally {
            setOpeningPayment(false);
        }
    };

    // 关掉二维码等于放弃本次支付：二次确认后把订单置为已取消，避免留下没人付的待支付单。
    // 已支付/确认中/已关闭/已取消的订单只关窗口；状态还没取回来时按待支付处理，避免漏掉取消。
    const closePaymentModal = () => {
        const status = orderStatus?.status;
        if (status === "paid" || status === "processing" || status === "closed" || status === "cancelled") {
            setIsModalOpen(false);
            return;
        }
        modal.confirm({
            title: translate("credits.cancelPaymentTitle"),
            content: translate("credits.cancelPaymentDescription"),
            okText: translate("credits.cancelPaymentConfirm"),
            cancelText: translate("credits.cancelPaymentKeep"),
            okButtonProps: { danger: true },
            centered: true,
            onOk: async () => {
                if (!orderNo) {
                    setIsModalOpen(false);
                    return;
                }
                try {
                    await cancelCreditOrder(orderNo);
                    paymentShownRef.current = false;
                    setPaymentUrl("");
                    setIsModalOpen(false);
                    await orderStatusQuery.refetch();
                } catch (error) {
                    message.error(error instanceof Error ? error.message : translate("credits.cancelPaymentFailed"));
                }
            },
        });
    };

    const statusMessage =
        orderStatus?.status === "paid"
            ? translate("credits.paymentSuccess")
            : orderStatus?.status === "cancelled"
              ? translate("credits.orderCancelled")
              : orderStatus?.status === "closed"
                ? translate("credits.paymentExpired")
                : orderStatus?.status === "processing"
                  ? translate("credits.paymentProcessing")
                  : translate("credits.paymentPending");

    return (
        <main className="studio-page h-full overflow-auto">
            <div className="mx-auto w-full max-w-[1200px] px-4 py-5 sm:px-6 lg:px-8">
                <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--studio-line)] pb-5">
                    <div className="flex items-center gap-3">
                        <Link
                            href="/credits"
                            className="grid size-10 place-items-center rounded-md text-[var(--studio-muted)] transition hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--studio-action)]"
                            aria-label={translate("credits.backToCredits")}
                            title={translate("credits.backToCredits")}
                        >
                            <ArrowLeft className="size-4" />
                        </Link>
                        <div>
                            <h1 className="flex items-center gap-2 text-xl font-semibold text-[var(--studio-ink)]">
                                <ShoppingCart className="size-5 text-[var(--studio-primary)]" />
                                {translate("credits.buyCredits")}
                            </h1>
                            <p className="mt-1 text-sm text-[var(--studio-muted)]">{translate("credits.creditPurchaseDescription")}</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Link href="/credits/redeem">
                            <Button icon={<Ticket className="size-4" />}>{translate("credits.redeemCredits")}</Button>
                        </Link>
                        {creditStoreUrl ? (
                            <a href={creditStoreUrl} target="_blank" rel="noreferrer">
                                <Button icon={<ExternalLink className="size-4" />}>{translate("credits.purchaseInNewWindow")}</Button>
                            </a>
                        ) : null}
                    </div>
                </header>

                {productsQuery.isError ? (
                    <Alert
                        className="mt-5"
                        type="error"
                        showIcon
                        title={translate("credits.failedToLoadProducts")}
                        action={
                            <Button size="small" onClick={() => void productsQuery.refetch()}>
                                {translate("credits.reload")}
                            </Button>
                        }
                    />
                ) : null}

                <section className="mt-6" aria-labelledby="credit-product-title">
                    <div className="mb-3 flex items-end justify-between gap-3">
                        <div>
                            <h2 id="credit-product-title" className="text-base font-semibold text-[var(--studio-ink)]">
                                {translate("credits.selectCreditProduct")}
                            </h2>
                            <p className="mt-1 text-sm text-[var(--studio-muted)]">{translate("credits.paidCreditsNeverExpire")}</p>
                        </div>
                        <span className="text-sm text-[var(--studio-muted)]">{translate("credits.platformWallet")}</span>
                    </div>
                    {productsQuery.isLoading ? (
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            {[1, 2, 3, 4].map((item) => (
                                <Skeleton key={item} active paragraph={{ rows: 2 }} />
                            ))}
                        </div>
                    ) : products.length ? (
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            {products.map((product) => {
                                const selected = product.id === selectedProductId;
                                return (
                                    <button
                                        key={product.id}
                                        type="button"
                                        aria-pressed={selected}
                                        onClick={() => setSelectedProductId(product.id)}
                                        className={cn(
                                            "min-h-36 rounded-lg border p-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--studio-action)]",
                                            selected ? "border-[var(--studio-action)] bg-[var(--studio-surface-soft)] shadow-sm" : "border-[var(--studio-line)] bg-[var(--studio-surface)] hover:border-[var(--studio-action)]",
                                        )}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <span className="text-2xl font-semibold tabular-nums text-[var(--studio-ink)]">{creditText(product.credits)}</span>
                                            {selected ? <CheckCircle2 className="size-5 shrink-0 text-[var(--studio-action)]" aria-label={translate("credits.selected")} /> : null}
                                        </div>
                                        <div className="mt-1 text-sm text-[var(--studio-muted)]">{translate("credits.creditsUnit")}</div>
                                        <div className="mt-5 text-lg font-semibold tabular-nums text-[var(--studio-action)]">¥ {product.priceAmount}</div>
                                    </button>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="border border-dashed border-[var(--studio-line)] px-6 py-12">
                            <Empty description={translate("credits.noProducts")} />
                        </div>
                    )}
                </section>

                <section className="mt-8 border-t border-[var(--studio-line)] pt-6" aria-labelledby="payment-method-title">
                    <div className="mb-3">
                        <h2 id="payment-method-title" className="text-base font-semibold text-[var(--studio-ink)]">
                            {translate("credits.paymentMethod")}
                        </h2>
                        <p className="mt-1 text-sm text-[var(--studio-muted)]">{translate("credits.paymentRedirectHint")}</p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <button
                            type="button"
                            aria-pressed={paymentMethod === "alipay"}
                            onClick={() => setPaymentMethod("alipay")}
                            className={cn(
                                "flex min-h-16 items-center gap-3 rounded-lg border px-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--studio-action)]",
                                paymentMethod === "alipay" ? "border-[var(--studio-action)] bg-[var(--studio-surface-soft)]" : "border-[var(--studio-line)] bg-[var(--studio-surface)] hover:border-[var(--studio-action)]",
                            )}
                        >
                            <img src="/payment/alipay.png" alt="支付宝" className="size-9 rounded-md object-contain" />
                            <span className="min-w-0 flex-1">
                                <span className="block font-medium text-[var(--studio-ink)]">{translate("credits.alipay")}</span>
                                <span className="mt-1 block text-xs text-[var(--studio-muted)]">{translate("credits.alipayAvailable")}</span>
                            </span>
                            {paymentMethod === "alipay" ? <CheckCircle2 className="size-5 text-[var(--studio-action)]" /> : null}
                        </button>
                        <button type="button" disabled aria-disabled="true" className="flex min-h-16 items-center gap-3 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] px-4 text-left opacity-60">
                            <WalletCards className="size-8 text-[var(--studio-muted)]" aria-hidden />
                            <span className="min-w-0 flex-1">
                                <span className="block font-medium text-[var(--studio-ink)]">{translate("credits.wechat")}</span>
                                <span className="mt-1 block text-xs text-[var(--studio-muted)]">{translate("credits.comingSoon")}</span>
                            </span>
                            <Tag>{translate("credits.comingSoon")}</Tag>
                        </button>
                    </div>
                    <div className="mt-5 flex flex-col gap-3 border-t border-[var(--studio-line)] pt-5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="text-sm text-[var(--studio-muted)]">
                            {selectedProduct ? translate("credits.selectedProductSummary", { value0: creditText(selectedProduct.credits), value1: selectedProduct.priceAmount }) : translate("credits.selectProductFirst")}
                        </div>
                        <Button
                            type="primary"
                            size="large"
                            disabled={!selectedProduct || paymentMethod !== "alipay" || submitting}
                            loading={submitting}
                            icon={submitting ? <LoaderCircle className="size-4" /> : <ShoppingCart className="size-4" />}
                            onClick={() => void submitOrder()}
                        >
                            {translate("credits.goToPay")}
                        </Button>
                    </div>
                </section>

                {orderNo ? (
                    <section className="mt-8 border-t border-[var(--studio-line)] pt-6" aria-live="polite">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                                {orderStatus?.status === "paid" ? (
                                    <CheckCircle2 className="size-5 text-[var(--studio-action)]" />
                                ) : orderStatus?.status === "closed" || orderStatus?.status === "cancelled" ? (
                                    <XCircle className="size-5 text-[var(--studio-muted)]" />
                                ) : (
                                    <LoaderCircle className="size-5 animate-spin text-[var(--studio-muted)]" />
                                )}
                                <div>
                                    <h2 className="font-semibold text-[var(--studio-ink)]">{statusMessage}</h2>
                                    <p className="mt-1 text-xs text-[var(--studio-muted)]">
                                        {translate("credits.orderNumber")}: {orderNo}
                                    </p>
                                </div>
                            </div>
                            {orderStatus?.status === "pending" ? (
                                <Button icon={<QrCode className="size-4" />} loading={openingPayment} onClick={() => void openPayment()}>
                                    {translate("credits.alipayScanPay")}
                                </Button>
                            ) : null}
                        </div>
                        {orderStatus?.status === "paid" ? <p className="mt-3 text-sm text-[var(--studio-action)]">{translate("credits.paymentSuccessDescription", { value0: creditText(orderStatus.credits) })}</p> : null}
                        {orderStatusQuery.isError ? (
                            <Alert
                                className="mt-3"
                                type="warning"
                                showIcon
                                title={translate("credits.orderStatusLoadFailed")}
                                action={
                                    <Button size="small" onClick={() => void orderStatusQuery.refetch()}>
                                        {translate("credits.reload")}
                                    </Button>
                                }
                            />
                        ) : null}
                    </section>
                ) : null}

                {/* 支付宝扫码支付弹窗 */}
                <Modal
                    open={isModalOpen}
                    onCancel={closePaymentModal}
                    footer={null}
                    width={380}
                    centered
                    mask={{ closable: true }}
                >
                    <div className="pt-2 text-center">
                        {orderStatus?.status === "paid" ? (
                            <div className="py-6">
                                <CheckCircle2 className="mx-auto size-14 text-emerald-500" />
                                <h3 className="mt-3 text-xl font-bold text-[var(--studio-ink)]">{translate("credits.paymentSuccess")}</h3>
                                <p className="mt-2 text-sm text-[var(--studio-muted)]">
                                    {translate("credits.paymentSuccessDescription", { value0: creditText(orderStatus.credits) })}
                                </p>
                                <Button type="primary" className="mt-6 w-full!" onClick={closePaymentModal}>
                                    {translate("credits.closeModal")}
                                </Button>
                            </div>
                        ) : (
                            <div>
                                <div className="flex items-center justify-center gap-2">
                                    <img src="/payment/alipay.png" alt="支付宝" className="size-6 rounded object-contain" />
                                    <span className="text-base font-semibold text-[var(--studio-ink)]">{translate("credits.alipayScanPay")}</span>
                                </div>

                                <div className="mt-3">
                                    <span className="text-sm font-medium text-[var(--studio-muted)]">{translate("credits.price")}</span>
                                    <div className="mt-0.5 text-3xl font-bold tabular-nums text-[var(--studio-ink)]">
                                        <span className="mr-1 text-xl font-semibold">¥</span>
                                        {paymentPriceAmount || selectedProduct?.priceAmount}
                                    </div>
                                </div>

                                <div className="mt-2 flex items-center justify-center gap-1.5 text-xs text-[var(--studio-muted)]">
                                    <Clock className={cn("size-3.5", remainingSeconds > 60 ? "text-amber-500" : "text-rose-500")} />
                                    <span>
                                        {remainingSeconds > 0
                                            ? translate("credits.payWithinTime", { value0: timeLeftText })
                                            : translate("credits.orderExpiredHint")}
                                    </span>
                                </div>

                                {/* 支付宝前置模式页面把二维码画在视口左上角，尺寸正好等于 qrcode_width（后端 AlipayPaymentProvider.QRCODE_WIDTH=200），
                                    iframe 必须与二维码等大，多出来的空间会全落到右下角、看起来不居中。 */}
                                <div className="relative mx-auto mt-4 flex size-[240px] items-center justify-center rounded-xl border border-[var(--studio-line)] bg-white p-4 shadow-xs">
                                    {paymentUrl ? (
                                        <iframe
                                            src={paymentUrl}
                                            title={translate("credits.alipayScanPay")}
                                            className="size-[200px] border-0"
                                            scrolling="no"
                                        />
                                    ) : (
                                        <LoaderCircle className="size-8 animate-spin text-[var(--studio-muted)]" />
                                    )}
                                    {remainingSeconds <= 0 ? (
                                        <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl bg-white/95 p-4 text-center backdrop-blur-xs">
                                            <XCircle className="mb-2 size-8 text-rose-500" />
                                            <span className="text-xs font-medium text-rose-600">{translate("credits.orderExpiredHint")}</span>
                                        </div>
                                    ) : null}
                                </div>

                                {paymentUrl ? (
                                    <a
                                        href={paymentUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--studio-action)] hover:underline"
                                    >
                                        <ExternalLink className="size-3" />
                                        {translate("credits.openQrInNewTab")}
                                    </a>
                                ) : null}

                                <div className="mt-4 flex flex-col items-center gap-1">
                                    <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--studio-ink)]">
                                        <ScanLine className="size-3.5 text-[var(--studio-primary)]" />
                                        <span>{translate("credits.scanWithAlipay")}</span>
                                    </div>
                                    <span className="text-[11px] text-[var(--studio-muted)]">{translate("credits.autoCloseAfterPaid")}</span>
                                </div>
                            </div>
                        )}
                    </div>
                </Modal>
            </div>
        </main>
    );
}
