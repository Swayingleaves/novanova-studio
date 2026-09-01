import { CANVAS_BACKGROUND_DEFAULT_COLOR, CANVAS_BACKGROUND_MIN_HEIGHT, CANVAS_BACKGROUND_MIN_WIDTH, CANVAS_BACKGROUND_PADDING, getCanvasNodeTemplate } from "../constants.ts";
import type { CanvasBackgroundNode, CanvasConnection, CanvasNode } from "../types.ts";
import { MINIMUM_CONTENT_NODE_DIMENSION, nodeSizeFromRatio, nodeSizeFromRatioWithMinimum } from "../utils/canvas-node-size.ts";
import {
    applyCanvasNodeAttributes,
    isImageNode,
    isBackgroundNode,
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
    if (!first || !second || first.id === second.id || isBackgroundNode(first) || isBackgroundNode(second)) return null;
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
        if (isBackgroundNode(node)) return;
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

/** 判断两个画布矩形是否相交。 */
export function canvasFramesIntersect(first: CanvasNode, second: CanvasNode): boolean {
    return first.frame.position.x < second.frame.position.x + second.frame.width
        && first.frame.position.x + first.frame.width > second.frame.position.x
        && first.frame.position.y < second.frame.position.y + second.frame.height
        && first.frame.position.y + first.frame.height > second.frame.position.y;
}

/** 将背景板扩展到完整包裹其成员，保持固定内边距。 */
export function expandBackgroundBoardsToMembers(nodes: CanvasNode[]): CanvasNode[] {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    return nodes.map((node) => {
        if (!isBackgroundNode(node) || !node.memberNodeIds.length) return node;
        const members = node.memberNodeIds.map((id) => nodeById.get(id)).filter((member): member is CanvasNode => Boolean(member && !isBackgroundNode(member)));
        if (!members.length) return updateCanvasNodeMembersSafely(node, []);
        const left = Math.min(node.frame.position.x, ...members.map((member) => member.frame.position.x - CANVAS_BACKGROUND_PADDING));
        const top = Math.min(node.frame.position.y, ...members.map((member) => member.frame.position.y - CANVAS_BACKGROUND_PADDING));
        const right = Math.max(node.frame.position.x + node.frame.width, ...members.map((member) => member.frame.position.x + member.frame.width + CANVAS_BACKGROUND_PADDING));
        const bottom = Math.max(node.frame.position.y + node.frame.height, ...members.map((member) => member.frame.position.y + member.frame.height + CANVAS_BACKGROUND_PADDING));
        return updateCanvasNodeFrame(node, {
            position: { x: left, y: top },
            width: Math.max(CANVAS_BACKGROUND_MIN_WIDTH, right - left),
            height: Math.max(CANVAS_BACKGROUND_MIN_HEIGHT, bottom - top),
        });
    });
}

/** 根据一次拖拽结果维护背景板归属；只对板外拖入建立新归属。 */
export function reconcileBackgroundBoardMembership(nodes: CanvasNode[], movedNodeIds: Set<string>, originallyMemberNodeIds: Set<string>): CanvasNode[] {
    const backgrounds = nodes.filter(isBackgroundNode);
    if (!backgrounds.length || !movedNodeIds.size) return nodes;
    const movedNodes = nodes.filter((node) => movedNodeIds.has(node.id) && !isBackgroundNode(node));
    const nextMembers = new Map(backgrounds.map((board) => [board.id, new Set(board.memberNodeIds)]));
    movedNodes.forEach((movedNode) => {
        const previousBoard = backgrounds.find((board) => originallyMemberNodeIds.has(movedNode.id) && board.memberNodeIds.includes(movedNode.id));
        if (previousBoard) {
            if (!canvasFramesIntersect(movedNode, previousBoard)) nextMembers.get(previousBoard.id)?.delete(movedNode.id);
            return;
        }
        const targetBoard = [...backgrounds].reverse().find((board) => canvasFramesIntersect(movedNode, board));
        if (targetBoard) nextMembers.get(targetBoard.id)?.add(movedNode.id);
    });
    const reconciled = nodes.map((node) => {
        if (!isBackgroundNode(node)) return node;
        return updateCanvasNodeMembersSafely(node, [...(nextMembers.get(node.id) || [])]);
    });
    return expandBackgroundBoardsToMembers(reconciled);
}

/** 清理恢复文档中的失效背景板成员，并保持成员完整包裹。 */
export function normalizeBackgroundBoardMembers(nodes: CanvasNode[]): CanvasNode[] {
    const validNodeIds = new Set(nodes.filter((node) => !isBackgroundNode(node)).map((node) => node.id));
    const normalized = nodes.map((node) => {
        if (!isBackgroundNode(node)) return node;
        const normalizedNode = {
            ...node,
            title: node.title || "背景板",
            backgroundColor: node.backgroundColor || CANVAS_BACKGROUND_DEFAULT_COLOR,
        };
        const memberNodeIds = Array.isArray(node.memberNodeIds) ? node.memberNodeIds : [];
        return updateCanvasNodeMembersSafely(normalizedNode, memberNodeIds.filter((id) => validNodeIds.has(id)));
    });
    return expandBackgroundBoardsToMembers(normalized);
}

function updateCanvasNodeMembersSafely(node: CanvasBackgroundNode, memberNodeIds: string[]): CanvasBackgroundNode {
    const normalized = Array.from(new Set(memberNodeIds)).filter((id) => id !== node.id);
    if (normalized.length === node.memberNodeIds.length && normalized.every((id, index) => id === node.memberNodeIds[index])) return node;
    return { ...node, memberNodeIds: normalized };
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
