"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MiniMap,
  ControlButton,
  Controls,
  ConnectionMode,
  SelectionMode,
  BaseEdge,
  getBezierPath,
  Position,
  useReactFlow,
  useNodesInitialized,
  type Viewport,
  type Node,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type NodeTypes,
  type Connection,
  type OnNodeDrag,
  type OnConnectStart,
  type OnConnectEnd,
  type OnNodesChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Eye, EyeOff } from "lucide-react";

import type { CanvasBackgroundMode } from "@/shared/lib/canvas-theme";
import { CANVAS_CONNECTION_HANDLE_SIZE } from "../constants";
import { getCanvasControlStyleVars } from "./canvas-flow-theme";
import { useCanvasTheme } from "./canvas-theme-provider";

type CanvasFlowProps = {
  viewport?: Viewport;
  backgroundMode?: CanvasBackgroundMode;
  onViewportChange?: (viewport: Viewport) => void;
  nodes?: Node[];
  edges?: Edge[];
  onNodesChange?: OnNodesChange;
  onEdgesChange?: (changes: any[]) => void;
  onConnect?: (connection: Connection) => void;
  onConnectStart?: OnConnectStart;
  onConnectEnd?: OnConnectEnd;
  onSelectionChange?: (nodeIds: string[], edgeIds: string[]) => void;
  onNodeMouseDown?: (event: React.MouseEvent, nodeId: string) => void;
  onNodeClick?: (event: React.MouseEvent, nodeId: string) => void;
  onNodeDragStop?: (event: MouseEvent | TouchEvent, node: Node, nodes: Node[]) => void;
  onNodeContextMenu?: (event: React.MouseEvent, nodeId: string) => void;
  onSelectionContextMenu?: (event: React.MouseEvent, nodeIds: string[]) => void;
  onEdgeClick?: (event: React.MouseEvent, edgeId: string) => void;
  onEdgeContextMenu?: (event: React.MouseEvent, edgeId: string) => void;
  onPaneClick?: () => void;
  onPaneContextMenu?: (event: React.MouseEvent | MouseEvent) => void;
  nodeTypes?: NodeTypes;
  children?: ReactNode;
};

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 5;
const CANVAS_EDGE_STROKE_WIDTH = 2.5;
// 使用归一化路径长度，让每条连线始终显示三段光带。
const CANVAS_EDGE_FLOW_DASH = "0.08 0.2533 0.08 0.2533 0.08 0.2534";
const CANVAS_PAN_ON_DRAG = [0, 1, 2];
const CANVAS_SELECTION_KEY_CODES = ["Control", "Meta"];
const CANVAS_PRO_OPTIONS = { hideAttribution: true };
const CANVAS_MINIMAP_VISIBLE_STORAGE_KEY = "novanova:canvas:minimap_visible";
const CANVAS_CONNECTION_HANDLE_RADIUS = CANVAS_CONNECTION_HANDLE_SIZE / 2;

const canvasEdgeTypes: EdgeTypes = { canvasConnection: CanvasConnectionEdge };

function CanvasConnectionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  labelStyle,
  labelShowBg,
  labelBgStyle,
  labelBgPadding,
  labelBgBorderRadius,
  style,
  markerEnd,
  markerStart,
  pathOptions,
  interactionWidth,
}: EdgeProps) {
  const theme = useCanvasTheme();
  const source = moveConnectionAnchorToNodeEdge(sourceX, sourceY, sourcePosition);
  const target = moveConnectionAnchorToNodeEdge(targetX, targetY, targetPosition);
  const [path, labelX, labelY] = getBezierPath({
    sourceX: source.x,
    sourceY: source.y,
    targetX: target.x,
    targetY: target.y,
    sourcePosition,
    targetPosition,
    curvature: pathOptions?.curvature,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        labelX={labelX}
        labelY={labelY}
        label={label}
        labelStyle={labelStyle}
        labelShowBg={labelShowBg}
        labelBgStyle={labelBgStyle}
        labelBgPadding={labelBgPadding}
        labelBgBorderRadius={labelBgBorderRadius}
        className="canvas-edge-base"
        style={style}
        markerEnd={markerEnd}
        markerStart={markerStart}
        interactionWidth={interactionWidth}
      />
      <path
        d={path}
        pathLength={1}
        fill="none"
        stroke={theme.node.activeStroke}
        strokeWidth={CANVAS_EDGE_STROKE_WIDTH + 0.25}
        strokeLinecap="round"
        strokeDasharray={CANVAS_EDGE_FLOW_DASH}
        className="canvas-edge-flow"
        pointerEvents="none"
        aria-hidden="true"
      />
    </>
  );
}

/** React Flow 默认以连接点外缘作为线端；收回半径后线条贴合节点边缘。 */
function moveConnectionAnchorToNodeEdge(x: number, y: number, position: Position) {
  switch (position) {
    case Position.Left:
      return { x: x + CANVAS_CONNECTION_HANDLE_RADIUS, y };
    case Position.Right:
      return { x: x - CANVAS_CONNECTION_HANDLE_RADIUS, y };
    case Position.Top:
      return { x, y: y + CANVAS_CONNECTION_HANDLE_RADIUS };
    case Position.Bottom:
      return { x, y: y - CANVAS_CONNECTION_HANDLE_RADIUS };
  }
}

const canvasWheelIgnoreSelector =
  "[data-canvas-no-zoom],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown,input,textarea,select,[contenteditable='true']";

function readCanvasMiniMapVisible() {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(CANVAS_MINIMAP_VISIBLE_STORAGE_KEY);
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

function saveCanvasMiniMapVisible(visible: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CANVAS_MINIMAP_VISIBLE_STORAGE_KEY, String(visible));
  } catch {
    // 本地存储不可用时，仅保留当前会话中的显示状态。
  }
}

export function CanvasFlow({
  viewport = { x: 0, y: 0, zoom: 1 },
  backgroundMode = "dots",
  onViewportChange,
  nodes = [],
  edges = [],
  onNodesChange,
  onEdgesChange,
  onConnect,
  onConnectStart,
  onConnectEnd,
  onSelectionChange,
  onNodeMouseDown,
  onNodeClick,
  onNodeDragStop,
  onNodeContextMenu,
  onSelectionContextMenu,
  onEdgeClick,
  onEdgeContextMenu,
  onPaneClick,
  onPaneContextMenu,
  nodeTypes,
  children,
}: CanvasFlowProps) {
  const theme = useCanvasTheme();
  const controlStyles = getCanvasControlStyleVars(theme);
  const edgeStroke = theme.node.stroke;
  const canvasEdgeStyle = { stroke: edgeStroke, strokeWidth: CANVAS_EDGE_STROKE_WIDTH };
  const defaultEdgeOptions = { style: canvasEdgeStyle };
  const wrapperRef = useRef<HTMLDivElement>(null);
  const initialNodesRef = useRef(nodes);
  const initialEdgesRef = useRef(edges);
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [nodesReadyForSelection, setNodesReadyForSelection] = useState(false);
  const rectangleSelectionInProgressRef = useRef(false);
  const pendingSelectionRef = useRef<{ nodeIds: string[]; edgeIds: string[] } | null>(null);

  const handleViewportChange = useCallback(
    (viewport: Viewport) => {
      onViewportChange?.(viewport);
    },
    [onViewportChange],
  );

  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }: { nodes: Node[]; edges: Edge[] }) => {
      const selection = {
        nodeIds: selectedNodes.map((node) => node.id),
        edgeIds: selectedEdges.map((edge) => edge.id),
      };
      if (rectangleSelectionInProgressRef.current) {
        pendingSelectionRef.current = selection;
        return;
      }
      onSelectionChange?.(selection.nodeIds, selection.edgeIds);
    },
    [onSelectionChange],
  );

  const handleSelectionStart = useCallback(() => {
    rectangleSelectionInProgressRef.current = true;
    pendingSelectionRef.current = null;
  }, []);

  const handleSelectionEnd = useCallback(() => {
    rectangleSelectionInProgressRef.current = false;
    const selection = pendingSelectionRef.current;
    pendingSelectionRef.current = null;
    if (selection) onSelectionChange?.(selection.nodeIds, selection.edgeIds);
  }, [onSelectionChange]);

  const handleNodesInitializedChange = useCallback((nodesInitialized: boolean) => {
    setNodesReadyForSelection((current) => (current === nodesInitialized ? current : nodesInitialized));
  }, []);

  const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      onNodeContextMenu?.(event, node.id);
    },
    [onNodeContextMenu],
  );

  const handleSelectionContextMenu = useCallback(
    (event: React.MouseEvent, selectedNodes: Node[]) => {
      event.preventDefault();
      event.stopPropagation();
      onSelectionContextMenu?.(event, selectedNodes.map((node) => node.id));
    },
    [onSelectionContextMenu],
  );

  const handleEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.preventDefault();
      onEdgeContextMenu?.(event, edge.id);
    },
    [onEdgeContextMenu],
  );

  const handleEdgeClick = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.stopPropagation();
      onEdgeClick?.(event, edge.id);
    },
    [onEdgeClick],
  );

  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      onNodeClick?.(event, node.id);
    },
    [onNodeClick],
  );

  const handleNodeMouseDownCapture = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!event.ctrlKey || !event.shiftKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const nodeElement = target?.closest(".react-flow__node");
      const nodeId = nodeElement?.getAttribute("data-id");
      if (!nodeId) return;

      event.preventDefault();
      event.stopPropagation();
      onNodeMouseDown?.(event, nodeId);
    },
    [onNodeMouseDown],
  );

  const handlePaneClick = useCallback(() => {
    onPaneClick?.();
  }, [onPaneClick]);

  const handlePaneContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      event.preventDefault();
      onPaneContextMenu?.(event);
    },
    [onPaneContextMenu],
  );

  const handleToggleMiniMap = useCallback(() => {
    setShowMiniMap((current) => {
      const next = !current;
      saveCanvasMiniMapVisible(next);
      return next;
    });
  }, []);

  const handleNodeDragStop = useCallback<OnNodeDrag>(
    (event, node, nodes) => {
      onNodeDragStop?.(event, node, nodes);
    },
    [onNodeDragStop],
  );

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const preventWheel = (e: WheelEvent) => {
      const target = e.target as Element | null;
      if (target?.closest(canvasWheelIgnoreSelector)) {
        e.stopPropagation();
        e.preventDefault();
      }
    };
    el.addEventListener("wheel", preventWheel, { passive: false, capture: true } as AddEventListenerOptions);
    return () => el.removeEventListener("wheel", preventWheel, { capture: true } as EventListenerOptions);
  }, []);

  useEffect(() => {
    setShowMiniMap(readCanvasMiniMapVisible());
  }, []);

  return (
    <div
      ref={wrapperRef}
      className="h-full w-full"
      style={{ background: theme.canvas.backgroundGradient, "--canvas-edge-stroke": edgeStroke } as CSSProperties}
      onMouseDownCapture={handleNodeMouseDownCapture}
    >
      <ReactFlow
        viewport={viewport}
        defaultNodes={initialNodesRef.current}
        defaultEdges={initialEdgesRef.current}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        defaultEdgeOptions={defaultEdgeOptions}
        connectionLineStyle={canvasEdgeStyle}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        connectionMode={ConnectionMode.Loose}
        onViewportChange={handleViewportChange}
        onSelectionChange={handleSelectionChange}
        onSelectionStart={handleSelectionStart}
        onSelectionEnd={handleSelectionEnd}
        onNodeClick={handleNodeClick}
        onNodeContextMenu={handleNodeContextMenu}
        onSelectionContextMenu={handleSelectionContextMenu}
        onEdgeClick={handleEdgeClick}
        onEdgeContextMenu={handleEdgeContextMenu}
        onPaneClick={handlePaneClick}
        onPaneContextMenu={handlePaneContextMenu}
        onNodeDragStop={handleNodeDragStop}
        nodeTypes={nodeTypes}
        edgeTypes={canvasEdgeTypes}
        fitView={false}
        nodesDraggable={true}
        nodesConnectable={true}
        connectionRadius={30}
        elementsSelectable={nodesReadyForSelection}
        panOnDrag={CANVAS_PAN_ON_DRAG}
        selectionKeyCode={CANVAS_SELECTION_KEY_CODES}
        selectionMode={SelectionMode.Partial}
        zoomOnScroll={true}
        zoomOnDoubleClick={false}
        proOptions={CANVAS_PRO_OPTIONS}
      >
        <CanvasFlowGraphSync nodes={nodes} edges={edges} onNodesInitializedChange={handleNodesInitializedChange} />
        {backgroundMode !== "blank" ? (
          <Background variant={BackgroundVariant.Dots} color={theme.canvas.dot} gap={24} size={1.5} />
        ) : null}
        {showMiniMap ? (
          <MiniMap
            style={{ background: theme.canvas.background }}
            maskColor={`${theme.canvas.background}99`}
            nodeColor={theme.node.fill}
            nodeStrokeColor={theme.node.stroke}
          />
        ) : null}
        <Controls style={controlStyles}>
          <ControlButton
            onClick={handleToggleMiniMap}
            title={showMiniMap ? "隐藏小地图" : "显示小地图"}
            aria-label={showMiniMap ? "隐藏小地图" : "显示小地图"}
          >
            {showMiniMap ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </ControlButton>
        </Controls>
        {children}
      </ReactFlow>
    </div>
  );
}

function CanvasFlowGraphSync({ nodes, edges, onNodesInitializedChange }: { nodes: Node[]; edges: Edge[]; onNodesInitializedChange: (nodesInitialized: boolean) => void }) {
  const { setNodes, setEdges } = useReactFlow();
  const nodesInitialized = useNodesInitialized();

  useEffect(() => {
    onNodesInitializedChange(nodesInitialized);
  }, [nodesInitialized, onNodesInitializedChange]);

  useEffect(() => {
    setNodes(nodes);
  }, [nodes, setNodes]);

  useEffect(() => {
    setEdges(edges);
  }, [edges, setEdges]);

  return null;
}
