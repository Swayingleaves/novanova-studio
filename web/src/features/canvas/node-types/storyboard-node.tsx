"use client";

import { memo, useEffect, useRef, useState, type CompositionEvent, type KeyboardEvent, type MouseEvent } from "react";
import { Clapperboard, ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import { App } from "antd";
import { NodeResizer, type NodeProps } from "@xyflow/react";

import { ModelPicker } from "@/features/settings/components/model-picker";
import { useEffectiveConfig } from "@/features/settings/stores/use-config-store";
import type { CanvasStoryboardNode } from "../types";
import { readStoryboardModelCost } from "../domain/storyboard";
import { useNodeActions } from "./node-action-context";
import { CanvasConnectionHandles, NodeHoverSurface } from "./shared";
import { useCanvasTheme } from "../components/canvas-theme-provider";

export const StoryboardNode = memo(function StoryboardNode({ data: rawData, selected }: NodeProps) {
    const data = rawData as unknown as CanvasStoryboardNode;
    const actions = useNodeActions();
    const { modal } = App.useApp();
    const theme = useCanvasTheme();
    const config = useEffectiveConfig();
    const [instructionDraft, setInstructionDraft] = useState(data.content.instruction);
    const [visualStyleDraft, setVisualStyleDraft] = useState(data.content.visualStyle ?? "");
    const isInstructionComposingRef = useRef(false);
    const isVisualStyleComposingRef = useRef(false);
    const generated = data.storyboard.shots.length > 0;
    const running = data.execution.phase === "running";
    const failed = data.execution.phase === "failed";
    const model = data.content.model || config.textModel;
    const creditCost = readStoryboardModelCost(config.modelCosts, model);
    const statusText = running ? "处理中" : generated ? "已生成" : failed ? "操作失败" : "待生成";
    const statusColor = running || generated ? theme.node.activeStroke : failed ? "var(--studio-danger)" : theme.node.muted;
    const creditLabel = `${generated ? "重新生成" : "首次生成"} ${creditCost} 积分`;

    useEffect(() => {
        if (!isInstructionComposingRef.current) setInstructionDraft(data.content.instruction);
    }, [data.id, data.content.instruction]);

    useEffect(() => {
        if (!isVisualStyleComposingRef.current) setVisualStyleDraft(data.content.visualStyle ?? "");
    }, [data.id, data.content.visualStyle]);

    const handleInstructionChange = (value: string) => {
        setInstructionDraft(value);
        actions.onStoryboardInstructionChange?.(data.id, value);
    };

    const handleVisualStyleChange = (value: string) => {
        setVisualStyleDraft(value);
        actions.onStoryboardVisualStyleChange?.(data.id, value);
    };

    const handleCompositionStart = (_event: CompositionEvent<HTMLTextAreaElement>) => {
        isInstructionComposingRef.current = true;
    };

    const handleCompositionEnd = (event: CompositionEvent<HTMLTextAreaElement>) => {
        isInstructionComposingRef.current = false;
        handleInstructionChange(event.currentTarget.value);
    };

    const handleVisualStyleCompositionStart = (_event: CompositionEvent<HTMLTextAreaElement>) => {
        isVisualStyleComposingRef.current = true;
    };

    const handleVisualStyleCompositionEnd = (event: CompositionEvent<HTMLTextAreaElement>) => {
        isVisualStyleComposingRef.current = false;
        handleVisualStyleChange(event.currentTarget.value);
    };

    const stopCanvasKeyboardEvent = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        event.stopPropagation();
    };

    const requestStoryboardGeneration = (event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        if (!generated) {
            actions.onGenerateStoryboard?.(data);
            return;
        }
        modal.confirm({
            title: "重新生成分镜脚本",
            content: "重新生成会覆盖当前镜头、资产和已合成提示词，确定继续吗？",
            okText: "重新生成",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: () => actions.onGenerateStoryboard?.(data),
        });
    };

    return (
        <>
            <NodeResizer
                minWidth={280}
                minHeight={320}
                isVisible={selected}
                lineStyle={{ borderColor: theme.node.activeStroke }}
                handleStyle={{ borderColor: theme.node.activeStroke, backgroundColor: theme.node.panel }}
                onResizeEnd={(_, params) => actions.onResize?.(data.id, params.width, params.height, { x: params.x, y: params.y })}
            />
            <NodeHoverSurface
                nodeId={data.id}
                className="flex select-none flex-col overflow-hidden rounded-lg border"
                style={{
                    width: "100%",
                    height: "100%",
                    background: theme.node.panel,
                    borderColor: selected ? theme.node.activeStroke : theme.node.stroke,
                    boxShadow: selected ? `0 0 0 1px ${theme.node.activeStroke}55` : undefined,
                }}
            >
                <div className="flex items-center gap-2 border-b px-3 py-2.5" style={{ borderColor: theme.node.stroke }}>
                    <Clapperboard className="size-4" style={{ color: theme.node.activeStroke }} />
                    <span className="text-sm font-medium" style={{ color: theme.node.text }}>
                        分镜脚本
                    </span>
                    <span className="ml-auto flex items-center gap-1 text-[11px]" style={{ color: statusColor }}>
                        {running ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                        {statusText}
                    </span>
                </div>
                <div className="min-h-0 flex flex-1 flex-col gap-3 overflow-auto px-3 py-3">
                    <label className="block space-y-1.5">
                        <span className="block text-[11px] font-medium" style={{ color: theme.node.muted }}>
                            分镜描述
                        </span>
                        <textarea
                            rows={generated ? 2 : 4}
                            className={`nodrag nopan nowheel block w-full resize-none select-text rounded-md border p-2 text-xs leading-5 outline-none transition focus:ring-2 ${generated ? "min-h-[52px] max-h-24" : "min-h-24"}`}
                            style={{ color: theme.node.text, background: theme.node.fill, borderColor: theme.node.stroke, caretColor: theme.node.text }}
                            placeholder="描述剧情、片段为你生成分镜脚本"
                            value={instructionDraft}
                            disabled={running}
                            onChange={(event) => handleInstructionChange(event.target.value)}
                            onCompositionStart={handleCompositionStart}
                            onCompositionEnd={handleCompositionEnd}
                            onKeyDown={stopCanvasKeyboardEvent}
                            onKeyUp={stopCanvasKeyboardEvent}
                            onMouseDown={(event) => event.stopPropagation()}
                            onPointerDown={(event) => event.stopPropagation()}
                            onWheel={(event) => event.stopPropagation()}
                        />
                    </label>
                    <label className="block space-y-1.5">
                        <span className="block text-[11px] font-medium" style={{ color: theme.node.muted }}>
                            视觉风格
                        </span>
                        <textarea
                            rows={generated ? 2 : 3}
                            className={`nodrag nopan nowheel block w-full resize-none select-text rounded-md border p-2 text-xs leading-5 outline-none transition focus:ring-2 ${generated ? "min-h-[52px] max-h-24" : "min-h-[72px]"}`}
                            style={{ color: theme.node.text, background: theme.node.fill, borderColor: theme.node.stroke, caretColor: theme.node.text }}
                            placeholder="例如：国风二次元韩漫厚涂，电影级手绘质感"
                            value={visualStyleDraft}
                            disabled={running}
                            onChange={(event) => handleVisualStyleChange(event.target.value)}
                            onCompositionStart={handleVisualStyleCompositionStart}
                            onCompositionEnd={handleVisualStyleCompositionEnd}
                            onKeyDown={stopCanvasKeyboardEvent}
                            onKeyUp={stopCanvasKeyboardEvent}
                            onMouseDown={(event) => event.stopPropagation()}
                            onPointerDown={(event) => event.stopPropagation()}
                            onWheel={(event) => event.stopPropagation()}
                        />
                    </label>
                    <div className="flex min-w-0 items-center gap-2 border-b pb-2" style={{ borderColor: theme.node.stroke }}>
                        <span className="shrink-0 text-[11px]" style={{ color: theme.node.muted }}>
                            模型
                        </span>
                        <ModelPicker
                            config={config}
                            value={model}
                            capability="text"
                            className="!h-7 !min-w-0 !flex-1 !rounded-md"
                            placeholder="选择文本模型"
                            onChange={(value) => actions.onStoryboardModelChange?.(data.id, value)}
                            onMissingConfig={actions.onMissingTextModelConfig}
                        />
                        <span className="shrink-0 text-[11px] tabular-nums" style={{ color: theme.node.muted }}>
                            {creditLabel}
                        </span>
                    </div>
                    {failed && data.execution.errorMessage ? (
                        <p className="text-xs leading-5" style={{ color: "var(--studio-danger)" }}>
                            {data.execution.errorMessage}
                        </p>
                    ) : null}
                    {generated ? (
                        <dl className="mt-auto grid grid-cols-2 overflow-hidden rounded-md border" style={{ background: theme.node.fill, borderColor: theme.node.stroke }}>
                            <div className="flex items-center justify-between gap-2 px-3 py-2">
                                <dt className="text-[11px]" style={{ color: theme.node.muted }}>
                                    镜头
                                </dt>
                                <dd className="text-lg font-semibold tabular-nums" style={{ color: theme.node.text }}>
                                    {data.storyboard.shots.length}
                                </dd>
                            </div>
                            <div className="flex items-center justify-between gap-2 border-l px-3 py-2" style={{ borderColor: theme.node.stroke }}>
                                <dt className="text-[11px]" style={{ color: theme.node.muted }}>
                                    资产
                                </dt>
                                <dd className="text-lg font-semibold tabular-nums" style={{ color: theme.node.text }}>
                                    {data.storyboard.assets.length}
                                </dd>
                            </div>
                        </dl>
                    ) : null}
                </div>
                <div className="grid gap-2 border-t px-3 py-3" style={{ borderColor: theme.node.stroke }}>
                    {generated ? (
                        <button
                            type="button"
                            className="nodrag nopan flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-[filter,transform] duration-150 hover:brightness-95 active:translate-y-px motion-reduce:transition-none"
                            style={{ background: theme.node.activeStroke, color: theme.node.panel }}
                            onClick={(event) => {
                                event.stopPropagation();
                                actions.onOpenStoryboard(data);
                            }}
                        >
                            打开分镜脚本
                            <ExternalLink className="size-4" />
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className="nodrag nopan flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-[filter,transform,opacity] duration-150 hover:opacity-80 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
                        style={{ background: generated ? "transparent" : theme.node.activeStroke, color: generated ? theme.node.text : theme.node.panel, borderColor: generated ? theme.node.stroke : theme.node.activeStroke }}
                        disabled={running}
                        onClick={requestStoryboardGeneration}
                    >
                        {running ? <LoaderCircle className="size-4 animate-spin" /> : generated ? <RefreshCw className="size-4" /> : <Clapperboard className="size-4" />}
                        {running ? "正在生成分镜脚本" : generated ? "重新生成分镜脚本" : "开始生成"}
                    </button>
                </div>
                <CanvasConnectionHandles />
            </NodeHoverSurface>
        </>
    );
});
