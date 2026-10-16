"use client";

import { memo } from "react";
import { Button } from "antd";
import { Box, Camera, ExternalLink, KeyRound } from "lucide-react";
import { NodeResizer, type NodeProps } from "@xyflow/react";

import type { CanvasDirectorDeskNode } from "../types";
import { useCanvasTheme } from "../components/canvas-theme-provider";
import { useNodeActions } from "./node-action-context";
import { CanvasConnectionHandles, CanvasNodeTitle, NodeHoverSurface } from "./shared";

/** 画布中的 3D 导演台节点，只展示轻量封面与工程摘要。 */
export const DirectorDeskNode = memo(function DirectorDeskNode({ data: rawData, selected }: NodeProps) {
    const data = rawData as unknown as CanvasDirectorDeskNode;
    const theme = useCanvasTheme();
    const actions = useNodeActions();
    const project = data.director.project;
    const camera = project.cameras.find((item) => item.id === project.selectedCameraId);
    const keyframeCount = project.objects.reduce((count, object) => count + (object.track?.position.length || 0) + (object.track?.rotation.length || 0), 0) + (camera?.keyframes.length || 0);

    return (
        <>
            <NodeResizer
                minWidth={360}
                minHeight={260}
                isVisible={selected}
                lineStyle={{ borderColor: theme.node.activeStroke }}
                handleStyle={{ borderColor: theme.node.activeStroke, backgroundColor: theme.node.panel }}
                onResizeEnd={(_, params) => actions.onResize?.(data.id, params.width, params.height, { x: params.x, y: params.y })}
            />
            <NodeHoverSurface
                nodeId={data.id}
                className="relative flex select-none flex-col overflow-visible rounded-lg border"
                style={{ width: "100%", height: "100%", background: theme.node.panel, color: theme.node.text, borderColor: selected ? theme.node.activeStroke : theme.node.stroke }}
            >
                <CanvasNodeTitle nodeId={data.id} title={data.title} defaultTitle="3D 导演台" onTitleChange={actions.onTitleChange} />
                <div className="flex items-center gap-2 border-b px-3 py-2.5" style={{ borderColor: theme.node.stroke }}>
                    <Box className="size-4" style={{ color: theme.node.activeStroke }} aria-hidden="true" />
                    <span className="text-sm font-medium">3D 导演台</span>
                    <span className="ml-auto text-[11px]" style={{ color: theme.node.muted }}>
                        修订 {data.director.projectRevision}
                    </span>
                </div>
                <div className="relative min-h-0 flex-1 overflow-hidden px-3 py-3">
                    <div className="relative h-full min-h-36 overflow-hidden rounded-md border" style={{ borderColor: theme.node.stroke, background: theme.directorDesk.background }}>
                        <div
                            className="absolute inset-0 opacity-35"
                            style={{ backgroundImage: `linear-gradient(${theme.directorDesk.grid} 1px, transparent 1px), linear-gradient(90deg, ${theme.directorDesk.grid} 1px, transparent 1px)`, backgroundSize: "24px 24px" }}
                        />
                        <Box aria-hidden="true" className="absolute left-1/2 top-1/2 size-10 -translate-x-1/2 -translate-y-1/2" style={{ color: theme.node.activeStroke }} />
                        <div className="absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-1 rounded px-2 py-1 text-[10px]" style={{ background: theme.node.panel, color: theme.node.muted }}>
                            <Camera className="size-3" aria-hidden="true" />
                            {camera?.name || "未选择机位"}
                        </div>
                        <div className="absolute bottom-2 left-2 flex items-center gap-1 text-[10px]" style={{ color: theme.node.muted }}>
                            <KeyRound className="size-3" aria-hidden="true" />
                            {keyframeCount} 个关键帧
                        </div>
                    </div>
                </div>
                <div className="grid grid-cols-3 gap-2 border-t px-3 py-2.5 text-[11px]" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                    <span>
                        <strong className="mr-1 text-sm" style={{ color: theme.node.text }}>
                            {project.objects.length}
                        </strong>
                        对象
                    </span>
                    <span>
                        <strong className="mr-1 text-sm" style={{ color: theme.node.text }}>
                            {project.cameras.length}
                        </strong>
                        机位
                    </span>
                    <span>
                        <strong className="mr-1 text-sm" style={{ color: theme.node.text }}>
                            {(project.timeline.durationMilliseconds / 1000).toFixed(1)}s
                        </strong>
                        时长
                    </span>
                </div>
                <div className="border-t px-3 py-2.5" style={{ borderColor: theme.node.stroke }}>
                    <Button
                        type="primary"
                        block
                        icon={<ExternalLink className="size-4" />}
                        onClick={(event) => {
                            event.stopPropagation();
                            actions.onOpenDirectorDesk?.(data);
                        }}
                    >
                        打开导演台
                    </Button>
                </div>
                <CanvasConnectionHandles />
            </NodeHoverSurface>
        </>
    );
});
