"use client";

import { memo, useMemo } from "react";

import { canvasThemes } from "@/shared/lib/canvas-theme";
import type { CanvasTheme } from "@/shared/lib/canvas-theme";
import { useThemeStore } from "@/features/theme/stores/use-theme-store";
import type { CanvasConnection, CanvasDocument, CanvasNode } from "../types";
import { isImageNode, isStoryboardNode, isTextNode, isVideoCompositionNode, isVideoNode } from "../domain/canvas-node";

const previewWidth = 320;
const previewHeight = 180;
const previewPadding = 18;
const maxPreviewNodes = 42;
const maxPreviewConnections = 80;

type PreviewNode = CanvasNode & {
    previewX: number;
    previewY: number;
    previewWidth: number;
    previewHeight: number;
};

type PreviewConnection = {
    id: string;
    path: string;
};

type PreviewLayout = {
    nodes: PreviewNode[];
    connections: PreviewConnection[];
    hiddenNodeCount: number;
};

export const CanvasProjectPreview = memo(function CanvasProjectPreview({ document }: { document: CanvasDocument }) {
    const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
    const theme = canvasThemes[resolvedTheme];
    const layout = useMemo(() => buildCanvasProjectPreviewLayout(document.scene), [document.scene]);

    if (!document.scene.nodes.length) {
        return (
            <svg
                className="block aspect-video w-full overflow-hidden rounded-[8px] border"
                viewBox={`0 0 ${previewWidth} ${previewHeight}`}
                role="img"
                aria-label={`${document.identity.title} 空画布预览`}
                style={{ background: theme.canvas.background, borderColor: theme.node.stroke }}
            >
                <PreviewDots color={theme.canvas.dot} />
                <rect x="132" y="80" width="56" height="20" rx="5" fill={theme.toolbar.panel} stroke={theme.toolbar.border} />
                <text x="160" y="93" textAnchor="middle" fontSize="10" fill={theme.node.faint}>
                    空画布
                </text>
            </svg>
        );
    }

    return (
        <svg
            className="block aspect-video w-full overflow-hidden rounded-[8px] border"
            viewBox={`0 0 ${previewWidth} ${previewHeight}`}
            role="img"
            aria-label={`${document.identity.title} 画布预览`}
            style={{ background: theme.canvas.background, borderColor: theme.node.stroke }}
        >
            <PreviewDots color={theme.canvas.dot} />
            <g>
                {layout.connections.map((connection) => (
                    <path key={connection.id} d={connection.path} fill="none" stroke={theme.node.muted} strokeOpacity="0.48" strokeWidth="1.4" />
                ))}
            </g>
            <g>
                {layout.nodes.map((node) => (
                    <PreviewNodeShape key={node.id} node={node} theme={theme} />
                ))}
            </g>
            {layout.hiddenNodeCount > 0 ? (
                <g>
                    <rect x={previewWidth - 72} y={previewHeight - 27} width="58" height="17" rx="5" fill={theme.toolbar.panel} stroke={theme.toolbar.border} />
                    <text x={previewWidth - 43} y={previewHeight - 15} textAnchor="middle" fontSize="9" fill={theme.node.muted}>
                        +{layout.hiddenNodeCount} 节点
                    </text>
                </g>
            ) : null}
        </svg>
    );
});

export function buildCanvasProjectPreviewLayout(scene: Pick<CanvasDocument["scene"], "nodes" | "connections">): PreviewLayout {
    const nodes = scene.nodes.filter(isRenderableNode);
    const bounds = measureBounds(nodes);
    if (!bounds) return { nodes: [], connections: [], hiddenNodeCount: 0 };

    const scale = Math.min((previewWidth - previewPadding * 2) / bounds.width, (previewHeight - previewPadding * 2) / bounds.height);
    const offsetX = (previewWidth - bounds.width * scale) / 2 - bounds.minX * scale;
    const offsetY = (previewHeight - bounds.height * scale) / 2 - bounds.minY * scale;
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const visibleNodes = nodes.slice(0, maxPreviewNodes).map((node) => toPreviewNode(node, scale, offsetX, offsetY));
    const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));

    return {
        nodes: visibleNodes,
        connections: scene.connections
            .filter((connection) => visibleNodeIds.has(connection.source.nodeId) && visibleNodeIds.has(connection.target.nodeId))
            .slice(0, maxPreviewConnections)
            .map((connection) => toPreviewConnection(connection, nodeMap, scale, offsetX, offsetY))
            .filter((connection): connection is PreviewConnection => Boolean(connection)),
        hiddenNodeCount: Math.max(0, nodes.length - maxPreviewNodes),
    };
}

function PreviewDots({ color }: { color: string }) {
    return (
        <g opacity="0.72">
            {Array.from({ length: 7 }, (_, column) => (
                <g key={column}>
                    {Array.from({ length: 4 }, (_, row) => (
                        <circle key={row} cx={column * 46 + 22} cy={row * 46 + 22} r="1.4" fill={color} />
                    ))}
                </g>
            ))}
        </g>
    );
}

function PreviewNodeShape({ node, theme }: { node: PreviewNode; theme: CanvasTheme }) {
    const label = nodeLabel(node);
    const content = isTextNode(node)
        ? node.content.text
        : isStoryboardNode(node)
            ? node.storyboard.shots.length ? `已生成 ${node.storyboard.shots.length} 个镜头` : node.content.instruction
            : isVideoCompositionNode(node)
                ? `${node.composition.inputVideoNodeIds.length} 段视频`
                : node.content.source || node.generation.prompt;
    const showText = node.previewWidth >= 42 && node.previewHeight >= 24;

    if ((isImageNode(node) || isVideoNode(node)) && node.content.source) {
        return (
            <g>
                <rect x={node.previewX} y={node.previewY} width={node.previewWidth} height={node.previewHeight} rx="6" fill={isVideoNode(node) ? "#111827" : theme.node.panel} stroke={theme.node.stroke} />
                {isImageNode(node) ? (
                    <image
                        href={node.content.source}
                        x={node.previewX + 1}
                        y={node.previewY + 1}
                        width={Math.max(1, node.previewWidth - 2)}
                        height={Math.max(1, node.previewHeight - 2)}
                        preserveAspectRatio={node.frame.freeResize ? "none" : "xMidYMid meet"}
                    />
                ) : null}
                {isVideoNode(node) && showText ? (
                    <path
                        d={`M ${node.previewX + node.previewWidth / 2 - 5} ${node.previewY + node.previewHeight / 2 - 7} L ${node.previewX + node.previewWidth / 2 - 5} ${node.previewY + node.previewHeight / 2 + 7} L ${node.previewX + node.previewWidth / 2 + 8} ${node.previewY + node.previewHeight / 2} Z`}
                        fill="#ffffff"
                        opacity="0.82"
                    />
                ) : null}
            </g>
        );
    }

    return (
        <g>
            <rect
                x={node.previewX}
                y={node.previewY}
                width={node.previewWidth}
                height={node.previewHeight}
                rx="6"
                fill={theme.node.panel}
                stroke={theme.node.stroke}
                strokeOpacity="1"
            />
            {showText ? (
                <>
                    <text x={node.previewX + 7} y={node.previewY + 13} fontSize="8.5" fontWeight="600" fill={theme.node.text}>
                        {label}
                    </text>
                    {content ? (
                        <text x={node.previewX + 7} y={node.previewY + 26} fontSize="7.5" fill={theme.node.muted}>
                            {shortenText(content)}
                        </text>
                    ) : null}
                </>
            ) : null}
        </g>
    );
}

function measureBounds(nodes: CanvasNode[]) {
    if (!nodes.length) return null;

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    nodes.forEach((node) => {
        const width = safeSize(node.frame.width, 220);
        const height = safeSize(node.frame.height, 160);
        minX = Math.min(minX, node.frame.position.x);
        minY = Math.min(minY, node.frame.position.y);
        maxX = Math.max(maxX, node.frame.position.x + width);
        maxY = Math.max(maxY, node.frame.position.y + height);
    });

    return {
        minX,
        minY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY),
    };
}

function toPreviewNode(node: CanvasNode, scale: number, offsetX: number, offsetY: number): PreviewNode {
    return {
        ...node,
        previewX: node.frame.position.x * scale + offsetX,
        previewY: node.frame.position.y * scale + offsetY,
        previewWidth: Math.max(5, safeSize(node.frame.width, 220) * scale),
        previewHeight: Math.max(5, safeSize(node.frame.height, 160) * scale),
    };
}

function toPreviewConnection(connection: CanvasConnection, nodes: Map<string, CanvasNode>, scale: number, offsetX: number, offsetY: number): PreviewConnection | null {
    const from = nodes.get(connection.source.nodeId);
    const to = nodes.get(connection.target.nodeId);
    if (!from || !to) return null;

    const startX = (from.frame.position.x + safeSize(from.frame.width, 220)) * scale + offsetX;
    const startY = (from.frame.position.y + safeSize(from.frame.height, 160) / 2) * scale + offsetY;
    const endX = to.frame.position.x * scale + offsetX;
    const endY = (to.frame.position.y + safeSize(to.frame.height, 160) / 2) * scale + offsetY;
    const curve = Math.max(Math.abs(endX - startX) * 0.45, 12);

    return {
        id: connection.id,
        path: `M ${round(startX)} ${round(startY)} C ${round(startX + curve)} ${round(startY)}, ${round(endX - curve)} ${round(endY)}, ${round(endX)} ${round(endY)}`,
    };
}

function isRenderableNode(node: CanvasNode) {
    return Number.isFinite(node.frame.position.x) && Number.isFinite(node.frame.position.y);
}

function safeSize(value: number, fallback: number) {
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function round(value: number) {
    return Math.round(value * 10) / 10;
}

function nodeLabel(node: CanvasNode) {
    if (node.title) return node.title;
    if (isImageNode(node)) return "图片";
    if (isTextNode(node)) return "文本";
    if (isStoryboardNode(node)) return "分镜脚本";
    if (isVideoCompositionNode(node)) return "合成视频";
    return "视频";
}

function shortenText(value: string) {
    const text = value.replace(/\s+/g, " ").trim();
    return text.length > 14 ? `${text.slice(0, 14)}...` : text;
}
