"use client";
import { currentLanguageTag } from "@/features/locale/translate";

import { useTranslation } from "@/features/locale/use-translation";


import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { App, Button, Input, InputNumber, Modal, Pagination, Select, Space, Table, Tag, type TableProps } from "antd";
import { Copy, Eye, EyeOff, KeyRound, Plus, RefreshCw } from "lucide-react";

import { useCopyText } from "@/shared/hooks/use-copy-text";
import {
    generateCreditCards,
    listCreditCardBatches,
    listCreditCards,
    type ServerCreditCard,
    type ServerCreditCardBatch,
} from "@/services/api/server";
import { creditCardBatchText } from "@/app/(user)/credits/credit-card-utils";

const PAGE_SIZE = 20;

/**
 * 渲染管理员卡密批次与库存管理。
 *
 * @returns 卡密管理页面内容
 */
export function CreditCardManagement() {
    const translate = useTranslation();
    const { message } = App.useApp();
    const copyText = useCopyText();
    const [quantity, setQuantity] = useState<number | null>(100);
    const [creditsPerCard, setCreditsPerCard] = useState<number | null>(null);
    const [generated, setGenerated] = useState<{ batchId: number; cardCodes: string[] } | null>(null);
    const [batchPage, setBatchPage] = useState(1);
    const [cardPage, setCardPage] = useState(1);
    const [batchFilter, setBatchFilter] = useState<number | undefined>();
    const [statusFilter, setStatusFilter] = useState<"available" | "redeemed" | undefined>();
    const [cardKeywordInput, setCardKeywordInput] = useState("");
    const [cardKeyword, setCardKeyword] = useState("");
    const [userKeywordInput, setUserKeywordInput] = useState("");
    const [userKeyword, setUserKeyword] = useState("");
    const [includeCode, setIncludeCode] = useState(false);

    const batchesQuery = useQuery({
        queryKey: ["admin-credit-card-batches", batchPage],
        queryFn: () => listCreditCardBatches({ page: batchPage, pageSize: PAGE_SIZE }),
    });
    const cardsQuery = useQuery({
        queryKey: ["admin-credit-cards", batchFilter, statusFilter, cardKeyword, userKeyword, includeCode, cardPage],
        queryFn: () => listCreditCards({ batchId: batchFilter, status: statusFilter, cardCode: cardKeyword, redeemedUserKeyword: userKeyword, includeCode, page: cardPage, pageSize: PAGE_SIZE }),
    });

    const handleGenerate = async () => {
        if (!creditsPerCard || creditsPerCard < 1) {
            message.warning(translate("administration.enterPositiveIntegerCreditsPerCard"));
            return;
        }
        if (quantity === null || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
            message.warning(translate("administration.quantityMustBeBetween1And1000"));
            return;
        }
        try {
            const result = await generateCreditCards({ quantity, creditsPerCard });
            setGenerated({ batchId: result.batchId, cardCodes: result.cardCodes });
            message.success(translate("administration.generatedCodes", { value0: result.quantity }));
            await batchesQuery.refetch();
            await cardsQuery.refetch();
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("administration.failedToGenerateCodes"));
        }
    };

    const batchColumns: TableProps<ServerCreditCardBatch>["columns"] = [
        { title: translate("administration.batch"), dataIndex: "id", width: 90, render: (value: number) => <span className="font-mono tabular-nums">#{value}</span> },
        { title: translate("administration.creditsPerCard"), dataIndex: "creditsPerCard", width: 110, render: (value: number) => <span className="font-semibold tabular-nums">{value.toLocaleString(currentLanguageTag())}</span> },
        { title: translate("administration.stock"), dataIndex: "quantity", width: 180, render: (_: number, record) => <span className="tabular-nums">{record.availableCount} {translate("administration.available")}{record.redeemedCount} {translate("administration.redeemed")}</span> },
        { title: translate("administration.createAdministrator"), dataIndex: "createdByName", render: (_: string, record) => <div><div className="text-[var(--studio-ink)]">{record.createdByName}</div><div className="text-xs text-[var(--studio-muted)]">{record.createdByEmail}</div></div> },
        { title: translate("administration.createdAt"), dataIndex: "createdAt", width: 180, render: (value: string) => value ? new Date(value).toLocaleString(currentLanguageTag()) : "-" },
    ];

    const cardColumns: TableProps<ServerCreditCard>["columns"] = [
        { title: translate("administration.redemptionCode"), dataIndex: "codeMasked", width: 240, render: (_: string, record) => <span className="font-mono text-xs">{record.code || record.codeMasked}</span> },
        { title: translate("administration.batch"), dataIndex: "batchId", width: 80, render: (value: number) => <span className="font-mono">#{value}</span> },
        { title: translate("administration.credits"), dataIndex: "credits", width: 100, render: (value: number) => <span className="font-semibold tabular-nums">{value.toLocaleString(currentLanguageTag())}</span> },
        { title: translate("administration.status"), dataIndex: "status", width: 100, render: (value: ServerCreditCard["status"]) => value === "redeemed" ? <Tag color="green">{translate("administration.redeemed_b71c76")}</Tag> : <Tag color="blue">{translate("administration.notRedeemed")}</Tag> },
        { title: translate("administration.redeemedBy"), dataIndex: "redeemedByEmail", width: 220, render: (_: string | null, record) => record.redeemedByEmail ? <div><div className="truncate text-[var(--studio-ink)]">{record.redeemedByNickname || record.redeemedByUsername || record.redeemedByEmail}</div><div className="truncate text-xs text-[var(--studio-muted)]">{record.redeemedByEmail}</div></div> : <span className="text-[var(--studio-faint)]">-</span> },
        { title: translate("administration.redeemedAt"), dataIndex: "redeemedAt", width: 180, render: (value: string) => value ? new Date(value).toLocaleString(currentLanguageTag()) : "-" },
        { title: translate("administration.transactions"), dataIndex: "transactionId", width: 150, render: (_: number | null, record) => record.transactionId ? <span className="font-mono text-xs">#{record.transactionId} {translate("administration.balance")}{record.balanceAfter}</span> : "-" },
    ];

    return (
        <div>
            <section className="border border-[var(--studio-line)] bg-[var(--studio-surface)] p-5">
                <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--studio-ink)]"><KeyRound className="size-4 text-[var(--studio-primary)]" />{translate("administration.generateCodes")}</h2>
                        <p className="mt-1 text-sm text-[var(--studio-muted)]">{translate("administration.copyGeneratedCodesLineByLineToLDXPStock")}</p>
                    </div>
                    <Space.Compact>
                        <InputNumber min={1} max={1000} precision={0} value={quantity} onChange={setQuantity} addonBefore={translate("administration.quantity")} />
                        <InputNumber min={1} precision={0} value={creditsPerCard} onChange={(value) => setCreditsPerCard(value)} addonBefore={translate("administration.creditsPerCard")} />
                        <Button type="primary" icon={<Plus className="size-4" />} onClick={() => void handleGenerate()}>{translate("administration.generate")}</Button>
                    </Space.Compact>
                </div>
            </section>

            <section className="mt-6" aria-labelledby="credit-card-batches-title">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div><h2 id="credit-card-batches-title" className="text-base font-semibold text-[var(--studio-ink)]">{translate("administration.generationBatch")}</h2><p className="mt-1 text-sm text-[var(--studio-muted)]">{translate("administration.viewStockAndRedemptionsByBatch")}</p></div>
                    <Button icon={<RefreshCw className="size-4" />} onClick={() => void batchesQuery.refetch()}>{translate("administration.refresh")}</Button>
                </div>
                <Table<ServerCreditCardBatch> rowKey="id" columns={batchColumns} dataSource={batchesQuery.data?.batches || []} loading={batchesQuery.isLoading} pagination={false} scroll={{ x: 760 }} />
                {batchesQuery.data && batchesQuery.data.total > PAGE_SIZE ? <div className="mt-4 flex justify-end"><Pagination current={batchPage} pageSize={PAGE_SIZE} total={batchesQuery.data.total} showSizeChanger={false} onChange={setBatchPage} /></div> : null}
            </section>

            <section className="mt-8 border-t border-[var(--studio-line)] pt-6" aria-labelledby="credit-card-inventory-title">
                <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                    <div><h2 id="credit-card-inventory-title" className="text-base font-semibold text-[var(--studio-ink)]">{translate("administration.codeStock")}</h2><p className="mt-1 text-sm text-[var(--studio-muted)]">{translate("administration.codesAreMaskedByDefaultCheckYourSurroundingsBefore")}</p></div>
                    <Button icon={includeCode ? <EyeOff className="size-4" /> : <Eye className="size-4" />} onClick={() => setIncludeCode((value) => !value)}>{includeCode ? translate("administration.hideFullCode") : translate("administration.showFullCode")}</Button>
                </div>
                <div className="mb-4 flex flex-wrap gap-3">
                    <Select<number> allowClear placeholder={translate("administration.allBatches")} value={batchFilter} onChange={(value) => { setBatchFilter(value); setCardPage(1); }} className="w-36" options={(batchesQuery.data?.batches || []).map((batch) => ({ value: batch.id, label: translate("administration.batch_08e286", { value0: batch.id }) }))} />
                    <Select<"available" | "redeemed"> allowClear placeholder={translate("administration.allStatuses")} value={statusFilter} onChange={(value) => { setStatusFilter(value); setCardPage(1); }} className="w-36" options={[{ value: "available", label: translate("administration.notRedeemed") }, { value: "redeemed", label: translate("administration.redeemed_b71c76") }]} />
                    <Input.Search allowClear value={cardKeywordInput} onChange={(event) => { const value = event.target.value; setCardKeywordInput(value); if (!value) { setCardKeyword(""); setCardPage(1); } }} onSearch={() => { setCardKeyword(cardKeywordInput); setCardPage(1); }} placeholder={translate("administration.fullCodeOrLast4Characters")} className="w-60" />
                    <Input.Search allowClear value={userKeywordInput} onChange={(event) => { const value = event.target.value; setUserKeywordInput(value); if (!value) { setUserKeyword(""); setCardPage(1); } }} onSearch={() => { setUserKeyword(userKeywordInput); setCardPage(1); }} placeholder={translate("administration.userEmail")} className="w-52" />
                </div>
                <Table<ServerCreditCard> rowKey="id" columns={cardColumns} dataSource={cardsQuery.data?.cards || []} loading={cardsQuery.isLoading} pagination={false} scroll={{ x: 1_200 }} />
                {cardsQuery.data && cardsQuery.data.total > PAGE_SIZE ? <div className="mt-4 flex justify-end"><Pagination current={cardPage} pageSize={PAGE_SIZE} total={cardsQuery.data.total} showSizeChanger={false} onChange={setCardPage} /></div> : null}
            </section>

            <Modal title={translate("administration.batchCodes", { value0: generated?.batchId || "" })} open={Boolean(generated)} onCancel={() => setGenerated(null)} footer={<Button type="primary" icon={<Copy className="size-4" />} onClick={() => generated && copyText(creditCardBatchText(generated.cardCodes), translate("administration.codeCopied"))}>{translate("administration.copyAllCodes")}</Button>} width={640}>
                <Input.TextArea value={generated ? creditCardBatchText(generated.cardCodes) : ""} readOnly rows={14} className="font-mono text-xs" />
            </Modal>
        </div>
    );
}
