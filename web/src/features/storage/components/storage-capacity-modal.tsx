"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Empty, Modal, Radio, Skeleton } from "antd";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { useTeamStore } from "@/features/team/stores/use-team-store";
import { useTranslation } from "@/features/locale/use-translation";
import { getWalletBalances } from "@/services/api/team";
import { listStorageCapacityPackages, purchaseStorageCapacity } from "@/services/api/storage";
import { ServerApiError } from "@/services/api/server";
import type { CapacityPurchaseRequest } from "@/services/api/storage";
import { creditAmount, creditText } from "@/shared/lib/credit-amounts";
import { formatStorageGigabytes } from "../capacity-format";
import { useStorageCapacity } from "../use-storage-capacity";

/** 固定套餐永久扩容，显示实际钱包与支付金额，重试沿用购买标识。 */
export function StorageCapacityModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const translate = useTranslation();
    const { message } = App.useApp();
    const client = useQueryClient();
    const userId = useUserStore((state) => state.user?.id);
    const platformBalance = useUserStore((state) => state.user?.creditBalance);
    const wallets = useTeamStore((state) => state.wallets);
    const teamId = useTeamStore((state) => state.team?.id || 0);
    const capacity = useStorageCapacity();
    const packages = useQuery({ queryKey: ["storageCapacityPackages", userId, teamId], queryFn: listStorageCapacityPackages, enabled: open && !!userId, staleTime: 0 });
    const [selectedId, setSelectedId] = useState<string>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const request = useRef<CapacityPurchaseRequest | null>(null);
    const submitting = useRef(false);
    const selected = packages.data?.packages.find((item) => item.id === selectedId);
    const walletTeamId = packages.data?.walletTeamId;
    const balance = walletTeamId === 0 ? (wallets?.platformBalance ?? platformBalance) : wallets?.teamBalance;
    const insufficient = !!selected && balance !== undefined && creditAmount(balance).lessThan(selected.credits);

    useEffect(() => {
        if (!open) return;
        setError("");
        void capacity.refetch();
        void getWalletBalances()
            .then((value) => useTeamStore.getState().setWallets(value))
            .catch(() => undefined);
    }, [open]);

    const purchase = async () => {
        if (!selected || submitting.current) return;
        submitting.current = true;
        // 响应丢失时保留原套餐版本及请求标识，防止重试恰逢调价而重复购买。
        if (request.current?.packageId !== selected.id) request.current = { packageId: selected.id, revision: selected.revision, clientRequestId: crypto.randomUUID() };
        setBusy(true);
        setError("");
        try {
            const result = await purchaseStorageCapacity(request.current);
            client.setQueryData(["storageCapacity", userId, teamId], result.capacity);
            if (result.walletTeamId === 0) useUserStore.getState().setCreditBalance(result.creditBalance);
            const currentWallets = useTeamStore.getState().wallets;
            if (currentWallets) useTeamStore.getState().setWallets({ ...currentWallets, [result.walletTeamId === 0 ? "platformBalance" : "teamBalance"]: result.creditBalance });
            void getWalletBalances()
                .then((balances) => useTeamStore.getState().setWallets(balances))
                .catch(() => undefined);
            request.current = null;
            message.success(translate("storage.capacityPurchased"));
            onClose();
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : translate("storage.capacityPurchaseFailed"));
            if (failure instanceof ServerApiError && failure.code > 0 && failure.code < 5000) {
                request.current = null;
                void packages.refetch();
            }
        } finally {
            submitting.current = false;
            setBusy(false);
        }
    };

    return (
        <Modal
            width={520}
            style={{ maxWidth: "calc(100vw - 32px)" }}
            title={translate("storage.permanentExpansion")}
            open={open}
            onCancel={() => !busy && onClose()}
            closable={!busy}
            mask={{ closable: !busy }}
            confirmLoading={busy}
            onOk={() => void purchase()}
            okText={selected ? translate("storage.confirmCapacityPayment", { credits: creditText(selected.credits) }) : translate("storage.selectCapacityPackage")}
            cancelText={translate("storage.cancelCapacityPurchase")}
            okButtonProps={{ disabled: !selected || insufficient || balance === undefined || packages.isFetching }}
        >
            <div className="flex flex-col gap-4 py-2">
                {capacity.data ? (
                    <p className="text-sm text-[var(--studio-text)]">
                        {translate("storage.cloudStorage")}{" "}
                        <span className="tabular-nums">
                            {formatStorageGigabytes(capacity.data.usedBytes)} / {formatStorageGigabytes(capacity.data.totalBytes)} G
                        </span>
                        <span className="ml-2 text-[var(--studio-muted)]">{translate("storage.capacityPermanent")}</span>
                    </p>
                ) : null}
                {packages.isLoading ? (
                    <Skeleton active paragraph={{ rows: 3 }} />
                ) : packages.isError ? (
                    <Alert type="error" showIcon title={packages.error.message} />
                ) : packages.data?.packages.length ? (
                    <>
                        <p className="text-sm text-[var(--studio-muted)]">
                            {translate(walletTeamId === 0 ? "storage.platformCapacityWallet" : "storage.teamCapacityWallet")} · {translate("storage.capacityBalance")} {balance === undefined ? "…" : creditText(balance)}
                        </p>
                        <Radio.Group
                            className="flex! flex-col gap-2"
                            value={selectedId}
                            disabled={busy}
                            onChange={(event) => {
                                setSelectedId(event.target.value);
                                setError("");
                            }}
                        >
                            {packages.data.packages.map((item) => (
                                <Radio key={item.id} value={item.id} className="m-0! rounded-lg border border-[var(--studio-line)] px-3! py-3!">
                                    <span className="text-[var(--studio-ink)]">
                                        {item.name} · +{item.capacityGigabytes} G
                                    </span>
                                    <span className="ml-3 tabular-nums text-[var(--studio-muted)]">{translate("storage.capacityPackagePrice", { credits: creditText(item.credits) })}</span>
                                </Radio>
                            ))}
                        </Radio.Group>
                    </>
                ) : (
                    <Empty description={translate("storage.noCapacityPackages")} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                )}
                {insufficient ? <Alert type="warning" showIcon title={translate("storage.insufficientCapacityCredits")} /> : null}
                {error ? <Alert type="error" showIcon title={error} /> : null}
            </div>
        </Modal>
    );
}
