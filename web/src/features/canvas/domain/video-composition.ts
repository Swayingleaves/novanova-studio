import type { CanvasConnection, CanvasNode, CanvasVideoCompositionNode, CanvasVideoNode } from "../types";
import { isVideoCompositionNode, isVideoNode } from "./canvas-node";

/** 单个合成视频节点可接收的最大输入段数。 */
export const MAXIMUM_VIDEO_COMPOSITION_INPUT_COUNT = 20;

/**
 * 校验新增画布连线是否符合视频合成节点约束。
 *
 * @param sourceNodeId 源节点ID
 * @param targetNodeId 目标节点ID
 * @param nodes 当前画布节点
 * @param connections 当前画布连线
 * @return 不可创建时的中文原因，可创建时返回null
 */
export function readVideoCompositionConnectionError(
    sourceNodeId: string,
    targetNodeId: string,
    nodes: CanvasNode[],
    connections: CanvasConnection[],
): string | null {
    const source = nodes.find((node) => node.id === sourceNodeId);
    const target = nodes.find((node) => node.id === targetNodeId);
    if (!source || !target || source.id === target.id) return "连接节点不存在或不能连接自身";
    if (!isVideoCompositionNode(source) && !isVideoCompositionNode(target)) return null;
    if (!isVideoCompositionNode(target)) return "合成视频节点只能接收视频节点输入";
    if (!isVideoNode(source)) return "合成视频节点仅支持直接连接视频节点";
    if (connections.some((connection) => connection.source.nodeId === source.id && connection.target.nodeId === target.id)) {
        return "该视频已经连接到合成视频节点";
    }
    const connectedInputCount = connections.filter((connection) => connection.target.nodeId === target.id && connection.source.nodeId !== source.id).length;
    if (connectedInputCount >= MAXIMUM_VIDEO_COMPOSITION_INPUT_COUNT) return "单个合成视频节点最多连接20段视频";
    return null;
}

/**
 * 按当前连线同步合成节点的有序输入列表。
 *
 * 保留用户拖拽后的既有顺序，新接入的视频追加至列表末尾；删除连线或源节点时自动移除。
 *
 * @param nodes 当前画布节点
 * @param connections 当前画布连线
 * @return 同步后的画布节点
 */
export function synchronizeVideoCompositionInputs(nodes: CanvasNode[], connections: CanvasConnection[]): CanvasNode[] {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    let changed = false;
    const synchronizedNodes = nodes.map((node) => {
        if (!isVideoCompositionNode(node)) return node;
        const incomingIds = uniqueIds(
            connections
                .filter((connection) => connection.target.nodeId === node.id)
                .map((connection) => nodeById.get(connection.source.nodeId))
                .filter((source): source is CanvasVideoNode => Boolean(source && isVideoNode(source)))
                .map((source) => source.id),
        );
        const incomingIdSet = new Set(incomingIds);
        const preservedIds = node.composition.inputVideoNodeIds.filter((inputId) => incomingIdSet.has(inputId));
        const appendedIds = incomingIds.filter((inputId) => !preservedIds.includes(inputId));
        const inputVideoNodeIds = [...preservedIds, ...appendedIds].slice(0, MAXIMUM_VIDEO_COMPOSITION_INPUT_COUNT);
        const resultVideoNodeId = node.composition.resultVideoNodeId && nodeById.has(node.composition.resultVideoNodeId)
            ? node.composition.resultVideoNodeId
            : undefined;
        if (sameIds(inputVideoNodeIds, node.composition.inputVideoNodeIds) && resultVideoNodeId === node.composition.resultVideoNodeId) return node;
        changed = true;
        const composition = { ...node.composition, inputVideoNodeIds };
        if (resultVideoNodeId) composition.resultVideoNodeId = resultVideoNodeId;
        else delete composition.resultVideoNodeId;
        return {
            ...node,
            composition,
        };
    });
    return changed ? synchronizedNodes : nodes;
}

/**
 * 调整合成输入列表中两个视频的相对顺序。
 *
 * @param inputVideoNodeIds 原始有序输入节点ID
 * @param draggedNodeId 被拖动的视频节点ID
 * @param targetNodeId 拖动目标视频节点ID
 * @return 调整后的有序输入节点ID
 */
export function reorderVideoCompositionInputIds(inputVideoNodeIds: string[], draggedNodeId: string, targetNodeId: string): string[] {
    if (draggedNodeId === targetNodeId) return inputVideoNodeIds;
    const sourceIndex = inputVideoNodeIds.indexOf(draggedNodeId);
    const targetIndex = inputVideoNodeIds.indexOf(targetNodeId);
    if (sourceIndex < 0 || targetIndex < 0) return inputVideoNodeIds;
    const next = [...inputVideoNodeIds];
    next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, draggedNodeId);
    return next;
}

/**
 * 判断合成按钮是否可以提交。
 *
 * @param node 合成视频节点
 * @param videoById 视频节点映射
 * @return 是否存在2至20段已完成且已持久化的视频
 */
export function canComposeVideo(node: CanvasVideoCompositionNode, videoById: Map<string, CanvasVideoNode>): boolean {
    const inputIds = node.composition.inputVideoNodeIds;
    return inputIds.length >= 2
        && inputIds.length <= MAXIMUM_VIDEO_COMPOSITION_INPUT_COUNT
        && inputIds.every((inputId) => {
            const video = videoById.get(inputId);
            return Boolean(video && video.execution.phase === "succeeded" && video.content.storageKey?.trim());
        });
}

/**
 * 去除重复节点ID并保持原有顺序。
 *
 * @param values 原始节点ID列表
 * @return 去重后的节点ID列表
 */
function uniqueIds(values: string[]): string[] {
    const seen = new Set<string>();
    return values.filter((value) => {
        if (seen.has(value)) return false;
        seen.add(value);
        return true;
    });
}

/**
 * 比较两个节点ID列表是否完全一致。
 *
 * @param first 第一个节点ID列表
 * @param second 第二个节点ID列表
 * @return 是否顺序一致
 */
function sameIds(first: string[], second: string[]): boolean {
    return first.length === second.length && first.every((value, index) => value === second[index]);
}
