import { getCanvasNodeTemplate } from "../constants.ts";
import type { CanvasConnection, CanvasNode } from "../types.ts";
import { MINIMUM_CONTENT_NODE_DIMENSION, nodeSizeFromRatio, nodeSizeFromRatioWithMinimum } from "../utils/canvas-node-size.ts";
import {
    applyCanvasNodeAttributes,
    isImageNode,
    isStoryboardNode,
    isTextNode,
    updateCanvasNodeExecution,
    updateCanvasNodeFrame,
    type CanvasNodeAttributes,
} from "./canvas-node.ts";

export function applyCanvasNodeConfig(node: CanvasNode, attributes: CanvasNodeAttributes): CanvasNode {
    const updated = applyCanvasNodeAttributes(node, attributes);
    if (typeof attributes.size !== "string" || (isImageNode(updated) && updated.content.source) || (!isImageNode(updated) && !isTextNode(updated) && !isStoryboardNode(updated))) return updated;

    const template = getCanvasNodeTemplate(updated.kind);
    const size = isTextNode(updated) || isStoryboardNode(updated)
        ? nodeSizeFromRatioWithMinimum(attributes.size, template.width, template.height, MINIMUM_CONTENT_NODE_DIMENSION)
        : nodeSizeFromRatio(attributes.size, template.width, template.height);
    if (!size) return updated;

    return updateCanvasNodeFrame(updated, {
        ...size,
        position: {
            x: node.frame.position.x + node.frame.width / 2 - size.width / 2,
            y: node.frame.position.y + node.frame.height / 2 - size.height / 2,
        },
    });
}

export function normalizeCanvasConnection(firstNodeId: string, secondNodeId: string, nodes: CanvasNode[]): Omit<CanvasConnection, "id"> | null {
    const first = nodes.find((node) => node.id === firstNodeId);
    const second = nodes.find((node) => node.id === secondNodeId);
    if (!first || !second || first.id === second.id) return null;
    return {
        source: { nodeId: first.id },
        target: { nodeId: second.id },
    };
}

export function createCanvasConnection(id: string, sourceNodeId: string, targetNodeId: string, sourcePortId?: string | null, targetPortId?: string | null): CanvasConnection {
    return {
        id,
        source: { nodeId: sourceNodeId, ...(sourcePortId ? { portId: sourcePortId } : {}) },
        target: { nodeId: targetNodeId, ...(targetPortId ? { portId: targetPortId } : {}) },
    };
}

export function resetInterruptedCanvasNodes(nodes: CanvasNode[]): CanvasNode[] {
    return nodes.map((node) => {
        if (node.execution.phase !== "running" || node.execution.taskId || (isStoryboardNode(node) && node.storyboard.assetGeneration?.phase === "running")) return node;
        return updateCanvasNodeExecution(node, {
            phase: "failed",
            errorMessage: "页面刷新后生成已中断，请重新生成。",
        });
    });
}

export function readCanvasNodeContent(node: CanvasNode): string {
    if (isTextNode(node)) return node.content.text;
    if (isStoryboardNode(node)) return node.content.instruction;
    return isImageNode(node) || node.kind === "video" ? node.content.source : "";
}

export function readCanvasNodePrompt(node: CanvasNode): string {
    return isImageNode(node) || node.kind === "video" ? node.generation.prompt : "";
}

export function selectCanvasNodesInRectangle(
    nodes: CanvasNode[],
    rectangle: { left: number; top: number; right: number; bottom: number },
): string[] {
    return nodes
        .filter((node) => {
            const nodeRight = node.frame.position.x + node.frame.width;
            const nodeBottom = node.frame.position.y + node.frame.height;
            return rectangle.left < nodeRight
                && rectangle.right > node.frame.position.x
                && rectangle.top < nodeBottom
                && rectangle.bottom > node.frame.position.y;
        })
        .map((node) => node.id);
}

export function findCanvasConnectionDropTarget(
    nodes: CanvasNode[],
    sourceNodeId: string,
    handleType: "source" | "target",
    point: { x: number; y: number },
    zoom: number,
    paddingPixels: number,
    handleRadiusPixels: number,
): { nodeId: string | null; isNearNode: boolean } {
    const scale = Math.max(zoom, 0.05);
    const padding = paddingPixels / scale;
    const handleRadius = handleRadiusPixels / scale;
    let resultNodeId: string | null = null;
    let resultPriority = Number.POSITIVE_INFINITY;
    let isNearNode = false;

    [...nodes].reverse().forEach((node) => {
        const anchorX = handleType === "source" ? node.frame.position.x : node.frame.position.x + node.frame.width;
        const anchorY = node.frame.position.y + node.frame.height / 2;
        const distanceX = point.x - anchorX;
        const distanceY = point.y - anchorY;
        const hitsHandle = distanceX * distanceX + distanceY * distanceY <= handleRadius * handleRadius;
        const hitsInside = point.x >= node.frame.position.x
            && point.x <= node.frame.position.x + node.frame.width
            && point.y >= node.frame.position.y
            && point.y <= node.frame.position.y + node.frame.height;
        const hitsPadding = point.x >= node.frame.position.x - padding
            && point.x <= node.frame.position.x + node.frame.width + padding
            && point.y >= node.frame.position.y - padding
            && point.y <= node.frame.position.y + node.frame.height + padding;
        if (!hitsHandle && !hitsInside && !hitsPadding) return;
        isNearNode = true;
        if (node.id === sourceNodeId) return;
        const priority = hitsInside ? 0 : hitsHandle ? 1 : 2;
        if (priority >= resultPriority) return;
        resultNodeId = node.id;
        resultPriority = priority;
    });

    return { nodeId: resultNodeId, isNearNode };
}

export function updateCanvasNodeSelection(current: Set<string>, nodeId: string, additive: boolean): Set<string> {
    if (!additive) return new Set([nodeId]);
    const next = new Set(current);
    if (next.has(nodeId)) next.delete(nodeId);
    else next.add(nodeId);
    return next;
}

export function moveCanvasNodesFromOrigins(
    nodes: CanvasNode[],
    origins: Array<{ id: string; x: number; y: number }>,
    offsetX: number,
    offsetY: number,
): CanvasNode[] {
    const originById = new Map(origins.map((origin) => [origin.id, origin]));
    return nodes.map((node) => {
        const origin = originById.get(node.id);
        return origin ? updateCanvasNodeFrame(node, { position: { x: origin.x + offsetX, y: origin.y + offsetY } }) : node;
    });
}

export function applyGeneratedImageToBatchNodes(
    nodes: CanvasNode[],
    result: { rootId: string; targetId: string; attributes: CanvasNodeAttributes; width: number; height: number },
): CanvasNode[] {
    const updatedNodes = nodes.map((node) => {
        if (node.id !== result.targetId) return node;
        const center = {
            x: node.frame.position.x + node.frame.width / 2,
            y: node.frame.position.y + node.frame.height / 2,
        };
        const updated = applyCanvasNodeAttributes(node, result.attributes);
        return updateCanvasNodeFrame(updated, {
            position: { x: center.x - result.width / 2, y: center.y - result.height / 2 },
            width: result.width,
            height: result.height,
        });
    });

    if (result.rootId === result.targetId) return updatedNodes;
    const withStyleSnapshot = result.attributes.generationStyleSnapshots || result.attributes.generationStyleIds
        ? updatedNodes.map((node) => node.id === result.rootId
            ? applyCanvasNodeAttributes(node, {
                  generationStyleIds: result.attributes.generationStyleIds,
                  generationStyleSnapshots: result.attributes.generationStyleSnapshots,
              })
            : node)
        : updatedNodes;
    return synchronizeImageBatchRootExecution(withStyleSnapshot, result.rootId);
}

export function synchronizeImageBatchRootExecution(nodes: CanvasNode[], rootId: string): CanvasNode[] {
    const root = nodes.find((node) => node.id === rootId);
    if (!root || !isImageNode(root) || !root.grouping.isRoot || !root.grouping.childIds.length) return nodes;

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    let completedCount = 0;
    let succeededCount = 0;
    let failedCount = 0;
    root.grouping.childIds.forEach((childId) => {
        const phase = nodeById.get(childId)?.execution.phase;
        if (phase === "succeeded") succeededCount += 1;
        if (phase === "failed") failedCount += 1;
        if (phase === "succeeded" || phase === "failed") completedCount += 1;
    });
    const totalCount = root.grouping.childIds.length;
    const completed = completedCount >= totalCount;
    const phase = completed ? failedCount > 0 ? "failed" : "succeeded" : "running";
    const errorMessage = completed && failedCount > 0
        ? succeededCount > 0 ? `部分图片生成失败（成功 ${succeededCount}/${totalCount}）` : "全部图片生成失败"
        : "";

    return nodes.map((node) => node.id === rootId
        ? updateCanvasNodeExecution(node, {
              phase,
              progress: Math.round((completedCount / totalCount) * 100),
              errorMessage,
          })
        : node);
}
