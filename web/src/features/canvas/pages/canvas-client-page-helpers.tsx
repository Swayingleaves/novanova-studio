"use client";

import type { ReactNode } from "react";
import { ImageIcon, List, Video } from "lucide-react";

import type { CanvasTheme, CanvasBackgroundMode } from "@/shared/lib/canvas-theme";
import { useCanvasTheme } from "../components/canvas-theme-provider";
import type { CanvasTaskPanelTask } from "../components/canvas-task-panel";
import type { CanvasGenerationRequest } from "../services/canvas-generation-request-registry";
import { readCanvasLastUsedGenerationSettings } from "../services/canvas-last-used-generation-settings";
import { createImageNode, createTextNode, createVideoNode, getCanvasNodeTemplate } from "../constants";
import { applyCanvasNodeAttributes, isImageNode, isTextNode, isVideoNode, type CanvasNodeAttributes } from "../domain/canvas-node";
import {
    type CanvasAssistantMessage,
    type CanvasAssistantSession,
    type CanvasConnection,
    type CanvasNode,
    type CanvasNodeKind,
    type ConnectionHandle,
    type CanvasPoint,
    type CanvasViewTransform,
} from "../types";

export type CanvasClipboard = {
    nodes: CanvasNode[];
    connections: CanvasConnection[];
};

export type PendingConnectionCreate = {
    connection: ConnectionHandle;
    position: CanvasPoint;
    menuPosition?: CanvasPoint;
};

export type PendingConnectionCreateNodeType = CanvasNodeKind;

export type ConnectionDropTarget = {
    nodeId: string | null;
    isNearNode: boolean;
};

export type EdgeDeletePopover = {
    connectionId: string;
    x: number;
    y: number;
};

export type CanvasHistoryEntry = Pick<CanvasClipboard, "nodes" | "connections"> & {
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
};

const CONNECTION_CREATE_MENU_WIDTH = 300;
const CONNECTION_CREATE_MENU_HEIGHT = 328;
const AGENT_HISTORY_MESSAGE_LIMIT = 12;

export function createCanvasNode(kind: CanvasNodeKind, position: CanvasPoint, attributes?: CanvasNodeAttributes): CanvasNode {
    const template = getCanvasNodeTemplate(kind);
    const input = {
        id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        position: {
            x: position.x - template.width / 2,
            y: position.y - template.height / 2,
        },
    };
    const node = kind === "image" ? createImageNode(input) : kind === "video" ? createVideoNode(input) : createTextNode(input);
    return applyCanvasNodeAttributes(node, { ...readCanvasLastUsedGenerationSettings(kind), ...attributes });
}

export function buildAgentChatHistory(messages: CanvasAssistantMessage[]) {
    return messages
        .flatMap((item) => {
            if (item.role !== "user" && item.role !== "assistant") return [];
            const text = item.text.trim();
            if (!text) return [];
            if (item.role === "assistant" || !item.references?.length) {
                return [{ role: item.role, text }];
            }
            const references = item.references.map((reference) => `- ${reference.title}：${reference.text || ""}`).join("\n");
            return [{ role: item.role, text: `${text}\n\n选中节点：\n${references}` }];
        })
        .slice(-AGENT_HISTORY_MESSAGE_LIMIT);
}

export function CanvasLoadingShell() {
    const theme = useCanvasTheme();

    return (
        <main className="relative h-full min-h-0 overflow-hidden" style={{ background: theme.canvas.backgroundGradient, color: theme.node.faint }}>
            <div
                className="absolute inset-0 opacity-60"
                style={{
                    backgroundImage: `radial-gradient(circle, ${theme.canvas.dot} 1px, transparent 1px)`,
                    backgroundSize: "28px 28px",
                }}
            />

            <div className="absolute bottom-5 left-1/2 z-50 flex h-11 -translate-x-1/2 items-center gap-0.5 rounded-lg px-1" style={{ background: theme.toolbar.panel }} aria-hidden="true">
                {Array.from({ length: 9 }).map((_, index) => (
                    <div key={index} className="size-9 rounded-md bg-current opacity-10" />
                ))}
            </div>

            <div className="absolute bottom-24 left-6 z-50 h-40 w-[240px] rounded-lg border shadow-xl backdrop-blur-sm" style={{ background: theme.node.panel, borderColor: theme.node.stroke }} aria-hidden="true">
                <div className="absolute left-7 top-7 h-5 w-12 rounded-sm bg-current opacity-10" />
                <div className="absolute left-28 top-16 h-6 w-16 rounded-sm bg-current opacity-10" />
                <div className="absolute bottom-7 left-16 h-8 w-20 rounded-sm bg-current opacity-10" />
                <div className="absolute inset-5 rounded border border-current opacity-15" />
            </div>

            <div className="absolute bottom-5 left-5 z-50 flex h-11 w-[260px] items-center gap-2 rounded-lg px-1" style={{ background: theme.toolbar.panel }} aria-hidden="true">
                <div className="size-8 rounded-md bg-current opacity-10" />
                <div className="size-8 rounded-md bg-current opacity-10" />
                <div className="h-1 flex-1 rounded-full bg-current opacity-10" />
                <div className="h-4 w-10 rounded bg-current opacity-10" />
                <div className="size-8 rounded-md bg-current opacity-10" />
            </div>
        </main>
    );
}

export function ConnectionCreateMenu({
    pending,
    onCreate,
    onClose,
}: {
    pending: PendingConnectionCreate;
    onCreate: (type: PendingConnectionCreateNodeType) => void;
    onClose: () => void;
}) {
    const theme = useCanvasTheme();
    return (
        <div
            className="absolute z-[120] rounded-[18px] border p-3 shadow-2xl"
            data-connection-create-menu
            style={{
                left: pending.menuPosition?.x ?? pending.position.x,
                top: pending.menuPosition?.y ?? pending.position.y,
                width: CONNECTION_CREATE_MENU_WIDTH,
                background: theme.node.panel,
                borderColor: theme.node.stroke,
                color: theme.node.text,
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-medium" style={{ color: theme.node.muted }}>
                    引用该节点生成
                </span>
                <button type="button" className="grid size-7 place-items-center rounded-lg text-base opacity-55 transition hover:bg-black/5 hover:opacity-100" onClick={onClose} aria-label="关闭">
                    ×
                </button>
            </div>
            <div className="grid gap-1">
                <ConnectionCreateOption theme={theme} icon={<List className="size-5" />} title="文本生成" description="脚本、广告词、品牌文案" onClick={() => onCreate("text")} />
                <ConnectionCreateOption theme={theme} icon={<ImageIcon className="size-5" />} title="图片生成" onClick={() => onCreate("image")} />
                <ConnectionCreateOption theme={theme} icon={<Video className="size-5" />} title="视频生成" onClick={() => onCreate("video")} />
            </div>
        </div>
    );
}

function ConnectionCreateOption({
    theme,
    icon,
    title,
    description,
    onClick,
}: {
    theme: CanvasTheme;
    icon: ReactNode;
    title: string;
    description?: string;
    onClick?: () => void;
}) {
    return (
        <button
            type="button"
            className="flex h-16 w-full cursor-pointer items-center gap-3 rounded-2xl px-3 text-left transition"
            style={{ color: theme.node.text }}
            onClick={onClick}
            onMouseEnter={(event) => (event.currentTarget.style.background = theme.node.fill)}
            onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
        >
            <span className="grid size-11 shrink-0 place-items-center rounded-xl" style={{ background: theme.node.fill, color: theme.node.muted }}>
                {icon}
            </span>
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-base font-semibold leading-5">{title}</span>
                {description ? (
                    <span className="mt-1 block truncate text-sm" style={{ color: theme.node.muted }}>
                        {description}
                    </span>
                ) : null}
            </span>
        </button>
    );
}

export function PendingConnectionLine({
    pending,
    nodes,
    viewport,
}: {
    pending: PendingConnectionCreate;
    nodes: CanvasNode[];
    viewport: CanvasViewTransform;
}) {
    const theme = useCanvasTheme();
    const sourceNode = nodes.find((node) => node.id === pending.connection.nodeId);
    if (!sourceNode) return null;

    const sourceWorldX = pending.connection.handleType === "source" ? sourceNode.frame.position.x + sourceNode.frame.width : sourceNode.frame.position.x;
    const sourceWorldY = sourceNode.frame.position.y + sourceNode.frame.height / 2;
    const startX = viewport.x + sourceWorldX * viewport.k;
    const startY = viewport.y + sourceWorldY * viewport.k;
    const menuLeft = pending.menuPosition?.x ?? pending.position.x;
    const menuTop = pending.menuPosition?.y ?? pending.position.y;
    const menuRight = menuLeft + CONNECTION_CREATE_MENU_WIDTH;
    const menuAnchorPadding = 18;
    const endX = startX <= menuLeft + CONNECTION_CREATE_MENU_WIDTH / 2 ? menuLeft : menuRight;
    const endY = Math.min(Math.max(startY, menuTop + menuAnchorPadding), menuTop + CONNECTION_CREATE_MENU_HEIGHT - menuAnchorPadding);
    const direction = endX >= startX ? 1 : -1;
    const distance = Math.abs(endX - startX);
    const curvature = Math.max(distance * 0.45, 56);
    const pathD = `M ${startX} ${startY} C ${startX + curvature * direction} ${startY}, ${endX - curvature * direction} ${endY}, ${endX} ${endY}`;

    return (
        <svg className="pointer-events-none absolute inset-0 z-[119] h-full w-full overflow-visible" aria-hidden="true">
            <path d={pathD} stroke={theme.node.muted} strokeWidth="2.5" strokeDasharray="6 6" strokeLinecap="round" fill="none" opacity="0.9" />
        </svg>
    );
}

export function buildCanvasTasks(nodes: CanvasNode[], generationRequestByNodeId: Map<string, CanvasGenerationRequest>): CanvasTaskPanelTask[] {
    return nodes
        .flatMap((node, index) => {
            if (!isGeneratedMediaNode(node)) return [];
            const request = generationRequestByNodeId.get(node.id);
            const content = readNodeContent(node);
            const status = mapTaskStatus(node, content);
            const prompt = readNodePrompt(node);
            const fallbackName = isVideoNode(node) ? "视频任务" : isTextNode(node) ? "文本任务" : "图片任务";
            const taskType: CanvasTaskPanelTask["type"] = node.kind;
            const name = (node.title || prompt || fallbackName).trim();
            return [
                {
                    id: `task-${node.id}`,
                    nodeId: node.id,
                    runningNodeId: request?.runningNodeId || node.id,
                    name: truncateTaskName(name, fallbackName),
                    type: taskType,
                    status,
                    isRunning: Boolean(request),
                    prompt,
                    content,
                    errorDetails: node.execution.errorMessage,
                    width: node.frame.naturalWidth || node.frame.width,
                    height: node.frame.naturalHeight || node.frame.height,
                    bytes: isTextNode(node) ? undefined : node.content.bytes,
                    durationMs: isVideoNode(node) ? node.content.durationMilliseconds : undefined,
                    startedAt: node.execution.startedAt,
                    completedAt: node.execution.completedAt,
                    batchCount: isImageNode(node) && node.grouping.isRoot ? Math.max(1, node.grouping.childIds.length + 1) : undefined,
                    sortIndex: index,
                },
            ];
        })
        .sort((first, second) => Number(second.isRunning) - Number(first.isRunning) || second.sortIndex - first.sortIndex)
        .map(({ sortIndex, ...task }) => task);
}

function isGeneratedMediaNode(node: CanvasNode) {
    if (node.execution.phase === "running" || node.execution.phase === "failed") return true;
    if (isTextNode(node)) return Boolean(node.content.text);
    if (isImageNode(node)) return Boolean(node.generation.prompt || node.generation.model || node.generation.references.length || node.grouping.isRoot || node.grouping.rootId);
    return Boolean(node.generation.prompt || node.generation.model || node.generation.references.length);
}

function readNodeContent(node: CanvasNode) {
    return isTextNode(node) ? node.content.text : node.content.source;
}

function readNodePrompt(node: CanvasNode) {
    return isTextNode(node) ? undefined : node.generation.prompt.trim() || undefined;
}

function mapTaskStatus(node: CanvasNode, content: string): CanvasTaskPanelTask["status"] {
    if (node.execution.phase === "running") return "loading";
    if (node.execution.phase === "failed") return "error";
    if (node.execution.phase === "succeeded" || content) return "success";
    return "idle";
}

function truncateTaskName(value: string, fallback: string) {
    const text = value.trim() || fallback;
    return text.length > 32 ? text.slice(0, 32) : text;
}

export function isHiddenBatchChild(node: CanvasNode, nodes: CanvasNode[], collapsingBatchIds?: Set<string>) {
    const rootId = isImageNode(node) ? node.grouping.rootId : undefined;
    if (!rootId) return false;
    const root = nodes.find((item) => item.id === rootId);
    if (root && collapsingBatchIds?.has(rootId)) return false;
    return Boolean(root && isImageNode(root) && !root.grouping.expanded);
}

export function isHiddenBatchConnectionEndpoint(node: CanvasNode, nodes: CanvasNode[]) {
    const rootId = isImageNode(node) ? node.grouping.rootId : undefined;
    if (!rootId) return false;
    const root = nodes.find((item) => item.id === rootId);
    return Boolean(root && isImageNode(root) && !root.grouping.expanded);
}
