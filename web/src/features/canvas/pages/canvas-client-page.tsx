"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent as ReactChangeEvent, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { saveAs } from "file-saver";

import { requestEdit, requestGeneration, requestImageQuestion } from "@/features/generation/api/image";
import { requestVideoGeneration, storeGeneratedVideo } from "@/features/generation/api/video";
import { cancelAiTask, createAiTask, subscribeAiTaskDeltas, waitAiTask } from "@/services/api/server";
import { usePromptOptimization } from "@/features/generation/hooks/use-prompt-optimization";
import { normalizeImageGenerationCount } from "@/features/generation/components/image-settings-panel";
import { normalizeVideoGenerationCount } from "@/features/generation/components/video-settings-panel";
import { defaultConfig, normalizeModelOptionValue, type AiConfig, useConfigStore, useEffectiveConfig } from "@/features/settings/stores/use-config-store";
import { getImageBlob, resolveImageUrl, reuseOrUploadImage, uploadImage, type UploadedImage } from "@/features/storage/services/image-storage";
import { getMediaBlob, resolveMediaUrl, uploadMediaFile, type UploadedFile } from "@/features/storage/services/file-storage";
import { uploadObjectToStorage } from "@/features/storage/services/object-storage";
import { findMissingReferenceObjectStorageImages, uploadMissingReferenceImagesToObjectStorage } from "@/features/storage/services/reference-object-storage";
import { nanoid } from "nanoid";
import { getDataUrlByteSize } from "@/features/generation/lib/image-utils";
import { canvasThemes, type CanvasBackgroundMode } from "@/shared/lib/canvas-theme";
import { useThemeStore } from "@/features/theme/stores/use-theme-store";
import { useAssetStore } from "@/features/assets/stores/use-asset-store";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { cropDataUrl, splitDataUrl } from "../utils/canvas-image-data";
import { fitNodeSize, nodeSizeFromRatio } from "../utils/canvas-node-size";
import { App } from "antd";
import type { OnConnectEnd, OnConnectStartParams } from "@xyflow/react";
import { getCanvasNodeTemplate } from "../constants";
import { applyCanvasNodeAttributes, isImageNode, isTextNode, isVideoNode, updateCanvasNodeExecution, updateCanvasNodeFrame, type CanvasNodeAttributes } from "../domain/canvas-node";
import {
    applyCanvasNodeConfig,
    applyGeneratedImageToBatchNodes,
    createCanvasConnection,
    findCanvasConnectionDropTarget,
    moveCanvasNodesFromOrigins,
    normalizeCanvasConnection,
    readCanvasNodePrompt,
    resetInterruptedCanvasNodes,
    selectCanvasNodesInRectangle,
    synchronizeImageBatchRootExecution,
    updateCanvasNodeSelection,
} from "../domain/canvas-page-node";
import { ActiveConnectionPath, ConnectionPath } from "../components/canvas-connections";
import { CanvasChatPanel } from "../components/canvas-chat-panel";
import type { CanvasImageCropRect } from "../components/canvas-node-crop-dialog";
import { CanvasThemeProvider, useCanvasTheme } from "../components/canvas-theme-provider";
import type { CanvasImageSplitParams } from "../components/canvas-node-split-dialog";
import { buildNodeGenerationContext, buildNodeResponseMessages, hydrateNodeGenerationContext } from "../components/canvas-node-generation";
import { CanvasNodeHoverToolbar } from "../components/canvas-node-hover-toolbar";
import { CanvasFlow } from "../components/canvas-flow";
import { nodeTypes } from "../node-types";
import { NodeActionProvider, type BatchImagePreview, type NodeActions } from "../node-types/node-action-context";
import { toRFNodes, toRFEdges, createNodesChangeHandler, createEdgesChangeHandler, createConnectHandler } from "../node-types/rf-adapter";
import { CanvasNodePromptPanel, type CanvasNodeGenerationMode } from "../components/canvas-node-prompt-panel";
import { CanvasToolbar } from "../components/canvas-toolbar";
import { CanvasTaskPanel } from "../components/canvas-task-panel";
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
    buildCanvasTasks,
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
import { applyCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "../utils/canvas-agent-ops";
import { positionCanvasAgentAddNodeOps } from "../utils/canvas-agent-tools";
import { buildCanvasResourceReferences, buildNodeMentionReferences } from "../utils/canvas-resource-references";
import {
    type CanvasAssistantImage,
    type CanvasAssistantMessage,
    type CanvasAssistantSession,
    type CanvasConnection,
    type CanvasImageGenerationSettings,
    type CanvasImageGenerationType,
    type CanvasImageNode,
    type CanvasNode as CanvasDomainNode,
    type CanvasNodeKind,
    type ConnectionHandle,
    type ContextMenuState,
    type CanvasPoint,
    type SelectionBox,
    type CanvasViewTransform,
} from "../types";
import type { ReferenceImage } from "@/features/generation/types/image";

const VIDEO_NODE_MAX_WIDTH = 420;
const VIDEO_NODE_MAX_HEIGHT = 420;
const CONNECTION_HANDLE_HIT_RADIUS = 40;
const CONNECTION_NODE_HIT_PADDING = 32;
const PROMPT_PANEL_WIDTH = 580;
const PROMPT_PANEL_HEIGHT = 196;
const PROMPT_PANEL_GAP = 16;
const IMAGE_GENERATION_NODE_WIDTH = 320;
const IMAGE_GENERATION_NODE_HEIGHT = 220;
const PROMPT_PANEL_INTERACTION_IGNORE_SELECTOR = '[data-canvas-prompt-panel],[data-canvas-settings-popover],[data-slot="select-content"],.react-flow__node,.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown';
const NODE_STATUS_IDLE = "idle" as const;
const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_SUCCESS = "success" as const;
const NODE_STATUS_ERROR = "error" as const;

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
    }>({
        isDraggingNode: false,
        hasMoved: false,
        clickedNodeId: null,
        startX: 0,
        startY: 0,
        initialSelectedNodes: [],
    });

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
    const { completedThinkings, activeThinking, onThoughtDelta, onThoughtComplete, resetThinkings } = useAgentThinking();
    const [titleEditing, setTitleEditing] = useState(false);
    const [titleDraft, setTitleDraft] = useState("");
    const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
    const [collapsingBatchIds, setCollapsingBatchIds] = useState<Set<string>>(new Set());
    const [openingBatchIds, setOpeningBatchIds] = useState<Set<string>>(new Set());
    const batchTransitionIdsRef = useRef<Set<string>>(new Set());
    const [isNodeDragging, setIsNodeDragging] = useState(false);
    const [taskPanelOpen, setTaskPanelOpen] = useState(false);

    useEffect(() => {
        resetThinkings();
    }, [activeChatId, resetThinkings]);

    useEffect(() => {
        setInitialPrompt(readInitialPromptFromLocation());
    }, []);
    const { requests: generationRequestByNodeId, start: startGenerationRequest, finish: finishGenerationRequest, stopByRunningId: stopRegisteredGenerationRequests, isRunning: isGenerationRunning } = useCanvasGenerationRequests();

    const nodesRef = useRef(nodes);
    const connectionsRef = useRef(connections);
    const selectedNodeIdsRef = useRef(selectedNodeIds);
    const viewportRef = useRef(viewport);
    const generateNodeRef = useRef<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => Promise<void>) | null>(null);
    const connectingParamsRef = useRef(connectingParams);
    const connectionTargetNodeIdRef = useRef(connectionTargetNodeId);
    const selectionBoxRef = useRef(selectionBox);
    const pendingConnectionCreateRef = useRef(pendingConnectionCreate);
    const reactFlowConnectionStartRef = useRef<ConnectionHandle | null>(null);
    const pendingFocusNodeIdsRef = useRef<string[]>([]);
    const activeAgentAssistantMessageIdRef = useRef<string | null>(null);
    const activeAgentSessionIdRef = useRef<string | null>(null);

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
            const restoredNodes = await hydrateCanvasImages(resetInterruptedCanvasNodes(document.scene.nodes));
            const restoredSessions = await hydrateAssistantImages(document.conversation.sessions);
            setNodes(restoredNodes);
            // 过滤掉孤立边（源/目标节点不存在），防止 React Flow 报错
            const nodeIdSet = new Set(restoredNodes.map((n) => n.id));
            setConnections(document.scene.connections.filter((connection) => nodeIdSet.has(connection.source.nodeId) && nodeIdSet.has(connection.target.nodeId)));
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
                connections: document.scene.connections.filter((connection) => nodeIdSet.has(connection.source.nodeId) && nodeIdSet.has(connection.target.nodeId)),
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
            // 恢复进行中的服务端任务：查询后端运行中任务，匹配存储的 taskId 后重新绑定进度回调。
            const loadingNodes = restoredNodes.filter((node) => node.execution.phase === "running" && node.execution.taskId);
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
    }, [findDocument, hydrated, projectId, router]);

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

    const requestFocusNodes = useCallback((nodeIds: string[]) => {
        pendingFocusNodeIdsRef.current = nodeIds.filter(Boolean);
    }, []);

    const focusPendingNodes = useCallback(() => {
        const nodeIds = pendingFocusNodeIdsRef.current;
        if (!nodeIds.length) return;

        const idSet = new Set(nodeIds);
        const targetNodes = nodesRef.current.filter((node) => idSet.has(node.id));
        if (!targetNodes.length) return;

        pendingFocusNodeIdsRef.current = [];
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
        setViewport({
            x: size.width / 2 - centerX * scale,
            y: size.height / 2 - centerY * scale,
            k: scale,
        });
    }, [size.height, size.width]);

    useLayoutEffect(() => {
        focusPendingNodes();
    }, [focusPendingNodes, nodes]);

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
            const exists = connectionsRef.current.some((item) => item.source.nodeId === connection.source.nodeId && item.target.nodeId === connection.target.nodeId);
            if (!exists) {
                setConnections((prev) => [...prev, { id: `conn-${Date.now()}`, ...connection }]);
            }
            setContextMenu(null);
        },
        [message],
    );

    const createConnectedNode = useCallback(
        (type: PendingConnectionCreateNodeType, pending: PendingConnectionCreate) => {
            const newNode = createCanvasNode(type, pending.position);
            const connection = normalizeCanvasConnection(pending.connection.nodeId, newNode.id, [...nodesRef.current, newNode]);
            if (!connection) {
                message.warning("配置节点之间不能连接");
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
        [message, requestFocusNodes, setConnecting],
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
    const canvasTasks = useMemo(() => buildCanvasTasks(nodes, generationRequestByNodeId), [generationRequestByNodeId, nodes]);
    const toolbarNode = toolbarNodeId ? nodeById.get(toolbarNodeId) || null : null;
    const infoNode = infoNodeId ? nodeById.get(infoNodeId) || null : null;
    const cropNode = cropNodeId ? nodeById.get(cropNodeId) || null : null;
    const splitNode = splitNodeId ? nodeById.get(splitNodeId) || null : null;
    const previewNode = previewNodeId ? nodeById.get(previewNodeId) || null : null;
    const promptPanelNode = dialogNodeId && !selectionBox ? nodeById.get(dialogNodeId) || null : null;
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
    const agentSnapshot = useMemo<CanvasAgentSnapshot>(
        () => ({ projectId, title: currentDocument?.identity.title || "未命名画布", nodes, connections, selectedNodeIds: Array.from(selectedNodeIds), viewport }),
        [connections, currentDocument?.identity.title, nodes, projectId, selectedNodeIds, viewport],
    );

    const commitAgentSnapshot = useCallback((snapshot: CanvasAgentSnapshot) => {
        nodesRef.current = snapshot.nodes;
        connectionsRef.current = snapshot.connections;
        selectedNodeIdsRef.current = new Set(snapshot.selectedNodeIds);
        viewportRef.current = snapshot.viewport;
        setNodes(snapshot.nodes);
        setConnections(snapshot.connections);
        setSelectedNodeIds(new Set(snapshot.selectedNodeIds));
        setViewport(snapshot.viewport);
        setSelectedConnectionId(null);
        setContextMenu(null);
    }, []);

    const applyAgentOps = useCallback(
        (ops?: CanvasAgentOp[]) => {
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
                const mode = operation.mode || target.kind;
                const generationConfig = buildGenerationConfig(effectiveConfig, target, mode);
                if (isAiConfigReady(generationConfig, generationConfig.model)) continue;
                showMissingAiConfig(mode);
                throw new Error(`${mode === "image" ? "图片" : mode === "video" ? "视频" : "文本"}生成节点已创建，但模型配置不完整，生成尚未开始`);
            }
            queueMicrotask(() =>
                generationOps.forEach((operation) => {
                    if (!operation.nodeId) return;
                    const target = nodesRef.current.find((node) => node.id === operation.nodeId);
                    const prompt = operation.prompt?.trim() || (target ? readCanvasNodePrompt(target) : "");
                    void generateNodeRef.current?.(operation.nodeId, operation.mode || target?.kind || "image", prompt);
                }),
            );
            return { ...next, projectId, title: currentDocument?.identity.title || "未命名画布" };
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
            // 工具栏创建时错开节点，右键指定位置创建时保持落点准确。
            const offset = position ? { x: 0, y: 0 } : { x: (Math.random() - 0.5) * 200, y: (Math.random() - 0.5) * 200 };
            const newNode = createCanvasNode(type, { x: targetPosition.x + offset.x, y: targetPosition.y + offset.y });

            setNodes((prev) => [...prev, newNode]);
            requestFocusNodes([newNode.id]);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(newNode.id);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, getCanvasCenter, requestFocusNodes],
    );

    const deleteNodes = useCallback(
        (ids: Set<string>) => {
            if (!ids.size) return;
            const allIds = new Set(ids);
            nodesRef.current.forEach((node) => {
                if (ids.has(node.id) && isImageNode(node)) node.grouping.childIds.forEach((childId) => allIds.add(childId));
            });
            setNodes((prev) => {
                const next = prev.filter((node) => !allIds.has(node.id));
                return next.map((node) => {
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
                const contextTargetDeleted = (current?.type === "node" && allIds.has(current.nodeId))
                    || (current?.type === "selection" && current.nodeIds.some((nodeId) => allIds.has(nodeId)));
                return contextTargetDeleted ? null : current;
            });
            cleanupCanvasFiles({ projectId, nodes: nodesRef.current.filter((node) => !allIds.has(node.id)), chatSessions });
        },
        [chatSessions, cleanupCanvasFiles, projectId],
    );

    const deleteConnection = useCallback((connectionId: string) => {
        setConnections((prev) => prev.filter((conn) => conn.id !== connectionId));
        setSelectedConnectionId((current) => (current === connectionId ? null : current));
        setEdgeDeletePopover((current) => (current?.connectionId === connectionId ? null : current));
        setContextMenu((current) => (current?.type === "connection" && current.connectionId === connectionId ? null : current));
    }, []);

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
        setNodes([]);
        setConnections([]);
        setInfoNodeId(null);
        setCropNodeId(null);
        setPreviewNodeId(null);
        setRunningNodeId(null);
        deselectCanvas();
        setClearConfirmOpen(false);
        cleanupCanvasFiles({ projectId, nodes: [], chatSessions: [] });
    }, [cleanupCanvasFiles, deselectCanvas, projectId]);

    const duplicateNode = useCallback(
        (nodeId: string) => {
            const source = nodesRef.current.find((node) => node.id === nodeId);
            if (!source) return;

            const id = `${source.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const next: CanvasDomainNode = {
                ...structuredClone(source),
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

        const copiedNodes = nodesRef.current.filter((node) => selectedIds.has(node.id)).map((node) => structuredClone(node));

        if (!copiedNodes.length) return;

        clipboardRef.current = {
            nodes: copiedNodes,
            connections: connectionsRef.current.filter((connection) => selectedIds.has(connection.source.nodeId) && selectedIds.has(connection.target.nodeId)).map((connection) => structuredClone(connection)),
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
        const nextNodes = clipboard.nodes.map((node, index) => {
            const id = `${node.kind}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
            idMap.set(node.id, id);
            return {
                ...structuredClone(node),
                id,
                title: node.title.endsWith(" Copy") ? node.title : `${node.title} Copy`,
                frame: {
                    ...node.frame,
                    position: {
                        x: node.frame.position.x + dx,
                        y: node.frame.position.y + dy,
                    },
                },
            };
        });

        const nextConnections = clipboard.connections.flatMap((connection, index) => {
            const sourceNodeId = idMap.get(connection.source.nodeId);
            const targetNodeId = idMap.get(connection.target.nodeId);
            if (!sourceNodeId || !targetNodeId) return [];
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

    const focusCanvasNode = useCallback(
        (nodeId: string) => {
            const node = nodesRef.current.find((item) => item.id === nodeId);
            if (!node) return;
            const batchRootId = isImageNode(node) ? node.grouping.rootId : undefined;
            const batchRoot = batchRootId ? nodesRef.current.find((item) => item.id === batchRootId) : undefined;
            if (batchRootId && batchRoot && isImageNode(batchRoot) && !batchRoot.grouping.expanded) {
                setOpeningBatchIds((prev) => new Set(prev).add(batchRootId));
                window.setTimeout(() => {
                    setOpeningBatchIds((prev) => {
                        const next = new Set(prev);
                        next.delete(batchRootId);
                        return next;
                    });
                }, 260);
                setNodes((prev) => prev.map((item) => (item.id === batchRootId ? applyCanvasNodeAttributes(item, { imageBatchExpanded: true }) : item)));
            }
            const scale = viewportRef.current.k;
            const centerX = node.frame.position.x + node.frame.width / 2;
            const centerY = node.frame.position.y + node.frame.height / 2;
            setViewport({
                x: size.width / 2 - centerX * scale,
                y: size.height / 2 - centerY * scale,
                k: scale,
            });
            setSelectedNodeIds(new Set([nodeId]));
            setSelectedConnectionId(null);
            setContextMenu(null);
            setSelectionBox(null);
            setConnecting(null);
            setPendingConnectionCreate(null);
            setHoveredNodeId(null);
            setToolbarNodeId(null);
            setDialogNodeId(null);
        },
        [setConnecting, size.height, size.width],
    );

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
        const dragIds = new Set([...nextSelected, ...groupedChildIds]);
        dragRef.current = {
            isDraggingNode: true,
            hasMoved: false,
            clickedNodeId: nodeId,
            startX: event.clientX,
            startY: event.clientY,
            initialSelectedNodes: currentNodes.filter((node) => dragIds.has(node.id)).map((node) => ({ id: node.id, x: node.frame.position.x, y: node.frame.position.y })),
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
            setNodes((currentNodes) => moveCanvasNodesFromOrigins(currentNodes, initialPositions, dx, dy));
        }

        dragRef.current.isDraggingNode = false;
        dragRef.current.hasMoved = false;
        dragRef.current.initialSelectedNodes = [];
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
                if (selectedNodeIdsRef.current.size) deleteNodes(new Set(selectedNodeIdsRef.current));
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
        [copySelectedNodes, deleteConnection, deleteNodes, deselectCanvas, pasteCopiedNodes, pasteSystemClipboard, redoCanvas, selectedConnectionId, setConnecting, undoCanvas],
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
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? updateCanvasNodeFrame(node, { width, height, position: position || node.frame.position }) : node)));
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
        if (node) saveCanvasLastUsedGenerationSettings(node.kind, patch);
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? applyCanvasNodeConfig(node, patch) : node)));
    }, []);

    const downloadNodeImage = useCallback((node: CanvasDomainNode) => {
        if (isTextNode(node) || !node.content.source) return;
        saveAs(node.content.source, `canvas-${node.kind}-${node.id}.${isVideoNode(node) ? "mp4" : imageExtension(node.content.source)}`);
    }, []);

    const uploadNodeObjectStorage = useCallback(
        async (node: CanvasDomainNode) => {
            if (isTextNode(node)) return;
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
                const child = updateCanvasNodeFrame(
                    { ...createCanvasNode("image", node.frame.position, { ...imageAttributes(image), prompt: node.generation.prompt }), id: childId, title: "裁剪图片" },
                    { position: { x: node.frame.position.x + node.frame.width + 96, y: node.frame.position.y }, width, height: width * (image.height / image.width) },
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
                setNodes((prev) => [...prev, ...childNodes]);
                requestFocusNodes(childNodes.map((child) => child.id));
                setConnections((prev) => [...prev, ...childNodes.map((child) => createRightToLeftConnection(node.id, child.id))]);
                setSelectedNodeIds(new Set(childNodes.map((child) => child.id)));
                setSelectedConnectionId(null);
                setDialogNodeId(null);
                setSplitNodeId(null);
                message.success(`已切分为 ${childNodes.length} 个子节点`);
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
        },
    });

    const { sendMessage: sendAgentMessage, resetSession: resetAgentSession } = useAgentSSE({
        snapshot: agentSnapshot,
        onApplyOps: (ops) => applyAgentOps(ops),
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
                messages: session.messages.map((item) => item.id === `plan-${planId}`
                    ? { ...item, meta: status === "failed" ? `失败：${statusMessage}` : statusMessage }
                    : item),
                updatedAt: new Date().toISOString(),
            }));
        },
        onPromptPrepared: (planId, _taskId, strategy) => {
            const sessionId = activeAgentSessionIdRef.current;
            if (!sessionId) return;
            updateAssistantSession(sessionId, (session) => ({
                ...session,
                messages: session.messages.map((item) => item.id === `plan-${planId}`
                    ? { ...item, meta: strategy === "OPTIMIZE" ? "提示词已优化" : "保留原始提示词" }
                    : item),
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
        },
    });

    const handleCreateAgentSession = useCallback(() => {
        if (agentRunning) return;
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
    }, [activeChatId, agentRunning, chatSessions, handleAssistantSessionsChange, resetAgentSession, resetThinkings]);

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
        async (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => {
            if (isGenerationRunning(nodeId)) return;
            const sourceNode = nodesRef.current.find((node) => node.id === nodeId);
            const generationConfig = buildGenerationConfig(effectiveConfig, sourceNode, mode);
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                showMissingAiConfig(mode);
                return;
            }

            setRunningNodeId(nodeId);
            const runController = startGenerationRequest(nodeId, nodeId, nodeId);
            const sourceTextContent = sourceNode && isTextNode(sourceNode) ? sourceNode.content.text.trim() : "";
            const editingTextNode = mode === "text" && Boolean(sourceTextContent);
            const generationContext = await hydrateNodeGenerationContext(
                buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, editingTextNode ? `请根据要求修改以下文本。\n\n原文：\n${sourceTextContent}\n\n修改要求：\n${prompt}` : prompt),
                mode,
            );
            const effectivePrompt = generationContext.prompt.trim();
            if (runController.signal.aborted) {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
                return;
            }
            const markSourceStatus = !sourceNode || (!isImageNode(sourceNode) && !editingTextNode);
            if (markSourceStatus) {
                setNodes((prev) => prev.map((node) => (node.id === nodeId ? applyCanvasNodeAttributes(node, { prompt, status: NODE_STATUS_LOADING, errorDetails: "" }) : node)));
            }
            if (!effectivePrompt && mode === "text") {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
                return;
            }
            let pendingChildIds: string[] = [];

            try {
                if (mode === "image") {
                    const count = normalizeImageGenerationCount(generationConfig.count);
                    const sourceIsImage = Boolean(sourceNode && isImageNode(sourceNode));
                    const isEmptyImageNode = Boolean(sourceNode && isImageNode(sourceNode) && !sourceNode.content.source);
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
                    const referenceImages = sourceReference.length ? sourceReference : generationContext.referenceImages;
                    const generationType = referenceImages.length ? ("edit" as const) : ("generation" as const);
                    const generationAttributes = buildImageGenerationAttributes(generationType, generationConfig, count, referenceImages);
                    const parentConfig = getCanvasNodeTemplate(sourceIsImage ? "image" : "text");
                    const imageConfig = getCanvasNodeTemplate("image");
                    const parentPosition = sourceNode?.frame.position || { x: 0, y: 0 };
                    const gap = 96;
                    const rowGap = 36;
                    const rootId = isEmptyImageNode ? nodeId : `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                    const childIds = count > 1 ? Array.from({ length: count }, () => `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`) : [];
                    const targetIds = count > 1 ? childIds : [rootId];
                    pendingChildIds = isEmptyImageNode ? childIds : [rootId, ...childIds];
                    const rootSize = {
                        width: count > 1 ? IMAGE_GENERATION_NODE_WIDTH : isEmptyImageNode ? sourceNode?.frame.width || imageConfig.width : imageConfig.width,
                        height: count > 1 ? IMAGE_GENERATION_NODE_HEIGHT : isEmptyImageNode ? sourceNode?.frame.height || imageConfig.height : imageConfig.height,
                    };
                    const rootPosition = {
                        x: isEmptyImageNode ? parentPosition.x : parentPosition.x + parentConfig.width + gap,
                        y: parentPosition.y + parentConfig.height / 2 - rootSize.height / 2,
                    };
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
                                    ...generationAttributes,
                                    imageBatchExpanded: count > 1,
                                },
                            ),
                            id: rootId,
                            title: count > 1 ? "图片生成" : effectivePrompt.slice(0, 32) || "生成图片",
                        },
                        { position: rootPosition, ...rootSize },
                    );
                    const colCount = 2;
                    const rowCount = Math.ceil(count / colCount);
                    const childNodes: CanvasDomainNode[] = childIds.map((id, index) => {
                        const col = Math.floor(index / rowCount);
                        const row = index % rowCount;
                        return updateCanvasNodeFrame(
                            {
                                ...createCanvasNode("image", { x: 0, y: 0 }, { prompt: effectivePrompt, status: NODE_STATUS_LOADING, batchRootId: rootId, ...generationAttributes }),
                                id,
                                title: `${index + 1}/${count}`,
                            },
                            {
                                position: {
                                    x: rootNode.frame.position.x + rootNode.frame.width + 120 + col * (imageConfig.width + 36),
                                    y: rootNode.frame.position.y + row * (imageConfig.height + rowGap),
                                },
                                width: imageConfig.width,
                                height: imageConfig.height,
                            },
                        );
                    });
                    const batchConnections = [...(isEmptyImageNode ? [] : [createRightToLeftConnection(nodeId, rootId)]), ...childIds.map((childId) => createRightToLeftConnection(rootId, childId))];

                    setNodes((prev) => [
                        ...prev.map((node) =>
                            node.id === nodeId
                                ? isEmptyImageNode
                                    ? rootNode
                                    : sourceIsImage
                                      ? updateCanvasNodeExecution(node, { phase: "succeeded", errorMessage: "" })
                                      : replaceCanvasNodeWithText(node, prompt, prompt.slice(0, 32) || "提示词", "succeeded")
                                : node,
                        ),
                        ...(isEmptyImageNode ? [] : [rootNode]),
                        ...childNodes,
                    ]);
                    requestFocusNodes(isEmptyImageNode ? [nodeId] : [rootId, ...childIds]);
                    setConnections((prev) => [...prev, ...batchConnections]);
                    setSelectedNodeIds(new Set([nodeId]));
                    setSelectedConnectionId(null);
                    setDialogNodeId(nodeId);

                    const controller = runController;
                    targetIds.forEach((targetId) => startGenerationRequest(targetId, nodeId, nodeId, controller));
                    if (count > 1) startGenerationRequest(rootId, nodeId, nodeId, controller);
                    let hasSuccess = false;
                    let hasFailure = false;
                    await Promise.all(
                        targetIds.map(async (targetId) => {
                            try {
                                const generationRequest = referenceImages.length
                                    ? requestEdit({ ...generationConfig, count: "1" }, effectivePrompt, referenceImages, undefined, "canvas", { signal: controller.signal })
                                    : requestGeneration({ ...generationConfig, count: "1" }, effectivePrompt, "canvas", { signal: controller.signal });
                                const [image] = await generationRequest;
                                const uploaded = await reuseOrUploadImage(image);
                                const imageSize = fitNodeSize(uploaded.width, uploaded.height, imageConfig.width, imageConfig.height);
                                setNodes((currentNodes) => applyGeneratedImageToBatchNodes(currentNodes, { rootId, targetId, attributes: imageAttributes(uploaded), ...imageSize }));
                                hasSuccess = true;
                                return true;
                            } catch (error) {
                                if (isGenerationCanceled(error)) return false;
                                const errorDetails = error instanceof Error ? error.message : "生成失败";
                                hasFailure = true;
                                setNodes((prev) =>
                                    synchronizeImageBatchRootExecution(
                                        prev.map((node) => (node.id === targetId ? updateCanvasNodeExecution(node, { phase: "failed", errorMessage: errorDetails }) : node)),
                                        rootId,
                                    ),
                                );
                            } finally {
                                finishGenerationRequest(targetId, controller);
                            }
                            return false;
                        }),
                    );
                    if (count > 1) finishGenerationRequest(rootId, controller);
                    if (controller.signal.aborted) {
                        return;
                    }
                    if (hasFailure) message.error(hasSuccess ? "部分图片生成失败" : "全部图片生成失败");
                    return;
                }

                if (mode === "video") {
                    const count = normalizeVideoGenerationCount(generationConfig.count);
                    const referenceImages = await ensureVideoReferenceImagesObjectStorage(generationContext.referenceImages);
                    if (!referenceImages) {
                        if (markSourceStatus) setNodes((prev) => prev.map((node) => (node.id === nodeId ? updateCanvasNodeExecution(node, { phase: "idle", errorMessage: "" }) : node)));
                        return;
                    }
                    const videoGenerationContext = { ...generationContext, referenceImages };
                    const spec = nodeSizeFromRatio(generationConfig.size, getCanvasNodeTemplate("video").width, getCanvasNodeTemplate("video").height) || getCanvasNodeTemplate("video");
                    const isEmptyVideoNode = Boolean(sourceNode && isVideoNode(sourceNode) && !sourceNode.content.source);
                    const parent = sourceNode?.frame.position || { x: 0, y: 0 };
                    const videoIds = Array.from({ length: count }, (_, index) => (isEmptyVideoNode && index === 0 ? nodeId : nanoid()));
                    const additionalOffset = isEmptyVideoNode ? 1 : 0;
                    const videoNodes = videoIds.map((videoId, index) => {
                        const additionalIndex = index - additionalOffset;
                        const column = Math.max(0, additionalIndex % 2);
                        const row = Math.max(0, Math.floor(additionalIndex / 2));
                        const videoPosition =
                            isEmptyVideoNode && index === 0 && sourceNode
                                ? sourceNode.frame.position
                                : {
                                      x: parent.x + (sourceNode?.frame.width || spec.width) + 96 + column * (spec.width + 36),
                                      y: parent.y + row * (spec.height + 36),
                                  };
                        const videoSize = isEmptyVideoNode && index === 0 && sourceNode ? { width: sourceNode.frame.width, height: sourceNode.frame.height } : spec;
                        return updateCanvasNodeFrame(
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
                                        watermark: generationConfig.videoWatermark,
                                        count,
                                        references: generationReferenceUrls(videoGenerationContext),
                                    },
                                ),
                                id: videoId,
                                title: count > 1 ? `${index + 1}/${count}` : effectivePrompt.slice(0, 32) || "生成视频",
                            },
                            { position: videoPosition, width: videoSize.width, height: videoSize.height },
                        );
                    });
                    pendingChildIds = isEmptyVideoNode ? videoIds.slice(1) : videoIds;
                    setNodes((prev) => [...prev.map((node) => (node.id === nodeId ? (isEmptyVideoNode ? videoNodes[0] : updateCanvasNodeExecution(node, { phase: "succeeded" })) : node)), ...videoNodes.slice(isEmptyVideoNode ? 1 : 0)]);
                    requestFocusNodes(videoIds);
                    const connectionTargets = isEmptyVideoNode ? videoIds.slice(1) : videoIds;
                    if (connectionTargets.length) setConnections((prev) => [...prev, ...connectionTargets.map((videoId) => createCanvasConnection(nanoid(), nodeId, videoId))]);
                    videoIds.filter((videoId) => videoId !== nodeId).forEach((videoId) => startGenerationRequest(videoId, nodeId, nodeId, runController));

                    let hasSuccess = false;
                    let hasFailure = false;
                    await Promise.all(
                        videoIds.map(async (videoId) => {
                            try {
                                const video = await storeGeneratedVideo(
                                    await requestVideoGeneration({ ...generationConfig, count: "1" }, effectivePrompt, videoGenerationContext.referenceImages, videoGenerationContext.referenceVideos, "canvas", {
                                        signal: runController.signal,
                                        onProgress: (progress) => setNodes((prev) => prev.map((node) => (node.id === videoId ? updateCanvasNodeExecution(node, { progress }) : node))),
                                        onTaskCreated: (taskId) => setNodes((prev) => prev.map((node) => (node.id === videoId ? updateCanvasNodeExecution(node, { taskId }) : node))),
                                    }),
                                );
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
                                            watermark: generationConfig.videoWatermark,
                                            count,
                                            references: generationReferenceUrls(videoGenerationContext),
                                        });
                                        return updateCanvasNodeFrame(completed, { position: { x: center.x - completedSize.width / 2, y: center.y - completedSize.height / 2 }, ...completedSize });
                                    }),
                                );
                                hasSuccess = true;
                            } catch (error) {
                                if (isGenerationCanceled(error)) return;
                                hasFailure = true;
                                const errorDetails = error instanceof Error ? error.message : "视频生成失败";
                                setNodes((prev) => prev.map((node) => (node.id === videoId ? updateCanvasNodeExecution(node, { phase: "failed", errorMessage: errorDetails }) : node)));
                            } finally {
                                if (videoId !== nodeId) finishGenerationRequest(videoId, runController);
                            }
                        }),
                    );
                    if (hasFailure) message.error(hasSuccess ? "部分视频生成失败" : "全部视频生成失败");
                    return;
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
                                position: { x: parentPosition.x + parentConfig.width + 96, y: parentPosition.y + parentConfig.height / 2 - textConfig.height / 2 + (index - (1 - 1) / 2) * (textConfig.height + 36) },
                                width: textConfig.width,
                                height: textConfig.height,
                            },
                        ),
                    );
                    setNodes((prev) => [...prev, ...childNodes]);
                    requestFocusNodes(childIds);
                    setConnections((prev) => [...prev, ...childIds.map((childId) => createCanvasConnection(nanoid(), nodeId, childId))]);
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
                        // 后端任务体系下，每个目标节点创建一个文本任务，订阅text-delta增量回写节点内容。
                        return createAiTask({ taskType: "text", prompt: effectivePrompt, model: textModel, references: textReferences })
                            .then((task) => ({ targetNodeId, taskId: task.id }))
                            .then(async ({ targetNodeId, taskId }) => {
                                let localStreamed = "";
                                const unsubscribe = subscribeAiTaskDeltas((deltaTaskId, delta) => {
                                    if (deltaTaskId !== taskId) return;
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
                if (controller.signal.aborted) return;
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
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : "生成失败";
                message.error(errorDetails);
                setNodes((prev) => prev.map((node) => (node.id === nodeId || pendingChildIds.includes(node.id) ? (node.id === nodeId && !markSourceStatus ? node : updateCanvasNodeExecution(node, { phase: "failed", errorMessage: errorDetails })) : node)));
            } finally {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, isGenerationRunning, message, requestFocusNodes, showMissingAiConfig, startGenerationRequest],
    );

    const handleGenerateNodePrompt = useCallback(
        (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string, onResult: (prompt: string) => void) => {
            if (mode === "text") return;
            void optimizePrompt({ operationId: nodeId, generationType: mode, prompt, onSuccess: onResult });
        },
        [optimizePrompt],
    );

    useEffect(() => {
        generateNodeRef.current = handleGenerateNode;
    }, [handleGenerateNode]);

    const handleRetryNode = useCallback(
        async (node: CanvasDomainNode) => {
            if (isGenerationRunning(node.id)) return;
            const sourceNode = node;
            const batchRoot = isImageNode(node) && node.grouping.rootId ? nodesRef.current.find((item) => item.id === node.grouping.rootId) : null;
            const savedImageNode = isImageNode(batchRoot || node) ? batchRoot || node : null;
            const savedImageGeneration = savedImageNode && isImageNode(savedImageNode) ? savedImageNode.generation : null;
            const hasSavedImageGeneration = Boolean(savedImageGeneration && (savedImageGeneration.prompt || savedImageGeneration.model || savedImageGeneration.references.length));
            const retryMode: CanvasNodeGenerationMode = node.kind;
            const generationConfig =
                hasSavedImageGeneration && savedImageGeneration
                    ? {
                          ...effectiveConfig,
                          model: savedImageGeneration.model || effectiveConfig.imageModel || effectiveConfig.model,
                          quality: savedImageGeneration.quality || effectiveConfig.quality,
                          size: savedImageGeneration.size || effectiveConfig.size,
                          count: "1",
                      }
                    : { ...buildGenerationConfig(effectiveConfig, sourceNode, retryMode), count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                showMissingAiConfig(retryMode);
                return;
            }

            const context = hasSavedImageGeneration ? null : await hydrateNodeGenerationContext(buildNodeGenerationContext(sourceNode.id, nodesRef.current, connectionsRef.current, readCanvasNodePrompt(sourceNode)), retryMode);
            const prompt = (savedImageGeneration?.prompt || context?.prompt || "").trim();
            if (!prompt) {
                message.warning("找不到提示词，无法重试");
                return;
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
                return;
            }
            const retryImages = retryReferenceImages || [];

            setRunningNodeId(node.id);
            setNodes((prev) => prev.map((item) => (item.id === node.id ? updateCanvasNodeExecution(item, { phase: "running", errorMessage: "" }) : item)));
            const controller = startGenerationRequest(node.id, sourceNode.id, node.id);

            try {
                if (isTextNode(node)) {
                    if (!context) return;
                    let streamed = "";
                    const answer = await requestImageQuestion(
                        generationConfig,
                        buildNodeResponseMessages({ ...context, prompt }),
                        (text) => {
                            streamed = text;
                            setNodes((prev) => prev.map((item) => (item.id === node.id ? replaceCanvasNodeWithText(item, text, item.title, "running") : item)));
                        },
                        { signal: controller.signal },
                    );
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? replaceCanvasNodeWithText(item, answer || streamed, item.title, "succeeded") : item)));
                    return;
                }
                if (isVideoNode(node)) {
                    const videoReferenceImages = await ensureVideoReferenceImagesObjectStorage(retryImages);
                    if (!videoReferenceImages) {
                        setNodes((prev) => prev.map((item) => (item.id === node.id ? updateCanvasNodeExecution(item, { phase: "idle", errorMessage: "" }) : item)));
                        return;
                    }
                    const video = await storeGeneratedVideo(
                        await requestVideoGeneration(generationConfig, prompt, videoReferenceImages, context?.referenceVideos || [], "canvas", {
                            signal: controller.signal,
                            onProgress: (progress) => setNodes((prev) => prev.map((item) => (item.id === node.id ? updateCanvasNodeExecution(item, { progress }) : item))),
                            onTaskCreated: (taskId) => setNodes((prev) => prev.map((item) => (item.id === node.id ? updateCanvasNodeExecution(item, { taskId }) : item))),
                        }),
                    );
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
                                    watermark: generationConfig.videoWatermark,
                                    references: generationReferenceUrls({ referenceImages: videoReferenceImages, referenceVideos: context?.referenceVideos || [] }),
                                }),
                                { position: { x: center.x - videoSize.width / 2, y: center.y - videoSize.height / 2 }, ...videoSize },
                            );
                        }),
                    );
                    return;
                }

                const image = useReferenceImages
                    ? await requestEdit(generationConfig, prompt, retryImages, undefined, "canvas", { signal: controller.signal }).then((items) => items[0])
                    : await requestGeneration(generationConfig, prompt, "canvas", { signal: controller.signal }).then((items) => items[0]);
                const uploadedImage = await reuseOrUploadImage(image);
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
                      }
                    : buildImageGenerationAttributes(useReferenceImages ? "edit" : "generation", generationConfig, 1, retryImages);
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
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : "生成失败";
                message.error(errorDetails);
                setNodes((prev) => prev.map((item) => (item.id === node.id ? updateCanvasNodeExecution(item, { phase: "failed", errorMessage: errorDetails }) : item)));
            } finally {
                finishGenerationRequest(node.id, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, ensureVideoReferenceImagesObjectStorage, finishGenerationRequest, isAiConfigReady, isGenerationRunning, message, showMissingAiConfig, startGenerationRequest],
    );

    const insertAssistantImage = useCallback(
        async (image: CanvasAssistantImage) => {
            const storedImage = await reuseOrUploadImage(image);
            const config = fitNodeSize(storedImage.width, storedImage.height);
            const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const node = updateCanvasNodeFrame(
                { ...createCanvasNode("image", center, { ...imageAttributes(storedImage), prompt: image.prompt }), id, title: image.prompt.slice(0, 32) || "生成图片" },
                { position: { x: center.x - config.width / 2, y: center.y - config.height / 2 }, ...config },
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
            const node = {
                ...createCanvasNode("text", center, { content: text, status: NODE_STATUS_SUCCESS }),
                title: text.slice(0, 32) || "Assistant Text",
            };

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
                const node = updateCanvasNodeFrame(
                    {
                        ...createCanvasNode("video", center, { content: payload.url, storageKey: payload.storageKey, status: NODE_STATUS_SUCCESS, naturalWidth: payload.width, naturalHeight: payload.height, objectStorage: payload.objectStorage }),
                        id,
                        title: payload.title,
                    },
                    { position: { x: center.x - nextSize.width / 2, y: center.y - nextSize.height / 2 }, ...nextSize },
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

    const assistantOpen = assistantMounted;
    const openAgent = () => setAssistantMounted(true);
    const closeAgent = () => setAssistantMounted(false);

    // Phase 2-3: 转换为 React Flow 格式
    const hiddenBatchNodeIds = useMemo(() => new Set(nodes.filter((node) => isHiddenBatchChild(node, nodes, collapsingBatchIds)).map((node) => node.id)), [collapsingBatchIds, nodes]);
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
    const rfEdges = useMemo(() => toRFEdges(connections, nodeIdSet, hiddenBatchEdgeNodeIds), [connections, hiddenBatchEdgeNodeIds, nodeIdSet]);
    const onNodesChange = useMemo(() => createNodesChangeHandler(setNodes), []);
    const onEdgesChange = useMemo(() => createEdgesChangeHandler(setConnections), []);
    const onConnect = useMemo(() => createConnectHandler(setConnections, connectionsRef), []);

    const activeSessionMessages = useMemo(() => chatSessions.find((s) => s.id === activeChatId)?.messages || [], [chatSessions, activeChatId]);
    const nodeActions = useMemo(
        (): NodeActions => ({
            textEditingNodeId: editingNodeId,
            textEditRequestVersion: editRequestNonce,
            onInfo: (n) => setInfoNodeId(n.id),
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
            onRetry: (n) => void handleRetryNode(n),
            onToggleBatch: toggleBatchExpanded,
            batchOpeningRootIds: openingBatchIds,
            batchCollapsingRootIds: collapsingBatchIds,
            batchImagePreviewsByRootId: batchCardStacks.imagePreviewsByRootId,
            batchCardStackTransformsByNodeId: batchCardStacks.transformsByNodeId,
            onToggleFreeResize: (node) => handleConfigNodeChange(node.id, { freeResize: !node.frame.freeResize }),
            onDelete: (n) => deleteNodes(new Set([n.id])),
            onKeepToolbar: keepNodeToolbar,
            onHideToolbar: hideNodeToolbar,
            onResize: (nodeId, width, height, position) => {
                setNodes((prev) => prev.map((node) => (node.id === nodeId ? updateCanvasNodeFrame(node, { width, height, position: position ?? node.frame.position }) : node)));
            },
        }),
        [
            batchCardStacks,
            collapsingBatchIds,
            deleteNodes,
            downloadNodeImage,
            editRequestNonce,
            editingNodeId,
            handleConfigNodeChange,
            handleGenerateNode,
            handleNodeContentChange,
            handleRetryNode,
            handleUploadRequest,
            hideNodeToolbar,
            keepNodeToolbar,
            openingBatchIds,
            openTextEditor,
            saveNodeAsset,
            toggleBatchExpanded,
            uploadNodeObjectStorage,
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
        setDialogNodeId(nodeId);
        setContextMenu(null);
        setEdgeDeletePopover(null);
        setPendingConnectionCreate(null);
    }, []);
    const handleNodeContextMenu = useCallback((event: ReactMouseEvent, nodeId: string) => {
        setEdgeDeletePopover(null);
        const selectedNodeIds = selectedNodeIdsRef.current;
        setContextMenu(selectedNodeIds.size > 1 && selectedNodeIds.has(nodeId)
            ? { type: "selection", x: event.clientX, y: event.clientY, nodeIds: [...selectedNodeIds] }
            : { type: "node", x: event.clientX, y: event.clientY, nodeId });
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
                    agentOpen={assistantOpen}
                    onToggleAgent={() => (assistantOpen ? closeAgent() : openAgent())}
                    taskPanel={<CanvasTaskPanel tasks={canvasTasks} open={taskPanelOpen} onOpenChange={setTaskPanelOpen} onLocateTask={(task) => focusCanvasNode(task.nodeId)} onStopTask={(task) => stopGenerationByRunningId(task.runningNodeId)} />}
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
                        onNodeClick={handleNodeClick}
                        onSelectionChange={handleSelectionChange}
                        onNodeContextMenu={handleNodeContextMenu}
                        onSelectionContextMenu={handleSelectionContextMenu}
                        onEdgeClick={handleEdgeClick}
                        onPaneClick={handlePaneClick}
                        onPaneContextMenu={handlePaneContextMenu}
                    />
                </NodeActionProvider>

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
                        <ConnectionCreateMenu pending={pendingConnectionCreate} onCreate={(type) => createConnectedNode(type, pendingConnectionCreate)} onClose={cancelPendingConnectionCreate} />
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
                            node={promptPanelNode}
                            isRunning={runningNodeId === promptPanelNode.id}
                            isPromptGenerating={promptGeneratingNodeId === promptPanelNode.id}
                            mentionReferences={mentionReferencesByNodeId.get(promptPanelNode.id) || []}
                            onPromptChange={handleNodePromptChange}
                            onConfigChange={handleConfigNodeChange}
                            onGenerate={handleGenerateNode}
                            onGeneratePrompt={handleGenerateNodePrompt}
                            onStop={confirmStopGeneration}
                            onMissingConfig={showMissingAiConfig}
                            onApplyContent={handleNodeContentChange}
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
                    onCrop={(node) => setCropNodeId(node.id)}
                    onSplit={(node) => setSplitNodeId(node.id)}
                    onViewImage={(node) => setPreviewNodeId(node.id)}
                    onRetry={(node) => void handleRetryNode(node)}
                    onToggleFreeResize={(node) => toggleNodeFreeResize(node.id)}
                    onDelete={(node) => deleteNodes(new Set([node.id]))}
                />

                <CanvasToolbar
                    selectedCount={selectedNodeIds.size}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    onAddImage={() => createNode("image")}
                    onAddVideo={() => createNode("video")}
                    onAddText={() => createNode("text")}
                    onUndo={undoCanvas}
                    onRedo={redoCanvas}
                    onUpload={() => handleUploadRequest()}
                    onDelete={() => deleteNodes(new Set(selectedNodeIds))}
                    onClear={() => setClearConfirmOpen(true)}
                    onDeselect={deselectCanvas}
                    onOpenMyAssets={() => {
                        setAssetPickerOpen(true);
                    }}
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
                    onCloseContextMenu={() => setContextMenu(null)}
                    onCreateNode={createNode}
                    onDuplicateNode={duplicateNode}
                    onDeleteNodes={deleteNodes}
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
                    onCloseAssetPicker={() => setAssetPickerOpen(false)}
                />
            </section>
            {assistantMounted ? (
                <CanvasChatPanel
                    onCollapse={closeAgent}
                    nodes={nodes}
                    onNodeDropRef={onNodeDropRef}
                    messages={activeSessionMessages}
                    completedThinkings={completedThinkings}
                    activeThinking={activeThinking}
                    onNewSession={handleCreateAgentSession}
                    initialPrompt={initialPrompt}
                    onSend={async (text, references = []) => {
                        if (agentRunning) return;
                        const now = new Date().toISOString();
                        const sessionId = activeChatId || nanoid();
                        const userMessage: CanvasAssistantMessage = { id: nanoid(), role: "user", text, references };
                        const history = buildAgentChatHistory(activeSessionMessages);
                        activeAgentSessionIdRef.current = sessionId;
                        activeAgentAssistantMessageIdRef.current = null;
                        resetTextStream(false);
                        resetThinkings();
                        setAgentRunning(true);

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
                            );
                        } catch (error) {
                            resetThinkings();
                            appendAssistantMessage(sessionId, { id: nanoid(), role: "error", title: "操作失败", text: error instanceof Error ? error.message : "操作失败" });
                            setAgentRunning(false);
                        }
                    }}
                    isStreaming={agentRunning}
                    config={config}
                    model={config.agentModel}
                    onModelChange={(model) => updateConfig("agentModel", model)}
                    onMissingConfig={() => showMissingAiConfig("text")}
                />
            ) : null}
        </main>
    );
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

function buildImageGenerationAttributes(type: CanvasImageGenerationType, config: AiConfig, count: number, references: ReferenceImage[]): CanvasNodeAttributes {
    return {
        generationType: type,
        model: config.model,
        size: config.size,
        quality: config.quality,
        imageResolution: config.imageResolution,
        count,
        references: references.map(referenceUrl).filter((url): url is string => Boolean(url)),
        referenceObjectStorages: references.map((reference) => reference.objectStorage).filter((file): file is NonNullable<typeof file> => Boolean(file?.url)),
    };
}

function referenceUrl(image: ReferenceImage) {
    return image.objectStorage?.url || image.storageKey || image.url || (!image.dataUrl.startsWith("data:") ? image.dataUrl : undefined);
}

function generationReferenceUrls(context: { referenceImages: ReferenceImage[]; referenceVideos: Array<{ storageKey?: string; url?: string }> }) {
    return [...context.referenceImages.map(referenceUrl).filter((url): url is string => Boolean(url)), ...context.referenceVideos.map((video) => video.storageKey || video.url).filter((url): url is string => Boolean(url))];
}

async function resolveGenerationReferences(generation: CanvasImageGenerationSettings) {
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

async function readNodeObjectStorageBlob(node: CanvasDomainNode) {
    if (isTextNode(node) || !node.content.source) return null;
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
    const generation = node && !isTextNode(node) ? node.generation : null;
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

function isGenerationCanceled(error: unknown) {
    return error instanceof Error && (error.message === "请求已取消" || error.name === "AbortError");
}

function sourceNodeReferenceImages(node: CanvasDomainNode | null) {
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
