"use client";

import { productionParameterLabel } from "../lib/production-labels";

import { useTranslation } from "@/features/locale/use-translation";

import { useState } from "react";
import { useRouter } from "@/shared/lib/team-navigation";
import { App, Button, Card, Empty, Form, Input, Modal, Select, Space, Table, Tag } from "antd";
import { ExternalLink, Layers, Link2, Plus, SendToBack } from "lucide-react";

import { useComicDramaStore } from "../stores/use-comic-drama-store";
import type { ComicDramaCanvasBinding } from "../types";

/** 无限画布联动阶段视图。 */
export function StageCanvas() {
    const translate = useTranslation();
    const router = useRouter();
    const { message } = App.useApp();
    const workspace = useComicDramaStore((state) => state.workspace);
    const bindCanvas = useComicDramaStore((state) => state.bindCanvas);

    const [bindModalOpen, setBindModalOpen] = useState(false);
    const [form] = Form.useForm<{
        canvasProjectId: string;
        entityType: string;
        entityId: string;
        nodeId: string;
    }>();
    const [binding, setBinding] = useState(false);

    if (!workspace) return null;

    const bindings = workspace.canvasBindings || [];
    const shots = workspace.shots || [];
    const assets = workspace.assets || [];

    const handleOpenCanvas = () => {
        router.push("/canvas");
    };

    const handleCreateBinding = async () => {
        try {
            const values = await form.validateFields();
            setBinding(true);
            await bindCanvas(values);
            message.success(translate("comicDrama.canvasNodeLinked"));
            setBindModalOpen(false);
            form.resetFields();
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        } finally {
            setBinding(false);
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <header className="flex flex-col gap-2 border-b border-[var(--studio-line)] pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-[var(--studio-ink)]">{translate("comicDrama.infiniteCanvasIntegration")}</h2>
                    <p className="mt-1 text-sm text-[var(--studio-muted)]">
                        {translate("comicDrama.comicDramaManagesStructuredProjectsAndShotProductionInfiniteCanvas")}</p>
                </div>

                <div className="flex items-center gap-2">
                    <Button icon={<Link2 className="size-4" />} onClick={() => setBindModalOpen(true)}>
                        {translate("comicDrama.linkNodeManually")}</Button>
                    <Button type="primary" icon={<ExternalLink className="size-4" />} onClick={handleOpenCanvas}>
                        {translate("comicDrama.openInfiniteCanvas")}</Button>
                </div>
            </header>

            {/* Workflow Banner */}
            <div className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-5">
                <div className="flex items-start gap-4">
                    <div className="rounded-xl bg-[var(--studio-line)] p-3 text-[var(--studio-ink)]">
                        <SendToBack className="size-6" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <h4 className="text-base font-semibold text-[var(--studio-ink)]">
                            {translate("comicDrama.oneProjectMultipleCreativeSpaces")}</h4>
                        <p className="text-xs leading-5 text-[var(--studio-muted)]">
                            {translate("comicDrama.referenceCharacterSheetsShotPromptsAndStoryboardNodesOnThe")}</p>
                    </div>
                </div>
            </div>

            {/* Existing Canvas Bindings Table */}
            <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-[var(--studio-ink)]">{translate("comicDrama.linkedCanvasNodesCount_fbe77a", { value0: bindings.length })}</h3>
                </div>

                {bindings.length === 0 ? (
                    <Empty description={translate("comicDrama.thisProjectHasNoLinkedCanvasNodes")}>
                        <Button type="dashed" icon={<Plus className="size-4" />} onClick={() => setBindModalOpen(true)}>
                            {translate("comicDrama.createFirstLink")}</Button>
                    </Empty>
                ) : (
                    <div className="grid gap-3">
                        {bindings.map((b) => (
                            <div
                                key={b.id}
                                className="flex items-center justify-between rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-4 text-xs"
                            >
                                <div className="flex items-center gap-3">
                                    <Tag color={b.entityType === "shot" ? "blue" : "purple"}>
                                        {b.entityType === "shot" ? translate("comicDrama.shot_c7d192") : translate("comicDrama.asset")}
                                    </Tag>
                                    <span className="font-semibold text-[var(--studio-ink)]">{translate("comicDrama.entityIdCount_2e48ba", { value0: b.entityId })}</span>
                                    <span className="text-[var(--studio-muted)]">{translate("comicDrama.canvasProjectCountNodeCount_4ccdc5", { value0: b.canvasProjectId, value1: b.nodeId })}</span>
                                </div>

                                <Button size="small" type="link" onClick={() => router.push(`/canvas/${b.canvasProjectId}`)}>
                                    {translate("comicDrama.goToCanvasNode")}</Button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Bind Node Modal */}
            <Modal
                title={translate("comicDrama.linkInfiniteCanvasNode")}
                open={bindModalOpen}
                onCancel={() => setBindModalOpen(false)}
                footer={null}
                width={500}
            >
                <Form form={form} layout="vertical" className="py-2">
                    <Form.Item
                        name="canvasProjectId"
                        label={translate("comicDrama.canvasProjectId")}
                        rules={[{ required: true, message: translate("comicDrama.enterACanvasProjectId") }]}
                    >
                        <Input placeholder={translate("comicDrama.enterTheTargetCanvasProjectId")} />
                    </Form.Item>

                    <Form.Item
                        name="entityType"
                        label={translate("comicDrama.linkedEntityType")}
                        initialValue="shot"
                        rules={[{ required: true, message: translate("comicDrama.selectAnEntityType") }]}
                    >
                        <Select
                            options={[
                                { value: "shot", label: translate("comicDrama.shot_95716e") },
                                { value: "asset", label: translate("comicDrama.visualAsset") },
                            ]}
                        />
                    </Form.Item>

                    <Form.Item
                        name="entityId"
                        label={translate("comicDrama.entityId_d54039")}
                        rules={[{ required: true, message: translate("comicDrama.selectOrEnterAnEntityId") }]}
                    >
                        <Select
                            placeholder={translate("comicDrama.selectTheShotOrAssetToLink")}
                            options={[
                                ...shots.map((s) => ({
                                    value: s.id,
                                    label: translate("comicDrama.shotCountCount", { value0: s.shotNumber, value1: productionParameterLabel(s.shotSize || "", translate) || translate("comicDrama.shotSizeNotSet") }),
                                })),
                                ...assets.map((a) => ({
                                    value: a.id,
                                    label: translate("comicDrama.assetCountCount", { value0: a.name, value1: a.assetType }),
                                })),
                            ]}
                        />
                    </Form.Item>

                    <Form.Item
                        name="nodeId"
                        label={translate("comicDrama.canvasNodeId")}
                        rules={[{ required: true, message: translate("comicDrama.enterACanvasNodeId") }]}
                    >
                        <Input placeholder={translate("comicDrama.enterTheTargetNodeIdForExampleNodeXxx")} />
                    </Form.Item>

                    <div className="mt-4 flex justify-end gap-2 border-t border-[var(--studio-line)] pt-3">
                        <Button onClick={() => setBindModalOpen(false)}>{translate("comicDrama.cancel")}</Button>
                        <Button type="primary" loading={binding} onClick={handleCreateBinding}>
                            {translate("comicDrama.confirmLink")}</Button>
                    </div>
                </Form>
            </Modal>
        </div>
    );
}
