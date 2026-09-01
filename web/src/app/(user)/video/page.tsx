"use client";

import { BookOpen, CloudUpload, Download, FolderPlus, Cog, HelpCircle, Link2, LoaderCircle, Palette, Play, RefreshCw, Sparkles, TriangleAlert, Upload, VideoIcon } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { App, Button, Image, Input, Modal, Tag, Tooltip, Typography } from "antd";
import { nanoid } from "nanoid";

import { bindPendingVideoSize, renderPendingVideoToolCall, VideoGeneratingCard } from "./components/pending-video-tool-call";
import { renderPendingImageToolCall } from "@/app/(user)/image/components/pending-image-tool-call";
import { AssetPickerModal, type InsertAssetPayload } from "@/features/assets/components/asset-picker-modal";
import { useAssetStore } from "@/features/assets/stores/use-asset-store";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import type { AgentAttachment } from "@/features/canvas/api/agent";
import { CreationWorkspace } from "@/features/generation/components/creation-workspace";
import { RecentReferenceImagePicker } from "@/features/generation/components/recent-reference-image-picker";
import { ImageSettingsPanel } from "@/features/generation/components/image-settings-panel";
import { VideoSettingsPanel, videoResolutionLabel, videoSecondsLabel, videoSizeLabel } from "@/features/generation/components/video-settings-panel";
import type { CreationComposerAction, CreationConversationItem, CreationReferenceChip, CreationStyleOption, CreationThreadRound, CreationThreadSection } from "@/features/generation/components/creation-workspace-types";
import { seedanceReferenceLabel, SEEDANCE_REFERENCE_LIMITS } from "@/features/generation/lib/seedance-video";
import { formatBytes, formatDuration } from "@/features/generation/lib/image-utils";
import { formatVideoGenerationSettingsSummary } from "@/features/generation/lib/generation-settings-summary";
import type { ReferenceImage } from "@/features/generation/types/image";
import type { ReferenceVideo } from "@/features/generation/types/media";
import { PromptSelectDialog } from "@/features/prompts/components/prompt-select-dialog";
import { ModelPicker } from "@/features/settings/components/model-picker";
import { modelOptionLabel, useConfigStore, useEffectiveConfig, type AiConfig } from "@/features/settings/stores/use-config-store";
import { deleteStoredMedia, resolveMediaStorageInfo, resolveMediaUrl, uploadMediaFile } from "@/features/storage/services/file-storage";
import { downloadMedia } from "@/features/storage/services/media-download";
import { resolveImageUrl, uploadImage } from "@/features/storage/services/image-storage";
import { uploadRemoteObjectToStorage } from "@/features/storage/services/object-storage";
import { useThemeStore } from "@/features/theme/stores/use-theme-store";
import { canvasThemes } from "@/shared/lib/canvas-theme";
import { clearInitialPromptFromLocation, readInitialPromptFromLocation } from "@/shared/lib/initial-prompt";
import { useCopyText } from "@/shared/hooks/use-copy-text";
import type { ObjectStorageFile } from "@/shared/types/object-storage";
import { useAgentChatSSE } from "@/features/chat/use-agent-chat-sse";
import { useAgentThinking } from "@/features/chat/use-agent-thinking";
import type { AgentActivityState, ChatAttachment, ChatMessageItem, ToolCallState } from "@/features/chat/types";
import { buildChatThreadSection } from "@/features/generation/components/chat-thread-section";
import { ChoiceHistoryBar } from "@/features/generation/components/creation-message-thread";
import { ResultDetailDialog, type ResultDetail } from "@/features/generation/components/result-detail-dialog";
import {
    createToolExecutionActivity,
    finishRoundAgentActivities,
    finishRunningAgentActivities,
    mergePlanTaskActivityMessage,
    normalizeHistoricalAgentActivities,
    updateAgentActivityMessage,
    upsertAgentActivityMessage,
} from "@/features/generation/components/agent-activity";
import { hasPendingVideoConversation } from "@/features/generation/lib/generation-conversation-recovery";
import { reconcileGenerationLogTasks } from "@/features/generation/lib/generation-log-task-reconciliation";
import { getGenerationConversationStatus, hasRunningGeneration, type GenerationLogStatusFields } from "@/features/generation/lib/generation-log-status";
import { selectGenerationAttachments } from "@/features/generation/lib/generation-retry";
import { imageReferenceAttachments, referenceMediaType, referenceMediaUrl, videoReferenceAttachments } from "@/features/generation/lib/reference-attachments";
import { usePromptOptimization } from "@/features/generation/hooks/use-prompt-optimization";
import { useRecentReferenceImages } from "@/features/generation/hooks/use-recent-reference-images";
import { loadVideoLastUsedSettings, saveVideoLastUsedSettings, type VideoLastUsedSettings } from "@/features/generation/lib/last-used-generation-settings";
import { formatGenerationStyleMessage } from "@/features/generation/lib/style-command";
import { availableVideoModelsForMode, quoteVideoGeneration, videoGenerationReferenceIssue } from "@/features/generation/lib/video-billing";
import { requestCreditCost } from "@/features/generation/constants/credits";
import {
    cancelAiTask,
    deleteGenerationLogs,
    getAiTaskPollingIntervalMilliseconds,
    listGenerationLogs,
    listGenerationStyles,
    listSkills,
    markGenerationLogViewed,
    quoteVideoWorkflow as quoteVideoWorkflowOnServer,
    renameGenerationLogTitle,
    type GenerationStyleSnapshot,
    type SkillOption,
    type ServerVideoWorkflowQuote,
    type ServerVideoWorkflowStageQuote,
} from "@/services/api/server";
import { findLatestPlayableVideo, hasPlayableVideoUrl } from "./video-display";

type GeneratedVideo = {
    id: string;
    url: string;
    storageKey: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
    objectStorage?: ObjectStorageFile;
};

type GenerationResult = {
    id: string;
    taskId?: string;
    status: "pending" | "success" | "failed" | "canceled";
    progress?: number;
    video?: GeneratedVideo;
    error?: string;
};

type WorkflowOutput = {
    id?: string;
    role?: string;
    taskId?: string;
    taskType?: "image" | "video" | string;
    url?: string;
    storageKey?: string;
    key?: string;
    mimeType?: string;
    width?: number;
    height?: number;
    durationMs?: number;
    bytes?: number;
    objectStorage?: ObjectStorageFile;
};

type WorkflowStage = {
    role: string;
    displayName: string;
    planTaskId: string;
    taskId?: string;
    status: "pending" | "running" | "success" | "failed" | "canceled" | "skipped";
    progress?: number;
    outputs?: WorkflowOutput[];
    error?: string;
    blocking?: boolean;
};

type WorkflowTaskSnapshot = {
    planTaskId?: string;
    taskId?: string;
    role?: string;
    status?: string;
};

type RoundConfig = Pick<AiConfig, "model" | "videoModel" | "size" | "vquality" | "videoSeconds" | "videoWatermark"> & {
    imageModel?: string;
    videoGenerationMode?: AiConfig["videoGenerationMode"];
    resolution?: string;
    seconds?: string;
    imageSize?: string;
    imageResolution?: string;
    imageQuality?: string;
};

/** 工作流草案轮的图片参数选择：按草案轮次ID绑定，每轮重新选择。 */
type WorkflowImageSelection = {
    roundId: string;
    imageModel: string;
    size: string;
    quality: string;
    imageResolution: string;
};

/** 工作流图片确认轮的视频参数选择：按图片确认轮次ID绑定，确认生成视频前必须显式确认比例/清晰度/时长。 */
type WorkflowVideoSelection = {
    roundId: string;
    size: string;
    resolution: string;
    seconds: string;
};

type Round = {
    id: string;
    prompt: string;
    generationPrompt?: string;
    generationStyleSnapshots?: GenerationStyleSnapshot[];
    /** 生成该轮时用户选择的技能快照 */
    skill?: { id: number; name: string; targetType: string } | null;
    /** 对话轮次中系统提供的选项（历史只读展示，不可再点击） */
    choices?: { label: string; value: string; multiple?: boolean; action?: string }[];
    references: ReferenceImage[];
    videoReferences: ReferenceVideo[];
    config: RoundConfig;
    /** 纯对话轮次（技能引导/澄清问答）无生成结果，可为空 */
    assistantText?: string;
    result?: GenerationResult;
    workflowType?: string;
    workflowStatus?: string;
    draftedPrompts?: Record<string, string>;
    stages?: WorkflowStage[];
    tasks?: WorkflowTaskSnapshot[];
    outputs?: WorkflowOutput[];
    error?: string;
    createdAt: number;
    activities?: AgentActivityState[];
};

type Conversation = GenerationLogStatusFields & {
    id: string;
    title: string;
    rounds: Round[];
    createdAt: number;
    updatedAt: number;
};

export default function VideoPage() {
    const { message, modal } = App.useApp();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const uploadChoiceInputRef = useRef<HTMLInputElement>(null);
    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const configHydrated = useConfigStore((state) => state.hydrated);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const userId = useUserStore((state) => state.user?.id);
    const userRole = useUserStore((state) => state.user?.role);
    const creditBalance = useUserStore((state) => state.user?.creditBalance);
    const addAsset = useAssetStore((state) => state.addAsset);
    const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
    const theme = canvasThemes[resolvedTheme];
    const { optimizingOperationId, optimizePrompt } = usePromptOptimization();
    const { recentReferenceImageUrls, recordRecentReferenceImage } = useRecentReferenceImages(userId);
    const isPromptOptimizing = optimizingOperationId === "video-page";

    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [prompt, setPrompt] = useState("");
    const [styleOptions, setStyleOptions] = useState<CreationStyleOption[]>([]);
    const [selectedStyles, setSelectedStyles] = useState<CreationStyleOption[]>([]);
    const [styleLoading, setStyleLoading] = useState(false);
    const [styleError, setStyleError] = useState<string | null>(null);
    const [skillOptions, setSkillOptions] = useState<SkillOption[]>([]);
    const [selectedSkill, setSelectedSkill] = useState<SkillOption | null>(null);
    const [serverWorkflowQuote, setServerWorkflowQuote] = useState<ServerVideoWorkflowQuote | null>(null);
    const [workflowImageSelection, setWorkflowImageSelection] = useState<WorkflowImageSelection | null>(null);
    const [workflowVideoSelection, setWorkflowVideoSelection] = useState<WorkflowVideoSelection | null>(null);
    const [skillLoading, setSkillLoading] = useState(false);
    const [skillError, setSkillError] = useState<string | null>(null);
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [videoReferences, setVideoReferences] = useState<ReferenceVideo[]>([]);
    const [uploadingReferenceIds, setUploadingReferenceIds] = useState<string[]>([]);
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [videoDraftSettingsModified, setVideoDraftSettingsModified] = useState(false);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [promptEditDialogOpen, setPromptEditDialogOpen] = useState(false);
    const [promptEditValue, setPromptEditValue] = useState({ firstFrame: "", lastFrame: "", video: "" });
    const [promptEditMode, setPromptEditMode] = useState<"single" | "three">("single");
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [resultDetail, setResultDetail] = useState<ResultDetail | null>(null);
    const [uploadingObjectStorageId, setUploadingObjectStorageId] = useState("");
    const [managementMode, setManagementMode] = useState(false);
    const [pendingStopping, setPendingStopping] = useState(false);
    const initialPromptAppliedRef = useRef(false);
    const [focusInitialPrompt, setFocusInitialPrompt] = useState(false);

    useEffect(() => {
        if (initialPromptAppliedRef.current) return;
        const initialPrompt = readInitialPromptFromLocation();
        if (!initialPrompt) return;
        initialPromptAppliedRef.current = true;
        setPrompt(initialPrompt);
        setFocusInitialPrompt(true);
        clearInitialPromptFromLocation();
    }, []);

    useEffect(() => {
        let cancelled = false;
        setStyleLoading(true);
        setStyleError(null);
        void listGenerationStyles("video")
            .then((result) => {
                if (!cancelled) setStyleOptions(result.styles);
            })
            .catch((error) => {
                if (!cancelled) setStyleError(error instanceof Error ? error.message : "视频风格加载失败");
            })
            .finally(() => {
                if (!cancelled) setStyleLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [message]);

    useEffect(() => {
        let cancelled = false;
        setSkillLoading(true);
        setSkillError(null);
        void listSkills("video")
            .then((result) => {
                if (!cancelled) setSkillOptions(result.skills);
            })
            .catch((error) => {
                if (!cancelled) setSkillError(error instanceof Error ? error.message : "技能加载失败");
            })
            .finally(() => {
                if (!cancelled) setSkillLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [message]);

    useEffect(() => {
        if (!configHydrated) return;
        void loadVideoLastUsedSettings()
            .then((settings) => {
                updateConfig("vquality", settings.vquality);
                updateConfig("videoGenerationMode", settings.videoGenerationMode);
                updateConfig("size", settings.size);
                updateConfig("videoSeconds", settings.videoSeconds);
                updateConfig("videoWatermark", settings.videoWatermark);
            })
            .catch((error) => console.error("读取上次视频生成设置失败", error));
    }, [configHydrated, updateConfig]);

    const updateVideoSettings = (key: keyof VideoLastUsedSettings, value: string) => {
        updateConfig(key, value);
        void saveVideoLastUsedSettings({ [key]: value }).catch((error) => console.error("保存上次视频生成设置失败", error));
    };

    const handleVideoSettingsChange = (key: keyof VideoLastUsedSettings, value: string) => {
        if (String(config[key]) !== value) {
            setVideoDraftSettingsModified(true);
        }
        updateVideoSettings(key, value);
    };

    /** 工作流图片面板的键映射到本轮草案的图片参数选择（count 不适用，固定单张）。 */
    const handleWorkflowImageSettingChange = (key: "quality" | "imageResolution" | "size" | "count", value: string) => {
        if (key === "count") return;
        if (key === "quality") updateWorkflowImageSelection({ quality: value });
        else if (key === "imageResolution") updateWorkflowImageSelection({ imageResolution: value });
        else updateWorkflowImageSelection({ size: value });
    };

    // 文生视频模式下上传参考素材时，按素材类型自动切换生成模式：仅图片 → 图生视频；含视频 → 全能参考。
    const autoSwitchModeForReferences = (addedImages: number, addedVideos: number) => {
        if (config.videoGenerationMode !== "text-to-video") return;
        if (videoReferences.length + addedVideos > 0) {
            handleVideoSettingsChange("videoGenerationMode", "reference-to-video");
        } else if (references.length + addedImages > 0) {
            handleVideoSettingsChange("videoGenerationMode", "image-to-video");
        }
    };

    // Agent chat state
    const [chatMessages, setChatMessages] = useState<ChatMessageItem[]>([]);
    const { completedThinkings, activeThinking, onThoughtDelta, onThoughtComplete, resetThinkings } = useAgentThinking();
    const [toolCalls, setToolCalls] = useState<ToolCallState[]>([]);
    const [streamingText, setStreamingText] = useState<{ messageId: string; text: string } | null>(null);
    const activeConversation = conversations.find((item) => item.id === activeId) || null;
    const latestRound = activeConversation?.rounds.at(-1);
    // 实时对话中的草案待确认轮：SSE 聊天区最后一条携带 choice 动作且含"确认生成"选项的助手消息。
    // 不依赖后端落库时序（saveClarificationRound 是异步落库，latestRound 可能尚未刷新），
    // 用户点"确认生成"的瞬间即用聊天区实时消息判定。
    const liveDraftChoiceRound = (() => {
        for (let index = chatMessages.length - 1; index >= 0; index--) {
            const message = chatMessages[index];
            if (message.role === "assistant") {
                return message.action?.type === "choice" && message.action.options?.some((option) => option.value === "确认生成") ? message : null;
            }
        }
        return null;
    })();
    // 实时对话中的图片待确认轮：最后一条携带 choice 动作且含"用这些图片生成视频"选项的助手消息。
    // 图片阶段完成后询问用户"用这些图片生成视频 / 修改提示词重新生成"。
    const liveImageConfirmChoiceRound = (() => {
        for (let index = chatMessages.length - 1; index >= 0; index--) {
            const message = chatMessages[index];
            if (message.role === "assistant") {
                return message.action?.type === "choice" && message.action.options?.some((option) => option.value === "用这些图片生成视频") ? message : null;
            }
        }
        return null;
    })();
    // 历史刷新场景兜底：最新落库轮次是 clarifying 且携带确认选项（刷新/切换会话后从记录恢复时命中）。
    const historyWorkflowChargingNext = Boolean(selectedSkill?.workflowType) && latestRound?.workflowStatus === "clarifying" && Boolean(latestRound.choices?.length);
    // 历史刷新场景兜底：最新落库轮次是图片待确认状态（刷新/切换会话后从记录恢复时命中）。
    const historyWorkflowImageConfirmNext = Boolean(selectedSkill?.workflowType) && latestRound?.workflowStatus === "image_pending_confirm" && Boolean(latestRound.choices?.length);
    // 工作流对话轮免费；仅当处于"草案待确认"（下一步可能确认生成并扣费）时才展示和校验报价。
    const workflowChargingNext = Boolean(selectedSkill?.workflowType) && (Boolean(liveDraftChoiceRound) || historyWorkflowChargingNext);
    // 图片阶段完成后的二次确认轮：下一步确认将生成视频并扣费，同样需要校验视频报价。
    const workflowImageConfirmNext = Boolean(selectedSkill?.workflowType) && (Boolean(liveImageConfirmChoiceRound) || historyWorkflowImageConfirmNext);
    // 草案轮绑定标识：实时对话用聊天消息 id，历史刷新场景用落库轮次 id
    const workflowDraftRoundId = liveDraftChoiceRound?.id ?? (historyWorkflowChargingNext ? (latestRound?.id ?? null) : null);
    // 草案轮的图片参数选择：按轮次绑定，每个草案轮重新选择；未显式选择时回退有效配置默认值（与卡片 UI 默认勾选一致）
    const activeWorkflowImageSelection = workflowDraftRoundId && workflowImageSelection?.roundId === workflowDraftRoundId ? workflowImageSelection : null;
    // 画质/清晰度/比例/模型：未显式点击时回退到有效配置默认值，避免默认勾选被误判为未选择。
    // 仅当模型也没有默认配置（effectiveConfig.imageModel 为空）时，才需要用户显式选择模型。
    const workflowImageModel = activeWorkflowImageSelection?.imageModel || effectiveConfig.imageModel || "";
    const workflowImageSize = activeWorkflowImageSelection?.size || effectiveConfig.size || "1:1";
    const workflowImageResolution = activeWorkflowImageSelection?.imageResolution || effectiveConfig.imageResolution || "2K";
    const workflowImageQuality = activeWorkflowImageSelection?.quality || effectiveConfig.quality || "medium";
    const workflowImageSelectionComplete = Boolean(workflowImageModel && workflowImageSize && workflowImageResolution && workflowImageQuality);
    const updateWorkflowImageSelection = (patch: Partial<Omit<WorkflowImageSelection, "roundId">>) => {
        if (!workflowDraftRoundId) return;
        setWorkflowImageSelection((current) => {
            const base = current && current.roundId === workflowDraftRoundId ? current : { roundId: workflowDraftRoundId, imageModel: "", size: "", quality: "", imageResolution: "" };
            return { ...base, ...patch };
        });
    };
    // 图片确认轮的视频参数选择：按图片确认轮次绑定，确认生成视频前必须显式确认比例/清晰度/时长。
    // 未显式选择时回退有效配置默认值（与视频设置面板默认勾选一致），仅当用户显式修改时才记录覆盖值。
    const workflowImageConfirmRoundId = liveImageConfirmChoiceRound?.id ?? (historyWorkflowImageConfirmNext ? (latestRound?.id ?? null) : null);
    const activeWorkflowVideoSelection = workflowImageConfirmRoundId && workflowVideoSelection?.roundId === workflowImageConfirmRoundId ? workflowVideoSelection : null;
    const workflowVideoSize = activeWorkflowVideoSelection?.size || config.size || "16:9";
    const workflowVideoResolution = activeWorkflowVideoSelection?.resolution || config.vquality || "720p";
    const workflowVideoSeconds = activeWorkflowVideoSelection?.seconds || config.videoSeconds || "5";
    const workflowVideoSelectionComplete = Boolean(workflowVideoSize && workflowVideoResolution && workflowVideoSeconds);
    const updateWorkflowVideoSelection = (patch: Partial<Omit<WorkflowVideoSelection, "roundId">>) => {
        if (!workflowImageConfirmRoundId) return;
        setWorkflowVideoSelection((current) => {
            const base = current && current.roundId === workflowImageConfirmRoundId ? current : { roundId: workflowImageConfirmRoundId, size: "", resolution: "", seconds: "" };
            return { ...base, ...patch };
        });
    };
    /** 视频设置面板键映射到工作流视频参数选择（生成模式/水印/数量不适用，固定引用配置）。 */
    const handleWorkflowVideoSettingChange = (key: "videoGenerationMode" | "vquality" | "size" | "videoSeconds" | "videoWatermark", value: string) => {
        if (key === "vquality") updateWorkflowVideoSelection({ resolution: value });
        else if (key === "size") updateWorkflowVideoSelection({ size: value });
        else if (key === "videoSeconds") updateWorkflowVideoSelection({ seconds: value });
    };
    const model = effectiveConfig.videoModel || effectiveConfig.model;
    const videoResolution = config.vquality || "720p";
    const agentCreationSettings = {
        model,
        imageModel: workflowImageModel,
        // 图片确认轮按用户确认的视频参数覆盖；草案轮/普通视频按页面配置
        size: workflowImageConfirmNext ? workflowVideoSize : config.size || "16:9",
        resolution: workflowImageConfirmNext ? workflowVideoResolution : videoResolution,
        quality: workflowImageConfirmNext ? (workflowVideoResolution.includes("1080") ? "high" : workflowVideoResolution.includes("480") ? "low" : "medium") : videoResolution.includes("1080") ? "high" : videoResolution.includes("480") ? "low" : "medium",
        seconds: workflowImageConfirmNext ? workflowVideoSeconds : config.videoSeconds || "5",
        watermark: String(config.videoWatermark).toLowerCase() === "true",
        videoGenerationMode: config.videoGenerationMode,
        imageSize: workflowImageSize,
        imageResolution: workflowImageResolution,
        imageQuality: workflowImageQuality,
        ...(selectedStyles.length ? { generationStyleIds: selectedStyles.map((style) => style.id) } : {}),
    };

    // Refs to access latest state in SSE callbacks
    const streamingTextRef = useRef(streamingText);
    const toolCallsRef = useRef(toolCalls);
    const pendingVideoSizeRef = useRef("");
    const chatMessagesRef = useRef(chatMessages);
    const conversationsRef = useRef(conversations);
    const activeIdRef = useRef(activeId);

    const refreshConversations = useCallback(async () => {
        let nextConversations = await readConversations();
        const activeConversation = nextConversations.find((conversation) => conversation.id === activeIdRef.current);
        if (activeConversation && getGenerationConversationStatus(activeConversation) !== "none" && activeConversation.generationStatus !== "running") {
            try {
                await markGenerationLogViewed(activeConversation.id);
                nextConversations = nextConversations.map((conversation) => (conversation.id === activeConversation.id ? { ...conversation, generationViewedAt: conversation.generationCompletedAt } : conversation));
            } catch (error) {
                console.error("标记视频生成记录已读失败", error);
            }
        }
        conversationsRef.current = nextConversations;
        setConversations(nextConversations);
        return nextConversations;
    }, []);

    const { sessionId, isStreaming, isQueued, isStopping, sendMessage, cancelMessage, canChangeSession, resetSession, restoreSession } = useAgentChatSSE({
        entrySource: "videoPage",
        skillId: selectedSkill ? String(selectedSkill.id) : undefined,
        creationSettings: agentCreationSettings,
        onTextDelta: (msgId, delta) => {
            setStreamingText((prev) => {
                const next = prev?.messageId === msgId ? { ...prev, text: prev.text + delta } : { messageId: msgId, text: delta };
                streamingTextRef.current = next;
                return next;
            });
        },
        onThoughtDelta,
        onThoughtComplete,
        onToolCall: (call) => {
            const isVideoTool = call.name === "generate_video" || call.name === "edit_video";
            const isImageTool = call.name === "generate_image" || call.name === "edit_image";
            const isMediaTool = isVideoTool || isImageTool;
            // 图片确认轮已确认的视频比例优先于页面配置（pendingVideoSizeRef 只在 generate/regenerateRound 更新，
            // handleActionReply 路径不会同步，否则 tool 消息会显示页面默认比例而非用户确认的比例）。
            const effectiveVideoSize = workflowImageConfirmNext ? workflowVideoSize : pendingVideoSizeRef.current;
            const pendingCall = isVideoTool ? bindPendingVideoSize(call, effectiveVideoSize) : call;
            setToolCalls((prev) => {
                const next = prev.some((item) => item.callId === pendingCall.callId) ? prev.map((item) => (item.callId === pendingCall.callId ? pendingCall : item)) : [...prev, pendingCall];
                toolCallsRef.current = next;
                return next;
            });
            setChatMessages((prev) => {
                const next = upsertAgentActivityMessage(prev, createToolExecutionActivity(pendingCall));
                chatMessagesRef.current = next;
                return next;
            });
            if (isMediaTool) {
                // 工具开始执行前，将 LLM 已输出的文本保存为助手消息，避免被清空丢失
                const streamed = streamingTextRef.current;
                if (streamed && streamed.text) {
                    setChatMessages((prev) => {
                        const next = prev.some((item) => item.id === streamed.messageId) ? prev : [...prev, { id: streamed.messageId, role: "assistant" as const, text: streamed.text }];
                        chatMessagesRef.current = next;
                        return next;
                    });
                }
                const toolText = call.name === "generate_video" ? "正在生成视频..." : call.name === "edit_video" ? "正在编辑视频..." : call.name === "generate_image" ? "正在生成图片..." : "正在编辑图片...";
                setChatMessages((prev) => {
                    const toolMessage = { id: pendingCall.callId, role: "tool" as const, text: toolText, detail: pendingCall };
                    const next = prev.some((item) => item.id === pendingCall.callId) ? prev.map((item) => (item.id === pendingCall.callId ? toolMessage : item)) : [...prev, toolMessage];
                    chatMessagesRef.current = next;
                    return next;
                });
                setStreamingText(null);
                streamingTextRef.current = null;
            }
        },
        onToolProgress: (callId, taskId, progress) => {
            setToolCalls((prev) => {
                const next = prev.map((c) => (c.callId === callId ? { ...c, progress, taskId } : c));
                toolCallsRef.current = next;
                return next;
            });
            setChatMessages((prev) => {
                const messagesWithProgress = prev.map((m) => {
                    const detail = m.detail as ToolCallState | undefined;
                    return m.role === "tool" && detail?.callId === callId ? { ...m, detail: { ...detail, progress, taskId } } : m;
                });
                const next = updateAgentActivityMessage(messagesWithProgress, `tool-${callId}`, { progress });
                chatMessagesRef.current = next;
                return next;
            });
            if (activeIdRef.current && !conversationsRef.current.some((conversation) => conversation.id === activeIdRef.current)) {
                void refreshConversations();
            }
        },
        onToolResult: (callId, ok, resultMsg, data) => {
            const status: ToolCallState["status"] = data?.canceled ? "canceled" : ok ? "success" : "failed";
            setToolCalls((prev) => {
                const next = prev.map((c) => (c.callId === callId ? { ...c, status, resultMessage: resultMsg, resultData: data } : c));
                toolCallsRef.current = next;
                return next;
            });
            setChatMessages((prev) => {
                const messagesWithResult = prev.map((m) => {
                    const detail = m.detail as ToolCallState | undefined;
                    return m.role === "tool" && detail?.callId === callId ? { ...m, detail: { ...detail, status, resultMessage: resultMsg, resultData: data } } : m;
                });
                const next = updateAgentActivityMessage(messagesWithResult, `tool-${callId}`, { status, progress: status === "success" ? 100 : undefined });
                chatMessagesRef.current = next;
                return next;
            });
        },
        onTaskComplete: (messageId, text, action) => {
            const streamed = streamingTextRef.current;
            setChatMessages((prev) => {
                let next = finishRoundAgentActivities(prev, text || "已完成");
                if (streamed && streamed.text) {
                    const assistantMessage = { id: streamed.messageId, role: "assistant" as const, text: streamed.text, ...(action ? { action } : {}) };
                    next = next.some((item) => item.id === streamed.messageId) ? next.map((item) => (item.id === streamed.messageId ? { ...item, ...(action ? { action } : {}) } : item)) : [...next, assistantMessage];
                } else if (text || action) {
                    const lastMessage = next.at(-1);
                    next =
                        lastMessage?.role === "assistant" && lastMessage.text === text
                            ? action
                                ? next.map((item, index) => (index === next.length - 1 ? { ...item, action } : item))
                                : next
                            : [...next, { id: messageId || nanoid(), role: "assistant" as const, text, ...(action ? { action } : {}) }];
                }
                chatMessagesRef.current = next;
                return next;
            });
            setStreamingText(null);
            streamingTextRef.current = null;
            resetThinkings();
            // 刷新侧栏（后端已保存生成记录）。聊天区保留完整对话历史；已实时渲染的轮次由历史区按 liveRoundIds 过滤去重。
            void refreshConversations();
        },
        onCanceled: (stoppedMessage) => {
            resetThinkings();
            setStreamingText(null);
            streamingTextRef.current = null;
            setToolCalls((prev) => {
                const next = prev.map((call) => (call.status === "executing" ? { ...call, status: "canceled" as const, resultMessage: stoppedMessage } : call));
                toolCallsRef.current = next;
                return next;
            });
            let hasExecutingTool = false;
            const messagesWithCanceledTool = chatMessagesRef.current.map((item) => {
                const detail = item.detail as ToolCallState | undefined;
                if (item.role !== "tool" || detail?.status !== "executing") return item;
                hasExecutingTool = true;
                return { ...item, text: stoppedMessage, detail: { ...detail, status: "canceled" as const, resultMessage: stoppedMessage } };
            });
            const canceledMessages = finishRunningAgentActivities(messagesWithCanceledTool, "canceled", stoppedMessage);
            if (!hasExecutingTool) {
                canceledMessages.push({ id: nanoid(), role: "error", text: stoppedMessage });
            }
            chatMessagesRef.current = canceledMessages;
            setChatMessages(canceledMessages);
            void refreshConversations();
        },
        onNotice: (message) => {
            setChatMessages((prev) => {
                const next = [...prev, { id: nanoid(), role: "assistant" as const, text: message }];
                chatMessagesRef.current = next;
                return next;
            });
        },
        onPlanCreated: (planId, summary, taskCount) => {
            setChatMessages((prev) => {
                const next = upsertAgentActivityMessage(prev, {
                    id: `plan-${planId}`,
                    type: "plan-created",
                    title: "创建创作计划",
                    description: `${summary}，共 ${taskCount} 个任务`,
                    status: "success",
                });
                chatMessagesRef.current = next;
                return next;
            });
        },
        onPlanTaskStatus: (planId, taskId, status, statusMessage) => {
            setChatMessages((prev) => {
                const next = mergePlanTaskActivityMessage(prev, planId, taskId, status, statusMessage);
                chatMessagesRef.current = next;
                return next;
            });
        },
        onPromptPrepared: (planId, taskId, strategy) => {
            setChatMessages((prev) => {
                const next = upsertAgentActivityMessage(prev, {
                    id: `prompt-${planId}-${taskId}`,
                    type: "prompt-prepared",
                    title: strategy === "OPTIMIZE" ? "优化生成提示词" : "准备生成提示词",
                    description: strategy === "OPTIMIZE" ? "已根据创作目标优化提示词" : "沿用原始提示词",
                    status: "success",
                });
                chatMessagesRef.current = next;
                return next;
            });
        },
        onError: (error) => {
            resetThinkings();
            setChatMessages((prev) => {
                const next = [...finishRunningAgentActivities(prev, "failed", error), { id: nanoid(), role: "error" as const, text: error }];
                chatMessagesRef.current = next;
                return next;
            });
        },
    });

    // 预览报价只关心计费档位，不受参考素材是否上传影响（素材缺失仅阻断真实生成）。
    const videoQuote = quoteVideoGeneration({
        config: effectiveConfig,
        model,
        mode: config.videoGenerationMode,
        resolution: config.vquality,
        seconds: config.videoSeconds,
        imageReferenceCount: references.length,
        videoReferenceCount: videoReferences.length,
        requireReferences: false,
    });
    useEffect(() => {
        if (!selectedSkill?.workflowType) {
            setServerWorkflowQuote(null);
            return;
        }
        let cancelled = false;
        setServerWorkflowQuote(null);
        // 图片确认轮时按用户确认的视频参数报价（清晰度/时长影响视频阶段计费）；草案轮按页面配置报价。
        const quoteResolution = workflowImageConfirmNext ? workflowVideoResolution : config.vquality;
        const quoteSeconds = workflowImageConfirmNext ? workflowVideoSeconds : config.videoSeconds;
        void quoteVideoWorkflowOnServer({ workflowType: selectedSkill.workflowType, model, imageModel: workflowImageModel, resolution: quoteResolution, seconds: quoteSeconds,
            stage: workflowImageConfirmNext ? "video" : "image" })
            .then((quote) => {
                if (!cancelled) setServerWorkflowQuote(quote);
            })
            .catch((error) => {
                if (!cancelled) setServerWorkflowQuote({ available: false, stages: [], reason: error instanceof Error ? error.message : "工作流报价请求失败", requiredCapabilities: [] });
            });
        return () => {
            cancelled = true;
        };
    }, [config.videoSeconds, config.vquality, workflowImageModel, workflowDraftRoundId, workflowImageConfirmNext, workflowVideoResolution, workflowVideoSeconds, model, selectedSkill?.workflowType]);
    // 图片确认轮：本次确认仅生成视频，报价只取视频阶段（首/尾帧图片已按草案确认时参数生成完毕）。
    const workflowVideoStageQuote = workflowImageConfirmNext && serverWorkflowQuote ? (serverWorkflowQuote.stages.find((stage) => stage.role === "video") ?? null) : null;
    const workflowImageConfirmQuote = workflowVideoStageQuote
        ? ({
              available: Boolean(serverWorkflowQuote?.available && workflowVideoStageQuote.credits != null),
              credits: workflowVideoStageQuote.credits ?? 0,
              reason: serverWorkflowQuote?.available ? undefined : serverWorkflowQuote?.reason || "视频工作流报价不可用",
              stages: serverWorkflowQuote?.stages ?? [],
          } as { available: boolean; credits: number; reason?: string; stages: ServerVideoWorkflowStageQuote[] })
        : null;
    const activeQuote = selectedSkill?.workflowType
        ? workflowChargingNext
            ? (serverWorkflowQuote ?? { available: false as const, reason: "正在获取工作流报价" })
            : (workflowImageConfirmQuote ?? (workflowImageConfirmNext ? { available: false as const, reason: "正在获取工作流报价" } : null))
        : videoQuote;
    // 素材要求单独校验，用于「可生成」判定与提示，不阻断价格预览。
    const referenceIssue = videoGenerationReferenceIssue(config.videoGenerationMode, references.length, videoReferences.length);
    const creditCost = activeQuote === null ? undefined : activeQuote.available ? (activeQuote.credits ?? null) : null;
    const workflowBalanceInsufficient = Boolean(selectedSkill?.workflowType) && activeQuote !== null && activeQuote.available && typeof creditBalance === "number" && (activeQuote.credits ?? 0) > creditBalance;
    const draftSettingsSummary = videoDraftSettingsModified ? buildVideoSettingsSummary(config, effectiveConfig, model) : "";
    const historySettingsSummary = !videoDraftSettingsModified && activeId && latestRound?.config ? buildVideoSettingsSummary(latestRound.config, effectiveConfig, latestRound.config.videoModel || latestRound.config.model || "") : "";
    const settingsSummary = draftSettingsSummary || historySettingsSummary;
    const activeConversationPending = activeConversation ? hasPendingVideoConversation(activeConversation) : false;
    // 声明视频工作流的技能，其首轮及后续引导消息属于免费对话，不应被视频报价阻断；
    // 工作流进入确认生成阶段后，activeQuote 与积分余额仍会继续控制提交状态。
    const workflowSkillConversation = Boolean(selectedSkill?.workflowType) && !workflowChargingNext && !workflowImageConfirmNext;
    const quoteReady = workflowSkillConversation || activeQuote === null || (activeQuote.available && !workflowBalanceInsufficient);
    // 工作流会自行生成阶段素材，不要求页面先上传普通视频参考素材。
    const referenceReady = Boolean(selectedSkill?.workflowType) || !referenceIssue;
    const canGenerate = Boolean(prompt.trim()) && quoteReady && referenceReady && !isStreaming && !isQueued && !activeConversationPending && !isPromptOptimizing && !uploadingReferenceIds.length;
    const allSelected = Boolean(conversations.length) && selectedIds.length === conversations.length;

    // SSE 请求状态丢失（刷新页面、连接中断或服务重启）但记录轮次仍在生成时，直接取消底层AI任务实现停止。
    const stopPendingGeneration = async () => {
        const conversation = conversationsRef.current.find((item) => item.id === activeIdRef.current);
        if (!conversation) return;
        const taskIds = [
            ...new Set(
                conversation.rounds.flatMap((round) => [
                    ...(round.result?.status === "pending" && round.result.taskId ? [round.result.taskId] : []),
                    ...(round.stages || []).filter((stage) => stage.taskId && stage.status === "pending").map((stage) => stage.taskId as string),
                    ...(round.tasks || []).flatMap((task) => (isPendingWorkflowTask(task) ? [task.taskId] : [])),
                ]),
            ),
        ];
        if (!taskIds.length) {
            message.warning("没有可停止的生成任务");
            return;
        }
        setPendingStopping(true);
        try {
            await Promise.all(taskIds.map((taskId) => cancelAiTask(taskId).catch((error) => console.error("停止生成任务失败", error))));
            await refreshConversations();
        } finally {
            setPendingStopping(false);
        }
    };

    useEffect(() => {
        if (!sessionId || sessionId === activeIdRef.current) return;
        activeIdRef.current = sessionId;
        setActiveId(sessionId);
    }, [sessionId]);

    useEffect(() => {
        let cancelled = false;
        void refreshConversations().then(() => {
            if (cancelled || !canChangeSession()) return;
            activeIdRef.current = null;
            setActiveId(null);
        });
        return () => {
            cancelled = true;
        };
    }, [canChangeSession, refreshConversations]);

    useEffect(() => {
        if (!hasRunningGeneration(conversations)) return;
        let cancelled = false;
        let refreshTimer: number | undefined;
        void getAiTaskPollingIntervalMilliseconds()
            .then((intervalMilliseconds) => {
                if (cancelled) return;
                refreshTimer = window.setInterval(() => {
                    void refreshConversations();
                }, intervalMilliseconds);
            })
            .catch((error) => console.error("读取AI任务轮询配置失败", error));
        return () => {
            cancelled = true;
            if (refreshTimer !== undefined) window.clearInterval(refreshTimer);
        };
    }, [conversations, refreshConversations]);

    const addReferences = async (files?: FileList | File[] | null): Promise<{ images: ReferenceImage[]; videos: ReferenceVideo[] }> => {
        try {
            const selectedFiles = Array.from(files || []);
            const unsupportedFiles = selectedFiles.filter((file) => !file.type.startsWith("image/") && !file.type.startsWith("video/"));
            if (unsupportedFiles.length) {
                message.warning("已忽略不支持的参考素材");
            }

            const imageFiles = selectedFiles.filter((file) => file.type.startsWith("image/") && file.size <= SEEDANCE_REFERENCE_LIMITS.imageMaxBytes).slice(0, SEEDANCE_REFERENCE_LIMITS.images - references.length);
            const videoFiles = selectedFiles.filter((file) => file.type.startsWith("video/") && file.size <= SEEDANCE_REFERENCE_LIMITS.videoMaxBytes).slice(0, SEEDANCE_REFERENCE_LIMITS.videos - videoReferences.length);
            if (selectedFiles.some((file) => file.type.startsWith("image/") && file.size > SEEDANCE_REFERENCE_LIMITS.imageMaxBytes)) {
                message.warning("已忽略超过 30MB 的参考图");
            }
            if (selectedFiles.some((file) => file.type.startsWith("video/") && file.size > SEEDANCE_REFERENCE_LIMITS.videoMaxBytes)) {
                message.warning("已忽略超过 50MB 的参考视频");
            }

            const imagePlaceholders = imageFiles.map((file) => ({
                id: nanoid(),
                name: file.name,
                type: file.type,
                dataUrl: URL.createObjectURL(file),
            }));
            const videoPlaceholders = videoFiles.map((file) => ({
                id: nanoid(),
                name: file.name,
                type: file.type,
                url: URL.createObjectURL(file),
            }));
            const placeholders = [...imagePlaceholders, ...videoPlaceholders];
            if (!placeholders.length) {
                return { images: [], videos: [] };
            }
            setReferences((current) => [...current, ...imagePlaceholders].slice(0, SEEDANCE_REFERENCE_LIMITS.images));
            setVideoReferences((current) => [...current, ...videoPlaceholders].slice(0, SEEDANCE_REFERENCE_LIMITS.videos));
            autoSwitchModeForReferences(imageFiles.length, videoFiles.length);
            setUploadingReferenceIds((current) => [...current, ...placeholders.map((placeholder) => placeholder.id)]);

            const uploadedImages: ReferenceImage[] = [];
            const uploadedVideos: ReferenceVideo[] = [];
            await Promise.all([
                ...imagePlaceholders.map(async (placeholder, index) => {
                    const file = imageFiles[index];
                    try {
                        const image = await uploadImage(file);
                        recordRecentReferenceImage(image.objectStorage?.url);
                        const uploadedReference: ReferenceImage = {
                            ...placeholder,
                            type: image.mimeType,
                            dataUrl: image.url,
                            storageKey: image.storageKey,
                            objectStorage: image.objectStorage,
                        };
                        uploadedImages.push(uploadedReference);
                        setReferences((current) => current.map((reference) => (reference.id === placeholder.id ? uploadedReference : reference)));
                    } catch (error) {
                        setReferences((current) => current.filter((reference) => reference.id !== placeholder.id));
                        message.error(error instanceof Error ? error.message : `上传参考图 ${placeholder.name} 失败`);
                    } finally {
                        URL.revokeObjectURL(placeholder.dataUrl);
                        setUploadingReferenceIds((current) => current.filter((id) => id !== placeholder.id));
                    }
                }),
                ...videoPlaceholders.map(async (placeholder, index) => {
                    const file = videoFiles[index];
                    try {
                        const video = await uploadMediaFile(file, "video-reference");
                        const uploadedReference: ReferenceVideo = {
                            ...placeholder,
                            type: video.mimeType,
                            url: video.url,
                            storageKey: video.storageKey,
                            bytes: video.bytes,
                            width: video.width,
                            height: video.height,
                            durationMs: video.durationMs,
                            objectStorage: video.objectStorage,
                        };
                        uploadedVideos.push(uploadedReference);
                        setVideoReferences((current) => current.map((reference) => (reference.id === placeholder.id ? uploadedReference : reference)));
                    } catch (error) {
                        setVideoReferences((current) => current.filter((reference) => reference.id !== placeholder.id));
                        message.error(error instanceof Error ? error.message : `上传参考视频 ${placeholder.name} 失败`);
                    } finally {
                        URL.revokeObjectURL(placeholder.url);
                        setUploadingReferenceIds((current) => current.filter((id) => id !== placeholder.id));
                    }
                }),
            ]);
            return { images: uploadedImages, videos: uploadedVideos };
        } catch (error) {
            message.error(error instanceof Error ? error.message : "上传参考素材失败");
            return { images: [], videos: [] };
        }
    };

    const generate = async () => {
        if (isStreaming || isQueued) return;
        const text = prompt.trim();
        if (!text) {
            message.error("请输入视频提示词");
            return;
        }

        resetThinkings();

        const videoModel = effectiveConfig.videoModel || effectiveConfig.model || model;
        const size = config.size || "16:9";
        const seconds = config.videoSeconds || "5";
        const quality = config.vquality || "720p";
        const watermark = config.videoWatermark ?? true;
        pendingVideoSizeRef.current = size;
        const currentAttachments = [...imageReferenceAttachments(references), ...videoReferenceAttachments(videoReferences)];
        const previousAttachments = [...imageReferenceAttachments(latestRound?.references || []), ...videoReferenceAttachments(latestRound?.videoReferences || [])];
        const allRefs = selectGenerationAttachments(text, currentAttachments, previousAttachments);
        const selectedVideoQuote = quoteVideoGeneration({
            config: effectiveConfig,
            model: videoModel,
            mode: config.videoGenerationMode,
            resolution: quality,
            seconds,
            imageReferenceCount: allRefs.filter((reference) => reference.type.startsWith("image/")).length,
            videoReferenceCount: allRefs.filter((reference) => reference.type.startsWith("video/")).length,
        });
        // 无技能时每次提交都是真实视频生成；选择技能后仅在即将创建生成任务的确认阶段校验报价与余额。
        const shouldValidateQuote = !selectedSkill?.workflowType || workflowChargingNext || workflowImageConfirmNext;
        if (shouldValidateQuote) {
            // 每次确认生成都必须先显式选择图片模型与参数
            if (workflowChargingNext && !workflowImageSelectionComplete) {
                message.warning("请先选择本次生成使用的图片模型与参数");
                return;
            }
            // 图片确认轮：先确认视频参数，再校验视频阶段报价与余额（图片已生成）
            if (workflowImageConfirmNext) {
                if (!workflowVideoSelectionComplete) {
                    message.warning("请先确认视频比例、清晰度和时长");
                    return;
                }
                const videoQuote = workflowVideoStageQuote;
                if (!videoQuote || videoQuote.credits == null) {
                    message.error("视频工作流报价尚未完成，请稍候重试");
                    return;
                }
                if (serverWorkflowQuote && !serverWorkflowQuote.available) {
                    message.error(serverWorkflowQuote.reason || "视频工作流报价不可用");
                    return;
                }
                if (typeof videoQuote.credits === "number" && typeof creditBalance === "number" && videoQuote.credits > creditBalance) {
                    message.error(`积分不足，生成视频需要 ${videoQuote.credits} 积分，当前可用 ${creditBalance} 积分`);
                    return;
                }
            } else {
                const selectedQuote = selectedSkill?.workflowType ? serverWorkflowQuote : selectedVideoQuote;
                if (!selectedQuote) {
                    message.error("工作流报价尚未完成");
                    return;
                }
                if (!selectedQuote.available) {
                    message.error(selectedQuote.reason);
                    return;
                }
                if (selectedSkill?.workflowType && typeof creditCost === "number" && typeof creditBalance === "number" && creditCost > creditBalance) {
                    message.error(`积分不足，本次工作流需要 ${creditCost} 积分，当前可用 ${creditBalance} 积分`);
                    return;
                }
            }
        }
        const attachments = buildChatAttachments(allRefs);

        setChatMessages((prev) => {
            const next = [...prev, { id: nanoid(), role: "user" as const, text, attachments, generationStyles: selectedStyles, skill: selectedSkill }];
            chatMessagesRef.current = next;
            return next;
        });

        await sendMessage(text, allRefs.length ? allRefs : undefined, {
            model: videoModel,
            imageModel: workflowImageModel,
            imageSize: workflowImageSize,
            imageResolution: workflowImageResolution,
            imageQuality: workflowImageQuality,
            size: workflowImageConfirmNext ? workflowVideoSize : size,
            resolution: workflowImageConfirmNext ? workflowVideoResolution : quality,
            quality: workflowImageConfirmNext ? (workflowVideoResolution.includes("1080") ? "high" : workflowVideoResolution.includes("480") ? "low" : "medium") : quality.includes("1080") ? "high" : quality.includes("480") ? "low" : "medium",
            seconds: workflowImageConfirmNext ? workflowVideoSeconds : seconds,
            watermark: String(watermark).toLowerCase() === "true",
            videoGenerationMode: config.videoGenerationMode,
            ...(selectedStyles.length ? { generationStyleIds: selectedStyles.map((style) => style.id) } : {}),
        });

        setPrompt("");
        setReferences([]);
        setVideoReferences([]);
        setSelectedStyles([]);
    };

    const handleActionReply = async (value: string) => {
        if (isStreaming || isQueued) return;
        const text = value.trim();
        if (!text) return;
        // 点击"确认生成"即真实扣费：报价不可用或余额不足时拦截；调整提示词等其余选项免费
        if (workflowChargingNext && text === "确认生成") {
            if (!workflowImageSelectionComplete) {
                message.warning("请先选择本次生成使用的图片模型与参数");
                return;
            }
            if (serverWorkflowQuote && !serverWorkflowQuote.available) {
                message.error(serverWorkflowQuote.reason);
                return;
            }
            if (typeof creditCost === "number" && typeof creditBalance === "number" && creditCost > creditBalance) {
                message.error(`积分不足，本次工作流需要 ${creditCost} 积分，当前可用 ${creditBalance} 积分`);
                return;
            }
        }
        // 图片确认轮点击"用这些图片生成视频"即真实扣费：先确认视频参数，再校验视频阶段报价与余额；"修改提示词重新生成"免费
        if (workflowImageConfirmNext && text === "用这些图片生成视频") {
            if (!workflowVideoSelectionComplete) {
                message.warning("请先确认视频比例、清晰度和时长");
                return;
            }
            const videoQuote = workflowVideoStageQuote;
            if (!videoQuote || videoQuote.credits == null) {
                message.error("视频工作流报价尚未完成，请稍候重试");
                return;
            }
            if (serverWorkflowQuote && !serverWorkflowQuote.available) {
                message.error(serverWorkflowQuote.reason || "视频工作流报价不可用");
                return;
            }
            const videoCost = videoQuote.credits;
            if (typeof videoCost === "number" && typeof creditBalance === "number" && videoCost > creditBalance) {
                message.error(`积分不足，生成视频需要 ${videoCost} 积分，当前可用 ${creditBalance} 积分`);
                return;
            }
        }
        // 技能引导中选择生成比例时同步页面尺寸配置，保证最终生成任务按用户选择的比例（而非页面默认值）
        if (/^\d+:\d+$/.test(text)) {
            updateConfig("size", text);
        }
        setChatMessages((prev) => {
            const next = [...prev, { id: nanoid(), role: "user" as const, text, skill: selectedSkill }];
            chatMessagesRef.current = next;
            return next;
        });
        // 携带当前参考素材附件：技能引导中用户上传的图片/视频需随确认消息送达，作为最终生成参考
        const currentAttachments = [...imageReferenceAttachments(references), ...videoReferenceAttachments(videoReferences)];
        // 图片确认轮确认生成视频时，携带用户确认的视频参数（比例/清晰度/时长）覆盖页面默认值
        const settingsOverride =
            workflowImageConfirmNext && text === "用这些图片生成视频"
                ? {
                      model,
                      imageModel: workflowImageModel,
                      imageSize: workflowImageSize,
                      imageResolution: workflowImageResolution,
                      imageQuality: workflowImageQuality,
                      size: workflowVideoSize,
                      resolution: workflowVideoResolution,
                      quality: workflowVideoResolution.includes("1080") ? "high" : workflowVideoResolution.includes("480") ? "low" : "medium",
                      seconds: workflowVideoSeconds,
                      watermark: String(config.videoWatermark).toLowerCase() === "true",
                      videoGenerationMode: config.videoGenerationMode,
                  }
                : undefined;
        if (workflowImageConfirmNext && text === "用这些图片生成视频") {
            // 同步 tool 消息展示用的比例（否则生成中的占位卡片会显示页面默认比例）
            pendingVideoSizeRef.current = workflowVideoSize;
        }
        await sendMessage(text, currentAttachments.length ? currentAttachments : undefined, settingsOverride);
    };

    const handlePromptEdit = (value: string, assistantText?: string, draftedPrompts?: Record<string, string>) => {
        const drafts = parseWorkflowDraftPrompts(assistantText, draftedPrompts);
        const hasThree = Boolean(drafts.firstFrame || drafts.lastFrame || drafts.video);
        setPromptEditMode(hasThree ? "three" : "single");
        setPromptEditValue(drafts);
        setPromptEditDialogOpen(true);
    };

    const submitPromptEdit = () => {
        const values = promptEditValue;
        if (promptEditMode === "three") {
            if (![values.firstFrame, values.lastFrame, values.video].some((item) => item.trim())) {
                message.warning("请至少填写一段提示词");
                return;
            }
            setPromptEditDialogOpen(false);
            void handleActionReply(`请按以下修改后的提示词重新生成：\n首帧提示词：${values.firstFrame.trim()}\n尾帧提示词：${values.lastFrame.trim()}\n视频提示词：${values.video.trim()}`);
            return;
        }
        if (!values.video.trim()) {
            message.warning("请输入修改后的提示词");
            return;
        }
        setPromptEditDialogOpen(false);
        void handleActionReply(values.video.trim());
    };

    /** 技能引导中"上传图片"按钮选择文件后：上传参考素材并在对话区回显，随后自动发送带附件的消息。 */
    const handleUploadFromChoice = async (files?: FileList | null) => {
        if (!files?.length) return;
        const { images, videos } = await addReferences(files);
        const attachments = [...imageReferenceAttachments(images), ...videoReferenceAttachments(videos)];
        if (!attachments.length || isStreaming || isQueued) return;
        const videoModel = effectiveConfig.videoModel || effectiveConfig.model || model;
        const size = config.size || "16:9";
        const seconds = config.videoSeconds || "5";
        const quality = config.vquality || "720p";
        const watermark = config.videoWatermark ?? true;
        const text = "已上传产品图片";
        const selectedVideoQuote = quoteVideoGeneration({
            config: effectiveConfig,
            model: videoModel,
            mode: config.videoGenerationMode,
            resolution: quality,
            seconds,
            imageReferenceCount: attachments.filter((reference) => reference.type.startsWith("image/")).length,
            videoReferenceCount: attachments.filter((reference) => reference.type.startsWith("video/")).length,
        });
        if (!selectedVideoQuote.available) {
            message.error(selectedVideoQuote.reason);
            return;
        }
        setChatMessages((prev) => {
            const next = [...prev, { id: nanoid(), role: "user" as const, text, attachments: buildChatAttachments(attachments), skill: selectedSkill }];
            chatMessagesRef.current = next;
            return next;
        });
        await sendMessage(text, attachments.length ? attachments : undefined, {
            model: videoModel,
            imageModel: workflowImageModel,
            imageSize: workflowImageSize,
            imageResolution: workflowImageResolution,
            imageQuality: workflowImageQuality,
            size,
            resolution: quality,
            quality: quality.includes("1080") ? "high" : quality.includes("480") ? "low" : "medium",
            seconds,
            watermark: String(watermark).toLowerCase() === "true",
            videoGenerationMode: config.videoGenerationMode,
            ...(selectedStyles.length ? { generationStyleIds: selectedStyles.map((style) => style.id) } : {}),
        });
    };

    const regenerateRound = async (round: Round) => {
        if (!canChangeSession()) return;
        const videoModel = round.config.videoModel || round.config.model || model;
        const size = round.config.size;
        const resolution = round.config.vquality;
        const attachments = [...imageReferenceAttachments(round.references), ...videoReferenceAttachments(round.videoReferences)];
        if (size) pendingVideoSizeRef.current = size;
        setChatMessages((prev) => {
            const next = [
                ...prev,
                {
                    id: nanoid(),
                    role: "user" as const,
                    text: round.prompt,
                    attachments: buildChatAttachments(attachments),
                    generationStyles: round.generationStyleSnapshots,
                    skill: round.skill,
                },
            ];
            chatMessagesRef.current = next;
            return next;
        });
        await sendMessage(
            round.prompt,
            attachments.length ? attachments : undefined,
            {
                model: videoModel,
                imageModel: round.config.imageModel || effectiveConfig.imageModel,
                ...(size ? { size } : {}),
                ...(resolution
                    ? {
                          resolution,
                          quality: resolution.includes("1080") ? "high" : resolution.includes("480") ? "low" : "medium",
                      }
                    : {}),
                ...(round.config.videoSeconds ? { seconds: round.config.videoSeconds } : {}),
                videoGenerationMode: round.config.videoGenerationMode || "text-to-video",
                ...(round.config.videoWatermark !== undefined && round.config.videoWatermark !== null ? { watermark: String(round.config.videoWatermark).toLowerCase() === "true" } : {}),
                ...(round.generationStyleSnapshots?.length ? { generationStyleSnapshots: round.generationStyleSnapshots } : {}),
            },
            round.skill ? String(round.skill.id) : undefined,
        );
        setSelectedStyles([]);
    };

    const newConversation = () => {
        if (!canChangeSession()) {
            message.warning("当前生成任务尚未结束，请先停止或等待完成");
            return;
        }
        setActiveId(null);
        activeIdRef.current = null;
        setVideoDraftSettingsModified(false);
        setPrompt("");
        setReferences([]);
        setVideoReferences([]);
        setSelectedStyles([]);
        setSelectedSkill(null);
        setSelectedIds([]);
        setManagementMode(false);
        setMobileSidebarOpen(false);
        setChatMessages([]);
        chatMessagesRef.current = [];
        resetThinkings();
        setToolCalls([]);
        toolCallsRef.current = [];
        setStreamingText(null);
        streamingTextRef.current = null;
        resetSession();
    };

    const selectConversation = (conversation: Conversation) => {
        if (!canChangeSession()) {
            message.warning("当前生成任务尚未结束，请先停止或等待完成");
            return;
        }
        if (getGenerationConversationStatus(conversation) !== "none" && conversation.generationStatus !== "running") {
            setConversations((current) => current.map((item) => (item.id === conversation.id ? { ...item, generationViewedAt: item.generationCompletedAt } : item)));
            void markGenerationLogViewed(conversation.id).catch(() => void refreshConversations());
        }
        setActiveId(conversation.id);
        activeIdRef.current = conversation.id;
        setVideoDraftSettingsModified(false);
        setChatMessages([]);
        chatMessagesRef.current = [];
        setToolCalls([]);
        toolCallsRef.current = [];
        resetThinkings();
        setStreamingText(null);
        streamingTextRef.current = null;
        setPrompt("");
        setReferences([]);
        setVideoReferences([]);
        setSelectedStyles([]);
        setSelectedSkill(null);
        setMobileSidebarOpen(false);
        restoreSession(conversation.id);
    };

    const toggleAll = () => {
        setSelectedIds(allSelected ? [] : conversations.map((item) => item.id));
    };

    const deleteSelected = () => {
        if (activeIdRef.current && selectedIds.includes(activeIdRef.current) && !canChangeSession()) {
            message.warning("当前生成任务尚未结束，请先停止或等待完成");
            return;
        }
        const mediaKeys = conversations.filter((conversation) => selectedIds.includes(conversation.id)).flatMap((conversation) => collectRoundMediaKeys(conversation.rounds));
        void Promise.all([deleteStoredMedia(mediaKeys), deleteGenerationLogs(selectedIds)]).then(refreshConversations);
        if (activeId && selectedIds.includes(activeId)) {
            setActiveId(null);
            activeIdRef.current = null;
            setVideoDraftSettingsModified(false);
            setPrompt("");
            setReferences([]);
            setVideoReferences([]);
            setSelectedStyles([]);
            setSelectedSkill(null);
            resetSession();
        }
        setSelectedIds([]);
        setManagementMode(false);
        setDeleteConfirmOpen(false);
    };

    const downloadVideo = async (video: GeneratedVideo) => {
        try {
            // 历史生成记录仅保存远程地址时，先登记为服务端媒体，确保下载仍由后端代理。
            const storageKey = video.storageKey || (await uploadMediaFile(video.url, "video", { mimeType: video.mimeType })).storageKey;
            await downloadMedia({ storageKey }, "video.mp4");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "视频下载失败");
        }
    };

    const openVideoResultDetail = (video: GeneratedVideo, round: Round) => {
        setResultDetail({
            media: { kind: "video", url: video.url, ossUrl: video.objectStorage?.url, width: video.width, height: video.height, bytes: video.bytes, durationMs: video.durationMs, mimeType: video.mimeType },
            prompt: round.prompt,
            generationPrompt: round.generationPrompt,
            references: round.references,
            videoReferences: round.videoReferences,
            onDownload: () => void downloadVideo(video),
        });
    };

    const saveResultToAssets = (video: GeneratedVideo) => {
        addAsset({
            kind: "video",
            title: "生成视频",
            coverUrl: "",
            tags: [],
            source: "视频创作台",
            data: {
                url: video.url,
                storageKey: video.storageKey,
                width: video.width,
                height: video.height,
                bytes: video.bytes,
                mimeType: video.mimeType,
                objectStorage: video.objectStorage,
            },
            metadata: {
                source: "video-page",
            },
        });
        message.success("已加入我的资产");
    };

    const uploadResultToObjectStorage = async (video: GeneratedVideo) => {
        if (video.objectStorage?.url) {
            try {
                await navigator.clipboard.writeText(video.objectStorage.url);
                message.success("云储存地址已复制");
            } catch {
                message.error("云储存地址复制失败");
            }
            return;
        }

        setUploadingObjectStorageId(video.id);
        try {
            const file = await uploadRemoteObjectToStorage({
                storageKey: video.storageKey,
                sourceUrl: video.url,
                kind: "video",
                mimeType: video.mimeType,
            });
            setConversations((current) =>
                current.map((conversation) => ({
                    ...conversation,
                    rounds: conversation.rounds.map((round) => updateRoundVideoObjectStorage(round, video.id, file)),
                })),
            );
            message.success("已上传到云储存，地址已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "上传到云储存失败");
        } finally {
            setUploadingObjectStorageId("");
        }
    };

    const insertPickedAsset = (payload: InsertAssetPayload) => {
        if (payload.kind === "text") {
            setPrompt(payload.content);
        } else if (payload.kind === "image") {
            if (!payload.storageKey) {
                message.error("图片素材缺少媒体存储键，请重新上传后再使用");
            } else {
                setReferences((current) =>
                    [
                        ...current,
                        {
                            id: nanoid(),
                            name: payload.title,
                            type: payload.mimeType,
                            dataUrl: payload.dataUrl,
                            storageKey: payload.storageKey,
                            objectStorage: payload.objectStorage,
                        },
                    ].slice(0, SEEDANCE_REFERENCE_LIMITS.images),
                );
                autoSwitchModeForReferences(1, 0);
            }
        } else if (payload.kind === "video") {
            if (!hasPlayableVideoUrl(payload.url)) {
                message.error("视频素材地址为空，无法插入");
                return;
            }
            setVideoReferences((current) =>
                [
                    ...current,
                    {
                        id: nanoid(),
                        name: payload.title,
                        type: "video/mp4",
                        url: payload.url,
                        storageKey: payload.storageKey,
                        width: payload.width,
                        height: payload.height,
                        objectStorage: payload.objectStorage,
                    },
                ].slice(0, SEEDANCE_REFERENCE_LIMITS.videos),
            );
            autoSwitchModeForReferences(0, 1);
        }
        setAssetPickerOpen(false);
    };

    const renameConversationTitle = async (conversationId: string, title: string) => {
        await renameGenerationLogTitle(conversationId, title);
        setConversations((current) => {
            const nextConversations = current.map((conversation) => (conversation.id === conversationId ? { ...conversation, title } : conversation));
            conversationsRef.current = nextConversations;
            return nextConversations;
        });
    };

    const deleteConversation = async (conversationId: string) => {
        if (activeIdRef.current === conversationId && !canChangeSession()) {
            message.warning("当前生成任务尚未结束，请先停止或等待完成");
            return;
        }
        const conversation = conversationsRef.current.find((item) => item.id === conversationId);
        const mediaKeys = collectRoundMediaKeys(conversation?.rounds || []);
        await Promise.all([deleteStoredMedia(mediaKeys), deleteGenerationLogs([conversationId])]);
        if (activeIdRef.current === conversationId) {
            newConversation();
        }
        await refreshConversations();
    };

    const conversationItems = buildVideoConversationItems(conversations, activeId, selectedIds);
    const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
    const referenceChips: CreationReferenceChip[] = [
        ...references.map((reference, index) => {
            const uploading = uploadingReferenceIds.includes(reference.id);
            return {
                id: reference.id,
                label: uploading ? `${seedanceReferenceLabel("image", index)} 上传中` : seedanceReferenceLabel("image", index),
                preview: (
                    <div className="relative size-11">
                        <Image src={reference.dataUrl} alt={reference.name} width={44} height={44} style={{ objectFit: "cover" }} className="rounded-xl" preview={uploading ? false : { mask: "预览" }} />
                        {uploading ? (
                            <span className="absolute inset-0 grid place-items-center rounded-xl bg-black/35 text-white">
                                <LoaderCircle className="size-4 animate-spin" />
                            </span>
                        ) : null}
                    </div>
                ),
                onRemove: () => setReferences((current) => current.filter((item) => item.id !== reference.id)),
            };
        }),
        ...videoReferences
            .filter((reference) => hasPlayableVideoUrl(reference.url))
            .map((reference, index) => {
                const uploading = uploadingReferenceIds.includes(reference.id);
                return {
                    id: reference.id,
                    label: uploading ? `${seedanceReferenceLabel("video", index)} 上传中` : seedanceReferenceLabel("video", index),
                    preview: (
                        <div
                            className={`group relative size-11 ${uploading ? "" : "cursor-pointer"}`}
                            onClick={() => {
                                if (!uploading) setVideoPreviewUrl(reference.url);
                            }}
                        >
                            <video src={reference.url} className="size-11 rounded-xl object-cover" muted />
                            {uploading ? null : (
                                <span className="pointer-events-none absolute inset-0 grid place-items-center rounded-xl bg-black/0 text-white opacity-0 transition-opacity group-hover:bg-black/35 group-hover:opacity-100">
                                    <VideoIcon className="size-5" />
                                </span>
                            )}
                            {uploading ? (
                                <span className="absolute inset-0 grid place-items-center rounded-xl bg-black/35 text-white">
                                    <LoaderCircle className="size-4 animate-spin" />
                                </span>
                            ) : null}
                        </div>
                    ),
                    onRemove: () => setVideoReferences((current) => current.filter((item) => item.id !== reference.id)),
                };
            }),
    ];
    const addRecentReference = (url: string) => {
        if (references.length >= SEEDANCE_REFERENCE_LIMITS.images) {
            message.warning(`最多可添加 ${SEEDANCE_REFERENCE_LIMITS.images} 张参考图`);
            return;
        }
        setReferences((current) => {
            if (current.some((reference) => reference.dataUrl === url)) return current;
            return [...current, { id: nanoid(), name: "最近上传的参考图", type: "image/*", dataUrl: url }];
        });
        autoSwitchModeForReferences(1, 0);
    };
    const composerActions: CreationComposerAction[] = [
        {
            key: "upload",
            label: "素材",
            icon: <Upload className="size-3.5" />,
            popoverContent: <RecentReferenceImagePicker urls={recentReferenceImageUrls} selectedUrls={references.map((reference) => reference.dataUrl)} disabled={references.length >= SEEDANCE_REFERENCE_LIMITS.images} onSelect={addRecentReference} />,
            onClick: () => fileInputRef.current?.click(),
        },
        {
            key: "prompt-library",
            label: "提示词库",
            icon: <BookOpen className="size-3.5" />,
            onClick: () => setPromptDialogOpen(true),
        },
        {
            key: "optimize-prompt",
            label: "AI优化提示词",
            icon: <Sparkles className="size-3.5" />,
            placement: "submit",
            iconOnly: true,
            disabled: !prompt.trim() || isStreaming || isQueued || activeConversationPending || isPromptOptimizing,
            loading: isPromptOptimizing,
            onClick: () => void optimizePrompt({ operationId: "video-page", generationType: "video", prompt, generationStyleIds: selectedStyles.map((style) => style.id), onSuccess: setPrompt }),
        },
        {
            key: "assets",
            label: "资产库",
            icon: <FolderPlus className="size-3.5" />,
            onClick: () => setAssetPickerOpen(true),
        },
        {
            key: "settings",
            label: settingsSummary || "更多设置",
            className: settingsSummary ? "creation-composer-action-settings" : undefined,
            icon: <Cog className="size-3.5" />,
            onClick: () => setSettingsOpen(true),
        },
    ];
    // 工作流草案确认卡片：草案轮要求用户确认图片模型与参数，未显式选择时回退有效配置默认值。
    // 设置项与图片生成页"更多设置"保持一致（画质/清晰度/比例 + 模型），卡片作为消息内联在草案轮下方展示。
    const workflowImageSettingsNode = workflowChargingNext ? (
        <div className="space-y-4 rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel)] p-3">
            <div className="text-sm font-semibold text-[var(--studio-ink)]">图片生成设置</div>
            <p className="text-xs leading-relaxed text-[var(--studio-muted)]">请为本次生成选择画质、清晰度、比例和模型，选择后才能确认生成。</p>
            <ImageSettingsPanel
                config={{ ...effectiveConfig, size: workflowImageSize, quality: workflowImageQuality, imageResolution: workflowImageResolution }}
                onConfigChange={handleWorkflowImageSettingChange}
                theme={theme}
                showTitle={false}
                showCount={false}
                className="space-y-4 px-0 py-0"
            />
            <div>
                <label className="mb-1.5 block text-sm font-semibold text-[var(--studio-ink)]">模型</label>
                <ModelPicker
                    config={effectiveConfig}
                    value={workflowImageModel}
                    onChange={(value) => updateWorkflowImageSelection({ imageModel: value })}
                    capability="image"
                    fullWidth
                    onMissingConfig={() => (userRole === "admin" ? openConfigDialog(false) : message.error("请联系管理员配置默认生图模型"))}
                />
            </div>
        </div>
    ) : null;
    // 工作流图片确认轮的视频参数卡片：确认生成视频前要求用户确认比例/清晰度/时长，未显式选择时回退有效配置默认值。
    // 设置项与视频设置面板保持一致（比例/清晰度/时长），卡片作为消息内联在图片确认轮下方展示。
    const workflowVideoSettingsNode = workflowImageConfirmNext ? (
        <div className="space-y-4 rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel)] p-3">
            <div className="text-sm font-semibold text-[var(--studio-ink)]">视频生成设置</div>
            <p className="text-xs leading-relaxed text-[var(--studio-muted)]">请为本次生成确认视频比例、清晰度和时长，确认后生成视频。</p>
            <VideoSettingsPanel
                config={{ ...effectiveConfig, size: workflowVideoSize, vquality: workflowVideoResolution, videoSeconds: workflowVideoSeconds }}
                onConfigChange={handleWorkflowVideoSettingChange}
                theme={theme}
                showTitle={false}
                showGenerationMode={false}
                showDuration
                className="space-y-4 px-0 py-0"
            />
        </div>
    ) : null;
    // 工作流草案待确认且图片参数未选完时，聊天区"确认生成"按钮置灰并提示；选完参数后恢复可点。
    // 图片确认轮要求先确认视频参数（比例/清晰度/时长），再校验视频报价与余额。
    const workflowConfirmDisabledReasons =
        workflowChargingNext && !workflowImageSelectionComplete
            ? { 确认生成: "请先选择图片模型与参数" }
            : workflowImageConfirmNext
              ? (() => {
                    if (!workflowVideoSelectionComplete) return { 用这些图片生成视频: "请先确认视频比例、清晰度和时长" };
                    const videoQuote = workflowVideoStageQuote;
                    if (!videoQuote || videoQuote.credits == null) return { 用这些图片生成视频: "正在获取视频报价" };
                    if (serverWorkflowQuote && !serverWorkflowQuote.available) return { 用这些图片生成视频: serverWorkflowQuote.reason || "视频工作流报价不可用" };
                    if (typeof videoQuote.credits === "number" && typeof creditBalance === "number" && videoQuote.credits > creditBalance) {
                        return { 用这些图片生成视频: `积分不足，生成视频需要 ${videoQuote.credits} 积分` };
                    }
                    return undefined;
                })()
              : undefined;
    // 仅把设置卡片内联到当前活跃草案轮（最后一条带"确认生成"choice 的助手消息）所在轮次，历史草案轮不重复展示。
    const draftChoiceUserRoundId = (() => {
        const draft = liveDraftChoiceRound;
        if (!draft) return null;
        const index = chatMessages.findIndex((message) => message.id === draft.id);
        for (let cursor = index - 1; cursor >= 0; cursor--) {
            if (chatMessages[cursor].role === "user") return chatMessages[cursor].id;
        }
        return null;
    })();
    // 仅把视频参数卡片内联到当前活跃图片确认轮（最后一条带"用这些图片生成视频"choice 的助手消息）所在轮次。
    const imageConfirmUserRoundId = (() => {
        const confirm = liveImageConfirmChoiceRound;
        if (!confirm) return null;
        const index = chatMessages.findIndex((message) => message.id === confirm.id);
        for (let cursor = index - 1; cursor >= 0; cursor--) {
            if (chatMessages[cursor].role === "user") return chatMessages[cursor].id;
        }
        return null;
    })();
    const chatThreadSection = buildChatThreadSection(
        chatMessages,
        completedThinkings,
        activeThinking,
        streamingText,
        toolCalls,
        (data, round, call) => {
            const roundReferences = splitChatAttachments(round?.attachments);
            const workflowReferences = workflowResultImageReferences(data);
            const imageNodes = renderLiveWorkflowImages(data, call);
            if (imageNodes) return imageNodes;
            return renderResultVideos(data, {
                onDownload: downloadVideo,
                onSaveAsset: saveResultToAssets,
                onUploadObjectStorage: uploadResultToObjectStorage,
                onOpenDetail: (video) =>
                    setResultDetail({
                        media: { kind: "video", url: video.url, ossUrl: video.objectStorage?.url, width: video.width, height: video.height, bytes: video.bytes, durationMs: video.durationMs, mimeType: video.mimeType },
                        prompt: round?.userText || prompt,
                        references: workflowReferences.length ? workflowReferences : roundReferences.images.length ? roundReferences.images : references,
                        videoReferences: roundReferences.videos.length ? roundReferences.videos : videoReferences,
                        onDownload: () => void downloadVideo(video),
                    }),
            });
        },
        // 执行中占位动画：图片工具与图片生成页面同款动画卡片（首尾帧工作流图片阶段），视频工具走视频动画卡片
        (call) => renderPendingImageToolCall(call) ?? renderPendingVideoToolCall(call),
        workflowConfirmDisabledReasons,
        (roundId) => {
            if (draftChoiceUserRoundId && roundId === draftChoiceUserRoundId) return workflowImageSettingsNode;
            if (imageConfirmUserRoundId && roundId === imageConfirmUserRoundId) return workflowVideoSettingsNode;
            return null;
        },
    );
    // 聊天区已实时渲染的生成轮次不再进入历史区，避免同一轮重复展示；纯文本对话保留在聊天区。
    // 当前会话激活时（chatMessages 非空），已落库的纯对话轮次也在聊天区渲染过，历史区一并跳过；
    // 刷新或切换会话后 chatMessages 清空，历史区恢复完整展示（含纯对话轮次）。
    const liveRoundIds = new Set(chatMessages.filter((item) => item.role === "tool").map((item) => item.id));
    const hideDialogueRounds = chatMessages.length > 0;
    const displayedConversation =
        activeConversation && (liveRoundIds.size || hideDialogueRounds)
            ? {
                  ...activeConversation,
                  rounds: activeConversation.rounds.filter((round) => {
                      if (liveRoundIds.has(round.id)) return false;
                      return !(hideDialogueRounds && !round.result && !round.stages?.length);
                  }),
              }
            : activeConversation;
    const threadSections = displayedConversation
        ? buildVideoThreadSections(displayedConversation, liveRoundIds, {
              uploadingObjectStorageId,
              onDownload: downloadVideo,
              onSaveAsset: saveResultToAssets,
              onUploadObjectStorage: uploadResultToObjectStorage,
              onOpenDetail: openVideoResultDetail,
              onRegenerate: regenerateRound,
          })
        : [];
    // 历史记录与当前生成中消息同时展示，避免续写时把已保存历史临时隐藏。
    const allThreadSections = chatThreadSection ? [...threadSections, chatThreadSection] : threadSections;

    return (
        <>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/mp4,video/quicktime"
                multiple
                className="hidden"
                onChange={(event) => {
                    void addReferences(event.target.files);
                    event.target.value = "";
                }}
            />
            <input
                ref={uploadChoiceInputRef}
                type="file"
                accept="image/*,video/mp4,video/quicktime"
                multiple
                className="hidden"
                onChange={(event) => {
                    void handleUploadFromChoice(event.target.files);
                    event.target.value = "";
                }}
            />

            <CreationWorkspace
                sidebar={{
                    heading: "开启创作",
                    items: conversationItems,
                    managementMode,
                    hasSelection: selectedIds.length > 0,
                    mobileOpen: mobileSidebarOpen,
                    onOpenMobile: () => setMobileSidebarOpen(true),
                    onCloseMobile: () => setMobileSidebarOpen(false),
                    onCreate: newConversation,
                    onToggleManagement: () => setManagementMode((current) => !current),
                    onToggleSelectAll: toggleAll,
                    onDeleteSelected: () => setDeleteConfirmOpen(true),
                    onSelectConversation: (conversationId) => {
                        const conversation = conversations.find((item) => item.id === conversationId);
                        if (conversation) {
                            selectConversation(conversation);
                        }
                    },
                    onToggleConversation: (conversationId, checked) => setSelectedIds((current) => (checked ? Array.from(new Set([...current, conversationId])) : current.filter((item) => item !== conversationId))),
                    onRenameConversation: renameConversationTitle,
                    onDeleteConversation: deleteConversation,
                }}
                thread={{
                    sections: allThreadSections,
                    onActionReply: (value) => void handleActionReply(value),
                    onPromptEdit: handlePromptEdit,
                    onUploadImage: () => {
                        // 与页面"添加参考图"同一上传链路；上传完成后自动发送带附件消息，对话区回显图片
                        uploadChoiceInputRef.current?.click();
                    },
                    emptyState: (
                        <div className="flex h-full flex-col justify-center pb-28 pt-12">
                            <div className="relative mx-auto w-full max-w-5xl px-6 sm:px-10 lg:-left-4 lg:px-3">
                                <div className="relative -top-[10%] max-w-2xl">
                                    <div className="mb-5 flex items-center gap-2.5 text-[11px] font-semibold uppercase text-[var(--studio-action)]">
                                        <span className="text-[var(--studio-faint)]">01</span>
                                        Video Generation Workspace
                                    </div>
                                    <h2 className="text-[clamp(52px,8vw,108px)] font-black uppercase leading-[0.82] text-[var(--studio-ink)]">
                                        Video
                                        <br />
                                        <span className="text-transparent [-webkit-text-stroke:1px_var(--studio-ink)]">Agent</span>
                                    </h2>
                                    <p className="mt-7 max-w-lg text-base leading-7 text-[var(--studio-text)]">从一个提示词开始组织镜头运动、主体动作与场景氛围。生成结果会按轮次保留在这里，便于继续比较与细化。</p>
                                </div>
                            </div>
                        </div>
                    ),
                }}
                composer={{
                    agentLabel: "Video Agent",
                    value: prompt,
                    placeholder: "描述镜头运动、主体动作、场景氛围和画面风格...",
                    references: referenceChips,
                    styleOptions,
                    selectedStyles,
                    styleLoading,
                    styleError,
                    skillOptions,
                    selectedSkill,
                    skillLoading,
                    skillError,
                    actions: composerActions,
                    running: isStreaming || activeConversationPending,
                    queued: isQueued,
                    canSubmit: canGenerate,
                    stopping: isStopping || pendingStopping,
                    focusWhenValueSet: focusInitialPrompt,
                    creditCost,
                    onChange: setPrompt,
                    onStyleSelect: (style) => setSelectedStyles([style]),
                    onStyleRemove: (styleId) => setSelectedStyles((current) => current.filter((style) => style.id !== styleId)),
                    onSkillSelect: (skill) => setSelectedSkill(skill),
                    onSkillRemove: () => setSelectedSkill(null),
                    onPasteImages: (files) => void addReferences(files),
                    onSubmit: () => void generate(),
                    onStop: isStreaming || isQueued ? () => void cancelMessage() : activeConversationPending ? () => void stopPendingGeneration() : undefined,
                }}
                settings={{
                    open: settingsOpen,
                    title: "视频设置",
                    onClose: () => setSettingsOpen(false),
                    content: (
                        <div className="space-y-4">
                            <VideoSettingsPanel config={config} onConfigChange={handleVideoSettingsChange} theme={theme} showTitle={false} className="space-y-4 px-0 py-0" />
                            {activeQuote !== null && (!activeQuote.available || (!selectedSkill?.workflowType && referenceIssue) || workflowBalanceInsufficient) ? (
                                <div className="flex items-start gap-1.5 text-xs leading-relaxed" style={{ color: theme.node.muted }}>
                                    <HelpCircle className="mt-px size-3.5 shrink-0" />
                                    <span>{workflowBalanceInsufficient ? `积分不足，本次工作流需要 ${creditCost} 积分，当前可用 ${creditBalance} 积分` : activeQuote.available ? referenceIssue : activeQuote.reason}</span>
                                </div>
                            ) : null}
                            {workflowChargingNext && serverWorkflowQuote?.available ? (
                                <div className="flex items-start gap-1.5 text-xs leading-relaxed" style={{ color: theme.node.muted }}>
                                    <HelpCircle className="mt-px size-3.5 shrink-0" />
                                    <span>工作流阶段报价：{serverWorkflowQuote.stages.map((stage) => `${stage.displayName} ${stage.credits} 积分`).join("，")}</span>
                                </div>
                            ) : null}
                            {workflowImageConfirmNext && workflowVideoStageQuote?.credits != null ? (
                                <div className="flex items-start gap-1.5 text-xs leading-relaxed" style={{ color: theme.node.muted }}>
                                    <HelpCircle className="mt-px size-3.5 shrink-0" />
                                    <span>
                                        生成视频报价：{workflowVideoStageQuote.displayName} {workflowVideoStageQuote.credits} 积分
                                    </span>
                                </div>
                            ) : null}
                            <div>
                                <label className="mb-1.5 block text-sm font-semibold text-[var(--studio-ink)]">模型</label>
                                <ModelPicker
                                    config={effectiveConfig}
                                    value={model}
                                    onChange={(value) => {
                                        if (value !== model) {
                                            setVideoDraftSettingsModified(true);
                                        }
                                        updateConfig("videoModel", value);
                                    }}
                                    capability="video"
                                    modelOptions={availableVideoModelsForMode(effectiveConfig, config.videoGenerationMode)}
                                    fullWidth
                                    onMissingConfig={() => (userRole === "admin" ? openConfigDialog(false) : message.error("请联系管理员配置默认生视频模型"))}
                                />
                            </div>
                        </div>
                    ),
                }}
            />

            <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setPrompt} />
            <Modal title="修改提示词重新生成" open={promptEditDialogOpen} onOk={submitPromptEdit} onCancel={() => setPromptEditDialogOpen(false)} okText="提交修改" cancelText="取消" destroyOnHidden>
                {promptEditMode === "three" ? (
                    <div className="space-y-4">
                        <div>
                            <label className="mb-1 block text-sm font-medium">首帧提示词</label>
                            <Input.TextArea rows={5} value={promptEditValue.firstFrame} onChange={(event) => setPromptEditValue((current) => ({ ...current, firstFrame: event.target.value }))} />
                        </div>
                        <div>
                            <label className="mb-1 block text-sm font-medium">尾帧提示词</label>
                            <Input.TextArea rows={5} value={promptEditValue.lastFrame} onChange={(event) => setPromptEditValue((current) => ({ ...current, lastFrame: event.target.value }))} />
                        </div>
                        <div>
                            <label className="mb-1 block text-sm font-medium">视频提示词</label>
                            <Input.TextArea rows={5} value={promptEditValue.video} onChange={(event) => setPromptEditValue((current) => ({ ...current, video: event.target.value }))} />
                        </div>
                    </div>
                ) : (
                    <Input.TextArea rows={6} autoFocus value={promptEditValue.video} onChange={(event) => setPromptEditValue((current) => ({ ...current, video: event.target.value }))} placeholder="输入修改后的提示词" />
                )}
            </Modal>
            <AssetPickerModal open={assetPickerOpen} defaultTab="my-assets" onInsert={(payload) => void insertPickedAsset(payload)} onClose={() => setAssetPickerOpen(false)} />
            <Modal title="删除对话" open={deleteConfirmOpen} onCancel={() => setDeleteConfirmOpen(false)} onOk={deleteSelected} okText="删除" okButtonProps={{ danger: true }} cancelText="取消">
                确定删除选中的 {selectedIds.length} 条对话吗？
            </Modal>
            <Modal open={Boolean(videoPreviewUrl)} title="参考视频预览" footer={null} onCancel={() => setVideoPreviewUrl(null)} width={720} centered destroyOnHidden>
                {videoPreviewUrl ? <video src={videoPreviewUrl} controls autoPlay className="max-h-[70vh] w-full rounded-xl bg-black" /> : null}
            </Modal>
            <ResultDetailDialog detail={resultDetail} onClose={() => setResultDetail(null)} />
        </>
    );
}

/** 聊天区该轮用户消息的参考附件按类型拆分为详情弹窗使用的图片/视频引用。 */
function splitChatAttachments(attachments: ChatAttachment[] | undefined): { images: ReferenceImage[]; videos: ReferenceVideo[] } {
    const images: ReferenceImage[] = [];
    const videos: ReferenceVideo[] = [];
    for (const attachment of attachments || []) {
        if (!attachment.url.trim()) continue;
        if (attachment.type?.startsWith("video/")) {
            videos.push({ id: attachment.id, name: attachment.name, type: attachment.type || "video/*", url: attachment.url });
        } else {
            images.push({ id: attachment.id, name: attachment.name, type: attachment.type || "image/*", dataUrl: attachment.url });
        }
    }
    return { images, videos };
}

/** 从视频工作流工具结果恢复实际提交给模型的首帧、尾帧引用。 */
function workflowResultImageReferences(data: Record<string, unknown>): ReferenceImage[] {
    const values = Array.isArray(data.workflowReferences) ? data.workflowReferences : [];
    return values.flatMap((value, index) => {
        if (!value || typeof value !== "object") return [];
        const reference = value as Record<string, unknown>;
        const dataUrl = typeof reference.url === "string" ? reference.url : "";
        const storageKey = typeof reference.storageKey === "string" ? reference.storageKey : "";
        if (!dataUrl && !storageKey) return [];
        const role = typeof reference.role === "string" ? reference.role : "";
        return [{
            id: typeof reference.id === "string" && reference.id ? reference.id : storageKey || `workflow-reference-${index}`,
            name: typeof reference.name === "string" && reference.name ? reference.name : frameRoleLabel(role) || `引用图片 ${index + 1}`,
            type: typeof reference.mimeType === "string" && reference.mimeType ? reference.mimeType : "image/*",
            dataUrl,
            ...(storageKey ? { storageKey } : {}),
        }];
    });
}

function parseWorkflowDraftPrompts(text?: string, draftedPrompts?: Record<string, string>): { firstFrame: string; lastFrame: string; video: string } {
    const structured = draftedPrompts || {};
    const structuredValues = {
        firstFrame: structured.first_frame || structured.firstFrame || structured.firstFramePrompt || "",
        lastFrame: structured.last_frame || structured.lastFrame || structured.lastFramePrompt || "",
        video: structured.video || structured.video_prompt || structured.videoPrompt || "",
    };
    if (structuredValues.firstFrame || structuredValues.lastFrame || structuredValues.video) return structuredValues;
    if (!text) return { firstFrame: "", lastFrame: "", video: "" };
    const read = (label: string, nextLabels: string[]) => {
        const labelPattern = `${label}\\*{0,2}`;
        const endingPattern = nextLabels.length ? `(?=\\n\\s*(?:${nextLabels.map((item) => `${item}\\*{0,2}`).join("|")})\\s*[：:]|$)` : "(?=$)";
        const match = text.match(new RegExp(`${labelPattern}\\s*[：:]\\s*([\\s\\S]*?)${endingPattern}`, "i"));
        return match?.[1]?.trim() || "";
    };
    return {
        firstFrame: read("首帧提示词", ["尾帧提示词", "视频提示词"]),
        lastFrame: read("尾帧提示词", ["视频提示词"]),
        video: read("视频提示词", []),
    };
}

/**
 * 从实时工作流工具结果中提取图片并渲染为可预览的图片网格。
 * 首尾帧工作流图片阶段的两个 generate_image 工具结果均为图片，需与视频结果区分渲染。
 * 服务端 AbstractTaskProfile.buildResult 在结果顶层写入 taskType（image/video），优先按它判定。
 *
 * @param data Record<string, unknown> 工具结果数据
 * @return React.ReactNode 图片网格；结果不含图片时返回 null（由视频渲染接管）
 */
function renderLiveWorkflowImages(data: Record<string, unknown>, call: ToolCallState): React.ReactNode {
    const dataTaskType = typeof data.taskType === "string" ? data.taskType.toLowerCase() : "";
    if (dataTaskType === "video") return null;
    const items = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];
    const images = items
        .map((item) => ({ item, url: typeof item.url === "string" ? item.url : "" }))
        .filter(({ item, url }) => {
            if (!url) return false;
            if (dataTaskType === "image") return true;
            const mimeType = typeof item.mimeType === "string" ? item.mimeType.toLowerCase() : "";
            const itemTaskType = typeof item.taskType === "string" ? item.taskType.toLowerCase() : "";
            if (itemTaskType === "video") return false;
            if (mimeType.startsWith("image/")) return true;
            if (mimeType.startsWith("video/")) return false;
            // 无 mimeType 时按常见图片扩展名兜底，避免将视频当图片渲染
            return /\.(png|jpe?g|webp|gif|bmp|avif)(\?|$)/i.test(url);
        });
    if (!images.length) return null;
    return (
        <div data-result-layout="compact" className="flex flex-wrap gap-3">
            {images.map(({ item, url }, index) => (
                <FrameImagePreview
                    key={(typeof item.id === "string" ? item.id : "") || (typeof item.storageKey === "string" ? item.storageKey : "") || `workflow-image-${index}`}
                    url={url}
                    role={readFrameRole(call, item)}
                />
            ))}
        </div>
    );
}

function readFrameRole(call: ToolCallState, item: Record<string, unknown>): string | undefined {
    const candidates = [item.role, call.arguments.taskRole, call.arguments.role, call.callId];
    return candidates.find((value): value is string => typeof value === "string" && ["first_frame", "last_frame", "first-frame", "last-frame"].includes(value))
        ?.replace("-", "_");
}

function frameRoleLabel(role?: string): string | undefined {
    if (role === "first_frame") return "首帧";
    if (role === "last_frame") return "尾帧";
    return undefined;
}

function FrameImagePreview({ url, role }: { url: string; role?: string }) {
    const label = frameRoleLabel(role);
    return (
        <div className="relative w-48 shrink-0 overflow-hidden rounded-xl border border-[var(--studio-line)] sm:w-56">
            {label ? <span className="absolute left-2 top-2 z-10 rounded-md bg-black/65 px-2 py-1 text-xs font-semibold text-white backdrop-blur-sm">{label}</span> : null}
            <Image src={url} alt={label || "工作流图片结果"} className="w-full object-cover" preview={{ mask: "查看大图" }} />
        </div>
    );
}

function renderResultVideos(
    data: Record<string, unknown>,
    callbacks: {
        onDownload: (video: GeneratedVideo) => void;
        onSaveAsset: (video: GeneratedVideo) => void;
        onUploadObjectStorage: (video: GeneratedVideo) => Promise<void>;
        onOpenDetail: (video: GeneratedVideo) => void;
    },
): React.ReactNode {
    // 从 items 数组提取视频数据，转换为 GeneratedVideo 复用 ResultCard
    const items = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];
    if (!items.length) return null;
    return React.createElement(
        "div",
        { className: "grid gap-3 xl:grid-cols-2" },
        ...items
            .map((item, i) => {
                const url = typeof item.url === "string" ? item.url : "";
                if (!url) return null;
                const video: GeneratedVideo = {
                    id: (typeof item.id === "string" ? item.id : "") || nanoid(),
                    url,
                    storageKey: readVideoStorageKey(item),
                    durationMs: typeof item.durationMs === "number" ? item.durationMs : 0,
                    width: typeof item.width === "number" ? item.width : 0,
                    height: typeof item.height === "number" ? item.height : 0,
                    bytes: typeof item.bytes === "number" ? item.bytes : 0,
                    mimeType: typeof item.mimeType === "string" ? item.mimeType : "video/mp4",
                };
                return React.createElement(ResultCard, {
                    key: i,
                    video,
                    uploadingObjectStorage: false,
                    onDownload: callbacks.onDownload,
                    onSaveAsset: callbacks.onSaveAsset,
                    onUploadObjectStorage: callbacks.onUploadObjectStorage,
                    onOpenDetail: callbacks.onOpenDetail,
                });
            })
            .filter(Boolean),
    );
}

/** 根据视频设置生成 composer 按钮摘要，历史配置缺字段时沿用面板默认值。 */
function buildVideoSettingsSummary(settings: Partial<Pick<AiConfig, "vquality" | "size" | "videoSeconds" | "model" | "videoModel">> & { resolution?: string; seconds?: string }, modelConfig: AiConfig, model: string): string {
    const summaryConfig: AiConfig = {
        ...modelConfig,
        model,
        videoModel: model,
        vquality: settings.vquality || settings.resolution || "720p",
        size: settings.size || "16:9",
        videoSeconds: settings.videoSeconds || settings.seconds || "5",
    };
    return formatVideoGenerationSettingsSummary({
        resolution: videoResolutionLabel(summaryConfig.vquality),
        ratio: videoSizeLabel(summaryConfig.size),
        duration: videoSecondsLabel(summaryConfig.videoSeconds, summaryConfig),
        model: modelOptionLabel(modelConfig, model),
    });
}

function buildVideoConversationItems(conversations: Conversation[], activeId: string | null, selectedIds: string[]): CreationConversationItem[] {
    return conversations.map((conversation) => {
        const latestVideo = findLatestPlayableVideo(conversation.rounds.flatMap((round) => workflowVideos(round).map((video) => ({ id: video.id, status: "success" as const, video }))));

        return {
            id: conversation.id,
            title: conversation.title,
            subtitle: `${formatConversationTime(conversation.updatedAt)} · ${conversation.rounds.length} 轮`,
            preview: latestVideo ? (
                <video src={latestVideo.url} muted className="size-10 rounded-xl object-cover" />
            ) : (
                <div className="grid size-10 place-items-center rounded-xl bg-[var(--studio-media)]">
                    <VideoIcon className="size-4 text-[var(--studio-muted)]" />
                </div>
            ),
            active: activeId === conversation.id,
            selected: selectedIds.includes(conversation.id),
            status: getGenerationConversationStatus(conversation),
        };
    });
}

function buildVideoThreadSections(
    activeConversation: Conversation,
    liveRoundIds: ReadonlySet<string>,
    handlers: {
        uploadingObjectStorageId: string;
        onDownload: (video: GeneratedVideo) => void;
        onSaveAsset: (video: GeneratedVideo) => void;
        onUploadObjectStorage: (video: GeneratedVideo) => void;
        onOpenDetail: (video: GeneratedVideo, round: Round) => void;
        onRegenerate: (round: Round) => Promise<void>;
    },
): CreationThreadSection[] {
    const sectionMap = new Map<string, CreationThreadSection["rounds"]>();

    for (const round of activeConversation.rounds) {
        if (liveRoundIds.has(round.id)) {
            continue;
        }
        const label = formatThreadSectionLabel(round.createdAt);
        const rounds = sectionMap.get(label) || [];
        rounds.push({
            id: round.id,
            userText: round.prompt,
            userCopyText: formatGenerationStyleMessage(round.prompt, round.generationStyleSnapshots),
            userAttachments:
                round.references.length || round.videoReferences.length || round.generationStyleSnapshots?.length || round.skill ? (
                    <div className="space-y-2">
                        {round.skill ? (
                            <div className="flex flex-wrap gap-2">
                                <span
                                    className="inline-flex max-w-52 items-center gap-1.5 rounded-full border border-[var(--studio-primary-line)] bg-[var(--studio-primary-soft)] px-2.5 py-1 text-xs font-medium text-[var(--studio-ink)]"
                                    title={`技能：${round.skill.name}`}
                                >
                                    <Sparkles className="size-3.5 shrink-0 text-[var(--studio-action)]" />
                                    <span className="truncate">{round.skill.name}</span>
                                </span>
                            </div>
                        ) : null}
                        {renderGenerationStyleSnapshots(round.generationStyleSnapshots)}
                        {renderVideoRoundReferences(round)}
                    </div>
                ) : undefined,
            statusText: buildVideoStatusText(round),
            assistantText: buildVideoAssistantText(round),
            draftedPrompts: round.draftedPrompts,
            activities: round.activities,
            actionBar: round.choices?.length ? <ChoiceHistoryBar choices={round.choices} /> : undefined,
            resultContent: (
                <div className="space-y-3">
                    {round.stages?.length ? (
                        renderWorkflowStages(round, handlers)
                    ) : getVideoDisplayResults(round).length ? (
                        <div className="grid gap-3 xl:grid-cols-2">
                            {getVideoDisplayResults(round).map((result) =>
                                result.status === "success" && result.video ? (
                                    <ResultCard
                                        key={result.id}
                                        video={result.video}
                                        uploadingObjectStorage={handlers.uploadingObjectStorageId === result.video.id}
                                        onDownload={handlers.onDownload}
                                        onSaveAsset={handlers.onSaveAsset}
                                        onUploadObjectStorage={handlers.onUploadObjectStorage}
                                        onOpenDetail={(video) => handlers.onOpenDetail(video, round)}
                                        onRegenerate={() => void handlers.onRegenerate(round)}
                                    />
                                ) : result.status === "failed" || result.status === "canceled" ? (
                                    <FailedCard key={result.id} error={result.error || "生成失败"} canceled={result.status === "canceled"} />
                                ) : (
                                    <VideoGeneratingCard key={result.id} size={round.config.size} progress={result.progress} />
                                ),
                            )}
                        </div>
                    ) : null}
                </div>
            ),
        });
        sectionMap.set(label, rounds);
    }

    return Array.from(sectionMap.entries()).map(([label, rounds], index) => ({
        id: `${activeConversation.id}-${index}`,
        label,
        rounds,
    }));
}

function renderVideoRoundReferences(round: Round) {
    const visibleImageReferences = round.references.filter((reference) => Boolean(reference.dataUrl?.trim()));
    const visibleVideoReferences = round.videoReferences.filter((reference) => Boolean(reference.url?.trim()));
    return (
        <div className="flex flex-wrap gap-2">
            {visibleImageReferences.map((reference, index) => (
                <Image key={reference.id} src={reference.dataUrl} alt={reference.name} title={seedanceReferenceLabel("image", index)} width={112} height={112} style={{ objectFit: "contain" }} className="rounded-xl" preview={{ mask: "查看大图" }} />
            ))}
            {visibleVideoReferences.map((reference, index) => (
                <video key={reference.id} src={reference.url} className="size-16 rounded-xl object-cover ring-1 ring-[var(--studio-line)]" muted title={seedanceReferenceLabel("video", index)} />
            ))}
        </div>
    );
}

function renderGenerationStyleSnapshots(snapshots?: GenerationStyleSnapshot[]) {
    if (!snapshots?.length) return null;
    return (
        <div className="flex flex-wrap gap-2">
            {snapshots.map((snapshot) => (
                <span
                    key={`generation-style-${snapshot.id}`}
                    title={snapshot.stylePrompt}
                    className="inline-flex max-w-52 items-center gap-1.5 rounded-full border border-[var(--studio-primary-line)] bg-[var(--studio-primary-soft)] px-2.5 py-1 text-xs font-medium text-[var(--studio-ink)]"
                >
                    <Palette className="size-3.5 shrink-0 text-[var(--studio-action)]" />
                    <span className="truncate">{snapshot.name}</span>
                </span>
            ))}
        </div>
    );
}

function getVideoDisplayResults(round: Round): GenerationResult[] {
    return round.result ? [round.result] : [];
}

function renderWorkflowStages(
    round: Round,
    handlers: {
        uploadingObjectStorageId: string;
        onDownload: (video: GeneratedVideo) => void;
        onSaveAsset: (video: GeneratedVideo) => void;
        onUploadObjectStorage: (video: GeneratedVideo) => void;
        onOpenDetail: (video: GeneratedVideo, round: Round) => void;
        onRegenerate: (round: Round) => Promise<void>;
    },
): React.ReactNode {
    const compactFramePreview = round.workflowStatus === "image_pending_confirm"
        && round.stages?.every((stage) => ["first_frame", "last_frame"].includes(stage.role));
    return (
        <div className={compactFramePreview ? "flex flex-wrap gap-3" : "grid gap-3 xl:grid-cols-2"}>
            {round.stages?.map((stage) => {
                const images = (stage.outputs || []).filter((output) => output.taskType === "image" && output.url);
                const videos = (stage.outputs || []).map(workflowOutputToVideo).filter((video): video is GeneratedVideo => video !== null);
                return (
                    <div key={stage.planTaskId} className={compactFramePreview ? "w-48 shrink-0 space-y-2 sm:w-56" : "space-y-2"}>
                        {!compactFramePreview ? <div className="text-xs font-medium text-[var(--studio-muted)]">{stage.displayName}</div> : null}
                        {stage.status === "success" && images.length ? (
                            <div className={compactFramePreview ? "flex flex-wrap gap-3" : "grid gap-3 sm:grid-cols-2"}>
                                {images.map((image, index) =>
                                    image.url ? (
                                        compactFramePreview ? <FrameImagePreview key={image.id || image.storageKey || index} url={image.url} role={stage.role} /> : <Image key={image.id || image.storageKey || index} src={image.url} alt={stage.displayName} className="w-full rounded-xl border border-[var(--studio-line)] object-cover" preview={{ mask: "查看大图" }} />
                                    ) : null,
                                )}
                            </div>
                        ) : null}
                        {stage.status === "success" &&
                            videos.map((video) => (
                                <ResultCard
                                    key={video.id}
                                    video={video}
                                    uploadingObjectStorage={handlers.uploadingObjectStorageId === video.id}
                                    onDownload={handlers.onDownload}
                                    onSaveAsset={handlers.onSaveAsset}
                                    onUploadObjectStorage={handlers.onUploadObjectStorage}
                                    onOpenDetail={(item) => handlers.onOpenDetail(item, round)}
                                    onRegenerate={() => void handlers.onRegenerate(round)}
                                />
                            ))}
                        {stage.status === "failed" || stage.status === "canceled" || stage.status === "skipped" ? (
                            <FailedCard error={stage.error || (stage.status === "skipped" ? "依赖阶段未成功完成，当前阶段已跳过" : "生成失败")} canceled={stage.status === "canceled"} skipped={stage.status === "skipped"} />
                        ) : null}
                        {["pending", "running"].includes(stage.status) ? <VideoGeneratingCard size={round.config.size} progress={stage.progress} /> : null}
                    </div>
                );
            })}
        </div>
    );
}

function workflowOutputToVideo(output: WorkflowOutput): GeneratedVideo | null {
    if (output.taskType !== "video" || !output.url) return null;
    return {
        id: output.id || output.storageKey || output.url,
        url: output.url,
        storageKey: output.storageKey || output.key || "",
        durationMs: output.durationMs || 0,
        width: output.width || 0,
        height: output.height || 0,
        bytes: output.bytes || 0,
        mimeType: output.mimeType || "video/mp4",
        objectStorage: output.objectStorage,
    };
}

function workflowVideos(round: Round): GeneratedVideo[] {
    if (round.stages?.length) return round.stages.flatMap((stage) => (stage.outputs || []).map(workflowOutputToVideo).filter((video): video is GeneratedVideo => video !== null));
    return round.result?.status === "success" && round.result.video ? [round.result.video] : [];
}

function buildVideoStatusText(round: Round): string {
    if (round.stages?.length) {
        const stages = round.stages;
        if (round.workflowStatus === "clarifying") return "等待补充信息";
        if (round.workflowStatus === "image_pending_confirm") return "图片已生成，等待确认";
        if (stages.some((stage) => stage.status === "pending" || stage.status === "running")) {
            const running = stages.find((stage) => stage.status === "running") || stages.find((stage) => stage.status === "pending");
            return running?.progress ? `${running.displayName} ${running.progress}%` : `${running?.displayName || "工作流"}进行中`;
        }
        if (stages.some((stage) => stage.status === "failed")) return "工作流执行失败";
        if (stages.some((stage) => stage.status === "canceled")) return "工作流已停止";
        if (stages.some((stage) => stage.status === "skipped")) return "部分阶段已跳过";
        return "工作流已完成";
    }
    if (!round.result) {
        return "";
    }
    if (round.result.status === "pending") {
        return round.result.progress != null && round.result.progress > 0 ? `生成中 ${round.result.progress}%` : "生成中";
    }
    if (round.result.status === "failed") {
        return "生成失败";
    }
    if (round.result.status === "canceled") {
        return "已停止生成";
    }
    return "已完成";
}

function buildVideoAssistantText(round: Round): string {
    if (round.stages?.length) {
        if (round.workflowStatus === "clarifying") return round.assistantText || "请补充工作流所需信息。";
        if (round.workflowStatus === "image_pending_confirm") return round.assistantText || "首帧和尾帧图片已生成，请确认是否用这些图片生成视频，或修改提示词重新生成。";
        if (round.stages.some((stage) => stage.status === "pending")) return "我正在执行视频工作流，请稍等。";
        if (round.stages.some((stage) => stage.status === "failed")) return "工作流中有阶段失败，你可以重新生成。";
        if (round.stages.some((stage) => stage.status === "canceled")) return "工作流已停止，你可以重新生成。";
        return "视频工作流结果已经准备好了。";
    }
    if (!round.result) {
        return round.assistantText || "";
    }
    if (round.result.status === "pending") {
        return "我正在整理这一轮视频结果，请稍等。";
    }
    if (round.result.status === "failed") {
        return "这轮视频生成失败了，你可以直接重新生成。";
    }
    if (round.result.status === "canceled") {
        return "已停止生成，你可以直接重新生成。";
    }
    return "视频结果已经准备好了，你可以继续追加镜头、动作或风格调整。";
}

function formatConversationTime(value: number): string {
    return new Date(value).toLocaleString("zh-CN", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatThreadSectionLabel(value: number): string {
    const date = new Date(value);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date >= today && date < tomorrow) {
        return "今天";
    }
    if (date >= yesterday && date < today) {
        return "昨天";
    }
    return date.toLocaleDateString("zh-CN", {
        month: "long",
        day: "numeric",
    });
}

function ResultCard({
    video,
    uploadingObjectStorage,
    onDownload,
    onSaveAsset,
    onUploadObjectStorage,
    onOpenDetail,
    onRegenerate,
}: {
    video: GeneratedVideo;
    uploadingObjectStorage: boolean;
    onDownload: (video: GeneratedVideo) => void;
    onSaveAsset: (video: GeneratedVideo) => void;
    onUploadObjectStorage: (video: GeneratedVideo) => void;
    onOpenDetail: (video: GeneratedVideo) => void;
    onRegenerate?: () => void;
}) {
    const [isDownloading, setIsDownloading] = useState(false);
    const copyText = useCopyText();
    if (!hasPlayableVideoUrl(video.url)) {
        return <FailedCard error="视频地址为空，无法播放" />;
    }

    const hasSize = video.width > 0 && video.height > 0;
    const hasBytes = video.bytes > 0;
    const hasDuration = video.durationMs > 0;

    const downloadResult = async () => {
        if (isDownloading) return;
        setIsDownloading(true);
        try {
            await onDownload(video);
        } finally {
            setIsDownloading(false);
        }
    };

    return (
        <div className="group overflow-hidden rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] transition hover:-translate-y-0.5 hover:border-[var(--studio-primary-line)]">
            <div className="relative cursor-pointer bg-black" onClick={() => onOpenDetail(video)}>
                <video src={video.url} muted preload="metadata" playsInline className="pointer-events-none max-h-96 w-full object-contain" style={{ aspectRatio: video.width && video.height ? `${video.width}/${video.height}` : undefined }} />
                <div className="absolute inset-0 grid place-items-center">
                    <div className="grid size-12 place-items-center rounded-full bg-black/50 text-white backdrop-blur-sm transition group-hover:scale-110">
                        <Play className="size-5" />
                    </div>
                </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-[var(--studio-line)] px-3 py-2.5">
                <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-[var(--studio-muted)]">
                    {hasSize ? (
                        <span>
                            {video.width}x{video.height}
                        </span>
                    ) : null}
                    {hasBytes ? <span>{formatBytes(video.bytes)}</span> : null}
                    {hasDuration ? <span>{formatDuration(video.durationMs)}</span> : null}
                    {video.objectStorage?.url ? (
                        <Tag className="!m-0 !text-[10px]" color="blue">
                            云储存
                        </Tag>
                    ) : null}
                </div>
                <div className="flex gap-1">
                    <Tooltip title="拷贝链接">
                        <Button aria-label="拷贝链接" size="small" className="!h-7 !w-7 !min-w-0 !rounded-full !p-0" icon={<Link2 className="size-3.5" />} onClick={() => copyText(video.objectStorage?.url || video.url, "链接已复制")} />
                    </Tooltip>
                    <Tooltip title={video.objectStorage?.url ? "复制云储存地址" : "上传到云储存"}>
                        <Button size="small" className="!h-7 !w-7 !min-w-0 !rounded-full !p-0" loading={uploadingObjectStorage} icon={<CloudUpload className="size-3.5" />} onClick={() => void onUploadObjectStorage(video)} />
                    </Tooltip>
                    <Tooltip title="添加到素材">
                        <Button size="small" className="!h-7 !w-7 !min-w-0 !rounded-full !p-0" icon={<FolderPlus className="size-3.5" />} onClick={() => onSaveAsset(video)} />
                    </Tooltip>
                    <Tooltip title="下载">
                        <Button size="small" className="!h-7 !w-7 !min-w-0 !rounded-full !p-0" icon={<Download className="size-3.5" />} loading={isDownloading} disabled={isDownloading} onClick={() => void downloadResult()} />
                    </Tooltip>
                    {onRegenerate ? (
                        <Tooltip title="重新生成">
                            <Button aria-label="重新生成" size="small" className="!h-7 !w-7 !min-w-0 !rounded-full !p-0" icon={<RefreshCw className="size-3.5" />} onClick={onRegenerate} />
                        </Tooltip>
                    ) : null}
                </div>
            </div>
            <div className="flex items-center gap-1 border-t border-[var(--studio-line)] px-3 py-2 text-xs text-amber-500">
                <TriangleAlert className="size-3.5 shrink-0" />
                <span>请尽快下载生成结果，超时将无法下载</span>
            </div>
        </div>
    );
}

function FailedCard({ error, canceled, skipped }: { error: string; canceled?: boolean; skipped?: boolean }) {
    return (
        <div className="overflow-hidden rounded-xl border border-red-300/40 bg-red-500/10">
            <div className="flex aspect-video flex-col items-center justify-center gap-3 p-5 text-center">
                <div className="rounded-full bg-[var(--studio-panel-solid)] px-3 py-1 text-sm font-medium text-red-500">{canceled ? "已停止生成" : skipped ? "已跳过" : "生成失败"}</div>
                <Typography.Paragraph ellipsis={{ rows: 3 }} className="!mb-0 !text-xs !text-red-400">
                    {error}
                </Typography.Paragraph>
            </div>
        </div>
    );
}

async function readConversations() {
    if (typeof window === "undefined") {
        return [];
    }

    try {
        const values = await listGenerationLogs<Conversation>("video");
        const reconciledValues = await reconcileGenerationLogTasks("video", values);
        const conversations = await Promise.all(reconciledValues.map(normalizeConversation));
        return conversations.sort((left, right) => (right.updatedAt || right.createdAt || 0) - (left.updatedAt || left.createdAt || 0));
    } catch {
        return [];
    }
}

async function normalizeConversation(raw: Partial<Conversation>): Promise<Conversation> {
    const rounds = await Promise.all(
        (raw.rounds || []).map(async (round) => {
            // 兼容服务端 saveGenerationRound 写入的 results[] 数组格式，转为前端 result 单数格式
            const rawResult = (round as any).result != null ? (round as any).result : Array.isArray((round as any).results) && (round as any).results.length > 0 ? (round as any).results[0] : null;
            // 澄清轮等纯对话轮的 result 是无状态空对象，归一化为空，避免渲染出无 key 的结果卡片
            const normalizedResult = rawResult && typeof rawResult === "object" && (rawResult.status || rawResult.video || rawResult.error || rawResult.taskId) ? rawResult : null;

            const video = normalizedResult?.video ? { ...normalizedResult.video, storageKey: readVideoStorageKey(normalizedResult.video) } : undefined;
            const rawStages = Array.isArray((round as any).stages) ? (round as any).stages : [];
            const stageOutputs = await Promise.all(
                rawStages.map(async (stage: WorkflowStage) => ({
                    ...stage,
                    outputs: await Promise.all(
                        (stage.outputs || []).map(async (output) => {
                            const storageKey = readMediaStorageKey(output);
                            const url = output.taskType === "image" ? await resolveImageUrl(storageKey, output.url || "") : (await resolveMediaStorageInfo(storageKey, output.url || "", output.objectStorage))?.url || output.url;
                            return { ...output, storageKey, url };
                        }),
                    ),
                })),
            );
            const [normalizedReferences, normalizedVideoReferences, storageInfo] = await Promise.all([
                Promise.all(
                    (round.references || []).map(async (reference) => ({
                        ...reference,
                        type: referenceMediaType(reference, "image/*"),
                        dataUrl: await resolveImageUrl(reference.storageKey, referenceMediaUrl(reference)),
                    })),
                ),
                Promise.all(
                    (round.videoReferences || []).map(async (reference) => ({
                        ...reference,
                        type: referenceMediaType(reference, "video/*"),
                        url: reference.storageKey ? await resolveMediaUrl(reference.storageKey, referenceMediaUrl(reference)) : referenceMediaUrl(reference),
                    })),
                ),
                video ? resolveMediaStorageInfo(video.storageKey, video.url, video.objectStorage) : Promise.resolve(null),
            ]);

            return {
                ...round,
                activities: normalizeHistoricalAgentActivities(round.activities, normalizeVideoRoundActivityStatus(normalizedResult)),
                references: normalizedReferences,
                videoReferences: normalizedVideoReferences,
                result:
                    video && storageInfo
                        ? {
                              ...normalizedResult,
                              video: {
                                  ...video,
                                  url: storageInfo.url,
                                  objectStorage: storageInfo.objectStorage,
                              },
                          }
                        : normalizedResult,
                stages: stageOutputs.length ? stageOutputs : undefined,
            };
        }),
    );

    return {
        id: raw.id || nanoid(),
        title: raw.title || "未命名",
        rounds,
        createdAt: raw.createdAt || Date.now(),
        updatedAt: raw.updatedAt || raw.createdAt || Date.now(),
        generationStatus: raw.generationStatus || "idle",
        generationCompletedAt: raw.generationCompletedAt,
        generationViewedAt: raw.generationViewedAt,
    };
}

function readMediaStorageKey(value: WorkflowOutput): string {
    return value.storageKey?.trim() || value.key?.trim() || "";
}

function collectRoundMediaKeys(rounds: readonly Round[]): string[] {
    return [...new Set(rounds.flatMap((round) => [...(round.result?.video?.storageKey ? [round.result.video.storageKey] : []), ...(round.stages || []).flatMap((stage) => (stage.outputs || []).map(readMediaStorageKey).filter(Boolean))]))];
}

function updateRoundVideoObjectStorage(round: Round, videoId: string, objectStorage: ObjectStorageFile): Round {
    const result = round.result?.video?.id === videoId && round.result.video ? { ...round.result, video: { ...round.result.video, objectStorage } } : round.result;
    const stages = round.stages?.map((stage) => ({
        ...stage,
        outputs: stage.outputs?.map((output) => (output.id === videoId || output.storageKey === videoId ? { ...output, objectStorage } : output)),
    }));
    return result !== round.result || stages !== round.stages ? { ...round, result, stages } : round;
}

function isPendingWorkflowTask(value: WorkflowTaskSnapshot): value is WorkflowTaskSnapshot & { taskId: string; status: string } {
    return typeof value.taskId === "string" && (value.status === "pending" || value.status === "running");
}

function buildChatAttachments(attachments: AgentAttachment[]) {
    return attachments.map((attachment, index) => ({
        id: `reference-${index}-${attachment.storageKey || attachment.url || "unknown"}`,
        name: attachment.name,
        url: attachment.url,
        type: attachment.type,
    }));
}

function normalizeVideoRoundActivityStatus(result: GenerationResult | null | undefined): "success" | "failed" | "canceled" | null {
    if (!result || result.status === "pending") {
        return null;
    }
    if (result.status === "canceled") {
        return "canceled";
    }
    if (result.status === "failed") {
        return "failed";
    }
    return "success";
}

function readVideoStorageKey(value: unknown): string {
    if (!value || typeof value !== "object") return "";
    const video = value as { storageKey?: unknown; key?: unknown };
    if (typeof video.storageKey === "string" && video.storageKey.trim()) return video.storageKey;
    return typeof video.key === "string" ? video.key : "";
}
