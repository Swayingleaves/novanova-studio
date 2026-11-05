import type { CanvasConnection, CanvasNode, CanvasPoint } from "../types.ts";
import { isImageNode, isVideoNode } from "./canvas-node.ts";
import { createCanvasConnection } from "./canvas-page-node.ts";

export type BatchImageToVideoPlan = {
    /** 参与批量的可见选中图片节点数量，包含已有连线的节点。 */
    imageNodeCount: number;
    /** 本次需要新增的连线。 */
    connections: CanvasConnection[];
    /** 已存在连线、本次跳过的节点数量。 */
    skippedExistingCount: number;
};

export type BatchImageToVideoPlanInput = {
    /** 选区中参与批量连接的来源节点。 */
    sourceNodeIds: readonly string[];
    targetNodeId: string;
    nodes: readonly CanvasNode[];
    connections: readonly CanvasConnection[];
    hiddenNodeIds?: ReadonlySet<string>;
    createConnectionId: () => string;
};

/**
 * 规划把选区中的全部图片节点连接到视频节点的结果。
 *
 * @param input 来源节点集合、目标视频节点和当前画布数据
 * @return 批量连线计划；返回 null 表示不满足批量条件
 */
export function planBatchImageToVideoConnections(input: BatchImageToVideoPlanInput): BatchImageToVideoPlan | null {
    const { sourceNodeIds, targetNodeId, nodes, connections, hiddenNodeIds, createConnectionId } = input;
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const targetNode = nodeById.get(targetNodeId);
    if (!targetNode || !isVideoNode(targetNode)) return null;

    const sourceIdSet = new Set(sourceNodeIds);
    const imageNodes = nodes
        .filter((node) => node.id !== targetNodeId && sourceIdSet.has(node.id) && isImageNode(node) && !hiddenNodeIds?.has(node.id))
        .sort(compareCanvasNodes);
    if (imageNodes.length < 2) return null;

    const existingSourceIds = new Set(connections
        .filter((connection) => connection.target.nodeId === targetNodeId)
        .map((connection) => connection.source.nodeId));
    const batchConnections: CanvasConnection[] = [];
    let skippedExistingCount = 0;
    for (const imageNode of imageNodes) {
        if (existingSourceIds.has(imageNode.id)) {
            skippedExistingCount += 1;
            continue;
        }
        const ports = batchConnectionPorts(imageNode, targetNode);
        batchConnections.push(createCanvasConnection(createConnectionId(), imageNode.id, targetNodeId, ports.sourcePortId, ports.targetPortId));
    }

    return { imageNodeCount: imageNodes.length, connections: batchConnections, skippedExistingCount };
}

export type CanvasNodesBounds = {
    left: number;
    top: number;
    width: number;
    height: number;
};

/** 读取多个节点在画布世界坐标中的外接矩形。 */
export function readCanvasNodesBounds(nodes: readonly CanvasNode[]): CanvasNodesBounds | null {
    if (!nodes.length) return null;
    let left = Number.POSITIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    for (const node of nodes) {
        left = Math.min(left, node.frame.position.x);
        top = Math.min(top, node.frame.position.y);
        right = Math.max(right, node.frame.position.x + node.frame.width);
        bottom = Math.max(bottom, node.frame.position.y + node.frame.height);
    }
    return { left, top, width: right - left, height: bottom - top };
}

/** 判断画布世界坐标点是否落在节点区域内。 */
export function canvasNodeContainsPoint(node: CanvasNode, point: CanvasPoint): boolean {
    return point.x >= node.frame.position.x
        && point.x <= node.frame.position.x + node.frame.width
        && point.y >= node.frame.position.y
        && point.y <= node.frame.position.y + node.frame.height;
}

function compareCanvasNodes(first: CanvasNode, second: CanvasNode): number {
    return first.frame.position.x - second.frame.position.x
        || first.frame.position.y - second.frame.position.y
        || first.id.localeCompare(second.id);
}

/** 按两者水平中心点选择最近的一侧连接点。 */
function batchConnectionPorts(sourceNode: CanvasNode, targetNode: CanvasNode) {
    const sourceCenterX = sourceNode.frame.position.x + sourceNode.frame.width / 2;
    const targetCenterX = targetNode.frame.position.x + targetNode.frame.width / 2;
    return sourceCenterX <= targetCenterX
        ? { sourcePortId: "right", targetPortId: "left" }
        : { sourcePortId: "left", targetPortId: "right" };
}
