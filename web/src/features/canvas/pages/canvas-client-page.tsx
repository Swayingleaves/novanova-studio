"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent as ReactChangeEvent, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { saveAs } from "file-saver";

import { requestEdit, requestGeneration, requestImageQuestion } from "@/features/generation/api/image";
import { requestVideoGeneration, storeGeneratedVideo } from "@/features/generation/api/video";
import { composeStoryboardPrompts, createStoryboardAssetImageTask, generateStoryboard, readStoryboardAssetImage } from "@/services/api/storyboard";
import { cancelAiTask, createAiTask, getAiTaskInfo, readAiTaskError, subscribeAiTaskDeltas, waitAiTask, type AiTaskErrorDetails, type GenerationStyleSnapshot, type SkillOption } from "@/services/api/server";
import { cancelCompositionTask, composeVideo, waitVideoCompositionTask, type VideoCompositionTask } from "@/services/api/video-composition";
import { usePromptOptimization } from "@/features/generation/hooks/use-prompt-optimization";
import { normalizeImageGenerationCount } from "@/features/generation/components/image-settings-panel";
import { normalizeVideoGenerationCount } from "@/features/generation/components/video-settings-panel";
import { quoteVideoGeneration } from "@/features/generation/lib/video-billing";
import { defaultConfig, normalizeModelOptionValue, type AiConfig, useConfigStore, useEffectiveConfig } from "@/features/settings/stores/use-config-store";
import { getImageBlob, resolveImageUrl, reuseOrUploadImage, uploadImage, type UploadedImage } from "@/features/storage/services/image-storage";
import { getMediaBlob, resolveMediaUrl, uploadMediaFile, type UploadedFile } from "@/features/storage/services/file-storage";
import { uploadObjectToStorage } from "@/features/storage/services/object-storage";
import { findMissingReferenceObjectStorageImages, uploadMissingReferenceImagesToObjectStorage } from "@/features/storage/services/reference-object-storage";
import { nanoid } from "nanoid";
import { getDataUrlByteSize } from "@/features/generation/lib/image-utils";
import { canvasThemes, type CanvasBackgroundMode } from "@/shared/lib/canvas-theme";
import { useThemeStore } from "@/features/theme/stores/use-theme-store";
import { AssetPreviewDialog } from "@/features/assets/components/asset-preview-dialog";
import { downloadAsset } from "@/features/assets/lib/asset-download";
import { useAssetStore } from "@/features/assets/stores/use-asset-store";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { cropDataUrl, splitDataUrl } from "../utils/canvas-image-data";
import { fitNodeSize, nodeSizeFromRatio } from "../utils/canvas-node-size";
import { App } from "antd";
import type { OnConnectEnd, OnConnectStartParams } from "@xyflow/react";
import { getCanvasNodeTemplate } from "../constants";
import {
    applyCanvasNodeAttributes,
    isBackgroundNode,
    isImageNode,
    isStoryboardNode,
    isTextNode,
    isVideoCompositionNode,
    isVideoNode,
    updateCanvasNodeExecution,
    updateCanvasNodeFrame,
    updateCanvasNodeTitle,
    updateStoryboardNodeContent,
    updateStoryboardNodeData,
    type CanvasNodeAttributes,
} from "../domain/canvas-node";
import {
    applyCanvasNodeConfig,
    applyGeneratedImageToBatchNodes,
    createCanvasConnection,
    findCanvasConnectionDropTarget,
    findNonOverlappingCanvasNodePosition,
    moveCanvasNodesFromOrigins,
    expandBackgroundBoardsToMembers,
    reconcileBackgroundBoardMembership,
    normalizeBackgroundBoardMembers,
    normalizeCanvasConnection,
    readCanvasNodePrompt,
    resetInterruptedCanvasNodes,
    selectCanvasNodesInRectangle,
    synchronizeImageBatchRootExecution,
    updateCanvasNodeSelection,
} from "../domain/canvas-page-node";
import { canComposeVideo, readVideoCompositionConnectionError, synchronizeVideoCompositionInputs } from "../domain/video-composition";
import { ActiveConnectionPath, ConnectionPath } from "../components/canvas-connections";
import { CanvasChatPanel } from "../components/canvas-chat-panel";
import type { CanvasImageCropRect } from "../components/canvas-node-crop-dialog";
import { CanvasThemeProvider, useCanvasTheme } from "../components/canvas-theme-provider";
import type { CanvasImageSplitParams } from "../components/canvas-node-split-dialog";
import { buildNodeGenerationContext, buildNodeResponseMessages, hasNodeGenerationInputs, hydrateNodeGenerationContext, resolveNodeGenerationPrompt } from "../components/canvas-node-generation";
import { CanvasNodeHoverToolbar } from "../components/canvas-node-hover-toolbar";
import { CanvasNavigationPanel, CanvasStoryboardAssetPreviewDialog, type CanvasNavigationAsset, type CanvasNavigationPanelState, type CanvasNavigationTab } from "../components/canvas-navigation-panel";
import { CanvasFlow } from "../components/canvas-flow";
import { StoryboardWorkspace } from "../components/storyboard-workspace";
import { StoryboardVideoGenerationModal, type StoryboardVideoGenerationSettings } from "../components/storyboard-video-generation-modal";
import { nodeTypes } from "../node-types";
import { NodeActionProvider, type BatchImagePreview, type NodeActions } from "../node-types/node-action-context";
import { toRFNodes, toRFEdges, createNodesChangeHandler, createEdgesChangeHandler, createConnectHandler } from "../node-types/rf-adapter";
import { CanvasNodePromptPanel, type CanvasNodeGenerationMode } from "../components/canvas-node-prompt-panel";
import { CanvasToolbar } from "../components/canvas-toolbar";
import { CanvasTopBar } from "../components/canvas-top-bar";
import { CanvasWorkspaceOverlays } from "../components/canvas-workspace-overlays";
import type { InsertAssetPayload } from "@/features/assets/components/asset-picker-modal";
import { useAgentSSE } from "../hooks/use-agent-sse";
import { useAgentThinking } from "@/features/chat/use-agent-thinking";
import { useAssistantMessageStream } from "../hooks/use-assistant-message-stream";
import { useCanvasKeyboardShortcuts } from "../hooks/canvas-keyboard-shortcuts";
import { useCanvasViewportGeometry } from "../hooks/canvas-viewport-geometry";
import { useCanvasGenerationRequests } from "../hooks/use-canvas-generation-requests";
import {
    buildAgentChatHistory,
    CanvasLoadingShell,
    type CanvasClipboard,
    type CanvasHistoryEntry,
    ConnectionCreateMenu,
    createCanvasNode,
    type ConnectionDropTarget,
    type EdgeDeletePopover,
    isHiddenBatchChild,
    PendingConnectionLine,
    type PendingConnectionCreate,
    type PendingConnectionCreateNodeType,
} from "./canvas-client-page-helpers";
import { useCanvasStore } from "../stores/use-canvas-store";
import { readCanvasSystemClipboard } from "../services/canvas-system-clipboard";
import { saveCanvasLastUsedGenerationSettings } from "../services/canvas-last-used-generation-settings";
import { clearInitialPromptFromLocation, readInitialPromptFromLocation } from "@/shared/lib/initial-prompt";
import { useCopyText } from "@/shared/hooks/use-copy-text";
import { applyCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "../utils/canvas-agent-ops";
import { positionCanvasAgentAddNodeOps, type CanvasAgentToolResult } from "../utils/canvas-agent-tools";
import { buildCanvasResourceReferences, buildNodeMentionReferences, getGenerationResourceNodes } from "../utils/canvas-resource-references";
import {
    createStoryboardAssetGenerationState,
    readStoryboardAssetGenerationProgress,
    readStoryboardAssetImageCost,
    readStoryboardModelCost,
    readStoryboardShotReferenceImages,
    readStoryboardVideoCost,
    readStoryboardVideoGenerationMode,
    readStoryboardVideoReferenceIssue,
    readStoryboardVideoShotIssue,
    STORYBOARD_SHOT_SIZES,
} from "../domain/storyboard";
import {
    type CanvasAssistantImage,
    type CanvasBackgroundNode,
    type CanvasAssistantMessage,
    type CanvasAssistantSession,
    type CanvasConnection,
    type CanvasGenerationMode,
    type CanvasImageGenerationSettings,
    type CanvasImageGenerationType,
    type CanvasImageNode,
    type CanvasSettingGraphSkillSnapshot,
    type CanvasNode as CanvasDomainNode,
    type CanvasNodeKind,
    type CanvasStoryboardAsset,
    type CanvasStoryboardNode,
    type CanvasStoryboardShot,
    type CanvasStoryboardAssetGenerationSettings,
    type CanvasStoryboardAssetGenerationState,
    type CanvasTextNode,
    type CanvasVideoCompositionNode,
    type CanvasVideoGenerationSettings,
    type CanvasVideoNode,
    type ConnectionHandle,
    type ContextMenuState,
    type CanvasPoint,
    type SelectionBox,
    type CanvasViewTransform,
} from "../types";
import type { ReferenceImage } from "@/features/generation/types/image";
import type { ReferenceVideo } from "@/features/generation/types/media";
import type { ObjectStorageFile } from "@/shared/types/object-storage";

const VIDEO_NODE_MAX_WIDTH = 630;
const VIDEO_NODE_MAX_HEIGHT = 630;
const CONNECTION_HANDLE_HIT_RADIUS = 40;

type CanvasNodeGenerationFailure = {
    nodeId: string;
    error: AiTaskErrorDetails;
};

type CanvasNodeGenerationOutcome = {
    nodeId: string;
    error?: AiTaskErrorDetails;
    canceled?: boolean;
};
const CONNECTION_NODE_HIT_PADDING = 32;
const PROMPT_PANEL_WIDTH = 580;
const PROMPT_PANEL_HEIGHT = 196;
const PROMPT_PANEL_GAP = 16;
const IMAGE_GENERATION_NODE_WIDTH = 480;
const IMAGE_GENERATION_NODE_HEIGHT = 330;
const PROMPT_PANEL_INTERACTION_IGNORE_SELECTOR = '[data-canvas-prompt-panel],[data-canvas-settings-popover],[data-slot="select-content"],.react-flow__node,.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown';
const NODE_STATUS_IDLE = "idle" as const;
const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_SUCCESS = "success" as const;
const NODE_STATUS_ERROR = "error" as const;
/** 引用生成节点与源节点之间的统一画布间距。 */
const CONNECTED_NODE_GAP = 144;

export default function CanvasPage() {
    const [mounted, setMounted] = useState(false);
    const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
    const theme = canvasThemes[resolvedTheme];

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) {
        return (
            <CanvasThemeProvider theme={theme}>
                <CanvasLoadingShell />
            </CanvasThemeProvider>
        );
    }

    return (
        <CanvasThemeProvider theme={theme}>
            <CanvasWorkspacePage />
        </CanvasThemeProvider>
    );
}

function CanvasWorkspacePage() {
    const { message, modal } = App.useApp();
    const copyText = useCopyText();
    const { optimizingOperationId: promptGeneratingNodeId, optimizePrompt } = usePromptOptimization();
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const projectId = params.id;
    const containerRef = useRef<HTMLDivElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const uploadTargetRef = useRef<{ nodeId?: string; position?: CanvasPoint } | null>(null);
    const clipboardRef = useRef<CanvasClipboard | null>(null);
    const historyRef = useRef<{ past: CanvasHistoryEntry[]; future: CanvasHistoryEntry[] }>({ past: [], future: [] });
    const lastHistoryRef = useRef<CanvasHistoryEntry | null>(null);
    const historyCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const applyingHistoryRef = useRef(false);
    const historyPausedRef = useRef(false);
    const rafRef = useRef<number | null>(null);
    const toolbarHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const nodeDraggingRef = useRef(false);
    const dragRef = useRef<{
        isDraggingNode: boolean;
        hasMoved: boolean;
        clickedNodeId: string | null;
        startX: number;
        startY: number;
        initialSelectedNodes: { id: string; x: number; y: number }[];
        originalBackgroundMemberNodeIds: string[];
    }>({
        isDraggingNode: false,
        hasMoved: false,
        clickedNodeId: null,
        startX: 0,
        startY: 0,
        initialSelectedNodes: [],
        originalBackgroundMemberNodeIds: [],
    });
    const backgroundDragRef = useRef<{ boardId: string; originX: number; originY: number; memberOrigins: Array<{ id: string; x: number; y: number }> } | null>(null);

    const onNodeDropRef = useRef<((nodeId: string) => void) | null>(null);
    const panelRectRef = useRef<DOMRect | null>(null);

    const handlePanelRectChange = useCallback((rect: DOMRect | null) => {
        panelRectRef.current = rect;
    }, []);

    type AgentDropState = {
        isActive: boolean;
        nodeId: string | null;
        startX: number;
        startY: number;
    };

    const agentDropRef = useRef<AgentDropState>({ isActive: false, nodeId: null, startX: 0, startY: 0 });
    const agentDropPreviewRef = useRef<HTMLDivElement | null>(null);

    const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

    const createAgentDropPreview = useCallback((nodeId: string, clientX: number, clientY: number) => {
        removeAgentDropPreview();
        const node = nodesRef.current.find((n) => n.id === nodeId);
        if (!node) return;

        const el = document.createElement("div");
        el.style.cssText =
            "position:fixed;pointer-events:none;z-index:9999;opacity:0.75;transform:translate(-50%,-50%);border-radius:12px;overflow:hidden;width:64px;height:64px;display:flex;align-items:center;justify-content:center;background:var(--studio-panel);backdrop-filter:blur(4px);border:1px solid var(--studio-line);box-shadow:var(--studio-shadow);";
        el.style.left = `${clientX}px`;
        el.style.top = `${clientY}px`;

        if (isImageNode(node) && node.content.source) {
            const img = document.createElement("img");
            img.src = node.content.source;
            img.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:11px;";
            el.appendChild(img);
        } else {
            const typeIcon = isVideoNode(node) ? "\u{1F3AC}" : "\u{1F4C4}";
            el.innerHTML = `<span style="color:var(--studio-ink);font-size:11px;text-align:center;line-height:1.2;padding:4px;">${typeIcon}<br/>${esc(node.title.slice(0, 6))}</span>`;
        }

        document.body.appendChild(el);
        agentDropPreviewRef.current = el;
    }, []);

    const updateAgentDropPreview = useCallback((clientX: number, clientY: number) => {
        const el = agentDropPreviewRef.current;
        if (!el) return;
        el.style.left = `${clientX}px`;
        el.style.top = `${clientY}px`;
    }, []);

    const removeAgentDropPreview = useCallback(() => {
        if (agentDropPreviewRef.current) {
            agentDropPreviewRef.current.remove();
            agentDropPreviewRef.current = null;
        }
    }, []);

    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const userRole = useUserStore((state) => state.user?.role);
    const creditBalance = useUserStore((state) => state.user?.creditBalance);
    const setCreditBalance = useUserStore((state) => state.setCreditBalance);
    const showMissingAiConfig = useCallback(
        (mode: CanvasNodeGenerationMode) => {
            if (userRole === "admin") {
                openConfigDialog(true);
                return;
            }
            const label = mode === "image" ? "生图" : mode === "video" ? "生视频" : "文本";
            message.error(`请联系管理员配置默认${label}模型`);
        },
        [message, openConfigDialog, userRole],
    );
    const addAsset = useAssetStore((state) => state.addAsset);
    const assets = useAssetStore((state) => state.assets);
    const cleanupAssetImages = useAssetStore((state) => state.cleanupImages);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const findDocument = useCanvasStore((state) => state.findDocument);
    const replaceScene = useCanvasStore((state) => state.replaceScene);
    const replaceConversation = useCanvasStore((state) => state.replaceConversation);
    const updatePreferences = useCanvasStore((state) => state.updatePreferences);
    const renameDocument = useCanvasStore((state) => state.renameDocument);
    const currentDocument = useCanvasStore((state) => state.documents.find((document) => document.identity.id === projectId));
    const theme = useCanvasTheme();
    const [nodes, setNodes] = useState<CanvasDomainNode[]>([]);
    const [connections, setConnections] = useState<CanvasConnection[]>([]);
    const [chatSessions, setChatSessions] = useState<CanvasAssistantSession[]>([]);
    const [activeChatId, setActiveChatId] = useState<string | null>(null);
    const [viewport, setViewport] = useState<CanvasViewTransform>({ x: 0, y: 0, k: 1 });
    const { size, screenToCanvas, getCanvasCenter } = useCanvasViewportGeometry(containerRef, viewport, setViewport);
    const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
    const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
    const [edgeDeletePopover, setEdgeDeletePopover] = useState<EdgeDeletePopover | null>(null);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [connectingParams, setConnectingParams] = useState<ConnectionHandle | null>(null);
    const [connectionTargetNodeId, setConnectionTargetNodeId] = useState<string | null>(null);
    const [pendingConnectionCreate, setPendingConnectionCreate] = useState<PendingConnectionCreate | null>(null);
    const [mouseWorld, setMouseWorld] = useState<CanvasPoint>({ x: 0, y: 0 });
    const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [runningNodeId, setRunningNodeId] = useState<string | null>(null);
    const [backgroundMode, setBackgroundMode] = useState<CanvasBackgroundMode>("dots");
    const [showImageInfo, setShowImageInfo] = useState(false);
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [canvasAssetPickerOpen, setCanvasAssetPickerOpen] = useState(false);
    const [canvasAssetReplaceNodeId, setCanvasAssetReplaceNodeId] = useState<string | null>(null);
    const [navigationPanelState, setNavigationPanelState] = useState<CanvasNavigationPanelState | "hidden">("expanded");
    const [navigationPanelTab, setNavigationPanelTab] = useState<CanvasNavigationTab>("nodes");
    const [previewAsset, setPreviewAsset] = useState<CanvasNavigationAsset | null>(null);
    const [projectLoaded, setProjectLoaded] = useState(false);
    const [toolbarNodeId, setToolbarNodeId] = useState<string | null>(null);
    const [nodeImageSettingsOpen, setNodeImageSettingsOpen] = useState(false);
    const [dialogNodeId, setDialogNodeId] = useState<string | null>(null);
    const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
    const [editRequestNonce, setEditRequestNonce] = useState(0);
    const [infoNodeId, setInfoNodeId] = useState<string | null>(null);
    const [cropNodeId, setCropNodeId] = useState<string | null>(null);
    const [croppingNodeId, setCroppingNodeId] = useState<string | null>(null);
    const [splitNodeId, setSplitNodeId] = useState<string | null>(null);
    const [splittingNodeId, setSplittingNodeId] = useState<string | null>(null);
    const [previewNodeId, setPreviewNodeId] = useState<string | null>(null);
    const [assistantMounted, setAssistantMounted] = useState(false);
    const [initialPrompt, setInitialPrompt] = useState("");
    const initialPromptHandledRef = useRef(false);
    const [agentUndoSnapshot, setAgentUndoSnapshot] = useState<CanvasAgentSnapshot | null>(null);
    const [agentRunning, setAgentRunning] = useState(false);
    const [agentQueued, setAgentQueued] = useState(false);
    const { completedThinkings, activeThinking, onThoughtDelta, onThoughtComplete, resetThinkings } = useAgentThinking();
    const [titleEditing, setTitleEditing] = useState(false);
    const [titleDraft, setTitleDraft] = useState("");
    const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
    const [collapsingBatchIds, setCollapsingBatchIds] = useState<Set<string>>(new Set());
    const [openingBatchIds, setOpeningBatchIds] = useState<Set<string>>(new Set());
    const batchTransitionIdsRef = useRef<Set<string>>(new Set());
    const [isNodeDragging, setIsNodeDragging] = useState(false);
    const [storyboardWorkspaceNodeId, setStoryboardWorkspaceNodeId] = useState<string | null>(null);
    const [storyboardVideoGenerationNodeId, setStoryboardVideoGenerationNodeId] = useState<string | null>(null);
    const [generatingStoryboardVideoNodeId, setGeneratingStoryboardVideoNodeId] = useState<string | null>(null);
    const [composingStoryboardNodeId, setComposingStoryboardNodeId] = useState<string | null>(null);
    const [composingStoryboardShot, setComposingStoryboardShot] = useState<{ nodeId: string; shotId: string } | null>(null);
    const previewLibraryAsset = previewAsset?.source === "library" ? previewAsset.asset : null;
    const previewStoryboardAsset = previewAsset?.source === "storyboard" ? previewAsset : null;

    useEffect(() => {
        resetThinkings();
    }, [activeChatId, resetThinkings]);

    useEffect(() => {
        setInitialPrompt(readInitialPromptFromLocation());
    }, []);
    useEffect(() => {
        setNavigationPanelState("expanded");
        setNavigationPanelTab("nodes");
        setPreviewAsset(null);
    }, [projectId]);
    const { start: startGenerationRequest, finish: finishGenerationRequest, stopByRunningId: stopRegisteredGenerationRequests, isRunning: isGenerationRunning } = useCanvasGenerationRequests();

    const nodesRef = useRef(nodes);
    const connectionsRef = useRef(connections);
    const selectedNodeIdsRef = useRef(selectedNodeIds);
    const viewportRef = useRef(viewport);
    const generateNodeRef = useRef<
        ((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string, recovery: boolean, signal?: AbortSignal, styleContext?: { ids?: number[]; snapshots?: GenerationStyleSnapshot[] }) => Promise<CanvasAgentToolResult>) | null
    >(null);
    const retryNodeRef = useRef<((node: CanvasDomainNode, signal?: AbortSignal) => Promise<CanvasAgentToolResult>) | null>(null);
    const connectingParamsRef = useRef(connectingParams);
    const connectionTargetNodeIdRef = useRef(connectionTargetNodeId);
    const selectionBoxRef = useRef(selectionBox);
    const pendingConnectionCreateRef = useRef(pendingConnectionCreate);
    const reactFlowConnectionStartRef = useRef<ConnectionHandle | null>(null);
    const pendingFocusNodeIdsRef = useRef<string[]>([]);
    const activeAgentAssistantMessageIdRef = useRef<string | null>(null);
    const activeAgentSessionIdRef = useRef<string | null>(null);
    const compositionPollControllersRef = useRef<Map<string, AbortController>>(new Map());
    const compositionSubmittingNodeIdsRef = useRef<Set<string>>(new Set());

    const applyVideoCompositionTask = useCallback((compositionNodeId: string, resultVideoNodeId: string | undefined, task: VideoCompositionTask) => {
        setNodes((currentNodes) => applyVideoCompositionTaskToNodes(currentNodes, compositionNodeId, resultVideoNodeId, task));
    }, []);

    const monitorVideoCompositionTask = useCallback(
        (compositionNodeId: string, resultVideoNodeId: string | undefined, taskId: string) => {
            compositionPollControllersRef.current.get(taskId)?.abort();
            const controller = new AbortController();
            compositionPollControllersRef.current.set(taskId, controller);
            void waitVideoCompositionTask(taskId, {
                signal: controller.signal,
                onProgress: (task) => applyVideoCompositionTask(compositionNodeId, resultVideoNodeId, task),
            })
                .then((task) => applyVideoCompositionTask(compositionNodeId, resultVideoNodeId, task))
                .catch((error) => {
                    if (isVideoCompositionPollingCanceled(error)) return;
                    setNodes((currentNodes) => markVideoCompositionTaskFailed(currentNodes, compositionNodeId, resultVideoNodeId, error instanceof Error ? error.message : "查询视频合成任务失败", taskId));
                })
                .finally(() => {
                    if (compositionPollControllersRef.current.get(taskId) === controller) compositionPollControllersRef.current.delete(taskId);
                });
        },
        [applyVideoCompositionTask],
    );

    useEffect(
        () => () => {
            compositionPollControllersRef.current.forEach((controller) => controller.abort());
            compositionPollControllersRef.current.clear();
        },
        [],
    );

    const createHistoryEntry = useCallback(
        (): CanvasHistoryEntry => ({
            nodes: nodesRef.current,
            connections: connectionsRef.current,
            chatSessions,
            activeChatId,
            backgroundMode,
            showImageInfo,
        }),
        [activeChatId, backgroundMode, chatSessions, showImageInfo],
    );

    const cleanupCanvasFiles = useCallback(
        (extra?: unknown) => {
            cleanupAssetImages({ extra, history: historyRef.current, lastHistory: lastHistoryRef.current });
        },
        [cleanupAssetImages],
    );

    const stopGenerationByRunningId = useCallback(
        (runningId: string) => {
            const affectedNodeIds = stopRegisteredGenerationRequests(runningId);
            setRunningNodeId((current) => (current === runningId ? null : current));
            if (!affectedNodeIds.size) return;
            setNodes((prev) => prev.map((node) => (affectedNodeIds.has(node.id) && node.execution.phase === "running" ? updateCanvasNodeExecution(node, { phase: "idle", errorMessage: "" }) : node)));
        },
        [stopRegisteredGenerationRequests],
    );

    const confirmStopGeneration = useCallback(
        (nodeId: string) => {
            modal.confirm({
                title: "停止生成？",
                content: "当前生成请求会被中断，已经生成完成的内容会保留。",
                okText: "停止",
                cancelText: "继续生成",
                okButtonProps: { danger: true },
                onOk: () => stopGenerationByRunningId(nodeId),
            });
        },
        [modal, stopGenerationByRunningId],
    );

    const confirmUploadReferenceImages = useCallback(
        (count: number) =>
            new Promise<boolean>((resolve) => {
                modal.confirm({
                    title: "上传参考图到云储存？",
                    content: `检测到 ${count} 张参考图未上传到云储存，生成视频需要公开可访问地址，是否现在上传？`,
                    okText: "上传并生成",
                    cancelText: "取消",
                    onOk: () => resolve(true),
                    onCancel: () => resolve(false),
                });
            }),
        [modal],
    );

    const ensureVideoReferenceImagesObjectStorage = useCallback(
        async (referenceImages: ReferenceImage[]) => {
            const missing = findMissingReferenceObjectStorageImages(referenceImages);
            if (!missing.length) return referenceImages;
            const confirmed = await confirmUploadReferenceImages(missing.length);
            if (!confirmed) return null;
            try {
                const nextReferenceImages = await uploadMissingReferenceImagesToObjectStorage(referenceImages);
                const objectStorageById = new Map(nextReferenceImages.map((image) => [image.id, image.objectStorage]));
                setNodes((prev) =>
                    prev.map((node) => {
                        const objectStorageFile = objectStorageById.get(node.id);
                        return objectStorageFile?.url ? applyCanvasNodeAttributes(node, { objectStorage: objectStorageFile }) : node;
                    }),
                );
                message.success("参考图已上传到云储存");
                return nextReferenceImages;
            } catch (error) {
                message.error(error instanceof Error ? error.message : "参考图上传到云储存失败");
                return null;
            }
        },
        [confirmUploadReferenceImages, message],
    );

    useEffect(() => {
        if (!hydrated) return;
        setProjectLoaded(false);
        const document = findDocument(projectId);
        if (!document) {
            router.replace("/canvas");
            return;
        }

        const restore = async () => {
            const hydratedNodes = normalizeBackgroundBoardMembers(await hydrateCanvasImages(resetInterruptedCanvasNodes(document.scene.nodes)));
            const restoredSessions = await hydrateAssistantImages(document.conversation.sessions);
            const nodeIdSet = new Set(hydratedNodes.map((node) => node.id));
            const backgroundNodeIdSet = new Set(hydratedNodes.filter(isBackgroundNode).map((node) => node.id));
            const restoredConnections = document.scene.connections.filter((connection) => nodeIdSet.has(connection.source.nodeId) && nodeIdSet.has(connection.target.nodeId) && !backgroundNodeIdSet.has(connection.source.nodeId) && !backgroundNodeIdSet.has(connection.target.nodeId));
            const restoredNodes = synchronizeVideoCompositionInputs(hydratedNodes, restoredConnections);
            setNodes(restoredNodes);
            // 过滤掉孤立边（源/目标节点不存在），防止 React Flow 报错。
            setConnections(restoredConnections);
            setChatSessions(restoredSessions);
            setActiveChatId(document.conversation.activeSessionId);
            setBackgroundMode(document.preferences.background);
            setShowImageInfo(document.preferences.showImageInformation);
            setViewport({
                x: document.scene.viewport.offsetX,
                y: document.scene.viewport.offsetY,
                k: document.scene.viewport.zoom,
            });
            if (historyCommitTimerRef.current) {
                clearTimeout(historyCommitTimerRef.current);
                historyCommitTimerRef.current = null;
            }
            lastHistoryRef.current = {
                nodes: restoredNodes,
                connections: restoredConnections,
                chatSessions: restoredSessions,
                activeChatId: document.conversation.activeSessionId,
                backgroundMode: document.preferences.background,
                showImageInfo: document.preferences.showImageInformation,
            };
            setHistoryState({ canUndo: false, canRedo: false });
            setProjectLoaded(true);
            return restoredNodes;
        };
        void restore().then(async (restoredNodes) => {
            const loadingStoryboardAssetNodes = restoredNodes.filter((node): node is CanvasStoryboardNode => isStoryboardNode(node) && node.storyboard.assetGeneration?.phase === "running");
            loadingStoryboardAssetNodes.forEach((node) => {
                void resumeStoryboardAssetGeneration(node, setNodes);
            });
            const runningVideoCompositionNodes = restoredNodes.filter((node): node is CanvasVideoCompositionNode => isVideoCompositionNode(node) && node.execution.phase === "running" && Boolean(node.execution.taskId));
            const compositionResultNodeIds = new Set(runningVideoCompositionNodes.map((node) => node.composition.resultVideoNodeId).filter((nodeId): nodeId is string => Boolean(nodeId)));
            runningVideoCompositionNodes.forEach((node) => {
                const taskId = node.execution.taskId as string;
                const resultVideoNodeId = node.composition.resultVideoNodeId;
                if (!resultVideoNodeId || !restoredNodes.some((item) => item.id === resultVideoNodeId && isVideoNode(item))) {
                    void cancelCompositionTask(taskId).catch(() => undefined);
                    setNodes((currentNodes) => markVideoCompositionTaskFailed(currentNodes, node.id, resultVideoNodeId, "合成结果视频节点不存在，任务已取消", taskId));
                    return;
                }
                monitorVideoCompositionTask(node.id, resultVideoNodeId, taskId);
            });
            // 恢复进行中的服务端任务：查询后端运行中任务，匹配存储的 taskId 后重新绑定进度回调。
            const loadingNodes = restoredNodes.filter(
                (node) => !(isStoryboardNode(node) && node.storyboard.assetGeneration?.phase === "running") && !isVideoCompositionNode(node) && !compositionResultNodeIds.has(node.id) && node.execution.phase === "running" && node.execution.taskId,
            );
            if (!loadingNodes.length) return;
            const { listAiTasks, waitAiTask } = await import("@/services/api/server");
            const runningTasks = await listAiTasks(["pending", "running"]).catch(() => []);
            for (const node of loadingNodes) {
                const taskId = node.execution.taskId as string;
                const matched = runningTasks.find((t) => t.id === taskId);
                if (!matched) {
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? updateCanvasNodeExecution(item, { phase: "failed", errorMessage: "页面刷新后生成已中断，请重新生成。" }) : item)));
                    continue;
                }
                if (matched.status === "success") {
                    setNodes((prev) => updateNodeWithTaskResult(prev, node.id, matched));
                    continue;
                }
                // 任务仍在运行，重新订阅进度。
                waitAiTask(taskId, {
                    signal: new AbortController().signal,
                    onProgress: (task) => setNodes((prev) => prev.map((item) => (item.id === node.id ? updateCanvasNodeExecution(item, { progress: task.progress || 0 }) : item))),
                })
                    .then((completed) => {
                        setNodes((prev) => updateNodeWithTaskResult(prev, node.id, completed));
                    })
                    .catch((error) => {
                        setNodes((prev) => prev.map((item) => (item.id === node.id ? updateCanvasNodeExecution(item, { phase: "failed", errorMessage: error instanceof Error ? error.message : "生成恢复失败" }) : item)));
                    });
            }
        });
    }, [findDocument, hydrated, monitorVideoCompositionTask, projectId, router]);

    useEffect(() => {
        if (!projectLoaded || !initialPrompt || initialPromptHandledRef.current) return;
        initialPromptHandledRef.current = true;
        setAssistantMounted(true);
        clearInitialPromptFromLocation();
    }, [initialPrompt, projectLoaded]);

    useEffect(() => {
        const historyDisabled = !projectLoaded || applyingHistoryRef.current || historyPausedRef.current;
        if (historyDisabled) return;
        const candidate = createHistoryEntry();
        const committed = lastHistoryRef.current;
        const candidateValues = [candidate.nodes, candidate.connections, candidate.chatSessions, candidate.activeChatId, candidate.backgroundMode, candidate.showImageInfo];
        const committedValues = committed ? [committed.nodes, committed.connections, committed.chatSessions, committed.activeChatId, committed.backgroundMode, committed.showImageInfo] : [];
        if (candidateValues.every((value, index) => Object.is(value, committedValues[index]))) return;

        const scheduledCommit = historyCommitTimerRef.current;
        if (scheduledCommit) clearTimeout(scheduledCommit);
        const commit = () => {
            const previousEntry = lastHistoryRef.current;
            if (!previousEntry) return;
            historyRef.current.past = [...historyRef.current.past.slice(-49), previousEntry];
            historyRef.current.future = [];
            setHistoryState({ canUndo: true, canRedo: false });
            lastHistoryRef.current = createHistoryEntry();
            historyCommitTimerRef.current = null;
        };
        historyCommitTimerRef.current = window.setTimeout(commit, 180);

        return () => {
            const pendingCommit = historyCommitTimerRef.current;
            if (pendingCommit) clearTimeout(pendingCommit);
            historyCommitTimerRef.current = null;
        };
    }, [activeChatId, backgroundMode, chatSessions, connections, createHistoryEntry, nodes, projectLoaded, showImageInfo]);

    useEffect(() => {
        if (!projectLoaded || historyPausedRef.current) return;
        replaceScene(projectId, {
            nodes,
            connections,
            viewport: {
                offsetX: viewport.x,
                offsetY: viewport.y,
                zoom: viewport.k,
            },
        });
    }, [connections, nodes, projectId, projectLoaded, replaceScene, viewport]);

    useEffect(() => {
        if (!projectLoaded) return;
        setNodes((currentNodes) => synchronizeVideoCompositionInputs(currentNodes, connections));
    }, [connections, projectLoaded]);

    useEffect(() => {
        if (!projectLoaded || historyPausedRef.current) return;
        replaceConversation(projectId, {
            sessions: chatSessions,
            activeSessionId: activeChatId,
        });
    }, [activeChatId, chatSessions, projectId, projectLoaded, replaceConversation]);

    useEffect(() => {
        if (!projectLoaded || historyPausedRef.current) return;
        updatePreferences(projectId, {
            background: backgroundMode,
            showImageInformation: showImageInfo,
        });
    }, [backgroundMode, projectId, projectLoaded, showImageInfo, updatePreferences]);

    useEffect(() => {
        if (!dialogNodeId) setNodeImageSettingsOpen(false);
    }, [dialogNodeId]);

    nodesRef.current = nodes;
    connectionsRef.current = connections;
    selectedNodeIdsRef.current = selectedNodeIds;
    viewportRef.current = viewport;
    connectingParamsRef.current = connectingParams;
    connectionTargetNodeIdRef.current = connectionTargetNodeId;
    pendingConnectionCreateRef.current = pendingConnectionCreate;
    selectionBoxRef.current = selectionBox;

    const focusCanvasNodes = useCallback(
        (nodeIds: string[]) => {
            if (!nodeIds.length) return false;
            const idSet = new Set(nodeIds);
            const targetNodes = nodesRef.current.filter((node) => idSet.has(node.id));
            if (!targetNodes.length) return false;
            const bounds = targetNodes.reduce(
                (acc, node) => ({
                    left: Math.min(acc.left, node.frame.position.x),
                    top: Math.min(acc.top, node.frame.position.y),
                    right: Math.max(acc.right, node.frame.position.x + node.frame.width),
                    bottom: Math.max(acc.bottom, node.frame.position.y + node.frame.height),
                }),
                { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
            );
            const scale = viewportRef.current.k;
            const centerX = (bounds.left + bounds.right) / 2;
            const centerY = (bounds.top + bounds.bottom) / 2;
            // 聚焦应以用户实际可见的画布区域为中心，避开顶部工具栏和左侧导航覆盖层。
            const container = containerRef.current;
            const containerBounds = container?.getBoundingClientRect();
            const canvasWidth = containerBounds?.width || size.width;
            const canvasHeight = containerBounds?.height || size.height;
            const navigation = container?.querySelector<HTMLElement>('[aria-label="画布导航"]');
            const navigationBounds = navigation?.getBoundingClientRect();
            const navigationRight = navigationBounds && containerBounds
                ? Math.max(0, Math.min(canvasWidth, navigationBounds.right - containerBounds.left))
                : 0;
            const topToolbar = container?.querySelector<HTMLElement>(":scope > header");
            const topToolbarHeight = topToolbar && containerBounds
                ? Math.max(0, Math.min(canvasHeight, topToolbar.getBoundingClientRect().bottom - containerBounds.top))
                : 56;
            const visibleWidth = Math.max(1, canvasWidth - navigationRight);
            const visibleHeight = Math.max(1, canvasHeight - topToolbarHeight);
            setViewport({
                x: navigationRight + visibleWidth / 2 - centerX * scale,
                y: topToolbarHeight + visibleHeight / 2 - centerY * scale,
                k: scale,
            });
            return true;
        },
        [size.height, size.width],
    );

    const requestFocusNodes = useCallback((nodeIds: string[]) => {
        pendingFocusNodeIdsRef.current = nodeIds.filter(Boolean);
    }, []);

    const focusPendingNodes = useCallback(() => {
        const nodeIds = pendingFocusNodeIdsRef.current;
        if (!nodeIds.length || !focusCanvasNodes(nodeIds)) return;
        pendingFocusNodeIdsRef.current = [];
    }, [focusCanvasNodes]);

    useLayoutEffect(() => {
        focusPendingNodes();
    }, [focusPendingNodes, nodes]);

    const handleNavigationNodeLocate = useCallback(
        (nodeId: string) => {
            focusCanvasNodes([nodeId]);
            setSelectedNodeIds(new Set([nodeId]));
            setSelectedConnectionId(null);
            setDialogNodeId(null);
            setToolbarNodeId(null);
            setSelectionBox(null);
            setContextMenu(null);
            setEdgeDeletePopover(null);
            setPendingConnectionCreate(null);
        },
        [focusCanvasNodes],
    );

    const setConnecting = useCallback((next: ConnectionHandle | null) => {
        connectingParamsRef.current = next;
        setConnectingParams(next);
        if (!next) {
            connectionTargetNodeIdRef.current = null;
            setConnectionTargetNodeId(null);
        }
    }, []);

    const keepNodeToolbar = useCallback(
        (nodeId: string) => {
            if (nodeDraggingRef.current || nodeImageSettingsOpen) return;
            if (toolbarHideTimerRef.current) {
                clearTimeout(toolbarHideTimerRef.current);
                toolbarHideTimerRef.current = null;
            }
            setToolbarNodeId(nodeId);
        },
        [nodeImageSettingsOpen],
    );

    const hideNodeToolbar = useCallback(() => {
        if (toolbarHideTimerRef.current) clearTimeout(toolbarHideTimerRef.current);
        toolbarHideTimerRef.current = setTimeout(() => {
            setToolbarNodeId(null);
            toolbarHideTimerRef.current = null;
        }, 120);
    }, []);

    const connectNodes = useCallback(
        (current: ConnectionHandle, targetNodeId: string) => {
            if (current.nodeId === targetNodeId) return;

            const connection = normalizeCanvasConnection(current.nodeId, targetNodeId, nodesRef.current);
            if (!connection) {
                message.warning("配置节点之间不能连接");
                return;
            }
            const errorMessage = readVideoCompositionConnectionError(connection.source.nodeId, connection.target.nodeId, nodesRef.current, connectionsRef.current);
            if (errorMessage) {
                message.warning(errorMessage);
                return;
            }
            const exists = connectionsRef.current.some((item) => item.source.nodeId === connection.source.nodeId && item.target.nodeId === connection.target.nodeId);
            if (!exists) {
                setConnections((prev) => [...prev, { id: `conn-${Date.now()}`, ...connection }]);
            }
            setContextMenu(null);
        },
        [message],
    );

    // 处理提示词@面板选择的资产连线，成功或已有连线时返回 true。
    const connectMentionReference = useCallback(
        (sourceNodeId: string, targetNodeId: string) => {
            if (sourceNodeId === targetNodeId) return false;
            const sourceNode = nodesRef.current.find((node) => node.id === sourceNodeId);
            const targetNode = nodesRef.current.find((node) => node.id === targetNodeId);
            if (!sourceNode || !targetNode || isBackgroundNode(sourceNode) || isBackgroundNode(targetNode)) {
                message.warning("该画布资产无法作为节点引用");
                return false;
            }
            const normalizedConnection = normalizeCanvasConnection(sourceNodeId, targetNodeId, nodesRef.current);
            if (!normalizedConnection) {
                message.warning("配置节点之间不能连接");
                return false;
            }
            // @引用始终从源资产右侧输出点连接到当前节点左侧输入点，避免 React Flow 在缺少端口时默认落到左侧。
            const connection = {
                ...normalizedConnection,
                source: { ...normalizedConnection.source, portId: "right" },
                target: { ...normalizedConnection.target, portId: "left" },
            };
            const errorMessage = readVideoCompositionConnectionError(connection.source.nodeId, connection.target.nodeId, nodesRef.current, connectionsRef.current);
            if (errorMessage) {
                message.warning(errorMessage);
                return false;
            }
            const exists = connectionsRef.current.some((item) => item.source.nodeId === connection.source.nodeId && item.target.nodeId === connection.target.nodeId);
            if (!exists) setConnections((prev) => [...prev, { id: `conn-${Date.now()}`, ...connection }]);
            return true;
        },
        [message],
    );

    const createConnectedNode = useCallback(
        (type: PendingConnectionCreateNodeType, pending: PendingConnectionCreate, settingGraphSkill?: SkillOption) => {
            const sourceNode = nodesRef.current.find((node) => node.id === pending.connection.nodeId);
            if (type === "storyboard" && (!sourceNode || !isTextNode(sourceNode))) {
                message.warning("分镜脚本只能引用文本剧本节点创建");
                return;
            }
            if (type === "videoComposition" && (!sourceNode || !isVideoNode(sourceNode))) {
                message.warning("合成视频仅支持引用视频节点创建");
                return;
            }
            const defaultStoryboardModel = type === "storyboard" ? normalizeModelOptionValue(effectiveConfig.textModel, effectiveConfig.channels) : "";
            const settingGraph = settingGraphSkill
                ? ({ id: settingGraphSkill.id, name: settingGraphSkill.name, targetType: "canvasSettingGraph", systemPrompt: settingGraphSkill.systemPrompt || "", aspectRatio: settingGraphSkill.aspectRatio || "16:9" } satisfies CanvasSettingGraphSkillSnapshot)
                : undefined;
            const initialNode = {
                ...createCanvasNode(type, pending.position, {
                    ...(defaultStoryboardModel ? { model: defaultStoryboardModel } : {}),
                    ...(settingGraph ? { settingGraph } : {}),
                    ...(settingGraph ? { count: 1 } : {}),
                }),
                ...(settingGraphSkill ? { title: `设定图·${settingGraphSkill.name}` } : {}),
            };
            // 连接菜单的释放点通常紧贴源节点手柄，不能直接作为新节点位置；统一按源节点边缘外侧间距布局。
            const preferredPosition = sourceNode
                ? {
                      x:
                          pending.connection.handleType === "target"
                              ? sourceNode.frame.position.x - CONNECTED_NODE_GAP - initialNode.frame.width
                              : sourceNode.frame.position.x + sourceNode.frame.width + CONNECTED_NODE_GAP,
                      y: sourceNode.frame.position.y + sourceNode.frame.height / 2 - initialNode.frame.height / 2,
                  }
                : initialNode.frame.position;
            const newNode = updateCanvasNodeFrame(initialNode, {
                position: findNonOverlappingCanvasNodePosition(nodesRef.current, preferredPosition, initialNode.frame.width, initialNode.frame.height, CONNECTED_NODE_GAP),
            });
            const connection = normalizeCanvasConnection(pending.connection.nodeId, newNode.id, [...nodesRef.current, newNode]);
            if (!connection) {
                message.warning("配置节点之间不能连接");
                return;
            }
            const errorMessage = readVideoCompositionConnectionError(connection.source.nodeId, connection.target.nodeId, [...nodesRef.current, newNode], connectionsRef.current);
            if (errorMessage) {
                message.warning(errorMessage);
                return;
            }
            setNodes((prev) => [...prev, newNode]);
            requestFocusNodes([newNode.id]);
            setConnections((prev) => [...prev, connectionHandlesForCreatedNode(nanoid(), pending.connection, connection)]);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(newNode.id);
            setPendingConnectionCreate(null);
            setConnecting(null);
        },
        [effectiveConfig.channels, effectiveConfig.textModel, message, requestFocusNodes, setConnecting],
    );

    const cancelPendingConnectionCreate = useCallback(() => {
        setPendingConnectionCreate(null);
        setConnecting(null);
    }, [setConnecting]);

    const getConnectionDropTarget = useCallback(
        (clientX: number, clientY: number, current: ConnectionHandle): ConnectionDropTarget => {
            const visibleNodes = nodesRef.current.filter((node) => !isHiddenBatchChild(node, nodesRef.current));
            return findCanvasConnectionDropTarget(visibleNodes, current.nodeId, current.handleType, screenToCanvas(clientX, clientY), viewportRef.current.k, CONNECTION_NODE_HIT_PADDING, CONNECTION_HANDLE_HIT_RADIUS);
        },
        [screenToCanvas],
    );

    const visibleNodes = useMemo(() => {
        const padding = 280;
        const rect = containerRef.current?.getBoundingClientRect();
        const width = rect?.width || size.width;
        const height = rect?.height || size.height;
        const viewLeft = -viewport.x / viewport.k - padding;
        const viewTop = -viewport.y / viewport.k - padding;
        const viewRight = viewLeft + width / viewport.k + padding * 2;
        const viewBottom = viewTop + height / viewport.k + padding * 2;

        return nodes.filter(
            (node) =>
                !isHiddenBatchChild(node, nodes, collapsingBatchIds) && node.frame.position.x + node.frame.width > viewLeft && node.frame.position.x < viewRight && node.frame.position.y + node.frame.height > viewTop && node.frame.position.y < viewBottom,
        );
    }, [collapsingBatchIds, nodes, size.height, size.width, viewport.k, viewport.x, viewport.y]);

    const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
    const storyboardWorkspaceNode = storyboardWorkspaceNodeId ? nodeById.get(storyboardWorkspaceNodeId) : null;
    const openedStoryboardNode = storyboardWorkspaceNode && isStoryboardNode(storyboardWorkspaceNode) ? storyboardWorkspaceNode : null;
    const storyboardVideoGenerationNode = storyboardVideoGenerationNodeId ? nodeById.get(storyboardVideoGenerationNodeId) : null;
    const openedStoryboardVideoGenerationNode = storyboardVideoGenerationNode && isStoryboardNode(storyboardVideoGenerationNode) ? storyboardVideoGenerationNode : null;
    useEffect(() => {
        if (storyboardWorkspaceNodeId && !openedStoryboardNode) setStoryboardWorkspaceNodeId(null);
    }, [openedStoryboardNode, storyboardWorkspaceNodeId]);
    useEffect(() => {
        if (storyboardVideoGenerationNodeId && !openedStoryboardVideoGenerationNode) setStoryboardVideoGenerationNodeId(null);
    }, [openedStoryboardVideoGenerationNode, storyboardVideoGenerationNodeId]);
    const storyboardReferenceVideos = useMemo(
        () => (openedStoryboardVideoGenerationNode ? readStoryboardVideoReferences(openedStoryboardVideoGenerationNode.id, nodes, connections) : []),
        [connections, nodes, openedStoryboardVideoGenerationNode],
    );

    const batchCardStacks = useMemo(() => {
        const imagePreviewsByRootId = new Map<string, BatchImagePreview[]>();
        const transformsByNodeId = new Map<string, string>();
        const nodesById = new Map(nodes.map((node) => [node.id, node]));

        nodes.forEach((root) => {
            if (!isImageNode(root) || !root.grouping.isRoot) return;
            const children = root.grouping.childIds.map((childId) => nodesById.get(childId)).filter((node): node is CanvasImageNode => Boolean(node && isImageNode(node) && node.content.source));
            imagePreviewsByRootId.set(
                root.id,
                children.map((node) => ({ id: node.id, source: node.content.source })),
            );

            children.forEach((child, index) => {
                const stackIndex = Math.min(index, 2);
                const scale = Math.min(0.48, 112 / child.frame.width);
                const targetLeft = root.frame.position.x + root.frame.width + 64 + stackIndex * 7;
                const targetTop = root.frame.position.y + root.frame.height / 2 - 40 + stackIndex * 4;
                const translateX = targetLeft - child.frame.position.x - child.frame.width / 2 + (child.frame.width * scale) / 2;
                const translateY = targetTop - child.frame.position.y - child.frame.height / 2 + (child.frame.height * scale) / 2;
                transformsByNodeId.set(child.id, `translate(${Math.round(translateX)}px, ${Math.round(translateY)}px) rotate(${stackIndex * 2 - 2}deg) scale(${scale})`);
            });
        });

        return { imagePreviewsByRootId, transformsByNodeId };
    }, [nodes]);
    const toolbarNode = toolbarNodeId ? nodeById.get(toolbarNodeId) || null : null;
    const infoNode = infoNodeId ? nodeById.get(infoNodeId) || null : null;
    const cropNode = cropNodeId ? nodeById.get(cropNodeId) || null : null;
    const splitNode = splitNodeId ? nodeById.get(splitNodeId) || null : null;
    const previewNode = previewNodeId ? nodeById.get(previewNodeId) || null : null;
    const dialogNode = dialogNodeId ? nodeById.get(dialogNodeId) || null : null;
    const promptPanelNode = dialogNode && !selectionBox && !isStoryboardNode(dialogNode) && !isVideoCompositionNode(dialogNode) ? dialogNode : null;
    const promptPanelCanGenerateWithoutPrompt = useMemo(() => {
        if (!promptPanelNode || !isImageNode(promptPanelNode) || !promptPanelNode.generation.settingGraph) return false;
        return hasNodeGenerationInputs(promptPanelNode.id, nodes, connections);
    }, [connections, nodes, promptPanelNode]);
    const floatingPanelStyle = useMemo(() => {
        if (!promptPanelNode) return null;
        const canvasRect = containerRef.current?.getBoundingClientRect();
        const left = viewport.x + (promptPanelNode.frame.position.x + promptPanelNode.frame.width / 2) * viewport.k - PROMPT_PANEL_WIDTH / 2;
        const top = viewport.y + (promptPanelNode.frame.position.y + promptPanelNode.frame.height) * viewport.k + PROMPT_PANEL_GAP;
        return {
            left: Math.max(PROMPT_PANEL_GAP, Math.min((canvasRect?.width || size.width) - PROMPT_PANEL_WIDTH - PROMPT_PANEL_GAP, left)),
            top: Math.max(PROMPT_PANEL_GAP, Math.min((canvasRect?.height || size.height) - PROMPT_PANEL_HEIGHT - PROMPT_PANEL_GAP, top)),
        };
    }, [promptPanelNode, size.height, size.width, viewport.k, viewport.x, viewport.y]);
    const hasMultipleSelectedNodes = selectedNodeIds.size > 1;
    const activeNodeId = hasMultipleSelectedNodes ? null : hoveredNodeId || (selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null);
    const batchChildCountById = useMemo(() => {
        const map = new Map<string, number>();
        nodes.forEach((node) => {
            if (isImageNode(node) && node.grouping.isRoot) map.set(node.id, node.grouping.childIds.length);
        });
        return map;
    }, [nodes]);
    const batchMotionById = useMemo(() => {
        const map = new Map<string, { x: number; y: number; index: number }>();
        nodes.forEach((node) => {
            const rootId = isImageNode(node) ? node.grouping.rootId : undefined;
            if (!rootId) return;
            const root = nodeById.get(rootId);
            const index = root && isImageNode(root) ? root.grouping.childIds.indexOf(node.id) : 0;
            const stackX = root ? root.frame.position.x + 34 + index * 14 : node.frame.position.x;
            const stackY = root ? root.frame.position.y + 14 + index * 8 : node.frame.position.y;
            map.set(node.id, { x: stackX - node.frame.position.x, y: stackY - node.frame.position.y, index: Math.max(index, 0) });
        });
        return map;
    }, [nodeById, nodes]);
    const relatedHighlight = useMemo(() => {
        const nodeIds = new Set<string>();
        const connectionIds = new Set<string>();

        if (!activeNodeId) return { nodeIds, connectionIds };

        nodeIds.add(activeNodeId);
        connections.forEach((connection) => {
            if (connection.source.nodeId !== activeNodeId && connection.target.nodeId !== activeNodeId) return;
            connectionIds.add(connection.id);
            nodeIds.add(connection.source.nodeId);
            nodeIds.add(connection.target.nodeId);
        });

        return { nodeIds, connectionIds };
    }, [activeNodeId, connections]);

    const resourceContextNodeId = dialogNodeId || activeNodeId;
    const canvasResourceReferences = useMemo(() => buildCanvasResourceReferences(nodes, connections, resourceContextNodeId), [connections, nodes, resourceContextNodeId]);
    const resourceReferenceByNodeId = useMemo(() => new Map(canvasResourceReferences.map((reference) => [reference.nodeId, reference])), [canvasResourceReferences]);
    const mentionReferencesByNodeId = useMemo(() => {
        const map = new Map<string, ReturnType<typeof buildNodeMentionReferences>>();
        nodes.forEach((node) => map.set(node.id, buildNodeMentionReferences(node, nodes, connections)));
        return map;
    }, [connections, nodes]);
    const cancelVideoCompositionTasksForDeletedNodes = useCallback(
        (nodeIds: Set<string>) => {
            const runningTasks = nodesRef.current
                .filter(
                    (node): node is CanvasVideoCompositionNode =>
                        isVideoCompositionNode(node) && node.execution.phase === "running" && Boolean(node.execution.taskId) && (nodeIds.has(node.id) || Boolean(node.composition.resultVideoNodeId && nodeIds.has(node.composition.resultVideoNodeId))),
                )
                .map((node) => ({ compositionNodeId: node.id, resultVideoNodeId: node.composition.resultVideoNodeId, taskId: node.execution.taskId as string }));
            runningTasks.forEach(({ compositionNodeId, resultVideoNodeId, taskId }) => {
                compositionPollControllersRef.current.get(taskId)?.abort();
                setNodes((currentNodes) => markVideoCompositionTaskFailed(currentNodes, compositionNodeId, resultVideoNodeId, "任务已取消", taskId));
                void cancelCompositionTask(taskId)
                    .then((task) => applyVideoCompositionTask(compositionNodeId, resultVideoNodeId, task))
                    .catch((error) => {
                        setNodes((currentNodes) => markVideoCompositionTaskFailed(currentNodes, compositionNodeId, resultVideoNodeId, error instanceof Error ? error.message : "取消视频合成任务失败", taskId));
                    });
            });
            return runningTasks;
        },
        [applyVideoCompositionTask],
    );
    const agentSnapshot = useMemo<CanvasAgentSnapshot>(
        () => ({ projectId, title: currentDocument?.identity.title || "未命名画布", nodes, connections, selectedNodeIds: Array.from(selectedNodeIds), viewport }),
        [connections, currentDocument?.identity.title, nodes, projectId, selectedNodeIds, viewport],
    );

    const commitAgentSnapshot = useCallback(
        (snapshot: CanvasAgentSnapshot) => {
            const nextNodeIds = new Set(snapshot.nodes.map((node) => node.id));
            const deletedNodeIds = new Set(nodesRef.current.filter((node) => !nextNodeIds.has(node.id)).map((node) => node.id));
            const canceledTasks = deletedNodeIds.size ? cancelVideoCompositionTasksForDeletedNodes(deletedNodeIds) : [];
            const nextNodes = canceledTasks.reduce((currentNodes, task) => markVideoCompositionTaskFailed(currentNodes, task.compositionNodeId, task.resultVideoNodeId, "任务已取消"), snapshot.nodes);
            nodesRef.current = nextNodes;
            connectionsRef.current = snapshot.connections;
            selectedNodeIdsRef.current = new Set(snapshot.selectedNodeIds);
            viewportRef.current = snapshot.viewport;
            setNodes(nextNodes);
            setConnections(snapshot.connections);
            setSelectedNodeIds(new Set(snapshot.selectedNodeIds));
            setViewport(snapshot.viewport);
            setSelectedConnectionId(null);
            setContextMenu(null);
        },
        [cancelVideoCompositionTasksForDeletedNodes],
    );

    const applyAgentOps = useCallback(
        async (ops: CanvasAgentOp[] | undefined, signal: AbortSignal) => {
            const safeOps = positionCanvasAgentAddNodeOps(Array.isArray(ops) ? ops.filter((op) => op?.type) : [], getCanvasCenter());
            const before = { projectId, title: currentDocument?.identity.title || "未命名画布", nodes: nodesRef.current, connections: connectionsRef.current, selectedNodeIds: Array.from(selectedNodeIdsRef.current), viewport: viewportRef.current };
            const generationOps: CanvasAgentOp[] = [];
            const stateOps: CanvasAgentOp[] = [];
            safeOps.forEach((operation) => (operation.type === "run_generation" ? generationOps : stateOps).push(operation));
            const next = applyCanvasAgentOps(before, stateOps);
            setAgentUndoSnapshot(before);
            commitAgentSnapshot(next);
            for (const operation of generationOps) {
                if (!operation.nodeId) throw new Error("生成节点ID不能为空");
                const target = next.nodes.find((node) => node.id === operation.nodeId);
                if (!target) throw new Error(`生成节点不存在: ${operation.nodeId}`);
                const mode = readCanvasGenerationMode(operation.mode ?? target.kind);
                if (!mode) throw new Error("分镜脚本节点不能使用通用生成操作，请在分镜脚本节点中生成");
                const generationConfig = buildGenerationConfig(effectiveConfig, target, mode);
                if (isAiConfigReady(generationConfig, generationConfig.model)) continue;
                showMissingAiConfig(mode);
                throw new Error(`${mode === "image" ? "图片" : mode === "video" ? "视频" : "文本"}生成节点已创建，但模型配置不完整，生成尚未开始`);
            }
            if (!generationOps.length) {
                return { snapshot: { ...next, projectId, title: currentDocument?.identity.title || "未命名画布" } };
            }
            const outcomes = await Promise.all(
                generationOps.map(async (operation) => {
                    if (!operation.nodeId) throw new Error("生成节点ID不能为空");
                    const target = nodesRef.current.find((node) => node.id === operation.nodeId);
                    if (!target) throw new Error(`生成节点不存在: ${operation.nodeId}`);
                    const prompt = operation.prompt?.trim() || readCanvasNodePrompt(target);
                    const execute = generateNodeRef.current;
                    if (!execute) throw new Error("画布生成执行器尚未就绪");
                    const mode = readCanvasGenerationMode(operation.mode ?? target.kind);
                    if (!mode) throw new Error("分镜脚本节点不能使用通用生成操作，请在分镜脚本节点中生成");
                    const generationType = mode === "image" || mode === "video" ? mode : null;
                    const snapshots = generationType ? operation.generationStyleSnapshots?.filter((snapshot) => snapshot.generationType === generationType) : [];
                    return execute(operation.nodeId, mode, prompt, operation.recovery === true, signal, { snapshots });
                }),
            );
            const result = withCanvasArgumentSources(mergeCanvasGenerationResults(outcomes), generationOps, stateOps);
            return {
                snapshot: {
                    ...next,
                    nodes: nodesRef.current,
                    connections: connectionsRef.current,
                    selectedNodeIds: Array.from(selectedNodeIdsRef.current),
                    viewport: viewportRef.current,
                    projectId,
                    title: currentDocument?.identity.title || "未命名画布",
                },
                result,
            };
        },
        [commitAgentSnapshot, currentDocument?.identity.title, effectiveConfig, getCanvasCenter, isAiConfigReady, projectId, showMissingAiConfig],
    );
    const undoAgentOps = useCallback(() => {
        if (!agentUndoSnapshot) return null;
        commitAgentSnapshot(agentUndoSnapshot);
        setAgentUndoSnapshot(null);
        return { ...agentUndoSnapshot, projectId, title: currentDocument?.identity.title || "未命名画布" };
    }, [agentUndoSnapshot, commitAgentSnapshot, currentDocument?.identity.title, projectId]);
    const createNode = useCallback(
        (type: CanvasNodeKind, position?: CanvasPoint) => {
            const targetPosition = position || getCanvasCenter();
            // 工具栏创建时随机错开节点，指定位置创建时仍优先保持落点并自动避开重叠。
            const offset = position ? { x: 0, y: 0 } : { x: (Math.random() - 0.5) * 200, y: (Math.random() - 0.5) * 200 };
            const newNode = createCanvasNode(type, { x: targetPosition.x + offset.x, y: targetPosition.y + offset.y });
            const safePosition = findNonOverlappingCanvasNodePosition(nodesRef.current, newNode.frame.position, newNode.frame.width, newNode.frame.height);
            const positionedNode = updateCanvasNodeFrame(newNode, { position: safePosition });

            setNodes((prev) => [...prev, positionedNode]);
            requestFocusNodes([positionedNode.id]);
            setSelectedNodeIds(new Set([positionedNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(type === "background" ? null : positionedNode.id);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, getCanvasCenter, requestFocusNodes],
    );

    const performDeleteNodes = useCallback(
        (ids: Set<string>) => {
            if (!ids.size) return;
            const allIds = new Set(ids);
            let expanded = true;
            while (expanded) {
                expanded = false;
                nodesRef.current.forEach((node) => {
                    const before = allIds.size;
                    if (allIds.has(node.id) && isImageNode(node)) node.grouping.childIds.forEach((childId) => allIds.add(childId));
                    if (allIds.has(node.id) && isBackgroundNode(node)) node.memberNodeIds.forEach((memberId) => allIds.add(memberId));
                    expanded ||= allIds.size !== before;
                });
            }
            cancelVideoCompositionTasksForDeletedNodes(allIds);
            setNodes((prev) => {
                const next = prev.filter((node) => !allIds.has(node.id));
                return next.map((node) => {
                    if (isBackgroundNode(node)) {
                        const memberNodeIds = node.memberNodeIds.filter((memberId) => !allIds.has(memberId));
                        return memberNodeIds.length === node.memberNodeIds.length ? node : { ...node, memberNodeIds };
                    }
                    if (!isImageNode(node) || !node.grouping.isRoot) return node;
                    const childIds = node.grouping.childIds.filter((childId) => !allIds.has(childId));
                    if (childIds.length === node.grouping.childIds.length) return node;
                    const primaryImageId = childIds.includes(node.grouping.primaryImageId || "") ? node.grouping.primaryImageId : childIds[0];
                    const primaryNode = next.find((item) => item.id === primaryImageId);
                    return applyCanvasNodeAttributes(node, {
                        batchChildIds: childIds,
                        primaryImageId,
                        content: primaryNode && isImageNode(primaryNode) ? primaryNode.content.source : node.content.source,
                        naturalWidth: primaryNode?.frame.naturalWidth || node.frame.naturalWidth,
                        naturalHeight: primaryNode?.frame.naturalHeight || node.frame.naturalHeight,
                    });
                });
            });
            setConnections((prev) => prev.filter((connection) => !allIds.has(connection.source.nodeId) && !allIds.has(connection.target.nodeId)));
            setSelectedNodeIds(new Set());
            setSelectedConnectionId(null);
            setHoveredNodeId((current) => (current && allIds.has(current) ? null : current));
            setToolbarNodeId((current) => (current && allIds.has(current) ? null : current));
            setDialogNodeId((current) => (current && allIds.has(current) ? null : current));
            setEditingNodeId((current) => (current && allIds.has(current) ? null : current));
            setInfoNodeId((current) => (current && allIds.has(current) ? null : current));
            setCropNodeId((current) => (current && allIds.has(current) ? null : current));
            setPreviewNodeId((current) => (current && allIds.has(current) ? null : current));
            setRunningNodeId((current) => (current && allIds.has(current) ? null : current));
            setContextMenu((current) => {
                const contextTargetDeleted = (current?.type === "node" && allIds.has(current.nodeId)) || (current?.type === "selection" && current.nodeIds.some((nodeId) => allIds.has(nodeId)));
                return contextTargetDeleted ? null : current;
            });
            cleanupCanvasFiles({ projectId, nodes: nodesRef.current.filter((node) => !allIds.has(node.id)), chatSessions });
        },
        [cancelVideoCompositionTasksForDeletedNodes, chatSessions, cleanupCanvasFiles, projectId],
    );

    const confirmDeleteNodes = useCallback(
        (ids: Set<string>) => {
            if (!ids.size) return;
            const selectedNodes = nodesRef.current.filter((node) => ids.has(node.id));
            const hasBackgroundBoard = selectedNodes.some(isBackgroundNode);
            const message = hasBackgroundBoard ? "删除背景板会同时删除其中的全部成员节点及相关连线，此操作可通过撤销恢复。" : "删除选中的节点及相关连线？此操作可通过撤销恢复。";
            modal.confirm({
                title: selectedNodes.length > 1 ? `删除选中节点（${selectedNodes.length}）？` : "删除节点？",
                content: message,
                okText: "删除",
                cancelText: "取消",
                okButtonProps: { danger: true },
                onOk: () => performDeleteNodes(ids),
            });
        },
        [modal, performDeleteNodes],
    );

    const performDeleteBackgroundOnly = useCallback(
        (nodeId: string) => {
            const target = nodesRef.current.find((node) => node.id === nodeId);
            if (!target || !isBackgroundNode(target)) return;
            setNodes((prev) => prev.filter((node) => node.id !== nodeId).map((node) => {
                if (!isBackgroundNode(node) || !node.memberNodeIds.includes(nodeId)) return node;
                return { ...node, memberNodeIds: node.memberNodeIds.filter((memberId) => memberId !== nodeId) };
            }));
            setConnections((prev) => prev.filter((connection) => connection.source.nodeId !== nodeId && connection.target.nodeId !== nodeId));
            setSelectedNodeIds((current) => new Set([...current].filter((id) => id !== nodeId)));
            setSelectedConnectionId(null);
            setHoveredNodeId((current) => (current === nodeId ? null : current));
            setToolbarNodeId((current) => (current === nodeId ? null : current));
            setDialogNodeId((current) => (current === nodeId ? null : current));
            setEditingNodeId((current) => (current === nodeId ? null : current));
            setInfoNodeId((current) => (current === nodeId ? null : current));
            setCropNodeId((current) => (current === nodeId ? null : current));
            setPreviewNodeId((current) => (current === nodeId ? null : current));
            setRunningNodeId((current) => (current === nodeId ? null : current));
            setContextMenu((current) => (current?.type === "node" && current.nodeId === nodeId ? null : current));
            cleanupCanvasFiles({ projectId, nodes: nodesRef.current.filter((node) => node.id !== nodeId), chatSessions });
        },
        [chatSessions, cleanupCanvasFiles, projectId],
    );

    const confirmDeleteBackgroundOnly = useCallback(
        (nodeId: string) => {
            const target = nodesRef.current.find((node) => node.id === nodeId);
            if (!target || !isBackgroundNode(target)) return;
            modal.confirm({
                title: "仅删除背景板？",
                content: "背景板内的节点会保留在画布上，相关连线也会保留。",
                okText: "删除背景板",
                cancelText: "取消",
                okButtonProps: { danger: true },
                onOk: () => performDeleteBackgroundOnly(nodeId),
            });
        },
        [modal, performDeleteBackgroundOnly],
    );

    const deleteConnection = useCallback((connectionId: string) => {
        setConnections((prev) => prev.filter((conn) => conn.id !== connectionId));
        setSelectedConnectionId((current) => (current === connectionId ? null : current));
        setEdgeDeletePopover((current) => (current?.connectionId === connectionId ? null : current));
        setContextMenu((current) => (current?.type === "connection" && current.connectionId === connectionId ? null : current));
    }, []);

    const removeNodeReferenceConnection = useCallback(
        (targetNodeId: string, referenceNodeId: string) => {
            connections
                .filter((connection) => connection.target.nodeId === targetNodeId && connection.source.nodeId === referenceNodeId)
                .forEach((connection) => deleteConnection(connection.id));
        },
        [connections, deleteConnection],
    );

    const deselectCanvas = useCallback(() => {
        cancelPendingConnectionCreate();
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        setEdgeDeletePopover(null);
        setContextMenu(null);
        setSelectionBox(null);
        setHoveredNodeId(null);
        setToolbarNodeId(null);
        setDialogNodeId(null);
        setEditingNodeId(null);
    }, [cancelPendingConnectionCreate]);

    const clearCanvas = useCallback(() => {
        cancelVideoCompositionTasksForDeletedNodes(new Set(nodesRef.current.map((node) => node.id)));
        setNodes([]);
        setConnections([]);
        setInfoNodeId(null);
        setCropNodeId(null);
        setPreviewNodeId(null);
        setRunningNodeId(null);
        deselectCanvas();
        setClearConfirmOpen(false);
        cleanupCanvasFiles({ projectId, nodes: [], chatSessions: [] });
    }, [cancelVideoCompositionTasksForDeletedNodes, cleanupCanvasFiles, deselectCanvas, projectId]);

    const duplicateNode = useCallback(
        (nodeId: string) => {
            const source = nodesRef.current.find((node) => node.id === nodeId);
            if (!source) return;

            if (isBackgroundNode(source)) {
                const groupIds = new Set([source.id, ...source.memberNodeIds]);
                const groupNodes = nodesRef.current.filter((node) => groupIds.has(node.id));
                const idMap = new Map(groupNodes.map((node) => [node.id, `${node.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`]));
                const nextNodes = groupNodes.map((node) => {
                    const copied = structuredClone(node);
                    const mappedId = idMap.get(node.id) as string;
                    const frame = { ...node.frame, position: { x: node.frame.position.x + 36, y: node.frame.position.y + 36 } };
                    if (isBackgroundNode(copied)) return { ...copied, id: mappedId, title: `${node.title} 副本`, frame, memberNodeIds: copied.memberNodeIds.flatMap((memberId) => (idMap.has(memberId) ? [idMap.get(memberId) as string] : [])) };
                    return { ...copied, id: mappedId, title: `${node.title} 副本`, frame };
                });
                const nextConnections = connectionsRef.current
                    .filter((connection) => groupIds.has(connection.source.nodeId) && groupIds.has(connection.target.nodeId))
                    .map((connection, index) => ({ ...structuredClone(connection), id: `conn-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`, source: { ...connection.source, nodeId: idMap.get(connection.source.nodeId) as string }, target: { ...connection.target, nodeId: idMap.get(connection.target.nodeId) as string } }));
                setNodes((prev) => [...prev, ...nextNodes]);
                setConnections((prev) => [...prev, ...nextConnections]);
                requestFocusNodes([idMap.get(source.id) as string]);
                setSelectedNodeIds(new Set(nextNodes.map((node) => node.id)));
                setSelectedConnectionId(null);
                setDialogNodeId(null);
                return;
            }

            const id = `${source.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const copied = structuredClone(source);
            const next: CanvasDomainNode = isVideoCompositionNode(copied)
                ? {
                      ...copied,
                      id,
                      title: `${source.title} Copy`,
                      execution: { phase: "idle" },
                      composition: { inputVideoNodeIds: [] },
                      frame: {
                          ...source.frame,
                          position: { x: source.frame.position.x + 36, y: source.frame.position.y + 36 },
                      },
                  }
                : {
                      ...copied,
                      id,
                      title: `${source.title} Copy`,
                      frame: {
                          ...source.frame,
                          position: { x: source.frame.position.x + 36, y: source.frame.position.y + 36 },
                      },
                  };

            setNodes((prev) => [...prev, next]);
            requestFocusNodes([id]);
            setSelectedNodeIds(new Set([id]));
            setSelectedConnectionId(null);
            setDialogNodeId(id);
        },
        [requestFocusNodes],
    );

    const copySelectedNodes = useCallback(() => {
        const selectedIds = selectedNodeIdsRef.current;
        if (!selectedIds.size) return;

        const copyIds = new Set(selectedIds);
        nodesRef.current.forEach((node) => {
            if (selectedIds.has(node.id) && isBackgroundNode(node)) node.memberNodeIds.forEach((memberId) => copyIds.add(memberId));
        });
        const copiedNodes = nodesRef.current.filter((node) => copyIds.has(node.id)).map((node) => structuredClone(node));

        if (!copiedNodes.length) return;

        clipboardRef.current = {
            nodes: copiedNodes,
            connections: connectionsRef.current.filter((connection) => copyIds.has(connection.source.nodeId) && copyIds.has(connection.target.nodeId)).map((connection) => structuredClone(connection)),
        };
    }, []);

    const pasteCopiedNodes = useCallback(() => {
        const clipboard = clipboardRef.current;
        if (!clipboard?.nodes.length) return false;

        const center = getCanvasCenter();
        const bounds = clipboard.nodes.reduce(
            (acc, node) => ({
                left: Math.min(acc.left, node.frame.position.x),
                top: Math.min(acc.top, node.frame.position.y),
                right: Math.max(acc.right, node.frame.position.x + node.frame.width),
                bottom: Math.max(acc.bottom, node.frame.position.y + node.frame.height),
            }),
            { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
        );
        const dx = center.x - (bounds.left + bounds.right) / 2;
        const dy = center.y - (bounds.top + bounds.bottom) / 2;
        const idMap = new Map<string, string>();
        clipboard.nodes.forEach((node, index) => {
            const id = `${node.kind}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
            idMap.set(node.id, id);
        });
        const nextNodes: CanvasDomainNode[] = clipboard.nodes.map((node) => {
            const copied = structuredClone(node);
            const frame = {
                ...node.frame,
                position: {
                    x: node.frame.position.x + dx,
                    y: node.frame.position.y + dy,
                },
            };
            if (isVideoCompositionNode(copied)) {
                return {
                    ...copied,
                    id: idMap.get(node.id) as string,
                    title: node.title.endsWith(" Copy") ? node.title : `${node.title} Copy`,
                    frame,
                    execution: { phase: "idle" as const },
                    composition: {
                        inputVideoNodeIds: copied.composition.inputVideoNodeIds.flatMap((inputNodeId) => {
                            const mappedNodeId = idMap.get(inputNodeId);
                            return mappedNodeId ? [mappedNodeId] : [];
                        }),
                    },
                };
            }
            if (isBackgroundNode(copied)) {
                return {
                    ...copied,
                    id: idMap.get(node.id) as string,
                    title: node.title.endsWith("副本") ? node.title : `${node.title} 副本`,
                    frame,
                    memberNodeIds: copied.memberNodeIds.flatMap((memberNodeId) => (idMap.has(memberNodeId) ? [idMap.get(memberNodeId) as string] : [])),
                };
            }
            return {
                ...copied,
                id: idMap.get(node.id) as string,
                title: node.title.endsWith(" Copy") ? node.title : `${node.title} Copy`,
                frame,
            };
        });

        const copiedNodeById = new Map(clipboard.nodes.map((node) => [node.id, node]));
        const nextConnections = clipboard.connections.flatMap((connection, index) => {
            const sourceNodeId = idMap.get(connection.source.nodeId);
            const targetNodeId = idMap.get(connection.target.nodeId);
            if (!sourceNodeId || !targetNodeId) return [];
            const sourceNode = copiedNodeById.get(connection.source.nodeId);
            if (sourceNode && isVideoCompositionNode(sourceNode)) return [];
            return [
                {
                    ...connection,
                    id: `conn-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
                    source: { ...connection.source, nodeId: sourceNodeId },
                    target: { ...connection.target, nodeId: targetNodeId },
                },
            ];
        });

        setNodes((prev) => [...prev, ...nextNodes]);
        requestFocusNodes(nextNodes.map((node) => node.id));
        setConnections((prev) => [...prev, ...nextConnections]);
        setSelectedNodeIds(new Set(nextNodes.map((node) => node.id)));
        setSelectedConnectionId(null);
        setContextMenu(null);
        setDialogNodeId(nextNodes[0]?.id || null);
        return true;
    }, [getCanvasCenter, requestFocusNodes]);

    const restoreHistoryEntry = useCallback((entry: CanvasHistoryEntry) => {
        const pendingCommit = historyCommitTimerRef.current;
        if (pendingCommit) clearTimeout(pendingCommit);
        historyCommitTimerRef.current = null;
        applyingHistoryRef.current = true;
        const { nodes: restoredNodes, connections: restoredConnections, chatSessions: restoredSessions, activeChatId: restoredChatId, backgroundMode: restoredBackground, showImageInfo: restoredImageInformation } = entry;
        setNodes(restoredNodes);
        setConnections(restoredConnections);
        setChatSessions(restoredSessions);
        setActiveChatId(restoredChatId);
        setBackgroundMode(restoredBackground);
        setShowImageInfo(restoredImageInformation);
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        setContextMenu(null);
        queueMicrotask(() => {
            lastHistoryRef.current = entry;
            applyingHistoryRef.current = false;
            setHistoryState({ canUndo: historyRef.current.past.length > 0, canRedo: historyRef.current.future.length > 0 });
        });
    }, []);

    const navigateHistory = useCallback(
        (direction: "undo" | "redo") => {
            const sourceEntries = direction === "undo" ? historyRef.current.past : historyRef.current.future;
            const targetEntries = direction === "undo" ? historyRef.current.future : historyRef.current.past;
            const destination = sourceEntries.pop();
            const current = lastHistoryRef.current;
            if (!destination || !current) return;
            targetEntries.push(current);
            restoreHistoryEntry(destination);
        },
        [restoreHistoryEntry],
    );

    const undoCanvas = useCallback(() => navigateHistory("undo"), [navigateHistory]);
    const redoCanvas = useCallback(() => navigateHistory("redo"), [navigateHistory]);

    const confirmBackToProjects = useCallback(() => {
        modal.confirm({
            title: "返回画布列表？",
            content: "当前画布会自动保存，是否返回到画布列表？",
            okText: "返回列表",
            cancelText: "取消",
            onOk: () => router.push("/canvas"),
        });
    }, [modal, router]);

    const handleCanvasMouseDown = useCallback(
        (event: ReactPointerEvent<HTMLDivElement>) => {
            if (event.button !== 0) return;
            setContextMenu(null);
            if (pendingConnectionCreateRef.current) cancelPendingConnectionCreate();

            const startsRectangleSelection = event.ctrlKey || event.metaKey;
            if (!startsRectangleSelection) {
                setSelectionBox(null);
                setSelectedNodeIds(new Set());
                setSelectedConnectionId(null);
                return;
            }

            const origin = screenToCanvas(event.clientX, event.clientY);
            const selection = {
                startWorldX: origin.x,
                startWorldY: origin.y,
                currentWorldX: origin.x,
                currentWorldY: origin.y,
                additive: event.shiftKey,
                initialSelectedNodeIds: event.shiftKey ? [...selectedNodeIdsRef.current] : [],
            };
            selectionBoxRef.current = selection;
            setSelectionBox(selection);
            if (!event.shiftKey) setSelectedNodeIds(new Set());
            setSelectedConnectionId(null);
        },
        [cancelPendingConnectionCreate, screenToCanvas],
    );

    const handleNodeMouseDown = useCallback((event: ReactMouseEvent, nodeId: string) => {
        event.stopPropagation();
        setContextMenu(null);
        setHoveredNodeId(null);
        setToolbarNodeId(null);
        setSelectedConnectionId(null);

        // Ctrl+Shift+drag → start agent drop mode (not normal node drag)
        if (event.ctrlKey && event.shiftKey) {
            event.preventDefault();
            agentDropRef.current = { isActive: true, nodeId, startX: event.clientX, startY: event.clientY };
            return;
        }

        const currentNodes = nodesRef.current;
        const additive = event.shiftKey || event.metaKey || event.ctrlKey;
        const nextSelected = updateCanvasNodeSelection(selectedNodeIdsRef.current, nodeId, additive);
        setSelectedNodeIds(nextSelected);
        const groupedChildIds = currentNodes.flatMap((node) => (nextSelected.has(node.id) && isImageNode(node) ? node.grouping.childIds : []));
        const backgroundMemberIds = currentNodes.flatMap((node) => (nextSelected.has(node.id) && isBackgroundNode(node) ? node.memberNodeIds : []));
        const dragIds = new Set([...nextSelected, ...groupedChildIds, ...backgroundMemberIds]);
        const originalBackgroundMemberNodeIds = currentNodes.filter((node) => isBackgroundNode(node)).flatMap((node) => node.memberNodeIds);
        dragRef.current = {
            isDraggingNode: true,
            hasMoved: false,
            clickedNodeId: nodeId,
            startX: event.clientX,
            startY: event.clientY,
            initialSelectedNodes: currentNodes.filter((node) => dragIds.has(node.id)).map((node) => ({ id: node.id, x: node.frame.position.x, y: node.frame.position.y })),
            originalBackgroundMemberNodeIds,
        };
        historyPausedRef.current = true;
        nodeDraggingRef.current = true;
        setIsNodeDragging(true);
    }, []);

    const finishNodeDrag = useCallback((clientX?: number, clientY?: number) => {
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        if (!dragRef.current.isDraggingNode) return;

        const wasClick = !dragRef.current.hasMoved && Boolean(dragRef.current.clickedNodeId);
        const clickedNodeId = dragRef.current.clickedNodeId;
        const currentViewport = viewportRef.current;
        const dx = clientX == null ? 0 : (clientX - dragRef.current.startX) / currentViewport.k;
        const dy = clientY == null ? 0 : (clientY - dragRef.current.startY) / currentViewport.k;
        const initialPositions = dragRef.current.initialSelectedNodes;

        historyPausedRef.current = false;
        nodeDraggingRef.current = false;
        setIsNodeDragging(false);
        if (dragRef.current.hasMoved && clientX != null && clientY != null) {
            const movedNodeIds = new Set(initialPositions.map((item) => item.id));
            const originalBackgroundMemberNodeIds = new Set(dragRef.current.originalBackgroundMemberNodeIds);
            setNodes((currentNodes) => reconcileBackgroundBoardMembership(moveCanvasNodesFromOrigins(currentNodes, initialPositions, dx, dy), movedNodeIds, originalBackgroundMemberNodeIds));
        }

        dragRef.current.isDraggingNode = false;
        dragRef.current.hasMoved = false;
        dragRef.current.initialSelectedNodes = [];
        dragRef.current.originalBackgroundMemberNodeIds = [];
        if (wasClick && clickedNodeId) setDialogNodeId(clickedNodeId);
    }, []);

    const handleGlobalMouseMove = useCallback(
        (event: MouseEvent) => {
            const currentViewport = viewportRef.current;

            if (agentDropRef.current.isActive) {
                const { startX, startY, nodeId } = agentDropRef.current;
                if (Math.abs(event.clientX - startX) > 3 || Math.abs(event.clientY - startY) > 3) {
                    if (!agentDropPreviewRef.current && nodeId) {
                        createAgentDropPreview(nodeId, event.clientX, event.clientY);
                    }
                    updateAgentDropPreview(event.clientX, event.clientY);
                }
                return;
            }

            const dragState = dragRef.current;
            if (dragState.isDraggingNode) {
                const screenOffsetX = event.clientX - dragState.startX;
                const screenOffsetY = event.clientY - dragState.startY;
                dragState.hasMoved ||= Math.hypot(screenOffsetX, screenOffsetY) > 3;
                const scheduledFrame = rafRef.current;
                if (scheduledFrame !== null) cancelAnimationFrame(scheduledFrame);
                rafRef.current = window.requestAnimationFrame(() => {
                    setNodes((currentNodes) => moveCanvasNodesFromOrigins(currentNodes, dragState.initialSelectedNodes, screenOffsetX / currentViewport.k, screenOffsetY / currentViewport.k));
                    rafRef.current = null;
                });
                return;
            }

            if (connectingParamsRef.current && !pendingConnectionCreateRef.current) {
                const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, connectingParamsRef.current);
                connectionTargetNodeIdRef.current = dropTarget.nodeId;
                setConnectionTargetNodeId(dropTarget.nodeId);
                setMouseWorld(screenToCanvas(event.clientX, event.clientY));
            }
        },
        [getConnectionDropTarget, screenToCanvas],
    );

    const handleGlobalPointerMove = useCallback(
        (event: PointerEvent) => {
            const currentSelection = selectionBoxRef.current;
            if (!currentSelection) return;

            if (event.buttons === 0) {
                setSelectionBox(null);
                return;
            }

            const world = screenToCanvas(event.clientX, event.clientY);
            const nextSelected = new Set<string>(currentSelection.additive ? currentSelection.initialSelectedNodeIds : []);
            const visible = nodesRef.current.filter((node) => !isHiddenBatchChild(node, nodesRef.current));
            selectCanvasNodesInRectangle(visible, {
                left: Math.min(currentSelection.startWorldX, world.x),
                top: Math.min(currentSelection.startWorldY, world.y),
                right: Math.max(currentSelection.startWorldX, world.x),
                bottom: Math.max(currentSelection.startWorldY, world.y),
            }).forEach((nodeId) => nextSelected.add(nodeId));

            const nextSelectionBox = { ...currentSelection, currentWorldX: world.x, currentWorldY: world.y };
            setSelectionBox(nextSelectionBox);
            setSelectedNodeIds(nextSelected);
        },
        [screenToCanvas],
    );

    const handleGlobalMouseUp = useCallback(
        (event: MouseEvent) => {
            if (agentDropRef.current.isActive) {
                const { nodeId } = agentDropRef.current;
                // 实时读取面板位置，避免缓存过期
                const panelEl = document.querySelector("[data-agent-panel]");
                const panelRect = panelEl?.getBoundingClientRect() || null;
                if (nodeId && panelRect) {
                    const DROP_MARGIN = 80;
                    const isOverPanel = event.clientX >= panelRect.left - DROP_MARGIN && event.clientX <= panelRect.right && event.clientY >= panelRect.top - DROP_MARGIN && event.clientY <= panelRect.bottom + DROP_MARGIN;
                    if (isOverPanel) {
                        onNodeDropRef.current?.(nodeId);
                    }
                }
                removeAgentDropPreview();
                agentDropRef.current = { isActive: false, nodeId: null, startX: 0, startY: 0 };
                return;
            }

            finishNodeDrag(event.clientX, event.clientY);

            selectionBoxRef.current = null;
            setSelectionBox(null);

            if (pendingConnectionCreateRef.current) return;

            const currentConnection = connectingParamsRef.current;
            if (currentConnection) {
                const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, currentConnection);
                if (dropTarget.nodeId) {
                    connectNodes(currentConnection, dropTarget.nodeId);
                    setConnecting(null);
                } else if (dropTarget.isNearNode) {
                    setConnecting(null);
                } else {
                    const rect = containerRef.current?.getBoundingClientRect();
                    const position = screenToCanvas(event.clientX, event.clientY);
                    setMouseWorld(position);
                    setPendingConnectionCreate({
                        connection: currentConnection,
                        position,
                        menuPosition: {
                            x: event.clientX - (rect?.left || 0),
                            y: event.clientY - (rect?.top || 0),
                        },
                    });
                }
            }
        },
        [connectNodes, finishNodeDrag, getConnectionDropTarget, screenToCanvas, setConnecting],
    );

    useEffect(() => {
        const finishFromPointer = (event: PointerEvent) => finishNodeDrag(event.clientX, event.clientY);
        const cancelDrag = () => finishNodeDrag();
        const listeners = [
            ["mousemove", handleGlobalMouseMove],
            ["mouseup", handleGlobalMouseUp],
            ["pointerup", finishFromPointer],
            ["pointercancel", cancelDrag],
            ["blur", cancelDrag],
            ["pointermove", handleGlobalPointerMove],
        ] as const;
        listeners.forEach(([eventName, listener]) => window.addEventListener(eventName, listener as EventListener));
        return () => {
            listeners.forEach(([eventName, listener]) => window.removeEventListener(eventName, listener as EventListener));
        };
    }, [finishNodeDrag, handleGlobalMouseMove, handleGlobalMouseUp, handleGlobalPointerMove]);

    useEffect(() => {
        return () => {
            removeAgentDropPreview();
        };
    }, [removeAgentDropPreview]);

    const createImageFileNode = useCallback(
        async (file: File, position: CanvasPoint) => {
            try {
                const image = await uploadImage(file);
                const size = fitNodeSize(image.width, image.height);
                const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                const newNode = updateCanvasNodeFrame({ ...createCanvasNode("image", position, imageAttributes(image)), id, title: file.name }, { position: { x: position.x - size.width / 2, y: position.y - size.height / 2 }, ...size });

                setNodes((prev) => [...prev, newNode]);
                requestFocusNodes([newNode.id]);
                setSelectedNodeIds(new Set([id]));
                setSelectedConnectionId(null);
                setDialogNodeId(id);
            } catch (error) {
                message.error(error instanceof Error ? error.message : "上传图片失败");
            }
        },
        [message, requestFocusNodes],
    );

    const createVideoFileNode = useCallback(
        async (file: File, position: CanvasPoint) => {
            try {
                const video = await uploadMediaFile(file, "video");
                const size = fitNodeSize(video.width || 1280, video.height || 720, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                const node = updateCanvasNodeFrame({ ...createCanvasNode("video", position, videoAttributes(video)), id, title: file.name }, { position: { x: position.x - size.width / 2, y: position.y - size.height / 2 }, ...size });
                setNodes((prev) => [...prev, node]);
                requestFocusNodes([node.id]);
                setSelectedNodeIds(new Set([id]));
                setSelectedConnectionId(null);
                setDialogNodeId(id);
            } catch (error) {
                message.error(error instanceof Error ? error.message : "上传视频失败");
            }
        },
        [message, requestFocusNodes],
    );

    const createTextNodeFromClipboard = useCallback(
        (text: string) => {
            const trimmed = text.trim();
            if (!trimmed) return false;

            const node = {
                ...createCanvasNode("text", getCanvasCenter(), { content: trimmed, status: NODE_STATUS_SUCCESS }),
                title: trimmed.slice(0, 32) || "剪切板文本",
            };

            setNodes((prev) => [...prev, node]);
            requestFocusNodes([node.id]);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
            setContextMenu(null);
            setDialogNodeId(node.id);
            return true;
        },
        [getCanvasCenter, requestFocusNodes],
    );

    const pasteSystemClipboard = useCallback(async () => {
        if (!navigator.clipboard) return;
        const clipboardContent = await readCanvasSystemClipboard(navigator.clipboard);
        if (clipboardContent.kind === "image") {
            void createImageFileNode(clipboardContent.file, getCanvasCenter());
            message.success("已从剪切板添加图片");
            return;
        }
        if (createTextNodeFromClipboard(clipboardContent.text)) message.success("已从剪切板添加文本");
    }, [createImageFileNode, createTextNodeFromClipboard, getCanvasCenter, message]);

    const keyboardHandlers = useMemo(
        () => ({
            undo: undoCanvas,
            redo: redoCanvas,
            selectAll: () => {
                setSelectedNodeIds(new Set(nodesRef.current.map(({ id }) => id)));
                setSelectedConnectionId(null);
                setContextMenu(null);
                setSelectionBox(null);
            },
            copy: copySelectedNodes,
            paste: () => {
                if (!pasteCopiedNodes()) void pasteSystemClipboard();
            },
            delete: () => {
                if (selectedNodeIdsRef.current.size) confirmDeleteNodes(new Set(selectedNodeIdsRef.current));
                else if (selectedConnectionId) deleteConnection(selectedConnectionId);
            },
            cancel: () => {
                deselectCanvas();
                setConnecting(null);
                setEditingNodeId(null);
                setInfoNodeId(null);
                setCropNodeId(null);
                setPendingConnectionCreate(null);
            },
        }),
        [copySelectedNodes, confirmDeleteNodes, deleteConnection, deselectCanvas, pasteCopiedNodes, pasteSystemClipboard, redoCanvas, selectedConnectionId, setConnecting, undoCanvas],
    );
    useCanvasKeyboardShortcuts(keyboardHandlers);

    const handleConnectStart = useCallback(
        (event: ReactMouseEvent, nodeId: string, handleType: "source" | "target") => {
            event.stopPropagation();
            setMouseWorld(screenToCanvas(event.clientX, event.clientY));
            setConnecting({ nodeId, handleType });
            connectionTargetNodeIdRef.current = null;
            setConnectionTargetNodeId(null);
            setSelectedConnectionId(null);
        },
        [screenToCanvas, setConnecting],
    );

    const handleNodeResize = useCallback((nodeId: string, width: number, height: number, position?: CanvasPoint) => {
        setNodes((prev) => {
            const resized = prev.map((node) => (node.id === nodeId ? updateCanvasNodeFrame(node, { width, height, position: position || node.frame.position }) : node));
            return resized.some((node) => node.id === nodeId && isBackgroundNode(node)) ? expandBackgroundBoardsToMembers(resized) : resized;
        });
    }, []);

    const handleBackgroundNodeDrag = useCallback((_event: MouseEvent | TouchEvent, node: { id: string; position: { x: number; y: number } }) => {
        const board = nodesRef.current.find((item): item is CanvasBackgroundNode => item.id === node.id && isBackgroundNode(item));
        if (!board) return;
        const dragState = backgroundDragRef.current || {
            boardId: board.id,
            originX: board.frame.position.x,
            originY: board.frame.position.y,
            memberOrigins: board.memberNodeIds.flatMap((memberId) => {
                const member = nodesRef.current.find((item) => item.id === memberId);
                return member ? [{ id: member.id, x: member.frame.position.x, y: member.frame.position.y }] : [];
            }),
        };
        backgroundDragRef.current = dragState;
        const offsetX = node.position.x - dragState.originX;
        const offsetY = node.position.y - dragState.originY;
        setNodes((prev) => prev.map((item) => {
            if (item.id === dragState.boardId) return updateCanvasNodeFrame(item, { position: { x: node.position.x, y: node.position.y } });
            const origin = dragState.memberOrigins.find((candidate) => candidate.id === item.id);
            return origin ? updateCanvasNodeFrame(item, { position: { x: origin.x + offsetX, y: origin.y + offsetY } }) : item;
        }));
    }, []);

    const handleBackgroundNodeDragStop = useCallback(() => {
        backgroundDragRef.current = null;
    }, []);

    const handleBackgroundTitleChange = useCallback((node: CanvasBackgroundNode, title: string) => {
        setNodes((prev) => prev.map((item) => (item.id === node.id && isBackgroundNode(item) ? { ...item, title } : item)));
    }, []);

    const handleNodeTitleChange = useCallback((nodeId: string, title: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? updateCanvasNodeTitle(node, title) : node)));
    }, []);

    const handleBackgroundColorChange = useCallback((node: CanvasBackgroundNode, color: string) => {
        setNodes((prev) => prev.map((item) => (item.id === node.id && isBackgroundNode(item) ? { ...item, backgroundColor: color } : item)));
    }, []);

    const toggleNodeFreeResize = useCallback((nodeId: string) => {
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                const freeResize = !node.frame.freeResize;
                if (freeResize || !isImageNode(node)) return updateCanvasNodeFrame(node, { freeResize });
                const ratio = (node.frame.naturalWidth || node.frame.width) / (node.frame.naturalHeight || node.frame.height || 1);
                const height = node.frame.width / ratio;
                return updateCanvasNodeFrame(node, { height, position: { x: node.frame.position.x, y: node.frame.position.y + node.frame.height / 2 - height / 2 }, freeResize });
            }),
        );
    }, []);

    const handleNodeContentChange = useCallback((nodeId: string, content: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? applyCanvasNodeAttributes(node, { content }) : node)));
    }, []);

    const toggleBatchExpanded = useCallback((nodeId: string) => {
        if (batchTransitionIdsRef.current.has(nodeId)) return;
        const target = nodesRef.current.find((node) => node.id === nodeId);
        if (!target || !isImageNode(target)) return;
        const isExpanded = target.grouping.expanded;
        const prefersReducedMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const setTransitionIds = isExpanded ? setCollapsingBatchIds : setOpeningBatchIds;
        if (!prefersReducedMotion) {
            const transitionDuration = isExpanded ? 260 : 300;
            batchTransitionIdsRef.current.add(nodeId);
            setTransitionIds((current) => new Set(current).add(nodeId));
            window.setTimeout(() => {
                batchTransitionIdsRef.current.delete(nodeId);
                setTransitionIds((current) => {
                    const remaining = new Set(current);
                    remaining.delete(nodeId);
                    return remaining;
                });
            }, transitionDuration);
        }
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                return isImageNode(node) ? applyCanvasNodeAttributes(node, { imageBatchExpanded: !node.grouping.expanded }) : node;
            }),
        );
        if (isExpanded) {
            const childIds = new Set(target.grouping.childIds);
            setSelectedNodeIds((current) => new Set([...current].filter((selectedId) => !childIds.has(selectedId))));
        }
    }, []);

    const setBatchPrimary = useCallback((child: CanvasDomainNode) => {
        if (!isImageNode(child)) return;
        const rootId = child.grouping.rootId;
        if (!rootId || !child.content.source) return;
        setNodes((prev) =>
            prev.map((node) =>
                node.id === rootId && isImageNode(node)
                    ? updateCanvasNodeFrame(
                          applyCanvasNodeAttributes(node, {
                              content: child.content.source,
                              storageKey: child.content.storageKey,
                              mimeType: child.content.mimeType,
                              bytes: child.content.bytes,
                              objectStorage: child.content.objectStorage,
                              primaryImageId: child.id,
                              naturalWidth: child.frame.naturalWidth,
                              naturalHeight: child.frame.naturalHeight,
                              freeResize: child.frame.freeResize,
                          }),
                          { width: child.frame.width, height: child.frame.height },
                      )
                    : node,
            ),
        );
    }, []);

    const openTextEditor = useCallback((node: CanvasDomainNode) => {
        if (!isTextNode(node)) return;
        setSelectedNodeIds(new Set([node.id]));
        setSelectedConnectionId(null);
        setDialogNodeId(node.id);
        setEditingNodeId(node.id);
        setEditRequestNonce((value) => value + 1);
    }, []);

    const handleNodePromptChange = useCallback((nodeId: string, prompt: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? applyCanvasNodeAttributes(node, isTextNode(node) ? { content: prompt } : { prompt }) : node)));
    }, []);

    const handleConfigNodeChange = useCallback((nodeId: string, patch: CanvasNodeAttributes) => {
        const node = nodesRef.current.find((item) => item.id === nodeId);
        const nextPatch = node && isImageNode(node) && patch.settingGraph?.aspectRatio
            ? { ...patch, size: patch.settingGraph.aspectRatio }
            : patch;
        if (node) saveCanvasLastUsedGenerationSettings(node.kind, nextPatch);
        setNodes((prev) => prev.map((current) => {
            if (current.id !== nodeId) return current;
            const updated = applyCanvasNodeConfig(current, nextPatch);
            if (!isImageNode(updated) || !nextPatch.settingGraph?.aspectRatio || updated.frame.freeResize) return updated;
            const nextSize = nodeSizeFromRatio(nextPatch.settingGraph.aspectRatio, updated.frame.width, updated.frame.height);
            if (!nextSize) return updated;
            return updateCanvasNodeFrame(updated, {
                ...nextSize,
                position: {
                    x: updated.frame.position.x + (updated.frame.width - nextSize.width) / 2,
                    y: updated.frame.position.y + (updated.frame.height - nextSize.height) / 2,
                },
            });
        }));
    }, []);

    const resolveStoryboardRequest = useCallback(
        (node: CanvasStoryboardNode, selectedModel?: string) => {
            const source = findStoryboardScriptSource(node.id, nodesRef.current, connectionsRef.current);
            if (!source.ok) {
                message.error(source.error);
                return null;
            }
            const instruction = node.content.instruction.trim();
            if (!instruction) {
                message.error("请先填写分镜描述");
                return null;
            }
            const visualStyle = (node.content.visualStyle || "").trim();
            if (!visualStyle) {
                message.error("请先填写视觉风格");
                return null;
            }
            const modelValue = selectedModel === undefined ? node.content.model || effectiveConfig.textModel : selectedModel;
            const model = normalizeModelOptionValue(modelValue, effectiveConfig.channels);
            if (!model || !effectiveConfig.textModels.includes(model) || !isAiConfigReady(effectiveConfig, model)) {
                message.error("请选择可用的文本模型后再生成分镜");
                return null;
            }
            return {
                scriptContent: source.scriptContent,
                instruction,
                visualStyle,
                model,
                modelCost: readStoryboardModelCost(effectiveConfig.modelCosts, model),
            };
        },
        [effectiveConfig, isAiConfigReady, message],
    );

    const handleStoryboardInstructionChange = useCallback((nodeId: string, instruction: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? applyCanvasNodeAttributes(node, { content: instruction }) : node)));
    }, []);

    const handleStoryboardVisualStyleChange = useCallback((nodeId: string, visualStyle: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId && isStoryboardNode(node) ? updateStoryboardNodeContent(node, { visualStyle }) : node)));
    }, []);

    const handleStoryboardModelChange = useCallback(
        (nodeId: string, model: string) => {
            const normalizedModel = normalizeModelOptionValue(model, effectiveConfig.channels);
            setNodes((prev) => prev.map((node) => (node.id === nodeId ? applyCanvasNodeAttributes(node, { model: normalizedModel || model }) : node)));
        },
        [effectiveConfig.channels],
    );

    const handleStoryboardDataChange = useCallback((nodeId: string, updater: (storyboard: CanvasStoryboardNode["storyboard"]) => CanvasStoryboardNode["storyboard"]) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId && isStoryboardNode(node) ? updateStoryboardNodeData(node, updater(node.storyboard)) : node)));
    }, []);

    const updateStoryboardAssetGeneration = useCallback((nodeId: string, updater: (state: CanvasStoryboardAssetGenerationState) => CanvasStoryboardAssetGenerationState) => {
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId || !isStoryboardNode(node) || !node.storyboard.assetGeneration) return node;
                return updateStoryboardNodeData(node, { assetGeneration: updater(node.storyboard.assetGeneration) });
            }),
        );
    }, []);

    const handleGenerateStoryboardAssets = useCallback(
        async (nodeId: string, assetIds: string[], settings: CanvasStoryboardAssetGenerationSettings) => {
            const currentNode = nodesRef.current.find((item): item is CanvasStoryboardNode => item.id === nodeId && isStoryboardNode(item));
            if (!currentNode || currentNode.execution.phase === "running") return;
            const visualStyle = (currentNode.content.visualStyle || "").trim();
            if (!visualStyle) {
                message.error("请先在分镜脚本节点填写视觉风格");
                return;
            }
            const selectedIds = Array.from(new Set(assetIds));
            const selectedAssets = currentNode.storyboard.assets.filter((asset) => selectedIds.includes(asset.id));
            if (!selectedAssets.length) {
                message.error("请至少勾选一项资产");
                return;
            }
            if (selectedAssets.length !== selectedIds.length) {
                message.error("所选资产已发生变化，请重新选择");
                return;
            }
            const normalizedModel = normalizeModelOptionValue(settings.model, effectiveConfig.channels);
            if (!normalizedModel || !effectiveConfig.imageModels.includes(normalizedModel) || !isAiConfigReady(effectiveConfig, normalizedModel)) {
                message.error("请选择可用的图片模型后再生成资产图片");
                return;
            }
            const unnamedAsset = selectedAssets.find((asset) => !asset.name.trim());
            if (unnamedAsset) {
                message.error("请填写已勾选资产的名称后再生成图片");
                return;
            }
            const normalizedSettings: CanvasStoryboardAssetGenerationSettings = { ...settings, model: normalizedModel };
            const totalCredits = readStoryboardAssetImageCost(effectiveConfig.modelCosts, normalizedModel, selectedAssets.length);
            if (typeof creditBalance === "number" && totalCredits > creditBalance) {
                message.error(`积分不足，生成 ${selectedAssets.length} 项资产需要 ${totalCredits} 积分，当前可用 ${creditBalance} 积分`);
                return;
            }

            const startedAt = new Date().toISOString();
            const initialState = createStoryboardAssetGenerationState(selectedIds, normalizedSettings, startedAt);
            setNodes((prev) =>
                prev.map((node) =>
                    node.id === nodeId && isStoryboardNode(node)
                        ? updateCanvasNodeExecution(updateStoryboardNodeData(node, { assetGeneration: initialState }), { phase: "running", taskId: "", progress: 0, errorMessage: "", startedAt, completedAt: undefined })
                        : node,
                ),
            );

            const runAssetTask = async (asset: (typeof selectedAssets)[number]) => {
                try {
                    updateStoryboardAssetGeneration(nodeId, (state) => ({ ...state, statuses: { ...state.statuses, [asset.id]: "running" } }));
                    const task = await createStoryboardAssetImageTask(nodeId, asset, normalizedSettings, visualStyle);
                    updateStoryboardAssetGeneration(nodeId, (state) => ({ ...state, taskIds: { ...state.taskIds, [asset.id]: task.id }, statuses: { ...state.statuses, [asset.id]: "running" } }));
                    const completed = await waitAiTask(task.id, {
                        signal: new AbortController().signal,
                        onProgress: (snapshot) => {
                            setNodes((prev) =>
                                prev.map((node) =>
                                    node.id === nodeId && isStoryboardNode(node) ? updateCanvasNodeExecution(node, { progress: Math.max(node.execution.progress || 0, Math.round((snapshot.progress || 0) / selectedAssets.length)) }) : node,
                                ),
                            );
                        },
                    });
                    const image = readStoryboardAssetImage(completed);
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === nodeId && isStoryboardNode(node) && node.storyboard.assetGeneration
                                ? updateStoryboardNodeData(node, {
                                      assets: node.storyboard.assets.map((item) => (item.id === asset.id ? { ...item, image } : item)),
                                      assetGeneration: {
                                          ...node.storyboard.assetGeneration,
                                          statuses: { ...node.storyboard.assetGeneration.statuses, [asset.id]: "succeeded" },
                                          progress: readStoryboardAssetGenerationProgress({ ...node.storyboard.assetGeneration, statuses: { ...node.storyboard.assetGeneration.statuses, [asset.id]: "succeeded" } }),
                                          errors: Object.fromEntries(Object.entries(node.storyboard.assetGeneration.errors).filter(([id]) => id !== asset.id)),
                                      },
                                  })
                                : node,
                        ),
                    );
                    return true;
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : "资产图片生成失败";
                    updateStoryboardAssetGeneration(nodeId, (state) => {
                        const statuses = { ...state.statuses, [asset.id]: "failed" as const };
                        return { ...state, statuses, progress: readStoryboardAssetGenerationProgress({ ...state, statuses }), errors: { ...state.errors, [asset.id]: errorMessage } };
                    });
                    return false;
                }
            };

            const results = await Promise.all(selectedAssets.map((asset) => runAssetTask(asset)));
            const completedAt = new Date().toISOString();
            setNodes((prev) =>
                prev.map((node) => {
                    if (node.id !== nodeId || !isStoryboardNode(node) || !node.storyboard.assetGeneration) return node;
                    const state = node.storyboard.assetGeneration;
                    const hasFailed = state.selectedAssetIds.some((id) => state.statuses[id] === "failed");
                    const finishedState: CanvasStoryboardAssetGenerationState = {
                        ...state,
                        phase: hasFailed ? "failed" : "succeeded",
                        progress: 100,
                        completedAt,
                        errorMessage: hasFailed ? `部分资产图片生成失败（成功 ${results.filter(Boolean).length}/${results.length}）` : "",
                    };
                    return updateCanvasNodeExecution(updateStoryboardNodeData(node, { assetGeneration: finishedState }), {
                        phase: hasFailed ? "failed" : "succeeded",
                        progress: 100,
                        errorMessage: finishedState.errorMessage,
                        completedAt,
                    });
                }),
            );
            if (results.every(Boolean)) message.success(`已生成 ${results.length} 项资产图片`);
            else message.warning(`资产图片生成完成，成功 ${results.filter(Boolean).length}/${results.length} 项，失败任务已退款`);
        },
        [creditBalance, effectiveConfig, isAiConfigReady, message, updateStoryboardAssetGeneration],
    );

    const handleGenerateStoryboardVideos = useCallback(
        async (nodeId: string, shotIds: string[], selectedModel: string, selectedSettings: StoryboardVideoGenerationSettings) => {
            if (generatingStoryboardVideoNodeId) return;
            const currentNode = nodesRef.current.find((item): item is CanvasStoryboardNode => item.id === nodeId && isStoryboardNode(item));
            if (!currentNode || currentNode.execution.phase === "running") {
                message.error("分镜脚本正在处理，请稍后再生成视频");
                return;
            }
            const selectedShotIds = Array.from(new Set(shotIds));
            if (!selectedShotIds.length || selectedShotIds.length !== shotIds.length) {
                message.error("请选择至少一个有效镜头");
                return;
            }
            const selectedShotIdSet = new Set(selectedShotIds);
            const selectedShots = currentNode.storyboard.shots.filter((shot) => selectedShotIdSet.has(shot.id));
            if (selectedShots.length !== selectedShotIds.length) {
                message.error("所选镜头已发生变化，请重新选择");
                return;
            }
            const normalizedModel = normalizeModelOptionValue(selectedModel, effectiveConfig.channels);
            const generationConfig = {
                ...buildGenerationConfig(effectiveConfig, undefined, "video"),
                ...selectedSettings,
                model: normalizedModel,
                videoModel: normalizedModel,
                count: "1",
                canvasVideoCount: "1",
            };
            if (!normalizedModel || !effectiveConfig.videoModels.includes(normalizedModel) || !isAiConfigReady(generationConfig, normalizedModel)) {
                message.error("请选择可用的视频模型后再生成");
                return;
            }
            const storyboardReferenceVideos = readStoryboardVideoReferences(nodeId, nodesRef.current, connectionsRef.current);
            const invalidShot = selectedShots.find((shot) => readStoryboardVideoShotIssue(shot, generationConfig) || readStoryboardVideoReferenceIssue(shot, currentNode.storyboard.assets, generationConfig));
            if (invalidShot) {
                const issue = readStoryboardVideoShotIssue(invalidShot, generationConfig) || readStoryboardVideoReferenceIssue(invalidShot, currentNode.storyboard.assets, generationConfig);
                message.error(`镜号 ${invalidShot.shotNumber} 无法生成视频：${issue}`);
                return;
            }
            const videoQuote = readStoryboardVideoCost(effectiveConfig, normalizedModel, generationConfig, selectedShots, currentNode.storyboard.assets, storyboardReferenceVideos);
            if (!videoQuote.available) {
                message.error(videoQuote.reason);
                return;
            }
            if (typeof creditBalance === "number" && videoQuote.credits > creditBalance) {
                message.error(`积分不足，生成 ${selectedShots.length} 个视频需要 ${videoQuote.credits} 积分，当前可用 ${creditBalance} 积分`);
                return;
            }

            const referenceImagesByShotId = new Map(selectedShots.map((shot) => [shot.id, readStoryboardShotReferenceImages(shot, currentNode.storyboard.assets)]));
            const uniqueReferenceImages = [...new Map([...referenceImagesByShotId.values()].flat().map((image) => [image.id, image])).values()];
            const uploadedReferenceImages = await ensureVideoReferenceImagesObjectStorage(uniqueReferenceImages);
            if (!uploadedReferenceImages) return;
            const uploadedReferenceImageById = new Map(uploadedReferenceImages.map((image) => [image.id, image]));
            const preparedReferenceImagesByShotId = new Map([...referenceImagesByShotId].map(([shotId, references]) => [shotId, references.map((reference) => uploadedReferenceImageById.get(reference.id) || reference)]));
            const objectStorageByAssetId = new Map(uploadedReferenceImages.filter((image) => image.objectStorage?.url).map((image) => [image.id, image.objectStorage]));
            if (objectStorageByAssetId.size) {
                setNodes((prev) =>
                    prev.map((node) => {
                        if (node.id !== nodeId || !isStoryboardNode(node)) return node;
                        return updateStoryboardNodeData(node, {
                            assets: node.storyboard.assets.map((asset) => {
                                const objectStorage = objectStorageByAssetId.get(asset.id);
                                return asset.image && objectStorage ? { ...asset, image: { ...asset.image, objectStorage } } : asset;
                            }),
                        });
                    }),
                );
            }

            const videoTemplate = nodeSizeFromRatio(generationConfig.size, getCanvasNodeTemplate("video").width, getCanvasNodeTemplate("video").height) || getCanvasNodeTemplate("video");
            const occupiedStoryboardVideoNodes = nodesRef.current;
            const placedStoryboardVideoNodes: CanvasDomainNode[] = [];
            const createdVideoNodes = selectedShots.map((shot, index) => {
                const references = preparedReferenceImagesByShotId.get(shot.id) || [];
                const videoGenerationMode = readStoryboardVideoGenerationMode(shot, currentNode.storyboard.assets, storyboardReferenceVideos);
                const column = index % 2;
                const row = Math.floor(index / 2);
                const id = `video-${nanoid()}`;
                const preferredPosition = {
                    x: currentNode.frame.position.x + currentNode.frame.width + CONNECTED_NODE_GAP + column * (videoTemplate.width + 54),
                    y: currentNode.frame.position.y + row * (videoTemplate.height + 54),
                };
                const node = updateCanvasNodeFrame(
                    {
                        ...createCanvasNode(
                            "video",
                            { x: 0, y: 0 },
                            {
                                prompt: shot.finalPrompt.trim(),
                                status: NODE_STATUS_LOADING,
                                model: normalizedModel,
                                size: generationConfig.size,
                                seconds: String(shot.durationSeconds),
                                vquality: generationConfig.vquality,
                                videoGenerationMode,
                                watermark: generationConfig.videoWatermark,
                                count: 1,
                                ...generationVideoReferenceAttributes({ referenceImages: references, referenceVideos: storyboardReferenceVideos }),
                                generationStyleIds: [],
                                generationStyleSnapshots: [],
                            },
                        ),
                        id,
                        title: `镜头 ${String(shot.shotNumber).padStart(2, "0")} 视频`,
                    },
                    {
                        position: {
                            ...findNonOverlappingCanvasNodePosition([...occupiedStoryboardVideoNodes, ...placedStoryboardVideoNodes], preferredPosition, videoTemplate.width, videoTemplate.height),
                        },
                        width: videoTemplate.width,
                        height: videoTemplate.height,
                    },
                );
                placedStoryboardVideoNodes.push(node);
                return { id, shot, node, videoGenerationMode };
            });
            setGeneratingStoryboardVideoNodeId(nodeId);
            setNodes((prev) => [...prev, ...createdVideoNodes.map((item) => item.node)]);
            setConnections((prev) => [...prev, ...createdVideoNodes.map((item) => createRightToLeftConnection(currentNode.id, item.id))]);
            requestFocusNodes(createdVideoNodes.map((item) => item.id));
            setSelectedNodeIds(new Set(createdVideoNodes.map((item) => item.id)));
            setSelectedConnectionId(null);

            try {
                const results = await Promise.all(
                    createdVideoNodes.map(async ({ id, shot, videoGenerationMode }) => {
                        try {
                            const references = preparedReferenceImagesByShotId.get(shot.id) || [];
                            const shotGenerationConfig = {
                                ...generationConfig,
                                videoGenerationMode,
                                videoSeconds: String(shot.durationSeconds),
                                count: "1",
                                canvasVideoCount: "1",
                            };
                            const generatedVideo = await requestVideoGeneration(shotGenerationConfig, shot.finalPrompt.trim(), references, storyboardReferenceVideos, "storyboard", {
                                onProgress: (progress) => {
                                    setNodes((prev) => prev.map((node) => (node.id === id ? updateCanvasNodeExecution(node, { progress }) : node)));
                                },
                                onTaskCreated: (taskId) => {
                                    setNodes((prev) => prev.map((node) => (node.id === id ? updateCanvasNodeExecution(node, { taskId }) : node)));
                                },
                            });
                            const video = await storeGeneratedVideo(generatedVideo);
                            const completedSize = fitNodeSize(video.width || videoTemplate.width, video.height || videoTemplate.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                            setNodes((prev) =>
                                prev.map((node) => {
                                    if (node.id !== id) return node;
                                    const center = { x: node.frame.position.x + node.frame.width / 2, y: node.frame.position.y + node.frame.height / 2 };
                                    return updateCanvasNodeFrame(
                                        applyCanvasNodeAttributes(node, {
                                            ...videoAttributes(video),
                                            prompt: shot.finalPrompt.trim(),
                                            model: normalizedModel,
                                            size: generationConfig.size,
                                            seconds: String(shot.durationSeconds),
                                            vquality: generationConfig.vquality,
                                            videoGenerationMode,
                                            watermark: generationConfig.videoWatermark,
                                            count: 1,
                                            ...generationVideoReferenceAttributes({ referenceImages: references, referenceVideos: storyboardReferenceVideos }),
                                            generationStyleIds: [],
                                            generationStyleSnapshots: [],
                                        }),
                                        { position: { x: center.x - completedSize.width / 2, y: center.y - completedSize.height / 2 }, ...completedSize },
                                    );
                                }),
                            );
                            return true;
                        } catch (error) {
                            const structuredError = readAiTaskError(error);
                            setNodes((prev) => prev.map((node) => (node.id === id ? updateCanvasNodeExecution(node, { phase: "failed", errorMessage: structuredError.message }) : node)));
                            return false;
                        }
                    }),
                );
                if (results.every(Boolean)) message.success(`已创建 ${results.length} 个分镜视频任务`);
                else message.warning(`分镜视频生成完成，成功 ${results.filter(Boolean).length}/${results.length} 个，失败任务已退款`);
            } finally {
                setGeneratingStoryboardVideoNodeId(null);
            }
        },
        [creditBalance, effectiveConfig, ensureVideoReferenceImagesObjectStorage, generatingStoryboardVideoNodeId, isAiConfigReady, message, requestFocusNodes],
    );

    const handleGenerateStoryboard = useCallback(
        async (node: CanvasStoryboardNode) => {
            const currentNode = nodesRef.current.find((item): item is CanvasStoryboardNode => item.id === node.id && isStoryboardNode(item));
            if (!currentNode || currentNode.execution.phase === "running") return;
            const request = resolveStoryboardRequest(currentNode);
            if (!request) return;
            if (typeof creditBalance === "number" && request.modelCost > creditBalance) {
                message.error(`积分不足，首次生成需要 ${request.modelCost} 积分，当前可用 ${creditBalance} 积分`);
                return;
            }

            const startedAt = new Date().toISOString();
            setNodes((prev) => prev.map((item) => (item.id === currentNode.id ? updateCanvasNodeExecution(item, { phase: "running", taskId: "", progress: 0, errorMessage: "", startedAt }) : item)));
            try {
                const result = await generateStoryboard({
                    scriptContent: request.scriptContent,
                    instruction: request.instruction,
                    visualStyle: request.visualStyle,
                    model: request.model,
                });
                const completedAt = new Date().toISOString();
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === currentNode.id && isStoryboardNode(item) ? updateCanvasNodeExecution(replaceStoryboardGenerationResult(item, result.shots, result.assets), { phase: "succeeded", progress: 100, errorMessage: "", completedAt }) : item,
                    ),
                );
                applyStoryboardCreditCharge(result.chargedCredits, setCreditBalance);
                message.success(`分镜脚本已生成，消耗 ${result.chargedCredits} 积分`);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : "分镜脚本生成失败";
                setNodes((prev) => prev.map((item) => (item.id === currentNode.id ? updateCanvasNodeExecution(item, { phase: "failed", errorMessage, completedAt: new Date().toISOString() }) : item)));
                message.error(errorMessage);
            }
        },
        [creditBalance, message, resolveStoryboardRequest, setCreditBalance],
    );

    const handleComposeStoryboardPrompts = useCallback(
        async (nodeId: string, shotIds: string[], selectedModel: string) => {
            if (composingStoryboardNodeId || composingStoryboardShot) return;
            const currentNode = nodesRef.current.find((item): item is CanvasStoryboardNode => item.id === nodeId && isStoryboardNode(item));
            if (!currentNode || currentNode.execution.phase === "running") return;
            const selectedShotIds = new Set(shotIds);
            if (!selectedShotIds.size || selectedShotIds.size !== shotIds.length) {
                message.error("请选择至少一个有效镜头");
                return;
            }
            const selectedShots = currentNode.storyboard.shots.filter((shot) => selectedShotIds.has(shot.id));
            if (selectedShots.length !== selectedShotIds.size) {
                message.error("部分选择的镜头不存在或已被删除");
                return;
            }
            const request = resolveStoryboardRequest(currentNode, selectedModel);
            if (!request) return;
            const compositionAssets = collectStoryboardCompositionAssets(selectedShots, currentNode.storyboard.assets);
            const validationError = validateStoryboardComposition(selectedShots, compositionAssets);
            if (validationError) {
                message.error(validationError);
                return;
            }
            const totalCredits = request.modelCost * selectedShots.length;
            if (typeof creditBalance === "number" && totalCredits > creditBalance) {
                message.error(`积分不足，合成 ${selectedShots.length} 个镜头需要 ${totalCredits} 积分，当前可用 ${creditBalance} 积分`);
                return;
            }

            const startedAt = new Date().toISOString();
            setComposingStoryboardNodeId(currentNode.id);
            setNodes((prev) => prev.map((item) => (item.id === currentNode.id ? updateCanvasNodeExecution(item, { phase: "running", taskId: "", progress: 0, errorMessage: "", startedAt }) : item)));
            try {
                const result = await composeStoryboardPrompts({
                    scriptContent: request.scriptContent,
                    instruction: request.instruction,
                    visualStyle: request.visualStyle,
                    model: request.model,
                    shots: selectedShots,
                    assets: compositionAssets.map(({ id, kind, name, description }) => ({ id, kind, name, description })),
                });
                const promptByShotId = new Map(result.prompts.map((prompt) => [prompt.shotId, prompt.finalPrompt]));
                const completedAt = new Date().toISOString();
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === currentNode.id && isStoryboardNode(item)
                            ? updateCanvasNodeExecution(
                                  updateStoryboardNodeData(item, {
                                      shots: item.storyboard.shots.map((shot) => ({ ...shot, finalPrompt: promptByShotId.get(shot.id) || shot.finalPrompt })),
                                  }),
                                  { phase: "succeeded", progress: 100, errorMessage: "", completedAt },
                              )
                            : item,
                    ),
                );
                applyStoryboardCreditCharge(result.chargedCredits, setCreditBalance);
                message.success(`已生成 ${selectedShots.length} 个镜头的最终提示词，消耗 ${result.chargedCredits} 积分`);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : "提示词合成失败";
                setNodes((prev) => prev.map((item) => (item.id === currentNode.id ? updateCanvasNodeExecution(item, { phase: "failed", errorMessage, completedAt: new Date().toISOString() }) : item)));
                message.error(errorMessage);
            } finally {
                setComposingStoryboardNodeId((current) => (current === nodeId ? null : current));
            }
        },
        [composingStoryboardNodeId, composingStoryboardShot, creditBalance, message, resolveStoryboardRequest, setCreditBalance],
    );

    const handleComposeStoryboardShotPrompt = useCallback(
        async (nodeId: string, shotId: string) => {
            if (composingStoryboardNodeId || composingStoryboardShot) return;
            const currentNode = nodesRef.current.find((item): item is CanvasStoryboardNode => item.id === nodeId && isStoryboardNode(item));
            if (!currentNode || currentNode.execution.phase === "running") return;
            const shot = currentNode.storyboard.shots.find((item) => item.id === shotId);
            if (!shot) {
                message.error("镜头不存在或已被删除");
                return;
            }
            const request = resolveStoryboardRequest(currentNode);
            if (!request) return;
            const compositionAssets = collectStoryboardCompositionAssets([shot], currentNode.storyboard.assets);
            const validationError = validateStoryboardComposition([shot], compositionAssets);
            if (validationError) {
                message.error(validationError);
                return;
            }
            if (typeof creditBalance === "number" && request.modelCost > creditBalance) {
                message.error(`积分不足，合成镜号 ${shot.shotNumber} 需要 ${request.modelCost} 积分，当前可用 ${creditBalance} 积分`);
                return;
            }

            setComposingStoryboardShot({ nodeId, shotId });
            try {
                const result = await composeStoryboardPrompts({
                    scriptContent: request.scriptContent,
                    instruction: request.instruction,
                    visualStyle: request.visualStyle,
                    model: request.model,
                    shots: [shot],
                    assets: compositionAssets.map(({ id, kind, name, description }) => ({ id, kind, name, description })),
                });
                const finalPrompt = result.prompts.find((item) => item.shotId === shotId)?.finalPrompt;
                if (!finalPrompt) throw new Error("提示词合成完成，但未返回当前镜头结果");
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === nodeId && isStoryboardNode(item)
                            ? updateStoryboardNodeData(item, {
                                  shots: item.storyboard.shots.map((currentShot) => (currentShot.id === shotId ? { ...currentShot, finalPrompt } : currentShot)),
                              })
                            : item,
                    ),
                );
                applyStoryboardCreditCharge(result.chargedCredits, setCreditBalance);
                message.success(`镜号 ${shot.shotNumber} 的最终提示词已生成，消耗 ${result.chargedCredits} 积分`);
            } catch (error) {
                message.error(error instanceof Error ? error.message : "当前镜头提示词生成失败");
            } finally {
                setComposingStoryboardShot((current) => (current?.nodeId === nodeId && current.shotId === shotId ? null : current));
            }
        },
        [composingStoryboardNodeId, composingStoryboardShot, creditBalance, message, resolveStoryboardRequest, setCreditBalance],
    );

    const downloadNodeImage = useCallback((node: CanvasDomainNode) => {
        if ((!isImageNode(node) && !isVideoNode(node)) || !node.content.source) return;
        saveAs(node.content.source, `canvas-${node.kind}-${node.id}.${isVideoNode(node) ? "mp4" : imageExtension(node.content.source)}`);
    }, []);

    const uploadNodeObjectStorage = useCallback(
        async (node: CanvasDomainNode) => {
            if (!isImageNode(node) && !isVideoNode(node)) return;
            if (!node.content.source) {
                message.error(isImageNode(node) ? "没有可上传的图片" : "没有可上传的视频");
                return;
            }
            if (node.content.objectStorage?.url) {
                try {
                    await navigator.clipboard.writeText(node.content.objectStorage.url);
                    message.success("云储存地址已复制");
                } catch {
                    message.error("云储存地址复制失败");
                }
                return;
            }
            try {
                const blob = await readNodeObjectStorageBlob(node);
                if (!blob) throw new Error(isImageNode(node) ? "图片文件读取失败" : "视频文件读取失败");
                const objectStorageFile = await uploadObjectToStorage({
                    body: blob,
                    kind: node.kind,
                    fileName: `${node.title || node.id}.${isImageNode(node) ? imageExtension(node.content.source) : "mp4"}`,
                    mimeType: node.content.mimeType || blob.type || (isImageNode(node) ? "image/png" : "video/mp4"),
                });
                setNodes((prev) => prev.map((item) => (item.id === node.id ? applyCanvasNodeAttributes(item, { objectStorage: objectStorageFile }) : item)));
                message.success("已上传到云储存，地址已保存到节点");
            } catch (error) {
                message.error(error instanceof Error ? error.message : "上传到云储存失败");
            }
        },
        [message],
    );

    const saveNodeAsset = useCallback(
        async (node: CanvasDomainNode) => {
            if (isTextNode(node)) {
                const content = node.content.text.trim();
                if (!content) return message.error("没有可保存的文本");
                addAsset({ kind: "text", title: content.slice(0, 24) || "画布文本", coverUrl: "", tags: [], source: "Canvas", data: { content }, metadata: { source: "canvas", nodeId: node.id } });
                message.success("已加入我的资产");
                return;
            }
            if (isVideoNode(node)) {
                if (!node.content.source) return message.error("没有可保存的视频");
                addAsset({
                    kind: "video",
                    title: node.generation.prompt.slice(0, 24) || "画布视频",
                    coverUrl: "",
                    tags: [],
                    source: "Canvas",
                    data: {
                        url: node.content.source,
                        storageKey: node.content.storageKey,
                        width: node.frame.width,
                        height: node.frame.height,
                        bytes: node.content.bytes || 0,
                        mimeType: node.content.mimeType || "video/mp4",
                        objectStorage: node.content.objectStorage,
                    },
                    metadata: { source: "canvas", nodeId: node.id, prompt: node.generation.prompt },
                });
                message.success("已加入我的资产");
                return;
            }
            if (!isImageNode(node)) return;
            if (!node.content.source) return message.error("没有可保存的图片");
            const dataUrl = node.content.storageKey ? "" : node.content.source;
            addAsset({
                kind: "image",
                title: node.generation.prompt.slice(0, 24) || "画布图片",
                coverUrl: node.content.source,
                tags: [],
                source: "Canvas",
                data: {
                    dataUrl,
                    storageKey: node.content.storageKey,
                    width: node.frame.naturalWidth || node.frame.width,
                    height: node.frame.naturalHeight || node.frame.height,
                    bytes: node.content.bytes || getDataUrlByteSize(dataUrl),
                    mimeType: node.content.mimeType || "image/png",
                    objectStorage: node.content.objectStorage,
                },
                metadata: { source: "canvas", nodeId: node.id, prompt: node.generation.prompt },
            });
            message.success("已加入我的资产");
        },
        [addAsset, message],
    );

    const cropImageNode = useCallback(
        async (node: CanvasDomainNode, crop: CanvasImageCropRect) => {
            if (!isImageNode(node) || !node.content.source) return;
            setCroppingNodeId(node.id);
            try {
                const cropped = await withNodeImageObjectUrl(node, (sourceUrl) => cropDataUrl(sourceUrl, crop));
                const image = await uploadImage(cropped);
                const width = Math.min(node.frame.width, Math.max(220, image.width));
                const childId = nanoid();
                const height = width * (image.height / image.width);
                const position = findNonOverlappingCanvasNodePosition(nodesRef.current, { x: node.frame.position.x + node.frame.width + 96, y: node.frame.position.y }, width, height);
                const child = updateCanvasNodeFrame(
                    { ...createCanvasNode("image", node.frame.position, { ...imageAttributes(image), prompt: node.generation.prompt }), id: childId, title: "裁剪图片" },
                    { position, width, height },
                );
                setNodes((prev) => [...prev, child]);
                requestFocusNodes([childId]);
                setConnections((prev) => [...prev, createRightToLeftConnection(node.id, childId)]);
                setSelectedNodeIds(new Set([childId]));
                setDialogNodeId(childId);
                setCropNodeId(null);
            } catch (error) {
                message.error(error instanceof Error ? error.message : "裁剪图片失败");
            } finally {
                setCroppingNodeId((current) => (current === node.id ? null : current));
            }
        },
        [message, requestFocusNodes],
    );

    const splitImageNode = useCallback(
        async (node: CanvasDomainNode, params: CanvasImageSplitParams) => {
            if (!isImageNode(node) || !node.content.source) return;
            setSplittingNodeId(node.id);
            try {
                const pieces = await withNodeImageObjectUrl(node, (sourceUrl) => splitDataUrl(sourceUrl, params));
                const gap = 16;
                const cellWidth = node.frame.width / params.columns;
                const cellHeight = node.frame.height / params.rows;
                const startX = node.frame.position.x + node.frame.width + 96;
                const startY = node.frame.position.y;
                const childNodes = await Promise.all(
                    pieces.map(async (piece) => {
                        const image = await uploadImage(piece.dataUrl);
                        const id = nanoid();
                        return updateCanvasNodeFrame(
                            { ...createCanvasNode("image", { x: 0, y: 0 }, { ...imageAttributes(image), prompt: node.generation.prompt }), id, title: `${node.title || "图片"} ${piece.row + 1}-${piece.column + 1}` },
                            { position: { x: startX + piece.column * (cellWidth + gap), y: startY + piece.row * (cellHeight + gap) }, width: cellWidth, height: cellHeight },
                        );
                    }),
                );
                const placedChildNodes: CanvasDomainNode[] = [];
                childNodes.forEach((child) => {
                    const position = findNonOverlappingCanvasNodePosition(
                        [...nodesRef.current, ...placedChildNodes],
                        child.frame.position,
                        child.frame.width,
                        child.frame.height,
                    );
                    placedChildNodes.push(updateCanvasNodeFrame(child, { position }));
                });
                setNodes((prev) => [...prev, ...placedChildNodes]);
                requestFocusNodes(placedChildNodes.map((child) => child.id));
                setConnections((prev) => [...prev, ...placedChildNodes.map((child) => createRightToLeftConnection(node.id, child.id))]);
                setSelectedNodeIds(new Set(placedChildNodes.map((child) => child.id)));
                setSelectedConnectionId(null);
                setDialogNodeId(null);
                setSplitNodeId(null);
                message.success(`已切分为 ${placedChildNodes.length} 个子节点`);
            } catch (error) {
                message.error(error instanceof Error ? error.message : "切分图片失败");
            } finally {
                setSplittingNodeId((current) => (current === node.id ? null : current));
            }
        },
        [message, requestFocusNodes],
    );

    const handleFontSizeChange = useCallback((nodeId: string, fontSize: number) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? applyCanvasNodeAttributes(node, { fontSize }) : node)));
    }, []);

    const handleUploadRequest = useCallback((nodeId?: string, position?: CanvasPoint) => {
        uploadTargetRef.current = { nodeId, position };
        imageInputRef.current?.click();
    }, []);

    const handleImageInputChange = useCallback(
        async (event: ReactChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            const target = uploadTargetRef.current;
            if (!file || (!file.type.startsWith("image/") && !file.type.startsWith("video/"))) return;

            if (target?.nodeId) {
                try {
                    if (file.type.startsWith("video/")) {
                        const video = await uploadMediaFile(file, "video");
                        const nextSize = fitNodeSize(video.width || 1280, video.height || 720, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                        setNodes((prev) =>
                            prev.map((node) => {
                                if (node.id !== target.nodeId) return node;
                                const center = { x: node.frame.position.x + node.frame.width / 2, y: node.frame.position.y + node.frame.height / 2 };
                                const replacement = { ...createCanvasNode("video", center, videoAttributes(video)), id: node.id, title: file.name };
                                return updateCanvasNodeFrame(replacement, { position: { x: center.x - nextSize.width / 2, y: center.y - nextSize.height / 2 }, ...nextSize });
                            }),
                        );
                        setSelectedNodeIds(new Set([target.nodeId]));
                        setSelectedConnectionId(null);
                        setDialogNodeId(target.nodeId);
                        return;
                    }
                    const image = await uploadImage(file);
                    const size = fitNodeSize(image.width, image.height);
                    setNodes((prev) =>
                        prev.map((node) => {
                            if (node.id !== target.nodeId) return node;
                            const center = { x: node.frame.position.x + node.frame.width / 2, y: node.frame.position.y + node.frame.height / 2 };
                            const replacement = { ...createCanvasNode("image", center, imageAttributes(image)), id: node.id, title: file.name };
                            return updateCanvasNodeFrame(replacement, { position: { x: center.x - size.width / 2, y: center.y - size.height / 2 }, ...size, freeResize: false });
                        }),
                    );
                    setSelectedNodeIds(new Set([target.nodeId]));
                    setSelectedConnectionId(null);
                    setDialogNodeId(target.nodeId);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "上传媒体失败");
                } finally {
                    uploadTargetRef.current = null;
                    event.target.value = "";
                }
            } else {
                const position = target?.position || screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
                void (file.type.startsWith("video/") ? createVideoFileNode(file, position) : createImageFileNode(file, position));
            }

            uploadTargetRef.current = null;
            event.target.value = "";
        },
        [createImageFileNode, createVideoFileNode, message, screenToCanvas, size.height, size.width],
    );

    const handleDrop = useCallback(
        (event: ReactDragEvent<HTMLDivElement>) => {
            event.preventDefault();
            const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith("image/") || item.type.startsWith("video/"));
            if (!file) return;

            const pos = screenToCanvas(event.clientX, event.clientY);
            void (file.type.startsWith("video/") ? createVideoFileNode(file, pos) : createImageFileNode(file, pos));
        },
        [createImageFileNode, createVideoFileNode, screenToCanvas],
    );

    const pasteAssistantImage = useCallback(
        (file: File) => {
            const position = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            void createImageFileNode(file, position);
            message.success("已从剪切板添加图片");
        },
        [createImageFileNode, message, screenToCanvas, size.height, size.width],
    );

    const handleAssistantSessionsChange = useCallback((sessions: CanvasAssistantSession[], activeId: string | null) => {
        setChatSessions(sessions);
        setActiveChatId(activeId);
    }, []);

    const updateAssistantSession = useCallback((sessionId: string, updater: (session: CanvasAssistantSession) => CanvasAssistantSession) => {
        setChatSessions((prev) => prev.map((session) => (session.id === sessionId ? updater(session) : session)));
    }, []);

    const appendAssistantMessage = useCallback(
        (sessionId: string, assistantMessage: CanvasAssistantMessage) => {
            updateAssistantSession(sessionId, (session) => ({
                ...session,
                title: session.messages.length ? session.title : assistantMessage.text.slice(0, 18) || "新对话",
                messages: [...session.messages, assistantMessage],
                updatedAt: new Date().toISOString(),
            }));
        },
        [updateAssistantSession],
    );

    const upsertAssistantMessage = useCallback(
        (sessionId: string, messageId: string, text: string) => {
            updateAssistantSession(sessionId, (session) => {
                const exists = session.messages.some((item) => item.id === messageId);
                return {
                    ...session,
                    title: session.messages.length ? session.title : text.slice(0, 18) || "新对话",
                    messages: exists ? session.messages.map((item) => (item.id === messageId ? { ...item, role: "assistant" as const, text } : item)) : [...session.messages, { id: messageId, role: "assistant" as const, text }],
                    updatedAt: new Date().toISOString(),
                };
            });
        },
        [updateAssistantSession],
    );

    const removeAssistantMessage = useCallback(
        (sessionId: string, messageId: string) => {
            updateAssistantSession(sessionId, (session) => ({
                ...session,
                messages: session.messages.filter((item) => item.id !== messageId),
                updatedAt: new Date().toISOString(),
            }));
        },
        [updateAssistantSession],
    );

    const { appendTextDelta, completeTextMessage, resetTextStream } = useAssistantMessageStream({
        onMessageDrain: upsertAssistantMessage,
        onDisplayText: upsertAssistantMessage,
        onTaskDisplayComplete: () => {
            activeAgentAssistantMessageIdRef.current = null;
            setAgentRunning(false);
            setAgentQueued(false);
        },
    });

    const {
        sendMessage: sendAgentMessage,
        cancelMessage: cancelAgentMessage,
        resetSession: resetAgentSession,
    } = useAgentSSE({
        snapshot: agentSnapshot,
        onApplyOps: applyAgentOps,
        onToolExecute: () => {
            const sessionId = activeAgentSessionIdRef.current;
            const messageId = activeAgentAssistantMessageIdRef.current;
            resetTextStream(false);
            if (sessionId && messageId) removeAssistantMessage(sessionId, messageId);
            activeAgentAssistantMessageIdRef.current = null;
        },
        onTextDelta: (_messageId, delta) => {
            const sessionId = activeAgentSessionIdRef.current;
            if (!sessionId) return;
            const displayMessageId = activeAgentAssistantMessageIdRef.current || nanoid();
            activeAgentAssistantMessageIdRef.current = displayMessageId;
            appendTextDelta(sessionId, displayMessageId, delta);
        },
        onThoughtDelta,
        onThoughtComplete,
        onTaskComplete: (_messageId, text) => {
            resetThinkings();
            const sessionId = activeAgentSessionIdRef.current;
            if (!sessionId) return;
            const displayMessageId = activeAgentAssistantMessageIdRef.current || nanoid();
            activeAgentAssistantMessageIdRef.current = displayMessageId;
            completeTextMessage(sessionId, displayMessageId, text);
        },
        onCanceled: () => {
            resetThinkings();
            resetTextStream(false);
            activeAgentAssistantMessageIdRef.current = null;
            setAgentRunning(false);
            setAgentQueued(false);
        },
        onQueueStatus: (status) => {
            setAgentQueued(status === "queued");
            setAgentRunning(status === "running");
        },
        onRequestFinished: () => {
            setAgentQueued(false);
            setAgentRunning(false);
        },
        onPlanCreated: (planId, summary, taskCount) => {
            const sessionId = activeAgentSessionIdRef.current;
            if (!sessionId) return;
            appendAssistantMessage(sessionId, {
                id: `plan-${planId}`,
                role: "system",
                title: "创作计划",
                text: summary,
                meta: `${taskCount} 个任务`,
            });
        },
        onPlanTaskStatus: (planId, _taskId, status, statusMessage) => {
            const sessionId = activeAgentSessionIdRef.current;
            if (!sessionId) return;
            updateAssistantSession(sessionId, (session) => ({
                ...session,
                messages: session.messages.map((item) => {
                    if (item.id !== `plan-${planId}`) return item;
                    // 已标记失败的计划不被后到的诊断/调整/重试等中间状态覆盖，避免失败显示回退为执行中。
                    if (item.meta?.startsWith("失败：") && status !== "failed") return item;
                    return { ...item, meta: status === "failed" ? `失败：${statusMessage}` : statusMessage };
                }),
                updatedAt: new Date().toISOString(),
            }));
        },
        onPromptPrepared: (planId, _taskId, strategy) => {
            const sessionId = activeAgentSessionIdRef.current;
            if (!sessionId) return;
            updateAssistantSession(sessionId, (session) => ({
                ...session,
                messages: session.messages.map((item) => (item.id === `plan-${planId}` ? { ...item, meta: strategy === "OPTIMIZE" ? "提示词已优化" : "保留原始提示词" } : item)),
                updatedAt: new Date().toISOString(),
            }));
        },
        onError: (errorMessage) => {
            resetThinkings();
            const sessionId = activeAgentSessionIdRef.current;
            const messageId = activeAgentAssistantMessageIdRef.current;
            resetTextStream(false);
            if (sessionId && messageId) removeAssistantMessage(sessionId, messageId);
            activeAgentAssistantMessageIdRef.current = null;
            if (sessionId) {
                appendAssistantMessage(sessionId, { id: nanoid(), role: "error", title: "操作失败", text: `错误: ${errorMessage}` });
            }
            setAgentRunning(false);
            setAgentQueued(false);
        },
    });

    const handleCreateAgentSession = useCallback(() => {
        if (agentRunning || agentQueued) return;
        resetThinkings();
        const activeSession = chatSessions.find((session) => session.id === activeChatId);
        if (activeSession && activeSession.messages.length === 0) {
            resetAgentSession();
            activeAgentSessionIdRef.current = activeSession.id;
            activeAgentAssistantMessageIdRef.current = null;
            return;
        }
        const now = new Date().toISOString();
        const sessionId = nanoid();
        const newSession: CanvasAssistantSession = {
            id: sessionId,
            title: "新对话",
            messages: [],
            createdAt: now,
            updatedAt: now,
        };
        activeAgentSessionIdRef.current = sessionId;
        activeAgentAssistantMessageIdRef.current = null;
        resetAgentSession();
        handleAssistantSessionsChange([...chatSessions, newSession], sessionId);
    }, [activeChatId, agentQueued, agentRunning, chatSessions, handleAssistantSessionsChange, resetAgentSession, resetThinkings]);

    const activeSessionMessages = useMemo(() => chatSessions.find((s) => s.id === activeChatId)?.messages || [], [chatSessions, activeChatId]);

    const handleSettingGraphGenerate = useCallback(
        async (nodeId: string, prompt: string, skill: CanvasSettingGraphSkillSnapshot) => {
            if (agentRunning || agentQueued) {
                message.warning("画布Agent正在处理，请等待当前任务完成");
                return;
            }
            const effectivePrompt = resolveNodeGenerationPrompt(nodeId, nodesRef.current, connectionsRef.current, prompt, true);
            if (!effectivePrompt) {
                message.warning("请输入生成描述或连接有内容的上游节点");
                return;
            }
            const sessionId = activeChatId || nanoid();
            activeAgentSessionIdRef.current = sessionId;
            activeAgentAssistantMessageIdRef.current = null;
            resetThinkings();
            resetTextStream(false);
            setAgentQueued(true);
            const userMessage: CanvasAssistantMessage = { id: nanoid(), role: "user", text: effectivePrompt };
            if (!activeChatId) {
                const now = new Date().toISOString();
                handleAssistantSessionsChange([{ id: sessionId, title: `设定图：${skill.name}`, messages: [userMessage], createdAt: now, updatedAt: now }], sessionId);
            } else {
                appendAssistantMessage(sessionId, userMessage);
            }
            try {
                await sendAgentMessage(
                    effectivePrompt,
                    [],
                    config.agentModel || undefined,
                    buildAgentChatHistory(activeSessionMessages),
                    undefined,
                    {
                        size: skill.aspectRatio || "16:9",
                        resolution: config.imageResolution || undefined,
                        quality: config.quality || undefined,
                        // 设定图节点始终只生成一张，避免沿用画布批量生成数量。
                        count: 1,
                        settingGraphNodeId: nodeId,
                        settingGraphSkillSnapshot: skill,
                    },
                    String(skill.id),
                );
            } catch (error) {
                message.error(error instanceof Error ? error.message : "设定图生成失败");
                setAgentQueued(false);
                setAgentRunning(false);
            }
        },
        [activeChatId, activeSessionMessages, agentQueued, agentRunning, appendAssistantMessage, config.agentModel, config.canvasImageCount, config.count, config.imageResolution, config.quality, config.size, handleAssistantSessionsChange, message, resetTextStream, resetThinkings, sendAgentMessage],
    );

    const startTitleEditing = useCallback(() => {
        setTitleDraft(currentDocument?.identity.title || "未命名画布");
        setTitleEditing(true);
    }, [currentDocument?.identity.title]);

    const finishTitleEditing = useCallback(() => {
        const nextTitle = titleDraft.trim();
        if (nextTitle) renameDocument(projectId, nextTitle);
        setTitleEditing(false);
    }, [projectId, renameDocument, titleDraft]);

    const preventCanvasContextMenu = useCallback((event: ReactMouseEvent) => {
        if ((event.target as HTMLElement).closest("[data-node-id]")) return;
        event.preventDefault();
        setContextMenu(null);
    }, []);

    const handleGenerateNode = useCallback(
        async (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string, recovery = false, externalSignal?: AbortSignal, styleContext?: { ids?: number[]; snapshots?: GenerationStyleSnapshot[] }): Promise<CanvasAgentToolResult> => {
            if (recovery) {
                const retryNode = nodesRef.current.find((node) => node.id === nodeId);
                if (!retryNode) return failedCanvasGenerationResult(nodeId, canvasError("invalid_parameter", `生成节点不存在: ${nodeId}`, "nodeId"));
                const retry = retryNodeRef.current;
                if (!retry) return failedCanvasGenerationResult(nodeId, canvasError("configuration", "画布重试执行器尚未就绪"));
                return retry(retryNode, externalSignal);
            }
            if (isGenerationRunning(nodeId)) {
                return failedCanvasGenerationResult(nodeId, canvasError("configuration", "当前节点正在生成，请等待任务完成"));
            }
            const sourceNode = nodesRef.current.find((node) => node.id === nodeId);
            const generationConfig = buildGenerationConfig(effectiveConfig, sourceNode, mode);
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                showMissingAiConfig(mode);
                return failedCanvasGenerationResult(nodeId, canvasError("configuration", "模型配置不完整"));
            }

            const sourceTextContent = sourceNode && isTextNode(sourceNode) ? sourceNode.content.text.trim() : "";
            const editingTextNode = mode === "text" && Boolean(sourceTextContent);
            let generationContext: Awaited<ReturnType<typeof hydrateNodeGenerationContext>>;
            try {
                generationContext = await hydrateNodeGenerationContext(
                    buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, editingTextNode ? `请根据要求修改以下文本。\n\n原文：\n${sourceTextContent}\n\n修改要求：\n${prompt}` : prompt),
                    mode,
                );
            } catch (error) {
                if (isGenerationCanceled(error) || externalSignal?.aborted) return canceledCanvasGenerationResult();
                return failedCanvasGenerationResult(nodeId, readAiTaskError(error));
            }
            if (externalSignal?.aborted) return canceledCanvasGenerationResult();
            // 合并视频节点上手动上传/上次生成持久化的参考素材（与连线引用按地址去重）
            if (mode === "video" && sourceNode && isVideoNode(sourceNode)) {
                const savedReferences = await resolveVideoGenerationReferences(sourceNode.generation);
                if (savedReferences && !savedReferences.incomplete) {
                    generationContext = {
                        ...generationContext,
                        referenceImages: mergeUniqueReferences(generationContext.referenceImages, savedReferences.referenceImages),
                        referenceVideos: mergeUniqueReferences(generationContext.referenceVideos, savedReferences.referenceVideos),
                    };
                }
            }
            if (mode === "video") {
                const videoQuote = quoteVideoGeneration({
                    config: generationConfig,
                    model: generationConfig.model,
                    mode: generationConfig.videoGenerationMode,
                    resolution: generationConfig.vquality,
                    seconds: generationConfig.videoSeconds,
                    imageReferenceCount: generationContext.referenceImages.length,
                    videoReferenceCount: generationContext.referenceVideos.length,
                    taskCount: normalizeVideoGenerationCount(generationConfig.count),
                });
                if (!videoQuote.available) {
                    message.error(videoQuote.reason);
                    return failedCanvasGenerationResult(nodeId, canvasError("configuration", videoQuote.reason));
                }
            }
            setRunningNodeId(nodeId);
            const runController = startGenerationRequest(nodeId, nodeId, nodeId);
            const detachExternalAbort = bindAbortSignal(externalSignal, runController);
            const effectivePrompt = generationContext.prompt.trim();
            const actualToolArguments = canvasActualGenerationArguments(mode, effectivePrompt || prompt, generationConfig);
            const styleIds = styleContext?.ids || [];
            const styleSnapshots = styleContext?.snapshots || [];
            if (runController.signal.aborted) {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
                detachExternalAbort();
                return canceledCanvasGenerationResult();
            }
            const markSourceStatus = !sourceNode || (!isImageNode(sourceNode) && !editingTextNode);
            if (markSourceStatus) {
                setNodes((prev) => prev.map((node) => (node.id === nodeId ? applyCanvasNodeAttributes(node, { prompt, status: NODE_STATUS_LOADING, errorDetails: "" }) : node)));
            }
            if (!effectivePrompt && mode === "text") {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
                detachExternalAbort();
                return failedCanvasGenerationResult(nodeId, canvasError("invalid_parameter", "生成提示词不能为空", "prompt"));
            }
            let pendingChildIds: string[] = [];

            try {
                if (mode === "image") {
                    const sourceIsImage = Boolean(sourceNode && isImageNode(sourceNode));
                    const isEmptyImageNode = Boolean(sourceNode && isImageNode(sourceNode) && !sourceNode.content.source);
                    const isSettingGraphNode = Boolean(sourceNode && isImageNode(sourceNode) && sourceNode.generation.settingGraph);
                    const generationSize = isSettingGraphNode ? sourceNode?.generation.settingGraph?.aspectRatio || "16:9" : generationConfig.size;
                    const count = isSettingGraphNode ? 1 : normalizeImageGenerationCount(generationConfig.count);
                    const sourceReference =
                        sourceNode && isImageNode(sourceNode) && sourceNode.content.source
                            ? [
                                  {
                                      id: sourceNode.id,
                                      name: `${sourceNode.title || sourceNode.id}.png`,
                                      type: sourceNode.content.mimeType || "image/png",
                                      dataUrl: sourceNode.content.source,
                                      storageKey: sourceNode.content.storageKey,
                                      objectStorage: sourceNode.content.objectStorage,
                                  },
                              ]
                            : [];
                    // 设定图节点始终使用上游引用作为参考图，不能把节点自身上一次结果再次作为参考图。
                    const referenceImages = isSettingGraphNode
                        ? generationContext.referenceImages
                        : sourceReference.length
                          ? sourceReference
                          : generationContext.referenceImages;
                    const generationType = referenceImages.length ? ("edit" as const) : ("generation" as const);
                    const generationAttributes = buildImageGenerationAttributes(generationType, { ...generationConfig, size: generationSize }, count, referenceImages, styleIds, styleSnapshots);
                    const parentConfig = getCanvasNodeTemplate(sourceIsImage ? "image" : "text");
                    const imageConfig = getCanvasNodeTemplate("image");
                    const parentPosition = sourceNode?.frame.position || { x: 0, y: 0 };
                    const gap = 144;
                    const rowGap = 54;
                    // 设定图节点和空图片节点都原地生成，避免重复创建新的图片节点。
                    const reuseImageNode = isEmptyImageNode || isSettingGraphNode;
                    const rootId = reuseImageNode ? nodeId : `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                    const childIds = count > 1 ? Array.from({ length: count }, () => `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`) : [];
                    const targetIds = count > 1 ? childIds : [rootId];
                    pendingChildIds = reuseImageNode ? childIds : [rootId, ...childIds];
                    const rootSize = {
                        width: count > 1 ? IMAGE_GENERATION_NODE_WIDTH : reuseImageNode ? sourceNode?.frame.width || imageConfig.width : imageConfig.width,
                        height: count > 1 ? IMAGE_GENERATION_NODE_HEIGHT : reuseImageNode ? sourceNode?.frame.height || imageConfig.height : imageConfig.height,
                    };
                    const preferredRootPosition = {
                        x: reuseImageNode ? sourceNode?.frame.position.x || parentPosition.x : parentPosition.x + parentConfig.width + gap,
                        y: reuseImageNode ? sourceNode?.frame.position.y || parentPosition.y : parentPosition.y + parentConfig.height / 2 - rootSize.height / 2,
                    };
                    const occupiedNodes = reuseImageNode ? nodesRef.current.filter((node) => node.id !== nodeId) : nodesRef.current;
                    const rootPosition = reuseImageNode
                        ? preferredRootPosition
                        : findNonOverlappingCanvasNodePosition(occupiedNodes, preferredRootPosition, rootSize.width, rootSize.height);
                    const rootNode = updateCanvasNodeFrame(
                        {
                            ...createCanvasNode(
                                "image",
                                { x: 0, y: 0 },
                                {
                                    prompt: effectivePrompt,
                                    status: NODE_STATUS_LOADING,
                                    isBatchRoot: count > 1,
                                    batchChildIds: childIds,
                                    batchUsesReferenceImages: referenceImages.length > 0,
                                    ...(isSettingGraphNode && sourceNode && isImageNode(sourceNode) && sourceNode.generation.settingGraph
                                        ? { settingGraph: sourceNode.generation.settingGraph }
                                        : {}),
                                    ...generationAttributes,
                                    imageBatchExpanded: count > 1,
                                },
                            ),
                            id: rootId,
                            title: isSettingGraphNode && sourceNode ? sourceNode.title : count > 1 ? "图片生成" : effectivePrompt.slice(0, 32) || "生成图片",
                        },
                        { position: rootPosition, ...rootSize },
                    );
                    const colCount = 2;
                    const rowCount = Math.ceil(count / colCount);
                    const childNodes: CanvasDomainNode[] = [];
                    childIds.forEach((id, index) => {
                        const col = Math.floor(index / rowCount);
                        const row = index % rowCount;
                        const preferredPosition = {
                            x: rootNode.frame.position.x + rootNode.frame.width + 180 + col * (imageConfig.width + 54),
                            y: rootNode.frame.position.y + row * (imageConfig.height + rowGap),
                        };
                        const position = findNonOverlappingCanvasNodePosition([...occupiedNodes, rootNode, ...childNodes], preferredPosition, imageConfig.width, imageConfig.height);
                        childNodes.push(updateCanvasNodeFrame(
                            {
                                ...createCanvasNode("image", { x: 0, y: 0 }, { prompt: effectivePrompt, status: NODE_STATUS_LOADING, batchRootId: rootId, ...generationAttributes }),
                                id,
                                title: `${index + 1}/${count}`,
                            },
                            {
                                position,
                                width: imageConfig.width,
                                height: imageConfig.height,
                            },
                        ));
                    });
                    const batchConnections = [...(reuseImageNode ? [] : [createRightToLeftConnection(nodeId, rootId)]), ...childIds.map((childId) => createRightToLeftConnection(rootId, childId))];

                    setNodes((prev) => [
                        ...prev.map((node) =>
                            node.id === nodeId
                                ? reuseImageNode
                                    ? rootNode
                                    : sourceIsImage
                                      ? updateCanvasNodeExecution(node, { phase: "succeeded", errorMessage: "" })
                                      : replaceCanvasNodeWithText(node, prompt, prompt.slice(0, 32) || "提示词", "succeeded")
                                : node,
                        ),
                        ...(reuseImageNode ? [] : [rootNode]),
                        ...childNodes,
                    ]);
                    requestFocusNodes(reuseImageNode ? [nodeId] : [rootId, ...childIds]);
                    setConnections((prev) => [...prev, ...batchConnections]);
                    setSelectedNodeIds(new Set([nodeId]));
                    setSelectedConnectionId(null);
                    setDialogNodeId(nodeId);

                    const controller = runController;
                    targetIds.forEach((targetId) => startGenerationRequest(targetId, nodeId, nodeId, controller));
                    if (count > 1) startGenerationRequest(rootId, nodeId, nodeId, controller);
                    const outcomes = await Promise.all(
                        targetIds.map(async (targetId): Promise<CanvasNodeGenerationOutcome> => {
                            try {
                                const generationRequest = referenceImages.length
                                    ? requestEdit({ ...generationConfig, size: generationSize, count: "1" }, effectivePrompt, referenceImages, undefined, "canvas", {
                                          signal: controller.signal,
                                          generationStyleIds: styleSnapshots.length ? undefined : styleIds,
                                          generationStyleSnapshots: styleSnapshots.length ? styleSnapshots : undefined,
                                      })
                                    : requestGeneration({ ...generationConfig, size: generationSize, count: "1" }, effectivePrompt, "canvas", {
                                          signal: controller.signal,
                                          generationStyleIds: styleSnapshots.length ? undefined : styleIds,
                                          generationStyleSnapshots: styleSnapshots.length ? styleSnapshots : undefined,
                                      });
                                const [image] = await generationRequest;
                                if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
                                const completedStyleSnapshots = image.generationStyleSnapshots?.length ? image.generationStyleSnapshots : styleSnapshots;
                                const uploaded = await reuseOrUploadImage(image);
                                if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
                                const imageSize = fitNodeSize(uploaded.width, uploaded.height, imageConfig.width, imageConfig.height);
                                setNodes((currentNodes) =>
                                    applyGeneratedImageToBatchNodes(currentNodes, {
                                        rootId,
                                        targetId,
                                        attributes: {
                                            ...imageAttributes(uploaded),
                                            generationStyleIds: styleIds,
                                            generationStyleSnapshots: completedStyleSnapshots,
                                        },
                                        ...imageSize,
                                    }),
                                );
                                return { nodeId: targetId };
                            } catch (error) {
                                if (isGenerationCanceled(error)) {
                                    setNodes((prev) =>
                                        synchronizeImageBatchRootExecution(
                                            prev.map((node) => (node.id === targetId ? updateCanvasNodeExecution(node, { phase: "idle", errorMessage: "" }) : node)),
                                            rootId,
                                        ),
                                    );
                                    return { nodeId: targetId, canceled: true };
                                }
                                const structuredError = readAiTaskError(error);
                                setNodes((prev) =>
                                    synchronizeImageBatchRootExecution(
                                        prev.map((node) => (node.id === targetId ? updateCanvasNodeExecution(node, { phase: "failed", errorMessage: structuredError.message }) : node)),
                                        rootId,
                                    ),
                                );
                                return { nodeId: targetId, error: structuredError };
                            } finally {
                                finishGenerationRequest(targetId, controller);
                            }
                        }),
                    );
                    if (count > 1) finishGenerationRequest(rootId, controller);
                    if (controller.signal.aborted) {
                        return canceledCanvasGenerationResult();
                    }
                    const successfulNodeIds = outcomes.filter((outcome) => !outcome.error && !outcome.canceled).map((outcome) => outcome.nodeId);
                    const failures = outcomes.filter((outcome): outcome is CanvasNodeGenerationFailure => Boolean(outcome.error));
                    if (failures.length) message.error(successfulNodeIds.length ? "部分图片生成失败" : "全部图片生成失败");
                    return canvasGenerationResult(successfulNodeIds, failures, actualToolArguments);
                }

                if (mode === "video") {
                    const count = normalizeVideoGenerationCount(generationConfig.count);
                    const referenceImages = await ensureVideoReferenceImagesObjectStorage(generationContext.referenceImages);
                    if (!referenceImages) {
                        if (markSourceStatus) setNodes((prev) => prev.map((node) => (node.id === nodeId ? updateCanvasNodeExecution(node, { phase: "idle", errorMessage: "" }) : node)));
                        return canceledCanvasGenerationResult();
                    }
                    if (runController.signal.aborted) return canceledCanvasGenerationResult();
                    const videoGenerationContext = { ...generationContext, referenceImages };
                    const spec = nodeSizeFromRatio(generationConfig.size, getCanvasNodeTemplate("video").width, getCanvasNodeTemplate("video").height) || getCanvasNodeTemplate("video");
                    const isEmptyVideoNode = Boolean(sourceNode && isVideoNode(sourceNode) && !sourceNode.content.source);
                    const parent = sourceNode?.frame.position || { x: 0, y: 0 };
                    const videoIds = Array.from({ length: count }, (_, index) => (isEmptyVideoNode && index === 0 ? nodeId : nanoid()));
                    const additionalOffset = isEmptyVideoNode ? 1 : 0;
                    const occupiedVideoNodes = isEmptyVideoNode ? nodesRef.current.filter((node) => node.id !== nodeId) : nodesRef.current;
                    const placedVideoNodes: CanvasDomainNode[] = [];
                    const videoNodes = videoIds.map((videoId, index) => {
                        const additionalIndex = index - additionalOffset;
                        const column = Math.max(0, additionalIndex % 2);
                        const row = Math.max(0, Math.floor(additionalIndex / 2));
                        const preferredVideoPosition =
                            isEmptyVideoNode && index === 0 && sourceNode
                                ? sourceNode.frame.position
                                : {
                                      x: parent.x + (sourceNode?.frame.width || spec.width) + CONNECTED_NODE_GAP + column * (spec.width + 54),
                                      y: parent.y + row * (spec.height + 54),
                                  };
                        const videoSize = isEmptyVideoNode && index === 0 && sourceNode ? { width: sourceNode.frame.width, height: sourceNode.frame.height } : spec;
                        const videoPosition = isEmptyVideoNode && index === 0
                            ? preferredVideoPosition
                            : findNonOverlappingCanvasNodePosition([...occupiedVideoNodes, ...placedVideoNodes], preferredVideoPosition, videoSize.width, videoSize.height);
                        const videoNode = updateCanvasNodeFrame(
                            {
                                ...createCanvasNode(
                                    "video",
                                    { x: 0, y: 0 },
                                    {
                                        prompt: effectivePrompt,
                                        status: NODE_STATUS_LOADING,
                                        model: generationConfig.model,
                                        size: generationConfig.size,
                                        seconds: generationConfig.videoSeconds,
                                        vquality: generationConfig.vquality,
                                        videoGenerationMode: generationConfig.videoGenerationMode,
                                        watermark: generationConfig.videoWatermark,
                                        count: 1,
                                        ...generationVideoReferenceAttributes(videoGenerationContext),
                                        generationStyleIds: styleIds,
                                        generationStyleSnapshots: styleSnapshots,
                                    },
                                ),
                                id: videoId,
                                title: count > 1 ? `${index + 1}/${count}` : effectivePrompt.slice(0, 32) || "生成视频",
                            },
                            { position: videoPosition, width: videoSize.width, height: videoSize.height },
                        );
                        placedVideoNodes.push(videoNode);
                        return videoNode;
                    });
                    pendingChildIds = isEmptyVideoNode ? videoIds.slice(1) : videoIds;
                    setNodes((prev) => [...prev.map((node) => (node.id === nodeId ? (isEmptyVideoNode ? videoNodes[0] : updateCanvasNodeExecution(node, { phase: "succeeded" })) : node)), ...videoNodes.slice(isEmptyVideoNode ? 1 : 0)]);
                    requestFocusNodes(videoIds);
                    const connectionTargets = isEmptyVideoNode ? videoIds.slice(1) : videoIds;
                    if (connectionTargets.length) setConnections((prev) => [...prev, ...connectionTargets.map((videoId) => createRightToLeftConnection(nodeId, videoId))]);
                    videoIds.filter((videoId) => videoId !== nodeId).forEach((videoId) => startGenerationRequest(videoId, nodeId, nodeId, runController));

                    const outcomes = await Promise.all(
                        videoIds.map(async (videoId): Promise<CanvasNodeGenerationOutcome> => {
                            try {
                                const generatedVideo = await requestVideoGeneration({ ...generationConfig, count: "1" }, effectivePrompt, videoGenerationContext.referenceImages, videoGenerationContext.referenceVideos, "canvas", {
                                    signal: runController.signal,
                                    generationStyleIds: styleSnapshots.length ? undefined : styleIds,
                                    generationStyleSnapshots: styleSnapshots.length ? styleSnapshots : undefined,
                                    onProgress: (progress) => {
                                        if (!runController.signal.aborted) setNodes((prev) => prev.map((node) => (node.id === videoId ? updateCanvasNodeExecution(node, { progress }) : node)));
                                    },
                                    onTaskCreated: (taskId) => {
                                        if (!runController.signal.aborted) setNodes((prev) => prev.map((node) => (node.id === videoId ? updateCanvasNodeExecution(node, { taskId }) : node)));
                                    },
                                });
                                if (runController.signal.aborted) throw new DOMException("Aborted", "AbortError");
                                const video = await storeGeneratedVideo(generatedVideo);
                                if (runController.signal.aborted) throw new DOMException("Aborted", "AbortError");
                                const completedSize = fitNodeSize(video.width || spec.width, video.height || spec.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                                setNodes((prev) =>
                                    prev.map((node) => {
                                        if (node.id !== videoId) return node;
                                        const center = { x: node.frame.position.x + node.frame.width / 2, y: node.frame.position.y + node.frame.height / 2 };
                                        const completed = applyCanvasNodeAttributes(node, {
                                            ...videoAttributes(video),
                                            prompt: effectivePrompt,
                                            model: generationConfig.model,
                                            size: generationConfig.size,
                                            seconds: generationConfig.videoSeconds,
                                            vquality: generationConfig.vquality,
                                            videoGenerationMode: generationConfig.videoGenerationMode,
                                            watermark: generationConfig.videoWatermark,
                                            count: 1,
                                            ...generationVideoReferenceAttributes(videoGenerationContext),
                                            generationStyleIds: styleIds,
                                            generationStyleSnapshots: generatedVideo.generationStyleSnapshots?.length ? generatedVideo.generationStyleSnapshots : styleSnapshots,
                                        });
                                        return updateCanvasNodeFrame(completed, { position: { x: center.x - completedSize.width / 2, y: center.y - completedSize.height / 2 }, ...completedSize });
                                    }),
                                );
                                return { nodeId: videoId };
                            } catch (error) {
                                if (isGenerationCanceled(error)) {
                                    setNodes((prev) => prev.map((node) => (node.id === videoId ? updateCanvasNodeExecution(node, { phase: "idle", errorMessage: "" }) : node)));
                                    return { nodeId: videoId, canceled: true };
                                }
                                const structuredError = readAiTaskError(error);
                                setNodes((prev) => prev.map((node) => (node.id === videoId ? updateCanvasNodeExecution(node, { phase: "failed", errorMessage: structuredError.message }) : node)));
                                return { nodeId: videoId, error: structuredError };
                            } finally {
                                if (videoId !== nodeId) finishGenerationRequest(videoId, runController);
                            }
                        }),
                    );
                    if (runController.signal.aborted) return canceledCanvasGenerationResult();
                    const successfulNodeIds = outcomes.filter((outcome) => !outcome.error && !outcome.canceled).map((outcome) => outcome.nodeId);
                    const failures = outcomes.filter((outcome): outcome is CanvasNodeGenerationFailure => Boolean(outcome.error));
                    if (failures.length) message.error(successfulNodeIds.length ? "部分视频生成失败" : "全部视频生成失败");
                    return canvasGenerationResult(successfulNodeIds, failures, actualToolArguments);
                }

                let streamed = "";
                const parentConfig = getCanvasNodeTemplate("text");
                const textConfig = getCanvasNodeTemplate("text");
                const parentPosition = sourceNode?.frame.position || { x: 0, y: 0 };
                const childIds = editingTextNode ? Array.from({ length: 1 }, () => nanoid()) : [];
                pendingChildIds = childIds;
                if (editingTextNode) {
                    const childNodes: CanvasDomainNode[] = childIds.map((id, index) =>
                        updateCanvasNodeFrame(
                            { ...createCanvasNode("text", { x: 0, y: 0 }, { content: "", status: NODE_STATUS_LOADING, fontSize: 14 }), id, title: effectivePrompt.slice(0, 32) || "生成文本" },
                            {
                                position: findNonOverlappingCanvasNodePosition(
                                    nodesRef.current,
                                    { x: parentPosition.x + parentConfig.width + CONNECTED_NODE_GAP, y: parentPosition.y + parentConfig.height / 2 - textConfig.height / 2 + (index - (1 - 1) / 2) * (textConfig.height + 36) },
                                    textConfig.width,
                                    textConfig.height,
                                ),
                                width: textConfig.width,
                                height: textConfig.height,
                            },
                        ),
                    );
                    setNodes((prev) => [...prev, ...childNodes]);
                    requestFocusNodes(childIds);
                    setConnections((prev) => [...prev, ...childIds.map((childId) => createRightToLeftConnection(nodeId, childId))]);
                }

                const controller = runController;
                const textTargetIds = childIds.length ? childIds : [nodeId];
                textTargetIds.forEach((targetNodeId) => startGenerationRequest(targetNodeId, nodeId, nodeId, controller));
                const textModel = generationConfig.model || generationConfig.textModel;
                const textReferences = (generationContext.referenceImages || []).map((image) => ({
                    id: image.id,
                    name: image.name,
                    mimeType: image.type,
                    storageKey: image.storageKey,
                    url: image.objectStorage?.url || image.url || (/^https?:\/\//i.test(image.dataUrl || "") ? image.dataUrl : undefined),
                }));
                const answers = await Promise.all(
                    textTargetIds.map((targetNodeId) => {
                        if (controller.signal.aborted) {
                            return Promise.reject(new DOMException("Aborted", "AbortError"));
                        }
                        // 后端任务体系下，每个目标节点创建一个文本任务，订阅text-delta增量回写节点内容。
                        return createAiTask({ taskType: "text", prompt: effectivePrompt, model: textModel, references: textReferences })
                            .then((task) => ({ targetNodeId, taskId: task.id }))
                            .then(async ({ targetNodeId, taskId }) => {
                                let localStreamed = "";
                                const unsubscribe = subscribeAiTaskDeltas((deltaTaskId, delta) => {
                                    if (deltaTaskId !== taskId || controller.signal.aborted) return;
                                    localStreamed += delta;
                                    streamed = localStreamed;
                                    setNodes((prev) => prev.map((node) => (node.id === targetNodeId ? replaceCanvasNodeWithText(node, localStreamed, node.title, "running") : node)));
                                });
                                try {
                                    if (controller.signal.aborted) void cancelAiTask(taskId).catch(() => {});
                                    const completed = await waitAiTask(taskId, { signal: controller.signal });
                                    const resultContent = (completed.resultData as { content?: string } | null)?.content;
                                    return { nodeId: targetNodeId, content: resultContent || localStreamed };
                                } finally {
                                    unsubscribe();
                                    finishGenerationRequest(targetNodeId, controller);
                                }
                            });
                    }),
                );
                if (controller.signal.aborted) return canceledCanvasGenerationResult();
                const answerByNodeId = new Map(answers.map((item) => [item.nodeId, item.content]));
                setNodes((prev) =>
                    prev.map((node) =>
                        childIds.includes(node.id)
                            ? replaceCanvasNodeWithText(node, answerByNodeId.get(node.id) || streamed, node.title, "succeeded")
                            : node.id === nodeId && !editingTextNode
                              ? replaceCanvasNodeWithText(node, answerByNodeId.get(node.id) || streamed, prompt.slice(0, 32) || "生成文本", "succeeded")
                              : node,
                    ),
                );
                return canvasGenerationResult(textTargetIds, [], actualToolArguments);
            } catch (error) {
                if (isGenerationCanceled(error)) {
                    setNodes((prev) => prev.map((node) => (node.id === nodeId || pendingChildIds.includes(node.id) ? updateCanvasNodeExecution(node, { phase: "idle", errorMessage: "" }) : node)));
                    return canceledCanvasGenerationResult();
                }
                const structuredError = readAiTaskError(error);
                message.error(structuredError.message);
                setNodes((prev) =>
                    prev.map((node) => (node.id === nodeId || pendingChildIds.includes(node.id) ? (node.id === nodeId && !markSourceStatus ? node : updateCanvasNodeExecution(node, { phase: "failed", errorMessage: structuredError.message })) : node)),
                );
                const failedNodeIds = pendingChildIds.length ? pendingChildIds : [nodeId];
                return canvasGenerationResult(
                    [],
                    failedNodeIds.map((failedNodeId) => ({ nodeId: failedNodeId, error: structuredError })),
                    actualToolArguments,
                );
            } finally {
                detachExternalAbort();
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, isGenerationRunning, message, requestFocusNodes, showMissingAiConfig, startGenerationRequest],
    );

    const handleGenerateNodePrompt = useCallback(
        (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string, onResult: (prompt: string) => void, styleIds: number[] = []) => {
            if (mode === "text") return;
            void optimizePrompt({ operationId: nodeId, generationType: mode, prompt, generationStyleIds: styleIds, onSuccess: onResult });
        },
        [optimizePrompt],
    );

    useEffect(() => {
        generateNodeRef.current = handleGenerateNode;
    }, [handleGenerateNode]);

    const handleRetryNode = useCallback(
        async (node: CanvasDomainNode, externalSignal?: AbortSignal): Promise<CanvasAgentToolResult> => {
            if (isStoryboardNode(node)) {
                return failedCanvasGenerationResult(node.id, canvasError("configuration", "请在分镜脚本节点中重新生成"));
            }
            if (isGenerationRunning(node.id)) {
                return failedCanvasGenerationResult(node.id, canvasError("configuration", "当前节点正在生成，请等待任务完成"));
            }
            const sourceNode = node;
            const batchRoot = isImageNode(node) && node.grouping.rootId ? nodesRef.current.find((item) => item.id === node.grouping.rootId) : null;
            const savedImageNode = isImageNode(node) ? node : batchRoot && isImageNode(batchRoot) ? batchRoot : null;
            const savedImageGeneration = savedImageNode && isImageNode(savedImageNode) ? savedImageNode.generation : null;
            const savedVideoGeneration = isVideoNode(node) ? node.generation : null;
            const savedStyleSnapshots = savedImageNode?.generation.generationStyleSnapshots?.length
                ? savedImageNode.generation.generationStyleSnapshots
                : (isImageNode(node) || isVideoNode(node)) && node.generation.generationStyleSnapshots?.length
                  ? node.generation.generationStyleSnapshots
                  : [];
            const savedStyleIds = savedImageNode?.generation.generationStyleIds?.length
                ? savedImageNode.generation.generationStyleIds
                : (isImageNode(node) || isVideoNode(node)) && node.generation.generationStyleIds?.length
                  ? node.generation.generationStyleIds
                  : [];
            const hasSavedImageGeneration = Boolean(savedImageGeneration && (savedImageGeneration.prompt || savedImageGeneration.model || savedImageGeneration.references.length));
            const retryMode = readCanvasGenerationMode(node.kind);
            if (!retryMode) return failedCanvasGenerationResult(node.id, canvasError("configuration", "分镜脚本节点请使用专属生成入口"));
            const settingGraphRatio = isImageNode(node) && node.generation.settingGraph ? node.generation.settingGraph.aspectRatio || "16:9" : undefined;
            const generationConfig =
                hasSavedImageGeneration && savedImageGeneration
                    ? {
                          ...effectiveConfig,
                          model: savedImageGeneration.model || effectiveConfig.imageModel || effectiveConfig.model,
                          quality: savedImageGeneration.quality || effectiveConfig.quality,
                          size: settingGraphRatio || savedImageGeneration.size || effectiveConfig.size,
                          imageResolution: savedImageGeneration.resolution || effectiveConfig.imageResolution,
                          count: "1",
                      }
                    : { ...buildGenerationConfig(effectiveConfig, sourceNode, retryMode), ...(settingGraphRatio ? { size: settingGraphRatio } : {}), count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                showMissingAiConfig(retryMode);
                return failedCanvasGenerationResult(node.id, canvasError("configuration", "模型配置不完整"));
            }

            const context = hasSavedImageGeneration ? null : await hydrateNodeGenerationContext(buildNodeGenerationContext(sourceNode.id, nodesRef.current, connectionsRef.current, readCanvasNodePrompt(sourceNode)), retryMode);
            const prompt = (savedImageGeneration?.prompt || savedVideoGeneration?.prompt || context?.prompt || "").trim();
            if (!prompt) {
                message.warning("找不到提示词，无法重试");
                return failedCanvasGenerationResult(node.id, canvasError("invalid_parameter", "找不到提示词，无法重试", "prompt"));
            }
            const generationType = savedImageGeneration?.operation;
            const useReferenceImages = generationType ? generationType === "edit" : Boolean(context?.referenceImages.length);
            const retryReferenceImages =
                hasSavedImageGeneration && savedImageGeneration
                    ? await resolveGenerationReferences(savedImageGeneration)
                    : useReferenceImages
                      ? context?.referenceImages.length
                          ? context.referenceImages
                          : sourceNodeReferenceImages(batchRoot || sourceNode)
                      : [];
            if (useReferenceImages && !retryReferenceImages) {
                message.error("参考图片已丢失，无法继续重试");
                setNodes((prev) => prev.map((item) => (item.id === node.id ? updateCanvasNodeExecution(item, { phase: "failed", errorMessage: "参考图片已丢失，无法继续重试" }) : item)));
                return failedCanvasGenerationResult(node.id, canvasError("configuration", "参考图片已丢失，无法继续重试"));
            }
            const retryImages = retryReferenceImages || [];
            let retryVideoImages = retryImages;
            let retryVideoReferences: ReferenceVideo[] = context?.referenceVideos || [];
            if (isVideoNode(node)) {
                const savedVideoReferences = await resolveVideoGenerationReferences(savedVideoGeneration);
                if (savedVideoReferences?.incomplete) {
                    message.error("已保存的参考素材无法恢复，请重新连接参考节点后再试");
                    return failedCanvasGenerationResult(node.id, canvasError("configuration", "已保存的参考素材无法恢复，请重新连接参考节点后再试"));
                }
                if (savedVideoReferences) {
                    retryVideoImages = savedVideoReferences.referenceImages;
                    retryVideoReferences = savedVideoReferences.referenceVideos;
                }
            }
            if (isVideoNode(node)) {
                const videoQuote = quoteVideoGeneration({
                    config: generationConfig,
                    model: generationConfig.model,
                    mode: generationConfig.videoGenerationMode,
                    resolution: generationConfig.vquality,
                    seconds: generationConfig.videoSeconds,
                    imageReferenceCount: retryVideoImages.length,
                    videoReferenceCount: retryVideoReferences.length,
                    taskCount: 1,
                });
                if (!videoQuote.available) {
                    message.error(videoQuote.reason);
                    return failedCanvasGenerationResult(node.id, canvasError("configuration", videoQuote.reason));
                }
            }
            const actualToolArguments = canvasActualGenerationArguments(retryMode, prompt, generationConfig, 1);
            if (externalSignal?.aborted) return canceledCanvasGenerationResult();

            setRunningNodeId(node.id);
            setNodes((prev) => prev.map((item) => (item.id === node.id ? updateCanvasNodeExecution(item, { phase: "running", errorMessage: "" }) : item)));
            const controller = startGenerationRequest(node.id, sourceNode.id, node.id);
            const detachExternalAbort = bindAbortSignal(externalSignal, controller);

            try {
                if (isTextNode(node)) {
                    if (!context) return failedCanvasGenerationResult(node.id, canvasError("unknown", "文本节点缺少生成上下文"));
                    let streamed = "";
                    const answer = await requestImageQuestion(
                        generationConfig,
                        buildNodeResponseMessages({ ...context, prompt }),
                        (text) => {
                            if (controller.signal.aborted) return;
                            streamed = text;
                            setNodes((prev) => prev.map((item) => (item.id === node.id ? replaceCanvasNodeWithText(item, text, item.title, "running") : item)));
                        },
                        { signal: controller.signal },
                    );
                    if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? replaceCanvasNodeWithText(item, answer || streamed, item.title, "succeeded") : item)));
                    return canvasGenerationResult([node.id], [], actualToolArguments);
                }
                if (isVideoNode(node)) {
                    const videoReferenceImages = await ensureVideoReferenceImagesObjectStorage(retryVideoImages);
                    if (!videoReferenceImages) {
                        setNodes((prev) => prev.map((item) => (item.id === node.id ? updateCanvasNodeExecution(item, { phase: "idle", errorMessage: "" }) : item)));
                        return canceledCanvasGenerationResult();
                    }
                    const generatedVideo = await requestVideoGeneration(generationConfig, prompt, videoReferenceImages, retryVideoReferences, "canvas", {
                        signal: controller.signal,
                        generationStyleIds: savedStyleSnapshots.length ? undefined : savedStyleIds,
                        generationStyleSnapshots: savedStyleSnapshots.length ? savedStyleSnapshots : undefined,
                        onProgress: (progress) => {
                            if (!controller.signal.aborted) setNodes((prev) => prev.map((item) => (item.id === node.id ? updateCanvasNodeExecution(item, { progress }) : item)));
                        },
                        onTaskCreated: (taskId) => {
                            if (!controller.signal.aborted) setNodes((prev) => prev.map((item) => (item.id === node.id ? updateCanvasNodeExecution(item, { taskId }) : item)));
                        },
                    });
                    if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
                    const completedStyleSnapshots = generatedVideo.generationStyleSnapshots?.length ? generatedVideo.generationStyleSnapshots : savedStyleSnapshots;
                    const video = await storeGeneratedVideo(generatedVideo);
                    if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
                    const videoSize = fitNodeSize(video.width || node.frame.width, video.height || node.frame.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                    setNodes((prev) =>
                        prev.map((item) => {
                            if (item.id !== node.id) return item;
                            const center = { x: item.frame.position.x + item.frame.width / 2, y: item.frame.position.y + item.frame.height / 2 };
                            return updateCanvasNodeFrame(
                                applyCanvasNodeAttributes(item, {
                                    ...videoAttributes(video),
                                    prompt,
                                    model: generationConfig.model,
                                    size: generationConfig.size,
                                    seconds: generationConfig.videoSeconds,
                                    vquality: generationConfig.vquality,
                                    videoGenerationMode: generationConfig.videoGenerationMode,
                                    watermark: generationConfig.videoWatermark,
                                    ...generationVideoReferenceAttributes({ referenceImages: videoReferenceImages, referenceVideos: retryVideoReferences }),
                                    generationStyleIds: savedStyleIds,
                                    generationStyleSnapshots: completedStyleSnapshots,
                                }),
                                { position: { x: center.x - videoSize.width / 2, y: center.y - videoSize.height / 2 }, ...videoSize },
                            );
                        }),
                    );
                    return canvasGenerationResult([node.id], [], actualToolArguments);
                }

                const image = useReferenceImages
                    ? await requestEdit(generationConfig, prompt, retryImages, undefined, "canvas", {
                          signal: controller.signal,
                          generationStyleIds: savedStyleSnapshots.length ? undefined : savedStyleIds,
                          generationStyleSnapshots: savedStyleSnapshots.length ? savedStyleSnapshots : undefined,
                      }).then((items) => items[0])
                    : await requestGeneration(generationConfig, prompt, "canvas", {
                          signal: controller.signal,
                          generationStyleIds: savedStyleSnapshots.length ? undefined : savedStyleIds,
                          generationStyleSnapshots: savedStyleSnapshots.length ? savedStyleSnapshots : undefined,
                      }).then((items) => items[0]);
                if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
                const completedStyleSnapshots = image.generationStyleSnapshots?.length ? image.generationStyleSnapshots : savedStyleSnapshots;
                const uploadedImage = await reuseOrUploadImage(image);
                if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
                const imageConfig = getCanvasNodeTemplate("image");
                const imageSize = fitNodeSize(uploadedImage.width, uploadedImage.height, imageConfig.width, imageConfig.height);
                const generationAttributes = savedImageGeneration
                    ? {
                          generationType: savedImageGeneration.operation,
                          model: generationConfig.model,
                          size: generationConfig.size,
                          quality: generationConfig.quality,
                          imageResolution: generationConfig.imageResolution,
                          count: normalizeImageGenerationCount(savedImageGeneration.count),
                          references: savedImageGeneration.references,
                          referenceObjectStorages: savedImageGeneration.referenceObjectStorages,
                          generationStyleIds: savedStyleIds,
                          generationStyleSnapshots: completedStyleSnapshots,
                      }
                    : buildImageGenerationAttributes(useReferenceImages ? "edit" : "generation", generationConfig, 1, retryImages, savedStyleIds, completedStyleSnapshots);
                setNodes((prev) =>
                    prev.map((item) => {
                        if (item.id !== node.id) return item;
                        const center = { x: item.frame.position.x + item.frame.width / 2, y: item.frame.position.y + item.frame.height / 2 };
                        const replacement = isImageNode(item) ? item : { ...createCanvasNode("image", center), id: item.id, title: item.title };
                        return updateCanvasNodeFrame(applyCanvasNodeAttributes(replacement, { ...imageAttributes(uploadedImage), prompt, ...generationAttributes }), {
                            position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 },
                            ...imageSize,
                        });
                    }),
                );
                return canvasGenerationResult([node.id], [], actualToolArguments);
            } catch (error) {
                if (isGenerationCanceled(error)) {
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? updateCanvasNodeExecution(item, { phase: "idle", errorMessage: "" }) : item)));
                    return canceledCanvasGenerationResult();
                }
                const structuredError = readAiTaskError(error);
                message.error(structuredError.message);
                setNodes((prev) => prev.map((item) => (item.id === node.id ? updateCanvasNodeExecution(item, { phase: "failed", errorMessage: structuredError.message }) : item)));
                return failedCanvasGenerationResult(node.id, structuredError, actualToolArguments);
            } finally {
                detachExternalAbort();
                finishGenerationRequest(node.id, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, ensureVideoReferenceImagesObjectStorage, finishGenerationRequest, isAiConfigReady, isGenerationRunning, message, showMissingAiConfig, startGenerationRequest],
    );

    useEffect(() => {
        retryNodeRef.current = handleRetryNode;
        return () => {
            retryNodeRef.current = null;
        };
    }, [handleRetryNode]);

    const insertAssistantImage = useCallback(
        async (image: CanvasAssistantImage) => {
            const storedImage = await reuseOrUploadImage(image);
            const config = fitNodeSize(storedImage.width, storedImage.height);
            const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const position = findNonOverlappingCanvasNodePosition(nodesRef.current, { x: center.x - config.width / 2, y: center.y - config.height / 2 }, config.width, config.height);
            const node = updateCanvasNodeFrame(
                { ...createCanvasNode("image", center, { ...imageAttributes(storedImage), prompt: image.prompt }), id, title: image.prompt.slice(0, 32) || "生成图片" },
                { position, ...config },
            );

            setNodes((prev) => [...prev, node]);
            requestFocusNodes([node.id]);
            setSelectedNodeIds(new Set([id]));
            setSelectedConnectionId(null);
            setDialogNodeId(id);
        },
        [requestFocusNodes, screenToCanvas, size.height, size.width],
    );

    const insertAssistantText = useCallback(
        (text: string) => {
            const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            const template = getCanvasNodeTemplate("text");
            const position = findNonOverlappingCanvasNodePosition(nodesRef.current, { x: center.x - template.width / 2, y: center.y - template.height / 2 }, template.width, template.height);
            const node = updateCanvasNodeFrame({
                ...createCanvasNode("text", center, { content: text, status: NODE_STATUS_SUCCESS }),
                title: text.slice(0, 32) || "Assistant Text",
            }, { position });

            setNodes((prev) => [...prev, node]);
            requestFocusNodes([node.id]);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
        },
        [requestFocusNodes, screenToCanvas, size.height, size.width],
    );

    const handleAssetInsert = useCallback(
        (payload: InsertAssetPayload) => {
            if (payload.kind === "text") {
                insertAssistantText(payload.content);
            } else if (payload.kind === "video") {
                const spec = getCanvasNodeTemplate("video");
                const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
                const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                const nextSize = fitNodeSize(payload.width || spec.width, payload.height || spec.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                const position = findNonOverlappingCanvasNodePosition(nodesRef.current, { x: center.x - nextSize.width / 2, y: center.y - nextSize.height / 2 }, nextSize.width, nextSize.height);
                const node = updateCanvasNodeFrame(
                    {
                        ...createCanvasNode("video", center, { content: payload.url, storageKey: payload.storageKey, status: NODE_STATUS_SUCCESS, naturalWidth: payload.width, naturalHeight: payload.height, objectStorage: payload.objectStorage }),
                        id,
                        title: payload.title,
                    },
                    { position, ...nextSize },
                );
                setNodes((prev) => [...prev, node]);
                requestFocusNodes([node.id]);
                setSelectedNodeIds(new Set([id]));
            } else {
                insertAssistantImage({ id: `asset-${Date.now()}`, prompt: payload.title, dataUrl: payload.dataUrl, storageKey: payload.storageKey, objectStorage: payload.objectStorage });
            }
            setAssetPickerOpen(false);
        },
        [insertAssistantImage, insertAssistantText, requestFocusNodes, screenToCanvas, size.height, size.width],
    );

    const handleCanvasAssetSelect = useCallback((asset: CanvasNavigationAsset) => {
        if (asset.source !== "storyboard" || !asset.asset.image?.source || !canvasAssetReplaceNodeId) return;
        const targetNodeId = canvasAssetReplaceNodeId;
        const source = asset.asset.image.source;
        setNodes((prev) => prev.map((node) => node.id === targetNodeId && isImageNode(node)
            ? applyCanvasNodeAttributes(node, {
                content: source,
                storageKey: asset.asset.image?.storageKey,
                mimeType: asset.asset.image?.mimeType,
                objectStorage: asset.asset.image?.objectStorage,
                status: NODE_STATUS_SUCCESS,
            })
            : node));
        setSelectedNodeIds(new Set([targetNodeId]));
        setDialogNodeId(targetNodeId);
        setCanvasAssetReplaceNodeId(null);
        setCanvasAssetPickerOpen(false);
        message.success("已使用画布资产替换当前图片");
        const image = new window.Image();
        image.onload = () => {
            if (!image.naturalWidth || !image.naturalHeight) return;
            setNodes((prev) => prev.map((node) => {
                if (node.id !== targetNodeId || !isImageNode(node) || node.frame.freeResize) return node;
                const nextSize = fitNodeSize(image.naturalWidth, image.naturalHeight);
                return updateCanvasNodeFrame(node, {
                    ...nextSize,
                    position: {
                        x: node.frame.position.x + (node.frame.width - nextSize.width) / 2,
                        y: node.frame.position.y + (node.frame.height - nextSize.height) / 2,
                    },
                    naturalWidth: image.naturalWidth,
                    naturalHeight: image.naturalHeight,
                });
            }));
        };
        image.src = source;
    }, [canvasAssetReplaceNodeId, message]);

    const handleVideoCompositionInputOrderChange = useCallback((nodeId: string, inputVideoNodeIds: string[]) => {
        setNodes((currentNodes) =>
            currentNodes.map((node) => {
                if (node.id !== nodeId || !isVideoCompositionNode(node)) return node;
                if (node.execution.phase === "running" || !sameNodeIdSet(node.composition.inputVideoNodeIds, inputVideoNodeIds) || sameNodeIds(node.composition.inputVideoNodeIds, inputVideoNodeIds)) return node;
                return {
                    ...node,
                    composition: {
                        ...node.composition,
                        inputVideoNodeIds: [...inputVideoNodeIds],
                    },
                };
            }),
        );
    }, []);

    const handleComposeVideo = useCallback(
        async (node: CanvasVideoCompositionNode) => {
            if (compositionSubmittingNodeIdsRef.current.has(node.id) || node.execution.phase === "running") return;
            const videoById = new Map(nodesRef.current.filter((item): item is CanvasVideoNode => isVideoNode(item)).map((item) => [item.id, item]));
            const currentNode = nodesRef.current.find((item): item is CanvasVideoCompositionNode => item.id === node.id && isVideoCompositionNode(item));
            if (!currentNode || !canComposeVideo(currentNode, videoById)) {
                message.warning("至少需要2段已完成且已保存的视频才能合成");
                return;
            }
            compositionSubmittingNodeIdsRef.current.add(node.id);
            try {
                const sourceStorageKeys = currentNode.composition.inputVideoNodeIds.map((inputNodeId) => videoById.get(inputNodeId)?.content.storageKey || "");
                const task = await composeVideo(sourceStorageKeys);
                const latestNode = nodesRef.current.find((item): item is CanvasVideoCompositionNode => item.id === currentNode.id && isVideoCompositionNode(item));
                if (!latestNode) {
                    void cancelCompositionTask(task.id).catch(() => undefined);
                    return;
                }
                const resultId = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                const resultTemplate = getCanvasNodeTemplate("video");
                const resultPosition = findNonOverlappingCanvasNodePosition(nodesRef.current, {
                    x: latestNode.frame.position.x + latestNode.frame.width + 144,
                    y: latestNode.frame.position.y + latestNode.frame.height / 2 - resultTemplate.height / 2,
                }, resultTemplate.width, resultTemplate.height);
                const resultCenter = {
                    x: resultPosition.x + resultTemplate.width / 2,
                    y: resultPosition.y + resultTemplate.height / 2,
                };
                const resultNode = {
                    ...createCanvasNode("video", resultCenter, { status: NODE_STATUS_LOADING, taskId: task.id, progress: task.progress }),
                    id: resultId,
                    title: "合成视频",
                };
                setNodes((currentNodes) => [
                    ...currentNodes.map((item) =>
                        item.id === latestNode.id && isVideoCompositionNode(item)
                            ? {
                                  ...item,
                                  execution: { phase: "running" as const, taskId: task.id, progress: task.progress, startedAt: task.startedAt },
                                  composition: { ...item.composition, resultVideoNodeId: resultId },
                              }
                            : item,
                    ),
                    resultNode,
                ]);
                setConnections((currentConnections) => [...currentConnections, createRightToLeftConnection(latestNode.id, resultId)]);
                setSelectedNodeIds(new Set([resultId]));
                setSelectedConnectionId(null);
                requestFocusNodes([latestNode.id, resultId]);
                monitorVideoCompositionTask(latestNode.id, resultId, task.id);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : "创建视频合成任务失败";
                message.error(errorMessage);
                setNodes((currentNodes) => currentNodes.map((item) => (item.id === node.id && isVideoCompositionNode(item) ? { ...item, execution: { phase: "failed", errorMessage } } : item)));
            } finally {
                compositionSubmittingNodeIdsRef.current.delete(node.id);
            }
        },
        [message, monitorVideoCompositionTask, requestFocusNodes],
    );

    const assistantOpen = assistantMounted;
    const openAgent = () => setAssistantMounted(true);
    const closeAgent = () => setAssistantMounted(false);
    const openNavigationPanel = () => setNavigationPanelState("expanded");

    // Phase 2-3: 转换为 React Flow 格式
    const hiddenBatchNodeIds = useMemo(() => new Set(nodes.filter((node) => isHiddenBatchChild(node, nodes, collapsingBatchIds)).map((node) => node.id)), [collapsingBatchIds, nodes]);
    const navigationNodes = useMemo(() => nodes.filter((node) => !hiddenBatchNodeIds.has(node.id)), [hiddenBatchNodeIds, nodes]);
    const navigationAssets = useMemo<CanvasNavigationAsset[]>(
        () => [
            ...assets.map((asset) => ({ id: `library:${asset.id}`, source: "library" as const, asset })),
            ...nodes.flatMap((node) => (isStoryboardNode(node) ? node.storyboard.assets.map((asset) => ({ id: `storyboard:${node.id}:${asset.id}`, source: "storyboard" as const, asset, storyboardNodeTitle: node.title })) : [])),
        ],
        [assets, nodes],
    );
    const hiddenBatchEdgeNodeIds = useMemo(
        () =>
            new Set(
                nodes
                    .filter((node) => {
                        if (isHiddenBatchChild(node, nodes, collapsingBatchIds)) return true;
                        const rootId = isImageNode(node) ? node.grouping.rootId : undefined;
                        return Boolean(rootId && (openingBatchIds.has(rootId) || collapsingBatchIds.has(rootId)));
                    })
                    .map((node) => node.id),
            ),
        [collapsingBatchIds, nodes, openingBatchIds],
    );
    const rfNodes = useMemo(() => toRFNodes(nodes, selectedNodeIds, hiddenBatchNodeIds), [hiddenBatchNodeIds, nodes, selectedNodeIds]);
    const nodeIdSet = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
    const backgroundNodeIds = useMemo(() => new Set(nodes.filter(isBackgroundNode).map((node) => node.id)), [nodes]);
    const rfEdges = useMemo(() => toRFEdges(connections, nodeIdSet, hiddenBatchEdgeNodeIds, backgroundNodeIds), [backgroundNodeIds, connections, hiddenBatchEdgeNodeIds, nodeIdSet]);
    const videoNodesById = useMemo(() => new Map(nodes.filter((node): node is CanvasVideoNode => isVideoNode(node)).map((node) => [node.id, node])), [nodes]);
    const onNodesChange = useMemo(
        () =>
            createNodesChangeHandler(setNodes, (nodeIds) => {
                const allIds = new Set(nodeIds);
                let expanded = true;
                while (expanded) {
                    expanded = false;
                    nodesRef.current.forEach((node) => {
                        const before = allIds.size;
                        if (allIds.has(node.id) && isBackgroundNode(node)) node.memberNodeIds.forEach((memberId) => allIds.add(memberId));
                        if (allIds.has(node.id) && isImageNode(node)) node.grouping.childIds.forEach((childId) => allIds.add(childId));
                        expanded ||= allIds.size !== before;
                    });
                }
                if (allIds.size !== nodeIds.size) {
                    setSelectedNodeIds((current) => new Set([...current].filter((id) => !allIds.has(id))));
                }
                cancelVideoCompositionTasksForDeletedNodes(allIds);
                setConnections((currentConnections) => currentConnections.filter((connection) => !allIds.has(connection.source.nodeId) && !allIds.has(connection.target.nodeId)));
                return allIds;
            }),
        [cancelVideoCompositionTasksForDeletedNodes],
    );
    const onEdgesChange = useMemo(() => createEdgesChangeHandler(setConnections), []);
    const onConnect = useMemo(() => createConnectHandler(setConnections, connectionsRef, nodesRef, (errorMessage) => message.warning(errorMessage)), [message]);

    const nodeActions = useMemo(
        (): NodeActions => ({
            textEditingNodeId: editingNodeId,
            textEditRequestVersion: editRequestNonce,
            onInfo: (n) => setInfoNodeId(n.id),
            onTitleChange: handleNodeTitleChange,
            onEditText: openTextEditor,
            onContentChange: handleNodeContentChange,
            onDecreaseFont: (node) => {
                if (isTextNode(node)) handleConfigNodeChange(node.id, { fontSize: Math.max(10, node.content.fontSize - 2) });
            },
            onIncreaseFont: (node) => {
                if (isTextNode(node)) handleConfigNodeChange(node.id, { fontSize: Math.min(48, node.content.fontSize + 2) });
            },
            onGenerateImage: (node) => {
                if (isTextNode(node) && node.content.text) void handleGenerateNode(node.id, "image", node.content.text);
            },
            onUpload: (n) => handleUploadRequest(n.id),
            onUploadObjectStorage: (n) => void uploadNodeObjectStorage(n),
            onDownload: (n) => downloadNodeImage(n),
            onSaveAsset: (n) => saveNodeAsset(n),
            onCrop: (n) => setCropNodeId(n.id),
            onSplit: (n) => setSplitNodeId(n.id),
            onViewImage: (n) => setPreviewNodeId(n.id),
            onViewVideo: (n) => setPreviewNodeId(n.id),
            onRetry: (n) => (isStoryboardNode(n) ? void handleGenerateStoryboard(n) : void handleRetryNode(n)),
            onOpenStoryboard: (node) => setStoryboardWorkspaceNodeId(node.id),
            onStoryboardInstructionChange: handleStoryboardInstructionChange,
            onStoryboardVisualStyleChange: handleStoryboardVisualStyleChange,
            onStoryboardModelChange: handleStoryboardModelChange,
            onGenerateStoryboard: (node) => void handleGenerateStoryboard(node),
            videoNodesById,
            onVideoCompositionInputOrderChange: handleVideoCompositionInputOrderChange,
            onComposeVideo: (node) => void handleComposeVideo(node),
            onMissingTextModelConfig: () => showMissingAiConfig("text"),
            onToggleBatch: toggleBatchExpanded,
            batchOpeningRootIds: openingBatchIds,
            batchCollapsingRootIds: collapsingBatchIds,
            batchImagePreviewsByRootId: batchCardStacks.imagePreviewsByRootId,
            batchCardStackTransformsByNodeId: batchCardStacks.transformsByNodeId,
            onToggleFreeResize: (node) => handleConfigNodeChange(node.id, { freeResize: !node.frame.freeResize }),
            onDelete: (n) => confirmDeleteNodes(new Set([n.id])),
            onKeepToolbar: keepNodeToolbar,
            onHideToolbar: hideNodeToolbar,
            onResize: (nodeId, width, height, position) => {
                handleNodeResize(nodeId, width, height, position);
            },
            onBackgroundTitleChange: handleBackgroundTitleChange,
            onBackgroundColorChange: handleBackgroundColorChange,
        }),
        [
            batchCardStacks,
            collapsingBatchIds,
            confirmDeleteNodes,
            downloadNodeImage,
            editRequestNonce,
            editingNodeId,
            handleConfigNodeChange,
            handleBackgroundColorChange,
            handleBackgroundTitleChange,
            handleNodeResize,
            handleGenerateNode,
            handleGenerateStoryboard,
            handleComposeVideo,
            handleNodeContentChange,
            handleNodeTitleChange,
            handleRetryNode,
            handleStoryboardInstructionChange,
            handleStoryboardVisualStyleChange,
            handleStoryboardModelChange,
            handleUploadRequest,
            hideNodeToolbar,
            handleVideoCompositionInputOrderChange,
            keepNodeToolbar,
            openingBatchIds,
            openTextEditor,
            saveNodeAsset,
            showMissingAiConfig,
            toggleBatchExpanded,
            uploadNodeObjectStorage,
            videoNodesById,
        ],
    );

    useEffect(() => {
        if (!edgeDeletePopover) return;
        if (connections.some((connection) => connection.id === edgeDeletePopover.connectionId)) return;
        setEdgeDeletePopover(null);
    }, [connections, edgeDeletePopover]);

    const reactFlowViewport = useMemo(() => ({ x: viewport.x, y: viewport.y, zoom: viewport.k }), [viewport.k, viewport.x, viewport.y]);
    const handleViewportChange = useCallback((next: { x: number; y: number; zoom: number }) => {
        setViewport((current) => {
            if (current.x === next.x && current.y === next.y && current.k === next.zoom) return current;
            return { x: next.x, y: next.y, k: next.zoom };
        });
        setContextMenu(null);
    }, []);
    const getReactFlowConnectionHandle = useCallback((params: OnConnectStartParams): ConnectionHandle | null => {
        if (!params.nodeId) return null;
        return {
            nodeId: params.nodeId,
            handleType: params.handleId === "left" ? "target" : "source",
        };
    }, []);
    const handleSelectionChange = useCallback((nodeIds: string[], edgeIds: string[]) => {
        setSelectedNodeIds((current) => {
            if (current.size === nodeIds.length && nodeIds.every((nodeId) => current.has(nodeId))) return current;
            return new Set(nodeIds);
        });
        setSelectedConnectionId((current) => {
            const next = edgeIds[0] || null;
            return current === next ? current : next;
        });
        if (nodeIds.length || !edgeIds.length) setEdgeDeletePopover(null);
    }, []);
    const handleNodeClick = useCallback((_event: ReactMouseEvent, nodeId: string) => {
        const node = nodesRef.current.find((item) => item.id === nodeId);
        setDialogNodeId(node && !isBackgroundNode(node) ? nodeId : null);
        setContextMenu(null);
        setEdgeDeletePopover(null);
        setPendingConnectionCreate(null);
    }, []);
    const handleNodeContextMenu = useCallback((event: ReactMouseEvent, nodeId: string) => {
        setEdgeDeletePopover(null);
        const selectedNodeIds = selectedNodeIdsRef.current;
        const targetNode = nodesRef.current.find((node) => node.id === nodeId);
        setContextMenu(selectedNodeIds.size > 1 && selectedNodeIds.has(nodeId) ? { type: "selection", x: event.clientX, y: event.clientY, nodeIds: [...selectedNodeIds] } : { type: "node", x: event.clientX, y: event.clientY, nodeId, nodeKind: targetNode?.kind || "text" });
    }, []);
    const handleSelectionContextMenu = useCallback((event: ReactMouseEvent, nodeIds: string[]) => {
        if (!nodeIds.length) return;
        setSelectedConnectionId(null);
        setEdgeDeletePopover(null);
        setPendingConnectionCreate(null);
        setDialogNodeId(null);
        setContextMenu({ type: "selection", x: event.clientX, y: event.clientY, nodeIds });
    }, []);
    const handleEdgeClick = useCallback((event: ReactMouseEvent, edgeId: string) => {
        const rect = containerRef.current?.getBoundingClientRect();
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(edgeId);
        setEdgeDeletePopover({
            connectionId: edgeId,
            x: event.clientX - (rect?.left || 0),
            y: event.clientY - (rect?.top || 0),
        });
        setDialogNodeId(null);
        setContextMenu(null);
    }, []);
    const handlePaneClick = useCallback(() => {
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        setEdgeDeletePopover(null);
        setPendingConnectionCreate(null);
        setDialogNodeId(null);
        setContextMenu(null);
    }, []);
    const handlePaneContextMenu = useCallback(
        (event: ReactMouseEvent | MouseEvent) => {
            setSelectedConnectionId(null);
            setEdgeDeletePopover(null);
            setPendingConnectionCreate(null);
            setDialogNodeId(null);
            const selectedNodeIds = selectedNodeIdsRef.current;
            if (selectedNodeIds.size) {
                setContextMenu({ type: "selection", x: event.clientX, y: event.clientY, nodeIds: [...selectedNodeIds] });
                return;
            }
            setSelectedNodeIds(new Set());
            setContextMenu({ type: "canvas", x: event.clientX, y: event.clientY, position: screenToCanvas(event.clientX, event.clientY) });
        },
        [screenToCanvas],
    );
    const handleCanvasRootPointerDownCapture = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest(PROMPT_PANEL_INTERACTION_IGNORE_SELECTOR)) return;
        setDialogNodeId(null);
    }, []);
    const handleReactFlowConnectStart = useCallback(
        (_event: MouseEvent | TouchEvent, params: OnConnectStartParams) => {
            reactFlowConnectionStartRef.current = getReactFlowConnectionHandle(params);
            setPendingConnectionCreate(null);
            setContextMenu(null);
            setEdgeDeletePopover(null);
        },
        [getReactFlowConnectionHandle],
    );
    const handleReactFlowConnectEnd = useCallback<OnConnectEnd>(
        (event, connectionState) => {
            const startedConnection = reactFlowConnectionStartRef.current;
            reactFlowConnectionStartRef.current = null;
            if (!startedConnection) return;
            if (connectionState.toNode) return;
            if (!nodesRef.current.some((node) => node.id === startedConnection.nodeId)) return;
            if (!("clientX" in event) || !("clientY" in event)) return;

            const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, startedConnection);
            if (dropTarget.nodeId || dropTarget.isNearNode) return;

            const position = screenToCanvas(event.clientX, event.clientY);
            const rect = containerRef.current?.getBoundingClientRect();
            setSelectedNodeIds(new Set());
            setSelectedConnectionId(null);
            setContextMenu(null);
            setEdgeDeletePopover(null);
            setMouseWorld(position);
            setPendingConnectionCreate({
                connection: startedConnection,
                position,
                menuPosition: {
                    x: event.clientX - (rect?.left || 0),
                    y: event.clientY - (rect?.top || 0),
                },
            });
        },
        [getConnectionDropTarget, screenToCanvas],
    );

    if (!projectLoaded) return <CanvasLoadingShell />;

    return (
        <main className="flex h-full min-h-0 overflow-hidden" style={{ background: theme.canvas.backgroundGradient, color: theme.node.text }} onPointerDownCapture={handleCanvasRootPointerDownCapture}>
            <section ref={containerRef} className="relative min-w-0 flex-1 overflow-hidden">
                <CanvasTopBar
                    title={currentDocument?.identity.title || "未命名画布"}
                    titleDraft={titleDraft}
                    isTitleEditing={titleEditing}
                    onTitleDraftChange={setTitleDraft}
                    onStartTitleEditing={startTitleEditing}
                    onFinishTitleEditing={finishTitleEditing}
                    onCancelTitleEditing={() => setTitleEditing(false)}
                    onBackToProjects={confirmBackToProjects}
                    navigationPanelHidden={navigationPanelState === "hidden"}
                    onOpenNavigationPanel={openNavigationPanel}
                    agentOpen={assistantOpen}
                    onToggleAgent={() => (assistantOpen ? closeAgent() : openAgent())}
                />

                <NodeActionProvider value={nodeActions}>
                    <CanvasFlow
                        viewport={reactFlowViewport}
                        backgroundMode={backgroundMode}
                        onViewportChange={handleViewportChange}
                        nodes={rfNodes}
                        edges={rfEdges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        onConnectStart={handleReactFlowConnectStart}
                        onConnectEnd={handleReactFlowConnectEnd}
                        nodeTypes={nodeTypes}
                        onNodeMouseDown={handleNodeMouseDown}
                        onNodeDrag={handleBackgroundNodeDrag}
                        onNodeDragStop={handleBackgroundNodeDragStop}
                        onNodeClick={handleNodeClick}
                        onSelectionChange={handleSelectionChange}
                        onNodeContextMenu={handleNodeContextMenu}
                        onSelectionContextMenu={handleSelectionContextMenu}
                        onEdgeClick={handleEdgeClick}
                        onPaneClick={handlePaneClick}
                        onPaneContextMenu={handlePaneContextMenu}
                    />
                </NodeActionProvider>

                {navigationPanelState !== "hidden" ? (
                    <CanvasNavigationPanel
                        state={navigationPanelState === "collapsed" ? "collapsed" : "expanded"}
                        activeTab={navigationPanelTab}
                        nodes={navigationNodes}
                        assets={navigationAssets}
                        selectedNodeIds={selectedNodeIds}
                        onTabChange={setNavigationPanelTab}
                        onLocateNode={handleNavigationNodeLocate}
                        onPreviewAsset={setPreviewAsset}
                        onCollapse={() => setNavigationPanelState("collapsed")}
                        onExpand={openNavigationPanel}
                        onHide={() => setNavigationPanelState("hidden")}
                    />
                ) : null}

                {edgeDeletePopover ? (
                    <div
                        className="absolute z-[115] flex items-center rounded-lg border p-1 shadow-lg"
                        style={{
                            left: edgeDeletePopover.x,
                            top: edgeDeletePopover.y,
                            transform: "translate(8px, -50%)",
                            background: theme.node.panel,
                            borderColor: theme.node.stroke,
                            color: theme.node.text,
                        }}
                        onMouseDown={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                    >
                        <button
                            type="button"
                            className="grid size-8 place-items-center rounded-md transition"
                            style={{ color: theme.node.muted }}
                            aria-label="删除连线"
                            title="删除连线"
                            onMouseEnter={(event) => {
                                event.currentTarget.style.background = theme.node.fill;
                                event.currentTarget.style.color = theme.node.text;
                            }}
                            onMouseLeave={(event) => {
                                event.currentTarget.style.background = "transparent";
                                event.currentTarget.style.color = theme.node.muted;
                            }}
                            onClick={() => deleteConnection(edgeDeletePopover.connectionId)}
                        >
                            <Trash2 className="size-4" />
                        </button>
                    </div>
                ) : null}

                {pendingConnectionCreate ? (
                    <>
                        <PendingConnectionLine pending={pendingConnectionCreate} nodes={nodes} viewport={viewport} />
                        <ConnectionCreateMenu
                            pending={pendingConnectionCreate}
                            sourceNode={nodeById.get(pendingConnectionCreate.connection.nodeId) || null}
                            onCreate={(type) => createConnectedNode(type, pendingConnectionCreate)}
                            onCreateSettingGraph={(skill) => createConnectedNode("image", pendingConnectionCreate, skill)}
                            onClose={cancelPendingConnectionCreate}
                        />
                    </>
                ) : null}

                {promptPanelNode && floatingPanelStyle ? (
                    <div
                        data-canvas-prompt-panel
                        className="absolute z-[90]"
                        style={{
                            left: floatingPanelStyle.left,
                            top: floatingPanelStyle.top,
                            width: PROMPT_PANEL_WIDTH,
                        }}
                    >
                        <CanvasNodePromptPanel
                            key={promptPanelNode.id}
                            node={promptPanelNode}
                            isRunning={runningNodeId === promptPanelNode.id}
                            isPromptGenerating={promptGeneratingNodeId === promptPanelNode.id}
                            mentionReferences={mentionReferencesByNodeId.get(promptPanelNode.id) || []}
                            onPromptChange={handleNodePromptChange}
                            onConfigChange={handleConfigNodeChange}
                            onGenerate={(nodeId, mode, prompt, styleIds, styleSnapshots) => {
                                const target = nodesRef.current.find((item) => item.id === nodeId);
                                if (target && isImageNode(target) && target.generation.settingGraph) {
                                    void handleSettingGraphGenerate(nodeId, prompt, target.generation.settingGraph);
                                    return;
                                }
                                void handleGenerateNode(nodeId, mode, prompt, false, undefined, { ids: styleIds, snapshots: styleSnapshots });
                            }}
                            onGeneratePrompt={handleGenerateNodePrompt}
                            onStop={confirmStopGeneration}
                            onMissingConfig={showMissingAiConfig}
                            onApplyContent={handleNodeContentChange}
                            canGenerateWithoutPrompt={promptPanelCanGenerateWithoutPrompt}
                            onRemoveReference={(reference) => removeNodeReferenceConnection(promptPanelNode.id, reference.nodeId)}
                            mentionCandidates={canvasResourceReferences}
                            onMentionSelect={(reference) => connectMentionReference(reference.nodeId, promptPanelNode.id)}
                            onImageSettingsOpenChange={(open) => {
                                setNodeImageSettingsOpen(open);
                                if (open) setToolbarNodeId(null);
                            }}
                        />
                    </div>
                ) : null}

                <CanvasNodeHoverToolbar
                    node={isNodeDragging || nodeImageSettingsOpen ? null : toolbarNode}
                    viewport={viewport}
                    onKeep={keepNodeToolbar}
                    onLeave={hideNodeToolbar}
                    onInfo={(node) => setInfoNodeId(node.id)}
                    onDecreaseFont={(node) => {
                        if (isTextNode(node)) handleFontSizeChange(node.id, Math.max(10, node.content.fontSize - 2));
                    }}
                    onIncreaseFont={(node) => {
                        if (isTextNode(node)) handleFontSizeChange(node.id, Math.min(32, node.content.fontSize + 2));
                    }}
                    onUpload={(node) => handleUploadRequest(node.id)}
                    onUploadObjectStorage={(node) => void uploadNodeObjectStorage(node)}
                    onDownload={downloadNodeImage}
                    onSaveAsset={(node) => void saveNodeAsset(node)}
                    onChooseAsset={(node) => {
                        setCanvasAssetReplaceNodeId(node.id);
                        setCanvasAssetPickerOpen(true);
                    }}
                    onCrop={(node) => setCropNodeId(node.id)}
                    onSplit={(node) => setSplitNodeId(node.id)}
                    onViewImage={(node) => setPreviewNodeId(node.id)}
                    onRetry={(node) => (isStoryboardNode(node) ? void handleGenerateStoryboard(node) : void handleRetryNode(node))}
                    onGenerateStoryboardVideos={(node) => {
                        if (isStoryboardNode(node)) setStoryboardVideoGenerationNodeId(node.id);
                    }}
                    onToggleFreeResize={(node) => toggleNodeFreeResize(node.id)}
                    onDelete={(node) => confirmDeleteNodes(new Set([node.id]))}
                />

                <CanvasToolbar
                    selectedCount={selectedNodeIds.size}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    onAddImage={() => createNode("image")}
                    onAddVideo={() => createNode("video")}
                    onAddText={() => createNode("text")}
                    onAddBackground={() => createNode("background")}
                    onUndo={undoCanvas}
                    onRedo={redoCanvas}
                    onUpload={() => handleUploadRequest()}
                    onDelete={() => confirmDeleteNodes(new Set(selectedNodeIds))}
                    onClear={() => setClearConfirmOpen(true)}
                    onDeselect={deselectCanvas}
                    onOpenMyAssets={() => {
                        setAssetPickerOpen(true);
                    }}
                    selectedBackground={selectedNodeIds.size === 1 ? (() => { const selected = nodes.find((node) => selectedNodeIds.has(node.id)); return selected && isBackgroundNode(selected) ? selected : null; })() : null}
                    onBackgroundTitleChange={(nodeId, title) => { const node = nodesRef.current.find((item): item is CanvasBackgroundNode => item.id === nodeId && isBackgroundNode(item)); if (node) handleBackgroundTitleChange(node, title); }}
                    onBackgroundColorChange={(nodeId, color) => { const node = nodesRef.current.find((item): item is CanvasBackgroundNode => item.id === nodeId && isBackgroundNode(item)); if (node) handleBackgroundColorChange(node, color); }}
                />

                <CanvasWorkspaceOverlays
                    contextMenu={contextMenu}
                    imageInputRef={imageInputRef}
                    infoNode={infoNode}
                    cropNode={cropNode}
                    cropLoading={Boolean(cropNodeId && croppingNodeId === cropNodeId)}
                    splitNode={splitNode}
                    splitLoading={Boolean(splitNodeId && splittingNodeId === splitNodeId)}
                    previewNode={previewNode}
                    clearConfirmOpen={clearConfirmOpen}
                    assetPickerOpen={assetPickerOpen}
                    canvasAssetPickerOpen={canvasAssetPickerOpen}
                    canvasAssets={navigationAssets.filter((asset): asset is Extract<CanvasNavigationAsset, { source: "storyboard" }> => asset.source === "storyboard" && Boolean(asset.asset.image?.source))}
                    onCloseContextMenu={() => setContextMenu(null)}
                    onCreateNode={createNode}
                    onDuplicateNode={duplicateNode}
                    onDeleteNodes={confirmDeleteNodes}
                    onDeleteBackgroundOnly={confirmDeleteBackgroundOnly}
                    onDeleteConnection={deleteConnection}
                    onImageInputChange={handleImageInputChange}
                    onCloseInfo={() => setInfoNodeId(null)}
                    onCloseCrop={() => {
                        if (!croppingNodeId) setCropNodeId(null);
                    }}
                    onCrop={(node, crop) => void cropImageNode(node, crop)}
                    onCloseSplit={() => {
                        if (!splittingNodeId) setSplitNodeId(null);
                    }}
                    onSplit={(node, params) => void splitImageNode(node, params)}
                    onClosePreview={() => setPreviewNodeId(null)}
                    onCloseClearConfirm={() => setClearConfirmOpen(false)}
                    onClearCanvas={clearCanvas}
                    onInsertAsset={handleAssetInsert}
                    onCloseAssetPicker={() => {
                        setAssetPickerOpen(false);
                    }}
                    onSelectCanvasAsset={handleCanvasAssetSelect}
                    onCloseCanvasAssetPicker={() => {
                        setCanvasAssetPickerOpen(false);
                        setCanvasAssetReplaceNodeId(null);
                    }}
                />
                <AssetPreviewDialog
                    asset={previewLibraryAsset}
                    onClose={() => setPreviewAsset(null)}
                    onCopy={() => {
                        if (previewLibraryAsset?.kind === "text") copyText(previewLibraryAsset.data.content, "文本已复制");
                    }}
                    onDownload={() => {
                        if (previewLibraryAsset) downloadAsset(previewLibraryAsset);
                    }}
                />
                <CanvasStoryboardAssetPreviewDialog asset={previewStoryboardAsset} onClose={() => setPreviewAsset(null)} />
            </section>
            <StoryboardWorkspace
                open={Boolean(openedStoryboardNode)}
                node={openedStoryboardNode}
                composing={composingStoryboardNodeId === openedStoryboardNode?.id}
                composingShotId={composingStoryboardShot?.nodeId === openedStoryboardNode?.id ? (composingStoryboardShot?.shotId ?? null) : null}
                onClose={() => setStoryboardWorkspaceNodeId(null)}
                onChangeStoryboard={handleStoryboardDataChange}
                onComposePrompts={(nodeId, shotIds, model) => void handleComposeStoryboardPrompts(nodeId, shotIds, model)}
                onComposeShotPrompt={(nodeId, shotId) => void handleComposeStoryboardShotPrompt(nodeId, shotId)}
                onGenerateAssets={(nodeId, assetIds, settings) => void handleGenerateStoryboardAssets(nodeId, assetIds, settings)}
                onMissingImageModelConfig={() => showMissingAiConfig("image")}
                onMissingTextModelConfig={() => showMissingAiConfig("text")}
            />
            <StoryboardVideoGenerationModal
                open={Boolean(openedStoryboardVideoGenerationNode)}
                node={openedStoryboardVideoGenerationNode}
                generating={generatingStoryboardVideoNodeId === openedStoryboardVideoGenerationNode?.id}
                referenceVideos={storyboardReferenceVideos}
                onClose={() => setStoryboardVideoGenerationNodeId(null)}
                onGenerate={(nodeId, shotIds, model, settings) => void handleGenerateStoryboardVideos(nodeId, shotIds, model, settings)}
                onMissingVideoModelConfig={() => showMissingAiConfig("video")}
            />
            {assistantMounted ? (
                <CanvasChatPanel
                    onCollapse={closeAgent}
                    nodes={nodes}
                    onNodeDropRef={onNodeDropRef}
                    messages={activeSessionMessages}
                    completedThinkings={completedThinkings}
                    activeThinking={activeThinking}
                    onNewSession={handleCreateAgentSession}
                    onStop={() => void cancelAgentMessage().catch((error) => message.error(error instanceof Error ? error.message : "停止失败"))}
                    initialPrompt={initialPrompt}
                    sessionId={activeChatId}
                    onSend={async (text, references = [], generationStyleIds = [], generationStyles = []) => {
                        if (agentRunning || agentQueued) return;
                        const now = new Date().toISOString();
                        const sessionId = activeChatId || nanoid();
                        const userMessage: CanvasAssistantMessage = { id: nanoid(), role: "user", text, references, generationStyles };
                        const history = buildAgentChatHistory(activeSessionMessages);
                        activeAgentSessionIdRef.current = sessionId;
                        activeAgentAssistantMessageIdRef.current = null;
                        resetTextStream(false);
                        resetThinkings();
                        setAgentRunning(false);
                        setAgentQueued(true);

                        if (!activeChatId) {
                            const newSession: CanvasAssistantSession = {
                                id: sessionId,
                                title: text.slice(0, 30) || "新对话",
                                messages: [userMessage],
                                createdAt: now,
                                updatedAt: now,
                            };
                            handleAssistantSessionsChange([...chatSessions, newSession], sessionId);
                        } else {
                            appendAssistantMessage(sessionId, userMessage);
                        }

                        try {
                            await sendAgentMessage(
                                text,
                                references.map((reference) => ({ title: reference.title, text: reference.text || "" })),
                                config.agentModel || undefined,
                                history,
                                {
                                    image: generationStyles.filter((style) => style.generationType === "image").map((style) => style.id),
                                    video: generationStyles.filter((style) => style.generationType === "video").map((style) => style.id),
                                },
                                {
                                    size: config.size || "16:9",
                                    resolution: config.vquality || "720p",
                                    quality: String(config.vquality || "720p").includes("1080") ? "high" : String(config.vquality || "720p").includes("480") ? "low" : "medium",
                                    count: normalizeVideoGenerationCount(config.canvasVideoCount),
                                    seconds: config.videoSeconds || "5",
                                    watermark: String(config.videoWatermark).toLowerCase() === "true",
                                    videoGenerationMode: config.videoGenerationMode,
                                    videoModel: config.videoModel || undefined,
                                },
                            );
                        } catch (error) {
                            resetThinkings();
                            appendAssistantMessage(sessionId, { id: nanoid(), role: "error", title: "操作失败", text: error instanceof Error ? error.message : "操作失败" });
                            setAgentRunning(false);
                            setAgentQueued(false);
                        }
                    }}
                    isStreaming={agentRunning}
                    isQueued={agentQueued}
                    config={config}
                    model={config.agentModel}
                    onModelChange={(model) => updateConfig("agentModel", model)}
                    onMissingConfig={() => showMissingAiConfig("text")}
                />
            ) : null}
        </main>
    );
}

function applyVideoCompositionTaskToNodes(nodes: CanvasDomainNode[], compositionNodeId: string, fallbackResultVideoNodeId: string | undefined, task: VideoCompositionTask): CanvasDomainNode[] {
    const compositionNode = nodes.find((node): node is CanvasVideoCompositionNode => node.id === compositionNodeId && isVideoCompositionNode(node));
    if (compositionNode?.execution.taskId !== task.id) return nodes;
    const resultVideoNodeId = compositionNode?.composition.resultVideoNodeId || fallbackResultVideoNodeId;
    if (task.status === "succeeded" && !readCompositionResultUrl(task)) {
        return markVideoCompositionTaskFailed(nodes, compositionNodeId, resultVideoNodeId, "视频合成完成但没有返回结果媒体", task.id);
    }
    const execution = videoCompositionExecution(task);
    return nodes.map((node) => {
        if (node.id === compositionNodeId && isVideoCompositionNode(node)) return { ...node, execution };
        if (node.id !== resultVideoNodeId || !isVideoNode(node)) return node;
        if (task.status === "succeeded") {
            const result = task.resultData || {};
            const updated = applyCanvasNodeAttributes(node, {
                status: NODE_STATUS_SUCCESS,
                content: readCompositionResultUrl(task),
                storageKey: typeof result.storageKey === "string" ? result.storageKey : undefined,
                mimeType: typeof result.mimeType === "string" ? result.mimeType : undefined,
                bytes: typeof result.bytes === "number" ? result.bytes : undefined,
                durationMs: typeof result.durationMs === "number" ? result.durationMs : undefined,
                objectStorage: result.objectStorage,
                naturalWidth: typeof result.width === "number" ? result.width : undefined,
                naturalHeight: typeof result.height === "number" ? result.height : undefined,
                startedAt: task.startedAt,
                completedAt: task.completedAt,
            });
            return updateCanvasNodeFrame(updated, {
                naturalWidth: typeof result.width === "number" ? result.width : undefined,
                naturalHeight: typeof result.height === "number" ? result.height : undefined,
            });
        }
        return { ...node, execution };
    });
}

function markVideoCompositionTaskFailed(nodes: CanvasDomainNode[], compositionNodeId: string, resultVideoNodeId: string | undefined, errorMessage: string, taskId?: string): CanvasDomainNode[] {
    const compositionNode = nodes.find((node): node is CanvasVideoCompositionNode => node.id === compositionNodeId && isVideoCompositionNode(node));
    if (taskId && compositionNode?.execution.taskId !== taskId) return nodes;
    return nodes.map((node) => {
        if (node.id === compositionNodeId && isVideoCompositionNode(node)) {
            return { ...node, execution: { phase: "failed", progress: 100, errorMessage } };
        }
        if (node.id === resultVideoNodeId && isVideoNode(node)) {
            return { ...node, execution: { phase: "failed", progress: 100, errorMessage } };
        }
        return node;
    });
}

function videoCompositionExecution(task: VideoCompositionTask) {
    if (task.status === "pending" || task.status === "running") {
        return {
            phase: "running" as const,
            taskId: task.id,
            progress: Math.max(0, Math.min(99, task.progress || 0)),
            ...(task.startedAt ? { startedAt: task.startedAt } : {}),
        };
    }
    if (task.status === "succeeded") {
        return {
            phase: "succeeded" as const,
            progress: 100,
            ...(task.startedAt ? { startedAt: task.startedAt } : {}),
            ...(task.completedAt ? { completedAt: task.completedAt } : {}),
        };
    }
    return {
        phase: "failed" as const,
        progress: 100,
        errorMessage: task.errorMessage || (task.status === "canceled" ? "任务已取消" : "视频合成失败"),
        ...(task.startedAt ? { startedAt: task.startedAt } : {}),
        ...(task.completedAt ? { completedAt: task.completedAt } : {}),
    };
}

function readCompositionResultUrl(task: VideoCompositionTask): string {
    const url = task.resultData?.url;
    return typeof url === "string" ? url.trim() : "";
}

function isVideoCompositionPollingCanceled(error: unknown): boolean {
    return error instanceof DOMException && error.name === "AbortError";
}

function sameNodeIds(first: string[], second: string[]): boolean {
    return first.length === second.length && first.every((nodeId, index) => nodeId === second[index]);
}

function sameNodeIdSet(first: string[], second: string[]): boolean {
    return first.length === second.length && new Set(first).size === first.length && first.every((nodeId) => second.includes(nodeId));
}

/** 读取画布连入分镜节点的视频参考，批量应用到分镜视频生成。 */
function readStoryboardVideoReferences(nodeId: string, nodes: CanvasDomainNode[], connections: CanvasConnection[]): ReferenceVideo[] {
    return getGenerationResourceNodes(nodeId, nodes, connections)
        .filter((node): node is CanvasVideoNode => isVideoNode(node) && Boolean(node.content.source))
        .map((node) => ({
            id: node.id,
            name: `${node.title || node.id}.mp4`,
            type: node.content.mimeType || "video/mp4",
            url: node.content.source,
            storageKey: node.content.storageKey,
            bytes: node.content.bytes,
            durationMs: node.content.durationMilliseconds,
            objectStorage: node.content.objectStorage,
        }));
}

function imageExtension(dataUrl: string) {
    return dataUrl.match(/^data:image[/]([^;]+)/)?.[1] || dataUrl.match(/image[/]([^;]+)/)?.[1] || "png";
}

function imageAttributes(image: UploadedImage): CanvasNodeAttributes {
    return { content: image.url, storageKey: image.storageKey, status: "success", naturalWidth: image.width, naturalHeight: image.height, bytes: image.bytes, mimeType: image.mimeType, objectStorage: image.objectStorage };
}

function videoAttributes(video: UploadedFile): CanvasNodeAttributes {
    return {
        content: video.url,
        storageKey: video.storageKey,
        status: "success",
        naturalWidth: video.width,
        naturalHeight: video.height,
        bytes: video.bytes,
        mimeType: video.mimeType || "video/mp4",
        durationMs: video.durationMs,
        objectStorage: video.objectStorage,
    };
}

function buildImageGenerationAttributes(type: CanvasImageGenerationType, config: AiConfig, count: number, references: ReferenceImage[], generationStyleIds: number[] = [], generationStyleSnapshots: GenerationStyleSnapshot[] = []): CanvasNodeAttributes {
    return {
        generationType: type,
        model: config.model,
        size: config.size,
        quality: config.quality,
        imageResolution: config.imageResolution,
        count,
        references: references.map(referenceUrl).filter((url): url is string => Boolean(url)),
        referenceObjectStorages: references.map((reference) => reference.objectStorage).filter((file): file is NonNullable<typeof file> => Boolean(file?.url)),
        generationStyleIds,
        generationStyleSnapshots,
    };
}

function referenceUrl(image: ReferenceImage) {
    return image.objectStorage?.url || image.storageKey || image.url || (!image.dataUrl.startsWith("data:") ? image.dataUrl : undefined);
}

function generationVideoReferenceAttributes(context: { referenceImages: ReferenceImage[]; referenceVideos: ReferenceVideo[] }) {
    return {
        references: context.referenceImages.map(referenceUrl).filter((url): url is string => Boolean(url)),
        referenceObjectStorages: context.referenceImages.map((reference) => reference.objectStorage).filter((file): file is NonNullable<typeof file> => Boolean(file?.url)),
        videoReferences: context.referenceVideos.map(videoReferenceUrl).filter((url): url is string => Boolean(url)),
        videoReferenceObjectStorages: context.referenceVideos.map((video) => video.objectStorage).filter((file): file is NonNullable<typeof file> => Boolean(file?.url)),
    };
}

type PersistableReference = { objectStorage?: ObjectStorageFile; url?: string; storageKey?: string; dataUrl?: string };

function referenceIdentityKey(reference: PersistableReference) {
    return reference.objectStorage?.url || reference.url || reference.storageKey || reference.dataUrl || "";
}

/** 合并两组参考素材，按对象存储地址/URL 去重，连线引用优先。 */
function mergeUniqueReferences<T extends PersistableReference>(primary: T[], extra: T[]): T[] {
    const seen = new Set(primary.map(referenceIdentityKey));
    return [...primary, ...extra.filter((reference) => !seen.has(referenceIdentityKey(reference)))];
}

function videoReferenceUrl(video: ReferenceVideo) {
    return video.objectStorage?.url || video.storageKey || video.url;
}

async function resolveGenerationReferences(generation: CanvasImageGenerationSettings): Promise<ReferenceImage[] | null> {
    if (generation.operation !== "edit") return [];
    if (!generation.references.length) return null;
    const references = await Promise.all(
        generation.references.map(async (url, index) => {
            const dataUrl = url.startsWith("image:") ? await resolveImageUrl(url, "") : url;
            const objectStorage = generation.referenceObjectStorages.find((file) => file.url === url);
            return dataUrl ? { id: `${index}`, name: `reference-${index}.png`, type: "image/png", dataUrl, url: url.startsWith("http") ? url : undefined, storageKey: url.startsWith("image:") ? url : undefined, objectStorage } : null;
        }),
    );
    return references.every(Boolean) ? (references as ReferenceImage[]) : null;
}

async function resolveVideoGenerationReferences(generation: CanvasVideoGenerationSettings | null): Promise<{ referenceImages: ReferenceImage[]; referenceVideos: ReferenceVideo[]; incomplete: boolean } | null> {
    if (!generation) return null;
    const imageReferences = Array.isArray(generation.references) ? generation.references : [];
    const imageObjectStorages = Array.isArray(generation.referenceObjectStorages) ? generation.referenceObjectStorages : [];
    const videoReferences = Array.isArray(generation.videoReferences) ? generation.videoReferences : [];
    const videoObjectStorages = Array.isArray(generation.videoReferenceObjectStorages) ? generation.videoReferenceObjectStorages : [];
    const hasPersistedReferenceState = Array.isArray(generation.videoReferences) || Array.isArray(generation.videoReferenceObjectStorages) || imageReferences.length > 0;
    if (!hasPersistedReferenceState) return null;

    const legacyImageEntries = imageReferences.map((reference) => ({ reference, objectStorage: findGenerationObjectStorage(imageObjectStorages, reference) })).filter(({ reference, objectStorage }) => !isVideoReferenceValue(reference, objectStorage));
    const legacyVideoEntries = imageReferences.map((reference) => ({ reference, objectStorage: findGenerationObjectStorage(imageObjectStorages, reference) })).filter(({ reference, objectStorage }) => isVideoReferenceValue(reference, objectStorage));
    const imageEntries: Array<ReferenceImage | null> = await Promise.all(
        legacyImageEntries.map(async ({ reference, objectStorage }, index): Promise<ReferenceImage | null> => {
            const dataUrl = objectStorage?.url || (reference.startsWith("http") ? reference : reference.startsWith("image:") ? await resolveImageUrl(reference, "") : "");
            if (!dataUrl) return null;
            return {
                id: `saved-video-image-${index}`,
                name: `reference-${index + 1}.png`,
                type: objectStorage?.mimeType || "image/png",
                dataUrl,
                ...(reference.startsWith("http") ? { url: reference } : {}),
                ...(reference.startsWith("image:") ? { storageKey: reference } : {}),
                ...(objectStorage ? { objectStorage } : {}),
            };
        }),
    );
    const videoEntries = [...legacyVideoEntries, ...videoReferences.map((reference) => ({ reference, objectStorage: findGenerationObjectStorage(videoObjectStorages, reference) }))];
    const resolvedVideos: Array<ReferenceVideo | null> = await Promise.all(
        videoEntries.map(async ({ reference, objectStorage }, index): Promise<ReferenceVideo | null> => {
            const storageKey = reference.startsWith("video:") ? reference : undefined;
            const url = objectStorage?.url || (reference.startsWith("http") ? reference : storageKey ? await resolveMediaUrl(storageKey, "") : "");
            if (!url) return null;
            return {
                id: `saved-video-reference-${index}`,
                name: `reference-${index + 1}.mp4`,
                type: objectStorage?.mimeType || "video/mp4",
                url,
                ...(storageKey ? { storageKey } : {}),
                ...(objectStorage?.bytes !== undefined ? { bytes: objectStorage.bytes } : {}),
                ...(objectStorage ? { objectStorage } : {}),
            };
        }),
    );
    return {
        referenceImages: imageEntries.filter((reference): reference is ReferenceImage => Boolean(reference)),
        referenceVideos: resolvedVideos.filter((reference): reference is ReferenceVideo => Boolean(reference)),
        incomplete: imageEntries.some((reference) => !reference) || resolvedVideos.some((reference) => !reference),
    };
}

function findGenerationObjectStorage(files: ObjectStorageFile[], reference: string) {
    const key = reference.replace(/^(?:image|video):/, "");
    return files.find((file) => file.url === reference || file.key === key);
}

function isVideoReferenceValue(reference: string, objectStorage?: { mimeType?: string }) {
    return objectStorage?.mimeType?.startsWith("video/") || /^(?:video:|.*\.(mp4|webm|mov|m4v)(?:[?#]|$))/i.test(reference);
}

async function readNodeObjectStorageBlob(node: CanvasDomainNode) {
    if ((!isImageNode(node) && !isVideoNode(node)) || !node.content.source) return null;
    if (isImageNode(node)) {
        if (node.content.storageKey) return getImageBlob(node.content.storageKey);
        return (await fetch(node.content.source)).blob();
    }
    if (node.content.storageKey) {
        return getMediaBlob(node.content.storageKey);
    }
    return (await fetch(node.content.source)).blob();
}

async function withNodeImageObjectUrl<Result>(node: CanvasDomainNode, process: (sourceUrl: string) => Promise<Result>): Promise<Result> {
    const blob = await readNodeObjectStorageBlob(node);
    if (!blob) throw new Error("图片文件读取失败");
    const sourceUrl = URL.createObjectURL(blob);
    try {
        return await process(sourceUrl);
    } finally {
        URL.revokeObjectURL(sourceUrl);
    }
}

async function hydrateCanvasImages(nodes: CanvasDomainNode[]) {
    const hydratedNodes: CanvasDomainNode[] = [];
    for (const node of nodes) {
        if (isTextNode(node)) {
            hydratedNodes.push(node);
            continue;
        }
        if (isStoryboardNode(node)) {
            const assets = await Promise.all(
                node.storyboard.assets.map(async (asset) => {
                    const image = asset.image;
                    if (!image) return asset;
                    if (image.storageKey) return { ...asset, image: { ...image, source: await resolveImageUrl(image.storageKey, image.source) } };
                    if (!image.source.startsWith("data:image/")) return asset;
                    const uploaded = await uploadImage(image.source);
                    return {
                        ...asset,
                        image: {
                            source: uploaded.url,
                            storageKey: uploaded.storageKey,
                            mimeType: uploaded.mimeType,
                            objectStorage: uploaded.objectStorage,
                        },
                    };
                }),
            );
            hydratedNodes.push(updateStoryboardNodeData(node, { assets }));
            continue;
        }
        if (isVideoCompositionNode(node)) {
            hydratedNodes.push(node);
            continue;
        }
        if (isBackgroundNode(node)) {
            hydratedNodes.push(node);
            continue;
        }
        const source = node.content.source;
        if (isVideoNode(node)) {
            hydratedNodes.push(node.content.storageKey ? applyCanvasNodeAttributes(node, { content: await resolveMediaUrl(node.content.storageKey, source) }) : node);
            continue;
        }
        if (!source) {
            hydratedNodes.push(node);
            continue;
        }
        if (node.content.storageKey) hydratedNodes.push(applyCanvasNodeAttributes(node, { content: await resolveImageUrl(node.content.storageKey, source) }));
        else if (source.startsWith("data:image/")) hydratedNodes.push(applyCanvasNodeAttributes(node, imageAttributes(await uploadImage(source))));
        else hydratedNodes.push(node);
    }
    return hydratedNodes;
}

async function hydrateAssistantImages(sessions: CanvasAssistantSession[]) {
    const hydratedSessions: CanvasAssistantSession[] = [];
    for (const session of sessions) {
        const hydratedMessages: CanvasAssistantMessage[] = [];
        for (const assistantMessage of session.messages) {
            const hydratedReferences = [];
            for (const reference of assistantMessage.references || []) {
                if (reference.storageKey) {
                    hydratedReferences.push({ ...reference, dataUrl: await resolveImageUrl(reference.storageKey, reference.dataUrl) });
                } else if (reference.dataUrl?.startsWith("data:image/")) {
                    const storedImage = await uploadImage(reference.dataUrl);
                    hydratedReferences.push({ ...reference, dataUrl: storedImage.url, storageKey: storedImage.storageKey, objectStorage: storedImage.objectStorage });
                } else {
                    hydratedReferences.push(reference);
                }
            }
            hydratedMessages.push({ ...assistantMessage, references: hydratedReferences });
        }
        hydratedSessions.push({ ...session, messages: hydratedMessages });
    }
    return hydratedSessions;
}

function connectionHandlesForCreatedNode(id: string, sourceHandle: ConnectionHandle, connection: Omit<CanvasConnection, "id">): CanvasConnection {
    const sourcePortId = sourceHandle.handleType === "source" ? "right" : "left";
    const createdNodeHandleId = sourceHandle.handleType === "source" ? "left" : "right";
    return {
        id,
        source: { ...connection.source, portId: sourcePortId },
        target: { ...connection.target, portId: createdNodeHandleId },
    };
}

function createRightToLeftConnection(sourceNodeId: string, targetNodeId: string): CanvasConnection {
    return createCanvasConnection(nanoid(), sourceNodeId, targetNodeId, "right", "left");
}

function buildGenerationConfig(config: AiConfig, node: CanvasDomainNode | undefined, mode: CanvasNodeGenerationMode): AiConfig {
    const defaultModel = mode === "image" ? config.imageModel : mode === "video" ? config.videoModel : config.textModel;
    const generation = node && (isImageNode(node) || isVideoNode(node)) ? node.generation : null;
    const model = normalizeModelOptionValue(generation?.model || defaultModel || config.model || defaultConfig.model, config.channels);
    return {
        ...config,
        model,
        videoModel: mode === "video" ? model : config.videoModel,
        quality: node && isImageNode(node) ? node.generation.quality || config.quality || defaultConfig.quality : config.quality || defaultConfig.quality,
        imageResolution: node && isImageNode(node) ? node.generation.resolution || config.imageResolution || defaultConfig.imageResolution : config.imageResolution || defaultConfig.imageResolution,
        size: generation?.size || config.size || defaultConfig.size,
        videoSeconds: node && isVideoNode(node) ? node.generation.seconds || config.videoSeconds || defaultConfig.videoSeconds : config.videoSeconds || defaultConfig.videoSeconds,
        vquality: node && isVideoNode(node) ? node.generation.quality || config.vquality || defaultConfig.vquality : config.vquality || defaultConfig.vquality,
        videoGenerationMode: node && isVideoNode(node) ? node.generation.videoGenerationMode || config.videoGenerationMode : config.videoGenerationMode,
        videoWatermark: node && isVideoNode(node) ? node.generation.watermark || config.videoWatermark || defaultConfig.videoWatermark : config.videoWatermark || defaultConfig.videoWatermark,
        count: String(
            mode === "image"
                ? normalizeImageGenerationCount((node && isImageNode(node) ? node.generation.count : undefined) || config.canvasImageCount || config.count || defaultConfig.count)
                : mode === "video"
                  ? normalizeVideoGenerationCount((node && isVideoNode(node) ? node.generation.count : undefined) || config.canvasVideoCount || defaultConfig.canvasVideoCount)
                  : 1,
        ),
        canvasVideoCount: String(normalizeVideoGenerationCount((node && isVideoNode(node) ? node.generation.count : undefined) || config.canvasVideoCount || defaultConfig.canvasVideoCount)),
    };
}

function readCanvasGenerationMode(value: unknown): CanvasGenerationMode | null {
    return value === "text" || value === "image" || value === "video" ? value : null;
}

function applyStoryboardCreditCharge(credits: number, setCreditBalance: (creditBalance: number) => void): void {
    if (!Number.isInteger(credits) || credits <= 0) return;
    const currentBalance = useUserStore.getState().user?.creditBalance;
    if (typeof currentBalance === "number") setCreditBalance(Math.max(0, currentBalance - credits));
}

/** 写入新一轮分镜结果，并清理上一轮资产批量生图状态，避免新资产显示旧任务。 */
function replaceStoryboardGenerationResult(node: CanvasStoryboardNode, shots: CanvasStoryboardNode["storyboard"]["shots"], assets: CanvasStoryboardNode["storyboard"]["assets"]): CanvasStoryboardNode {
    const { assetGeneration: _previousAssetGeneration, ...storyboard } = node.storyboard;
    return { ...node, storyboard: { ...storyboard, shots, assets } };
}

function updateNodeWithTaskResult(nodes: CanvasDomainNode[], nodeId: string, completed: import("@/services/api/server").ServerAiTask): CanvasDomainNode[] {
    const item =
        completed.resultData && typeof completed.resultData === "object"
            ? (((completed.resultData as Record<string, unknown>).item as Record<string, unknown> | undefined) ?? ((completed.resultData as Record<string, unknown>).items as Array<Record<string, unknown>> | undefined)?.[0])
            : undefined;
    const url = item && typeof item.url === "string" ? item.url : "";
    if (!url) return nodes.map((node) => (node.id === nodeId ? updateCanvasNodeExecution(node, { phase: "failed", errorMessage: "生成完成但没有返回结果 URL" }) : node));
    const type = nodeId.startsWith("video") ? "video" : "image";
    return nodes.map((node) => {
        if (node.id !== nodeId) return node;
        const center = { x: node.frame.position.x + node.frame.width / 2, y: node.frame.position.y + node.frame.height / 2 };
        const width = (item?.width as number) || node.frame.width;
        const height = (item?.height as number) || node.frame.height;
        const replacement = node.kind === type ? node : { ...createCanvasNode(type, center), id: node.id, title: node.title };
        return updateCanvasNodeFrame(
            applyCanvasNodeAttributes(replacement, {
                content: url,
                mimeType: (item?.mimeType as string) || (type === "video" ? "video/mp4" : "image/png"),
                status: "success",
                progress: 100,
                bytes: (item?.bytes as number) || 0,
                durationMs: type === "video" ? (item?.durationMs as number) || undefined : undefined,
            }),
            { position: { x: center.x - width / 2, y: center.y - height / 2 }, width, height, naturalWidth: width, naturalHeight: height },
        );
    });
}

function canvasError(category: string, errorMessage: string, parameter?: string): AiTaskErrorDetails {
    return {
        source: "canvas",
        category,
        stage: "frontend_tool",
        parameter,
        message: errorMessage,
        requestAccepted: false,
        safeToRetry: false,
    };
}

function canvasGenerationResult(successfulNodeIds: string[], failures: CanvasNodeGenerationFailure[], actualToolArguments?: Record<string, unknown>): CanvasAgentToolResult {
    const successful = Array.from(new Set(successfulNodeIds));
    return {
        ok: failures.length === 0,
        message: failures.length ? (successful.length ? "部分画布节点生成失败" : "画布节点生成失败") : `画布节点生成完成，共 ${successful.length} 个`,
        data: { successfulNodeIds: successful, failures, ...(actualToolArguments ? { actualToolArguments } : {}) },
    };
}

function failedCanvasGenerationResult(nodeId: string, error: AiTaskErrorDetails, actualToolArguments?: Record<string, unknown>): CanvasAgentToolResult {
    return canvasGenerationResult([], [{ nodeId, error }], actualToolArguments);
}

function canceledCanvasGenerationResult(): CanvasAgentToolResult {
    return { ok: false, message: "已停止生成", data: { canceled: true, successfulNodeIds: [], failures: [] } };
}

function mergeCanvasGenerationResults(results: CanvasAgentToolResult[]): CanvasAgentToolResult {
    if (results.some((result) => result.data?.canceled === true)) return canceledCanvasGenerationResult();
    const successfulNodeIds = results.flatMap((result) => (Array.isArray(result.data?.successfulNodeIds) ? result.data.successfulNodeIds.filter((value): value is string => typeof value === "string") : []));
    const failures = results.flatMap((result) =>
        Array.isArray(result.data?.failures)
            ? result.data.failures.filter((value): value is CanvasNodeGenerationFailure => Boolean(value && typeof value === "object" && typeof (value as CanvasNodeGenerationFailure).nodeId === "string" && (value as CanvasNodeGenerationFailure).error))
            : [],
    );
    const actualToolArguments = results.reduce<Record<string, unknown>>((combined, result) => {
        const value = result.data?.actualToolArguments;
        if (value && typeof value === "object" && !Array.isArray(value)) Object.assign(combined, value);
        return combined;
    }, {});
    return canvasGenerationResult(successfulNodeIds, failures, Object.keys(actualToolArguments).length ? actualToolArguments : undefined);
}

function withCanvasArgumentSources(result: CanvasAgentToolResult, generationOps: CanvasAgentOp[], stateOps: CanvasAgentOp[]): CanvasAgentToolResult {
    const actualToolArguments = result.data?.actualToolArguments;
    if (!actualToolArguments || typeof actualToolArguments !== "object") return result;
    const generatedNodeIds = new Set(stateOps.filter((operation) => operation.type === "add_node" && operation.id).map((operation) => operation.id as string));
    const targetNodeId = generationOps.find((operation) => operation.nodeId)?.nodeId;
    const createdNode = Boolean(targetNodeId && generatedNodeIds.has(targetNodeId));
    const addOperation = stateOps.find((operation) => operation.type === "add_node" && operation.id === targetNodeId);
    const agentFields = new Set(Object.keys(addOperation?.attributes || {}));
    if (agentFields.has("content")) agentFields.add("prompt");
    const argumentSources = Object.fromEntries(Object.keys(actualToolArguments).map((name) => [name, createdNode ? (agentFields.has(name) ? "Agent生成" : "系统默认") : "用户硬约束"]));
    return { ...result, data: { ...result.data, argumentSources } };
}

function canvasActualGenerationArguments(mode: CanvasNodeGenerationMode, prompt: string, config: AiConfig, forcedCount?: number): Record<string, unknown> {
    const values: Record<string, unknown> = {
        prompt,
        model: config.model,
        count: forcedCount ?? Number(config.count || 1),
    };
    if (mode === "image") {
        values.size = config.size;
        values.quality = config.quality;
        values.imageResolution = config.imageResolution;
    } else if (mode === "video") {
        values.size = config.size;
        values.seconds = config.videoSeconds;
        values.vquality = config.vquality;
        values.videoGenerationMode = config.videoGenerationMode;
        values.watermark = config.videoWatermark;
    }
    return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}

function bindAbortSignal(signal: AbortSignal | undefined, controller: AbortController) {
    if (!signal) return () => undefined;
    const abort = () => controller.abort();
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    return () => signal.removeEventListener("abort", abort);
}

function isGenerationCanceled(error: unknown) {
    return (error instanceof Error && (error.message === "请求已取消" || error.name === "AbortError")) || readAiTaskError(error).category === "canceled";
}

/** 在画布节点数组中更新分镜资产批量生成状态。 */
function updateStoryboardAssetGenerationInNodes(nodes: CanvasDomainNode[], nodeId: string, updater: (state: CanvasStoryboardAssetGenerationState) => CanvasStoryboardAssetGenerationState): CanvasDomainNode[] {
    return nodes.map((node) => {
        if (node.id !== nodeId || !isStoryboardNode(node) || !node.storyboard.assetGeneration) return node;
        return updateStoryboardNodeData(node, { assetGeneration: updater(node.storyboard.assetGeneration) });
    });
}

/** 刷新后恢复分镜资产图片任务，并把成功结果回写到对应资产。 */
async function resumeStoryboardAssetGeneration(node: CanvasStoryboardNode, setNodes: (updater: (nodes: CanvasDomainNode[]) => CanvasDomainNode[]) => void): Promise<void> {
    const state = node.storyboard.assetGeneration;
    if (!state) return;
    const taskResults = await Promise.all(
        state.selectedAssetIds.map(async (assetId) => {
            const taskId = state.taskIds[assetId];
            if (!taskId) return { assetId, ok: false, error: "页面刷新时未找到该资产的图片任务" };
            try {
                const task = await getAiTaskInfo(taskId);
                const completed = task.status === "success" ? task : await waitAiTask(taskId, { signal: new AbortController().signal });
                const image = readStoryboardAssetImage(completed);
                setNodes((nodes) =>
                    nodes.map((current) =>
                        current.id === node.id && isStoryboardNode(current) && current.storyboard.assetGeneration
                            ? updateStoryboardNodeData(current, {
                                  assets: current.storyboard.assets.map((asset) => (asset.id === assetId ? { ...asset, image } : asset)),
                                  assetGeneration: {
                                      ...current.storyboard.assetGeneration,
                                      statuses: { ...current.storyboard.assetGeneration.statuses, [assetId]: "succeeded" },
                                      progress: readStoryboardAssetGenerationProgress({ ...current.storyboard.assetGeneration, statuses: { ...current.storyboard.assetGeneration.statuses, [assetId]: "succeeded" } }),
                                      errors: Object.fromEntries(Object.entries(current.storyboard.assetGeneration.errors).filter(([id]) => id !== assetId)),
                                  },
                              })
                            : current,
                    ),
                );
                return { assetId, ok: true };
            } catch (error) {
                return { assetId, ok: false, error: error instanceof Error ? error.message : "资产图片恢复失败" };
            }
        }),
    );

    setNodes((nodes) => {
        const currentNode = nodes.find((current): current is CanvasStoryboardNode => current.id === node.id && isStoryboardNode(current));
        const currentState = currentNode?.storyboard.assetGeneration;
        if (!currentNode || !currentState) return nodes;
        const statuses = { ...currentState.statuses };
        const errors = { ...currentState.errors };
        taskResults.forEach((result) => {
            if (result.ok) {
                statuses[result.assetId] = "succeeded";
                delete errors[result.assetId];
            } else {
                statuses[result.assetId] = "failed";
                errors[result.assetId] = result.error || "资产图片恢复失败";
            }
        });
        const hasFailed = currentState.selectedAssetIds.some((assetId) => statuses[assetId] === "failed");
        const finishedState: CanvasStoryboardAssetGenerationState = {
            ...currentState,
            statuses,
            errors,
            phase: hasFailed ? "failed" : "succeeded",
            progress: 100,
            completedAt: new Date().toISOString(),
            errorMessage: hasFailed ? "页面刷新后部分资产图片生成失败，请重试失败项。" : "",
        };
        return nodes.map((current) =>
            current.id === node.id && isStoryboardNode(current)
                ? updateCanvasNodeExecution(updateStoryboardNodeData(current, { assetGeneration: finishedState }), {
                      phase: hasFailed ? "failed" : "succeeded",
                      progress: 100,
                      errorMessage: finishedState.errorMessage,
                      completedAt: finishedState.completedAt,
                  })
                : current,
        );
    });
}

type StoryboardScriptSource = { ok: true; scriptContent: string; node: CanvasTextNode } | { ok: false; error: string };

/** 读取分镜节点唯一关联的剧本文本节点。 */
function findStoryboardScriptSource(storyboardNodeId: string, nodes: CanvasDomainNode[], connections: CanvasConnection[]): StoryboardScriptSource {
    const sourceNodeIds = Array.from(new Set(connections.filter((connection) => connection.target.nodeId === storyboardNodeId).map((connection) => connection.source.nodeId)));
    if (sourceNodeIds.length !== 1) {
        return { ok: false, error: "分镜脚本必须且只能引用一个文本剧本节点" };
    }
    const sourceNode = nodes.find((node) => node.id === sourceNodeIds[0]);
    if (!sourceNode || !isTextNode(sourceNode)) {
        return { ok: false, error: "分镜脚本的来源必须是文本剧本节点" };
    }
    const scriptContent = sourceNode.content.text.trim();
    if (!scriptContent) {
        return { ok: false, error: "剧本文本不能为空，请先在来源文本节点输入剧本" };
    }
    return { ok: true, scriptContent, node: sourceNode };
}

/** 从当前参与合成的镜头中提取实际关联资产，未关联资产不会参与提示词合成。 */
function collectStoryboardCompositionAssets(shots: CanvasStoryboardShot[], assets: CanvasStoryboardAsset[]): CanvasStoryboardAsset[] {
    const associatedAssetIds = new Set<string>();
    for (const shot of shots) {
        if (!Array.isArray(shot.assetIds)) continue;
        for (const assetId of shot.assetIds) associatedAssetIds.add(assetId);
    }
    return assets.filter((asset) => associatedAssetIds.has(asset.id));
}

/** 校验用户编辑后的镜头与关联资产，避免在请求前产生无效扣费。 */
function validateStoryboardComposition(shots: CanvasStoryboardShot[], assets: CanvasStoryboardAsset[]): string | null {
    if (!shots.length) return "至少需要一个镜头才能合成提示词";
    if (shots.length > 100) return "镜头数量不能超过100个";

    if (assets.length > 300) return "资产数量不能超过300项";
    const assetIds = new Set<string>();
    const assetKinds = new Set(["character", "scene", "prop"]);
    for (const asset of assets) {
        if (!asset.id.trim() || !assetIds.add(asset.id)) return "资产标识无效或重复";
        if (!assetKinds.has(asset.kind)) return "资产类别仅支持角色、场景或道具";
        if (!asset.name.trim()) return "请填写关联资产的名称后再合成提示词";
    }

    const shotIds = new Set<string>();
    const shotNumbers = new Set<number>();
    const shotSizes = new Set(STORYBOARD_SHOT_SIZES.map((item) => item.value));
    for (const [index, shot] of shots.entries()) {
        const row = index + 1;
        if (!shot.id.trim() || !shotIds.add(shot.id)) return `第 ${row} 个镜头的标识无效或重复`;
        if (!Number.isInteger(shot.shotNumber) || shot.shotNumber < 1 || !shotNumbers.add(shot.shotNumber)) return `第 ${row} 个镜头的镜号必须是不重复的正整数`;
        if (!Number.isInteger(shot.durationSeconds) || shot.durationSeconds < 1 || shot.durationSeconds > 600) return `第 ${row} 个镜头的时长必须是1至600秒的整数`;
        if (!shot.visualDescription.trim()) return `请填写第 ${row} 个镜头的画面描述`;
        if (!shotSizes.has(shot.shotSize)) return `第 ${row} 个镜头的景别不合法`;
        if (!Array.isArray(shot.assetIds)) return `第 ${row} 个镜头的关联资产数据不合法`;
        const shotAssetIds = new Set<string>();
        for (const assetId of shot.assetIds) {
            if (!assetId.trim() || !shotAssetIds.add(assetId)) return `第 ${row} 个镜头的关联资产标识无效或重复`;
            if (!assetIds.has(assetId)) return `第 ${row} 个镜头关联了不存在的资产`;
        }
    }
    return null;
}

function sourceNodeReferenceImages(node: CanvasDomainNode | null): ReferenceImage[] {
    if (!node || !isImageNode(node) || !node.content.source) return [];
    return [
        {
            id: node.id,
            name: `${node.title || node.id}.png`,
            type: node.content.mimeType || "image/png",
            dataUrl: node.content.source,
            storageKey: node.content.storageKey,
            objectStorage: node.content.objectStorage,
        },
    ];
}

function uniqueReferenceImages(images: ReferenceImage[]) {
    const used = new Set<string>();
    return images.filter((image) => {
        const key = image.storageKey || image.dataUrl || image.id;
        if (used.has(key)) return false;
        used.add(key);
        return true;
    });
}

function replaceCanvasNodeWithText(node: CanvasDomainNode, content: string, title: string, phase: "running" | "succeeded"): CanvasDomainNode {
    if (isTextNode(node)) {
        return applyCanvasNodeAttributes({ ...node, title }, { content, status: phase === "running" ? "loading" : "success", errorDetails: "" });
    }
    const replacement = createCanvasNode("text", { x: 0, y: 0 }, { content, status: phase === "running" ? "loading" : "success" });
    return updateCanvasNodeFrame({ ...replacement, id: node.id, title }, node.frame);
}
