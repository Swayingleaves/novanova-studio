import { nanoid } from "nanoid";

import { createImageNode, createTextNode, createVideoNode } from "../constants.ts";
import {
    applyCanvasNodeAttributes,
    updateCanvasNodeFrame,
    updateCanvasNodeTitle,
    type CanvasNodeAttributes,
} from "../domain/canvas-node.ts";
import type { CanvasConnection, CanvasNode, CanvasNodeKind, CanvasViewTransform } from "../types.ts";

export type CanvasAgentNodeAttributes = CanvasNodeAttributes;

type CanvasAgentNodePatch = {
    title?: string;
    position?: { x: number; y: number };
    width?: number;
    height?: number;
};

type CanvasAgentCommonFields = {
    id?: string;
    ids?: string[];
    nodeId?: string;
    nodeType?: CanvasNodeKind;
    title?: string;
    position?: { x: number; y: number };
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    patch?: CanvasAgentNodePatch;
    attributes?: CanvasAgentNodeAttributes;
    all?: boolean;
    sourceNodeId?: string;
    targetNodeId?: string;
    viewport?: CanvasViewTransform;
    mode?: CanvasNodeKind;
    prompt?: string;
    recovery?: boolean;
    generationStyleSnapshots?: import("@/services/api/server").GenerationStyleSnapshot[];
};

export type CanvasAgentOp = CanvasAgentCommonFields &
    (
        | { type: "add_node" }
        | { type: "update_node" }
        | { type: "delete_node" }
        | { type: "delete_connections" }
        | { type: "connect_nodes" }
        | { type: "set_viewport" }
        | { type: "select_nodes" }
        | { type: "run_generation"; nodeId: string }
    );

export type CanvasAgentSnapshot = {
    projectId: string;
    title: string;
    nodes: CanvasNode[];
    connections: CanvasConnection[];
    selectedNodeIds: string[];
    viewport: CanvasViewTransform;
};

type AgentOpType = CanvasAgentOp["type"];
type AgentReducer = (snapshot: CanvasAgentSnapshot, op: CanvasAgentOp, index: number) => CanvasAgentSnapshot;

const OPERATION_LABELS: Record<AgentOpType, string> = {
    add_node: "新增节点",
    update_node: "更新节点",
    delete_node: "删除节点",
    delete_connections: "删除连线",
    connect_nodes: "连接",
    set_viewport: "调整视图",
    select_nodes: "选择节点",
    run_generation: "触发生成",
};

const OPERATION_REDUCERS: Record<AgentOpType, AgentReducer> = {
    add_node: reduceAddNode,
    update_node: reduceUpdateNode,
    delete_node: reduceDeleteNodes,
    delete_connections: reduceDeleteConnections,
    connect_nodes: reduceConnectNodes,
    set_viewport: reduceViewport,
    select_nodes: reduceSelection,
    run_generation: (snapshot) => snapshot,
};

export function summarizeCanvasAgentOps(ops?: CanvasAgentOp[]): string {
    const counts = new Map<AgentOpType, number>();
    for (const op of normalizeOps(ops)) counts.set(op.type, (counts.get(op.type) || 0) + 1);
    return Array.from(counts.entries())
        .map(([type, count]) => `${OPERATION_LABELS[type]} ${count}`)
        .join("，");
}

export function applyCanvasAgentOps(snapshot: CanvasAgentSnapshot, ops?: CanvasAgentOp[]): CanvasAgentSnapshot {
    return normalizeOps(ops).reduce((state, op, index) => OPERATION_REDUCERS[op.type](state, op, index), snapshot);
}

function normalizeOps(ops?: CanvasAgentOp[]): CanvasAgentOp[] {
    return Array.isArray(ops) ? ops.filter((op): op is CanvasAgentOp => Boolean(op?.type && op.type in OPERATION_REDUCERS)) : [];
}

function reduceAddNode(snapshot: CanvasAgentSnapshot, op: CanvasAgentOp, index: number): CanvasAgentSnapshot {
    const kind = readNodeKind(op.nodeType) || "text";
    const position = readPosition(op, index);
    const input = { id: op.id || `${kind}-${Date.now()}-${index}`, title: op.title, position };
    const created = kind === "image" ? createImageNode(input) : kind === "video" ? createVideoNode(input) : createTextNode(input);
    const framed = updateCanvasNodeFrame(created, {
        width: readDimension(op.width, created.frame.width),
        height: readDimension(op.height, created.frame.height),
    });
    const nextNode = applyCanvasNodeAttributes(framed, op.attributes);
    return { ...snapshot, nodes: [...snapshot.nodes, nextNode], selectedNodeIds: [nextNode.id] };
}

function reduceUpdateNode(snapshot: CanvasAgentSnapshot, op: CanvasAgentOp): CanvasAgentSnapshot {
    if (!op.id) return snapshot;
    return {
        ...snapshot,
        nodes: snapshot.nodes.map((node) => (node.id === op.id ? applyNodeUpdate(node, op) : node)),
    };
}

function applyNodeUpdate(node: CanvasNode, op: CanvasAgentOp): CanvasNode {
    const patch = op.patch || {};
    const titled = updateCanvasNodeTitle(node, op.title || patch.title || node.title);
    const framed = updateCanvasNodeFrame(titled, {
        position: patch.position,
        width: readDimension(patch.width, titled.frame.width),
        height: readDimension(patch.height, titled.frame.height),
    });
    return applyCanvasNodeAttributes(framed, op.attributes);
}

function reduceDeleteNodes(snapshot: CanvasAgentSnapshot, op: CanvasAgentOp): CanvasAgentSnapshot {
    const removedNodeIds = resolveDeletedNodeIds(snapshot.nodes, op);
    if (!removedNodeIds.size) return snapshot;
    return {
        ...snapshot,
        nodes: snapshot.nodes.filter((node) => !removedNodeIds.has(node.id)),
        connections: snapshot.connections.filter((connection) => !removedNodeIds.has(connection.source.nodeId) && !removedNodeIds.has(connection.target.nodeId)),
        selectedNodeIds: snapshot.selectedNodeIds.filter((id) => !removedNodeIds.has(id)),
    };
}

function reduceDeleteConnections(snapshot: CanvasAgentSnapshot, op: CanvasAgentOp): CanvasAgentSnapshot {
    if (op.all) return { ...snapshot, connections: [] };
    const targetConnectionIds = new Set([...(op.ids || []), ...(op.id ? [op.id] : [])]);
    return targetConnectionIds.size ? { ...snapshot, connections: snapshot.connections.filter((connection) => !targetConnectionIds.has(connection.id)) } : snapshot;
}

function reduceConnectNodes(snapshot: CanvasAgentSnapshot, op: CanvasAgentOp): CanvasAgentSnapshot {
    if (!op.sourceNodeId || !op.targetNodeId) return snapshot;
    const nodeIds = new Set(snapshot.nodes.map((node) => node.id));
    if (!nodeIds.has(op.sourceNodeId) || !nodeIds.has(op.targetNodeId)) return snapshot;
    if (snapshot.connections.some((connection) => connection.source.nodeId === op.sourceNodeId && connection.target.nodeId === op.targetNodeId)) return snapshot;
    const nextConnection: CanvasConnection = { id: op.id || nanoid(), source: { nodeId: op.sourceNodeId }, target: { nodeId: op.targetNodeId } };
    return { ...snapshot, connections: [...snapshot.connections, nextConnection] };
}

function reduceViewport(snapshot: CanvasAgentSnapshot, op: CanvasAgentOp): CanvasAgentSnapshot {
    return op.viewport ? { ...snapshot, viewport: op.viewport } : snapshot;
}

function reduceSelection(snapshot: CanvasAgentSnapshot, op: CanvasAgentOp): CanvasAgentSnapshot {
    const existingIds = new Set(snapshot.nodes.map((node) => node.id));
    return { ...snapshot, selectedNodeIds: (op.ids || []).filter((id) => existingIds.has(id)) };
}

function resolveDeletedNodeIds(nodes: CanvasNode[], op: CanvasAgentOp): Set<string> {
    if (op.ids) return new Set(op.ids);
    if (op.id) return new Set([op.id]);
    const kind = readNodeKind(op.nodeType);
    return new Set(kind ? nodes.filter((node) => node.kind === kind).map((node) => node.id) : []);
}

function readNodeKind(nodeType?: CanvasNodeKind): CanvasNodeKind | null {
    return nodeType === "image" || nodeType === "text" || nodeType === "video" ? nodeType : null;
}

function readPosition(op: CanvasAgentOp, index: number): { x: number; y: number } {
    return op.position || { x: op.x ?? index * 36, y: op.y ?? index * 36 };
}

function readDimension(value: number | undefined, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
