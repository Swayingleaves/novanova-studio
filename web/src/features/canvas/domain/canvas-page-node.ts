
import { translateMessage as translate } from "@/features/locale/translate";
import { CANVAS_BACKGROUND_DEFAULT_COLOR, CANVAS_BACKGROUND_LABEL_DEFAULT_COLOR, CANVAS_BACKGROUND_LABEL_DEFAULT_FONT_SIZE, CANVAS_BACKGROUND_LABEL_LEGACY_COLOR, CANVAS_BACKGROUND_LABEL_MAX_FONT_SIZE, CANVAS_BACKGROUND_LABEL_MIN_BOX_HEIGHT, CANVAS_BACKGROUND_LABEL_MIN_BOX_WIDTH, CANVAS_BACKGROUND_LABEL_MIN_FONT_SIZE, CANVAS_BACKGROUND_LABEL_PADDING, CANVAS_BACKGROUND_MIN_HEIGHT, CANVAS_BACKGROUND_MIN_WIDTH, CANVAS_BACKGROUND_PADDING, getCanvasNodeTemplate } from "../constants.ts";
import type { CanvasBackgroundLabel, CanvasBackgroundNode, CanvasConnection, CanvasNode, CanvasNodeFrame, CanvasPoint } from "../types.ts";
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
    // 批次根节点的相位由子节点派生，只要还有子节点能续跑就保持运行中。
    const resumableNodeIds = new Set(nodes.filter((node) => node.execution.phase === "running" && Boolean(node.execution.taskId)).map((node) => node.id));
    return nodes.map((node) => {
        if (node.execution.phase !== "running" || node.execution.taskId || (isStoryboardNode(node) && node.storyboard.assetGeneration?.phase === "running")) return node;
        if (isImageNode(node) && node.grouping.isRoot && node.grouping.childIds.some((childId) => resumableNodeIds.has(childId))) return node;
        return updateCanvasNodeExecution(node, {
            phase: "failed",
            errorMessage: translate("canvas.generationInterruptedByRefreshGenerateAgain"),
        });
    });
}

export function readCanvasNodeContent(node: CanvasNode): string {
    if (isTextNode(node)) return node.content.text;
    if (isStoryboardNode(node)) return node.content.instruction;
    return isImageNode(node) || node.kind === "video" || node.kind === "audio" ? node.content.source : "";
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

/**
 * 在首选位置附近寻找不与现有节点相交的位置。
 *
 * @param nodes 画布中已存在的节点
 * @param preferredPosition 首选的节点左上角坐标
 * @param width 待放置节点宽度
 * @param height 待放置节点高度
 * @param gap 节点之间保留的最小间距
 * @return CanvasPoint 可安全放置的节点左上角坐标
 */
export function findNonOverlappingCanvasNodePosition(nodes: CanvasNode[], preferredPosition: CanvasPoint, width: number, height: number, gap = 54): CanvasPoint {
    const step = Math.max(32, gap);
    const candidateIntersects = (position: CanvasPoint) => nodes.some((node) =>
        position.x < node.frame.position.x + node.frame.width + gap
        && position.x + width + gap > node.frame.position.x
        && position.y < node.frame.position.y + node.frame.height + gap
        && position.y + height + gap > node.frame.position.y,
    );
    if (!candidateIntersects(preferredPosition)) return preferredPosition;

    for (let radius = 1; radius <= 100; radius += 1) {
        for (let row = -radius; row <= radius; row += 1) {
            for (let column = -radius; column <= radius; column += 1) {
                if (Math.max(Math.abs(column), Math.abs(row)) !== radius) continue;
                const candidate = { x: preferredPosition.x + column * (width + step), y: preferredPosition.y + row * (height + step) };
                if (!candidateIntersects(candidate)) return candidate;
            }
        }
    }
    const rightmost = nodes.reduce((right, node) => Math.max(right, node.frame.position.x + node.frame.width), preferredPosition.x + width);
    return { x: rightmost + gap, y: preferredPosition.y };
}

/** 把文字描述字号限制在可调整范围内。 */
export function clampBackgroundLabelFontSize(fontSize: number): number {
    if (!Number.isFinite(fontSize)) return CANVAS_BACKGROUND_LABEL_DEFAULT_FONT_SIZE;
    return Math.min(CANVAS_BACKGROUND_LABEL_MAX_FONT_SIZE, Math.max(CANVAS_BACKGROUND_LABEL_MIN_FONT_SIZE, fontSize));
}

/** 把文字描述锚点限制在背景板内边距中，并留出可显示的最小区域。 */
export function clampBackgroundLabelPoint(x: number, y: number, boardWidth: number, boardHeight: number): { x: number; y: number } {
    const padding = CANVAS_BACKGROUND_LABEL_PADDING;
    const maxX = Math.max(padding, boardWidth - padding - CANVAS_BACKGROUND_LABEL_MIN_BOX_WIDTH);
    const maxY = Math.max(padding, boardHeight - padding - CANVAS_BACKGROUND_LABEL_MIN_BOX_HEIGHT);
    return {
        x: clampBackgroundLabelAxis(Number.isFinite(x) ? x : padding, padding, maxX),
        y: clampBackgroundLabelAxis(Number.isFinite(y) ? y : padding, padding, maxY),
    };
}

/** 夹紧一条文字描述的位置，未越界时保持原对象。 */
export function clampBackgroundLabel(label: CanvasBackgroundLabel, boardWidth: number, boardHeight: number): CanvasBackgroundLabel {
    const point = clampBackgroundLabelPoint(label.x, label.y, boardWidth, boardHeight);
    return point.x === label.x && point.y === label.y ? label : { ...label, ...point };
}

/** 把文字颜色解析成会随主题变化的颜色。旧的固定默认色改用主题文字色。 */
export function resolveBackgroundLabelColor(color: string | undefined): string {
    const trimmed = color?.trim();
    if (!trimmed || trimmed.toLowerCase() === CANVAS_BACKGROUND_LABEL_LEGACY_COLOR) return CANVAS_BACKGROUND_LABEL_DEFAULT_COLOR;
    return trimmed;
}

/** 在指定背景板范围内创建一条文字描述。 */
export function createBackgroundLabel(input: { id: string; text: string; x: number; y: number; color?: string; fontSize?: number }, boardWidth: number, boardHeight: number): CanvasBackgroundLabel {
    const point = clampBackgroundLabelPoint(input.x, input.y, boardWidth, boardHeight);
    return {
        id: input.id,
        text: input.text,
        x: point.x,
        y: point.y,
        color: resolveBackgroundLabelColor(input.color),
        fontSize: clampBackgroundLabelFontSize(input.fontSize ?? CANVAS_BACKGROUND_LABEL_DEFAULT_FONT_SIZE),
    };
}

/** 清理缺失或越界的文字描述。历史文档没有该字段时返回空数组。 */
export function normalizeBackgroundLabels(labels: unknown, boardWidth: number, boardHeight: number): CanvasBackgroundLabel[] {
    if (!Array.isArray(labels)) return [];
    return labels.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const label = item as Partial<CanvasBackgroundLabel>;
        if (typeof label.id !== "string" || !label.id.trim()) return [];
        const point = clampBackgroundLabelPoint(typeof label.x === "number" ? label.x : CANVAS_BACKGROUND_LABEL_PADDING, typeof label.y === "number" ? label.y : CANVAS_BACKGROUND_LABEL_PADDING, boardWidth, boardHeight);
        return [{
            id: label.id,
            text: typeof label.text === "string" ? label.text : "",
            x: point.x,
            y: point.y,
            color: resolveBackgroundLabelColor(typeof label.color === "string" ? label.color : undefined),
            fontSize: clampBackgroundLabelFontSize(typeof label.fontSize === "number" ? label.fontSize : CANVAS_BACKGROUND_LABEL_DEFAULT_FONT_SIZE),
        }];
    });
}

/** 背景板左上角或尺寸变化后，平移文字描述并夹回新范围，使画面位置保持不动。 */
export function relocateBackgroundLabels(labels: CanvasBackgroundLabel[], previous: CanvasNodeFrame, next: CanvasNodeFrame): CanvasBackgroundLabel[] {
    const offsetX = previous.position.x - next.position.x;
    const offsetY = previous.position.y - next.position.y;
    const frameUnchanged = offsetX === 0 && offsetY === 0 && previous.width === next.width && previous.height === next.height;
    if (frameUnchanged || !labels.length) return labels;
    let changed = false;
    const relocated = labels.map((label) => {
        const nextLabel = clampBackgroundLabel({ ...label, x: label.x + offsetX, y: label.y + offsetY }, next.width, next.height);
        if (nextLabel !== label) changed = true;
        return nextLabel;
    });
    return changed ? relocated : labels;
}

/** 更新背景板尺寸，并同步夹紧板上的文字描述。 */
export function updateBackgroundBoardFrame(node: CanvasBackgroundNode, patch: Partial<CanvasNodeFrame>): CanvasBackgroundNode {
    const next = updateCanvasNodeFrame(node, patch);
    const source = node.labels ?? [];
    const labels = relocateBackgroundLabels(source, node.frame, next.frame);
    return labels === source ? next : { ...next, labels };
}

/** 写回文字描述，并把每条都夹紧在当前背景板内。 */
export function updateBackgroundBoardLabels(node: CanvasBackgroundNode, labels: CanvasBackgroundLabel[]): CanvasBackgroundNode {
    const nextLabels = labels.map((label) => clampBackgroundLabel(label, node.frame.width, node.frame.height));
    const current = node.labels ?? [];
    const unchanged = current.length === nextLabels.length && current.every((label, index) => {
        const nextLabel = nextLabels[index];
        return !!nextLabel && label.id === nextLabel.id && label.text === nextLabel.text && label.x === nextLabel.x && label.y === nextLabel.y && label.color === nextLabel.color && label.fontSize === nextLabel.fontSize;
    });
    return unchanged ? node : { ...node, labels: nextLabels };
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
        return updateBackgroundBoardFrame(node, {
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
            title: node.title || translate("canvas.background"),
            backgroundColor: node.backgroundColor || CANVAS_BACKGROUND_DEFAULT_COLOR,
            labels: normalizeBackgroundLabels(node.labels, node.frame.width, node.frame.height),
        };
        const memberNodeIds = Array.isArray(node.memberNodeIds) ? node.memberNodeIds : [];
        return updateCanvasNodeMembersSafely(normalizedNode, memberNodeIds.filter((id) => validNodeIds.has(id)));
    });
    return expandBackgroundBoardsToMembers(normalized);
}

function clampBackgroundLabelAxis(value: number, min: number, max: number): number {
    if (max < min) return min;
    return Math.min(max, Math.max(min, value));
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
        ? succeededCount > 0 ? translate("canvas.someImagesFailedSuccessful", { value0: succeededCount, value1: totalCount }) : translate("canvas.allImagesFailed")
        : "";

    return nodes.map((node) => node.id === rootId
        ? updateCanvasNodeExecution(node, {
              phase,
              progress: Math.round((completedCount / totalCount) * 100),
              errorMessage,
          })
        : node);
}
