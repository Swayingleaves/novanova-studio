"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Card, Empty, Form, Input, Modal, Select, Space, Table, Tag } from "antd";
import { ExternalLink, Layers, Link2, Plus, SendToBack } from "lucide-react";

import { useComicDramaStore } from "../stores/use-comic-drama-store";
import type { ComicDramaCanvasBinding } from "../types";

/** 无限画布联动阶段视图。 */
export function StageCanvas() {
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
            message.success("画布节点绑定成功");
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
                    <h2 className="text-xl font-semibold text-[var(--studio-ink)]">无限画布联动 (Infinite Canvas Linkage)</h2>
                    <p className="mt-1 text-sm text-[var(--studio-muted)]">
                        漫剧创作负责结构化项目管理与镜头流水线；无限画布负责自由探索视觉创意、多方案横向对比与综合编排。两端数据节点双向联动互通。
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <Button icon={<Link2 className="size-4" />} onClick={() => setBindModalOpen(true)}>
                        手动绑定节点
                    </Button>
                    <Button type="primary" icon={<ExternalLink className="size-4" />} onClick={handleOpenCanvas}>
                        打开无限画布
                    </Button>
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
                            同一项目，多维度创作空间
                        </h4>
                        <p className="text-xs leading-5 text-[var(--studio-muted)]">
                            在无限画布中，您可以直接引用当前漫剧项目的角色设定图、镜头提示词以及分镜脚本节点进行多节点自由连线与视频合成；画布中确认采用的媒体结果可自动同步回写至当前漫剧工作区的镜头与资产版本中。
                        </p>
                    </div>
                </div>
            </div>

            {/* Existing Canvas Bindings Table */}
            <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-[var(--studio-ink)]">
                        已绑定的画布节点 ({bindings.length})
                    </h3>
                </div>

                {bindings.length === 0 ? (
                    <Empty description="当前项目暂无画布节点绑定记录">
                        <Button type="dashed" icon={<Plus className="size-4" />} onClick={() => setBindModalOpen(true)}>
                            建立第一个绑定
                        </Button>
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
                                        {b.entityType === "shot" ? "镜头" : "资产"}
                                    </Tag>
                                    <span className="font-semibold text-[var(--studio-ink)]">
                                        实体标识：{b.entityId}
                                    </span>
                                    <span className="text-[var(--studio-muted)]">
                                        画布项目：{b.canvasProjectId} · 节点：{b.nodeId}
                                    </span>
                                </div>

                                <Button size="small" type="link" onClick={() => router.push(`/canvas/${b.canvasProjectId}`)}>
                                    前往画布节点
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Bind Node Modal */}
            <Modal
                title="绑定无限画布节点"
                open={bindModalOpen}
                onCancel={() => setBindModalOpen(false)}
                footer={null}
                width={500}
            >
                <Form form={form} layout="vertical" className="py-2">
                    <Form.Item
                        name="canvasProjectId"
                        label="画布项目标识 (Canvas Project ID)"
                        rules={[{ required: true, message: "请输入画布项目ID" }]}
                    >
                        <Input placeholder="输入目标画布的项目ID" />
                    </Form.Item>

                    <Form.Item
                        name="entityType"
                        label="绑定实体类型"
                        initialValue="shot"
                        rules={[{ required: true, message: "请选择实体类型" }]}
                    >
                        <Select
                            options={[
                                { value: "shot", label: "镜头 (Shot)" },
                                { value: "asset", label: "视觉资产 (Asset)" },
                            ]}
                        />
                    </Form.Item>

                    <Form.Item
                        name="entityId"
                        label="实体标识 (Entity ID)"
                        rules={[{ required: true, message: "请选择或输入实体ID" }]}
                    >
                        <Select
                            placeholder="选择要绑定的镜头或资产"
                            options={[
                                ...shots.map((s) => ({
                                    value: s.id,
                                    label: `镜头 #${s.shotNumber} (${s.shotSize || "未定景别"})`,
                                })),
                                ...assets.map((a) => ({
                                    value: a.id,
                                    label: `资产：${a.name} (${a.assetType})`,
                                })),
                            ]}
                        />
                    </Form.Item>

                    <Form.Item
                        name="nodeId"
                        label="画布节点标识 (Node ID)"
                        rules={[{ required: true, message: "请输入画布节点ID" }]}
                    >
                        <Input placeholder="输入目标画布中的节点ID，例如 node_xxx" />
                    </Form.Item>

                    <div className="mt-4 flex justify-end gap-2 border-t border-[var(--studio-line)] pt-3">
                        <Button onClick={() => setBindModalOpen(false)}>取消</Button>
                        <Button type="primary" loading={binding} onClick={handleCreateBinding}>
                            确认绑定
                        </Button>
                    </div>
                </Form>
            </Modal>
        </div>
    );
}
