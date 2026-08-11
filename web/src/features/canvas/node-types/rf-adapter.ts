import { type Node, type NodeChange, type NodePositionChange, type NodeRemoveChange, type Edge, type EdgeChange, type EdgeRemoveChange, type XYPosition, type Connection } from "@xyflow/react";
import type { CanvasNode, CanvasConnection } from "../types";
import { nanoid } from "nanoid";
import { updateCanvasNodeFrame } from "../domain/canvas-node.ts";
import { readVideoCompositionConnectionError } from "../domain/video-composition";

const canvasEdgeStyle = { stroke: "var(--canvas-edge-stroke)", strokeWidth: 4 };
type NodePositionChangeWithPosition = NodePositionChange & { position: XYPosition };

/**
 * 将 CanvasNode[] 转换为 React Flow Node[]
 */
export function toRFNodes(nodes: CanvasNode[], selectedIds?: Set<string>, hiddenIds?: Set<string>): Node<CanvasNode>[] {
  return nodes.map((n) => {
    const selected = selectedIds?.has(n.id) ?? false;
    return {
      id: n.id,
      type: n.kind,
      position: { x: n.frame.position.x, y: n.frame.position.y } as XYPosition,
      data: n,
      style: { width: n.frame.width, height: n.frame.height },
      selected,
      hidden: hiddenIds?.has(n.id) ?? false,
    };
  });
}

/**
 * 将 CanvasConnection[] 转换为 React Flow Edge[]
 * 自动过滤掉源/目标节点不存在的孤立边
 */
export function toRFEdges(connections: CanvasConnection[], nodeIds: Set<string>, hiddenNodeIds?: Set<string>): Edge[] {
  return connections
    .filter((c) => nodeIds.has(c.source.nodeId) && nodeIds.has(c.target.nodeId))
    .map((c) => ({
      id: c.id,
      source: c.source.nodeId,
      target: c.target.nodeId,
      sourceHandle: c.source.portId,
      targetHandle: c.target.portId,
      type: "canvasConnection",
      animated: false,
      hidden: Boolean(hiddenNodeIds?.has(c.source.nodeId) || hiddenNodeIds?.has(c.target.nodeId)),
      style: canvasEdgeStyle,
    }));
}

/** 检查连线是否已存在 */
export function connectionExists(connections: CanvasConnection[], source: string, target: string): boolean {
  return connections.some((c) => c.source.nodeId === source && c.target.nodeId === target);
}

/**
 * 创建节点变更处理器
 */
export function createNodesChangeHandler(
  setNodes: (updater: CanvasNode[] | ((prev: CanvasNode[]) => CanvasNode[])) => void,
  onRemoveNodes?: (nodeIds: Set<string>) => void,
) {
  let rafId: number | null = null;
  const pendingPos = new Map<string, XYPosition>();
  const pendingRemove = new Set<string>();

  return (changes: NodeChange<Node>[]) => {
    const positionChanges = changes.filter(isCommittedPositionChange);
    const removeChanges = changes.filter(isNodeRemoveChange);

    for (const change of positionChanges) pendingPos.set(change.id, change.position);
    for (const change of removeChanges) pendingRemove.add(change.id);
    if (pendingPos.size === 0 && pendingRemove.size === 0) return;

    if (rafId !== null) return; // 已有待处理的 rAF
    rafId = requestAnimationFrame(() => {
      rafId = null;
      const pos = new Map(pendingPos);
      const remove = new Set(pendingRemove);
      pendingPos.clear();
      pendingRemove.clear();

      if (remove.size) onRemoveNodes?.(remove);

      setNodes((prev) => {
        let changed = false;
        let next = remove.size > 0 ? prev.filter((n) => !remove.has(n.id)) : prev;
        if (next.length !== prev.length) changed = true;
        if (pos.size > 0) {
          next = next.map((n) => {
            const p = pos.get(n.id);
            if (!p || (n.frame.position.x === p.x && n.frame.position.y === p.y)) return n;
            changed = true;
            return updateCanvasNodeFrame(n, { position: { x: p.x, y: p.y } });
          });
        }
        return changed ? next : prev;
      });
    });
  };
}

function isPositionChangeWithPosition(change: NodeChange<Node>): change is NodePositionChangeWithPosition {
  return change.type === "position" && Boolean(change.position);
}

function isCommittedPositionChange(change: NodeChange<Node>): change is NodePositionChangeWithPosition {
  return isPositionChangeWithPosition(change) && change.dragging === false;
}

function isNodeRemoveChange(change: NodeChange<Node>): change is NodeRemoveChange {
  return change.type === "remove";
}

/**
 * 创建连线变更处理器
 */
export function createEdgesChangeHandler(
  setConnections: (updater: CanvasConnection[] | ((prev: CanvasConnection[]) => CanvasConnection[])) => void,
) {
  return (changes: EdgeChange<Edge>[]) => {
    const removeIds = new Set(changes.filter(isEdgeRemoveChange).map((change) => change.id));
    if (removeIds.size === 0) return;
    setConnections((prev) => prev.filter((connection) => !removeIds.has(connection.id)));
  };
}

function isEdgeRemoveChange(change: EdgeChange<Edge>): change is EdgeRemoveChange {
  return change.type === "remove";
}

/**
 * 创建 onConnect 处理器（拖拽连线创建新连接）
 */
export function createConnectHandler(
  setConnections: (updater: CanvasConnection[] | ((prev: CanvasConnection[]) => CanvasConnection[])) => void,
  connectionsRef: { current: CanvasConnection[] },
  nodesRef: { current: CanvasNode[] },
  onRejected?: (message: string) => void,
) {
  return (connection: Connection) => {
    if (!connection.source || !connection.target) return;
    if (connection.source === connection.target) return;
    const errorMessage = readVideoCompositionConnectionError(connection.source, connection.target, nodesRef.current, connectionsRef.current);
    if (errorMessage) {
      onRejected?.(errorMessage);
      return;
    }
    if (connectionExists(connectionsRef.current, connection.source, connection.target)) return;
    const newConn: CanvasConnection = {
      id: nanoid(),
      source: { nodeId: connection.source, portId: connection.sourceHandle },
      target: { nodeId: connection.target, portId: connection.targetHandle },
    };
    setConnections((prev) => [...prev, newConn]);
  };
}
