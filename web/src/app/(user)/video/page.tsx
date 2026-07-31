"use client";

import { BookOpen, CloudUpload, Download, FolderPlus, Cog, LoaderCircle, RefreshCw, Sparkles, Upload, VideoIcon } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { App, Button, Image, Modal, Tag, Tooltip, Typography } from "antd";
import { nanoid } from "nanoid";

import { bindPendingVideoSize, renderPendingVideoToolCall, VideoGeneratingCard } from "./components/pending-video-tool-call";
import { AssetPickerModal, type InsertAssetPayload } from "@/features/assets/components/asset-picker-modal";
import { useAssetStore } from "@/features/assets/stores/use-asset-store";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { CreationWorkspace } from "@/features/generation/components/creation-workspace";
import { VideoSettingsPanel } from "@/features/generation/components/video-settings-panel";
import { requestCreditCost } from "@/features/generation/constants/credits";
import type { CreationComposerAction, CreationConversationItem, CreationReferenceChip, CreationThreadRound, CreationThreadSection } from "@/features/generation/components/creation-workspace-types";
import { seedanceReferenceLabel, SEEDANCE_REFERENCE_LIMITS } from "@/features/generation/lib/seedance-video";
import { formatBytes, formatDuration } from "@/features/generation/lib/image-utils";
import type { ReferenceImage } from "@/features/generation/types/image";
import type { ReferenceVideo } from "@/features/generation/types/media";
import { PromptSelectDialog } from "@/features/prompts/components/prompt-select-dialog";
import { ModelPicker } from "@/features/settings/components/model-picker";
import { useConfigStore, useEffectiveConfig, type AiConfig } from "@/features/settings/stores/use-config-store";
import { deleteStoredMedia, resolveMediaStorageInfo, resolveMediaUrl, uploadMediaFile } from "@/features/storage/services/file-storage";
import { downloadMedia } from "@/features/storage/services/media-download";
import { resolveImageUrl, uploadImage } from "@/features/storage/services/image-storage";
import { uploadRemoteObjectToStorage } from "@/features/storage/services/object-storage";
import { useThemeStore } from "@/features/theme/stores/use-theme-store";
import { canvasThemes } from "@/shared/lib/canvas-theme";
import { clearInitialPromptFromLocation, readInitialPromptFromLocation } from "@/shared/lib/initial-prompt";
import type { ObjectStorageFile } from "@/shared/types/object-storage";
import { useAgentChatSSE } from "@/features/chat/use-agent-chat-sse";
import { useAgentThinking } from "@/features/chat/use-agent-thinking";
import type { AgentActivityState, ChatMessageItem, ToolCallState } from "@/features/chat/types";
import { buildChatThreadSection } from "@/features/generation/components/chat-thread-section";
import { createToolExecutionActivity, finishRunningAgentActivities, getPlanTaskActivityStatus, normalizeAgentActivities, updateAgentActivityMessage, upsertAgentActivityMessage } from "@/features/generation/components/agent-activity";
import { hasPendingVideoConversation } from "@/features/generation/lib/generation-conversation-recovery";
import { getGenerationConversationStatus, hasRunningGeneration, type GenerationLogStatusFields } from "@/features/generation/lib/generation-log-status";
import { usePromptOptimization } from "@/features/generation/hooks/use-prompt-optimization";
import { loadVideoLastUsedSettings, saveVideoLastUsedSettings, type VideoLastUsedSettings } from "@/features/generation/lib/last-used-generation-settings";
import { deleteGenerationLogs, listGenerationLogs, markGenerationLogViewed, renameGenerationLogTitle } from "@/services/api/server";
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
    status: "pending" | "success" | "failed" | "canceled";
    progress?: number;
    video?: GeneratedVideo;
    error?: string;
};

type RoundConfig = Pick<AiConfig, "model" | "videoModel" | "size" | "vquality" | "videoSeconds" | "videoWatermark">;

type Round = {
    id: string;
    prompt: string;
    generationPrompt?: string;
    references: ReferenceImage[];
    videoReferences: ReferenceVideo[];
    config: RoundConfig;
    result: GenerationResult;
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
    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const configHydrated = useConfigStore((state) => state.hydrated);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const userRole = useUserStore((state) => state.user?.role);
    const addAsset = useAssetStore((state) => state.addAsset);
    const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
    const theme = canvasThemes[resolvedTheme];
    const { optimizingOperationId, optimizePrompt } = usePromptOptimization();
    const isPromptOptimizing = optimizingOperationId === "video-page";

    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [prompt, setPrompt] = useState("");
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [videoReferences, setVideoReferences] = useState<ReferenceVideo[]>([]);
    const [uploadingReferenceIds, setUploadingReferenceIds] = useState<string[]>([]);
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [uploadingObjectStorageId, setUploadingObjectStorageId] = useState("");
    const [managementMode, setManagementMode] = useState(false);
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
        if (!configHydrated) return;
        void loadVideoLastUsedSettings()
            .then((settings) => {
                updateConfig("vquality", settings.vquality);
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

    // Agent chat state
    const [chatMessages, setChatMessages] = useState<ChatMessageItem[]>([]);
    const { completedThinkings, activeThinking, onThoughtDelta, onThoughtComplete, resetThinkings } = useAgentThinking();
    const [toolCalls, setToolCalls] = useState<ToolCallState[]>([]);
    const [streamingText, setStreamingText] = useState<{ messageId: string; text: string } | null>(null);
    const model = effectiveConfig.videoModel || effectiveConfig.model;
    const videoResolution = config.vquality || "720p";
    const agentCreationSettings = {
        model,
        size: config.size || "16:9",
        resolution: videoResolution,
        quality: videoResolution.includes("1080") ? "high" : videoResolution.includes("480") ? "low" : "medium",
        seconds: config.videoSeconds || "5",
        watermark: String(config.videoWatermark).toLowerCase() === "true",
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

    const { sessionId, isStreaming, isStopping, sendMessage, cancelMessage, resetSession, restoreSession } = useAgentChatSSE({
        entrySource: "videoPage",
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
            const pendingCall = isVideoTool ? bindPendingVideoSize(call, pendingVideoSizeRef.current) : call;
            setToolCalls((prev) => {
                const next = prev.some((item) => item.callId === pendingCall.callId)
                    ? prev.map((item) => (item.callId === pendingCall.callId ? pendingCall : item))
                    : [...prev, pendingCall];
                toolCallsRef.current = next;
                return next;
            });
            setChatMessages((prev) => {
                const next = upsertAgentActivityMessage(prev, createToolExecutionActivity(pendingCall));
                chatMessagesRef.current = next;
                return next;
            });
            if (isVideoTool) {
                // 工具开始执行前，将 LLM 已输出的文本保存为助手消息，避免被清空丢失
                const streamed = streamingTextRef.current;
                if (streamed && streamed.text) {
                    setChatMessages((prev) => {
                        const next = prev.some((item) => item.id === streamed.messageId)
                            ? prev
                            : [...prev, { id: streamed.messageId, role: "assistant" as const, text: streamed.text }];
                        chatMessagesRef.current = next;
                        return next;
                    });
                }
                const toolText = call.name === "generate_video" ? "正在生成视频..." : "正在编辑视频...";
                setChatMessages((prev) => {
                    const toolMessage = { id: pendingCall.callId, role: "tool" as const, text: toolText, detail: pendingCall };
                    const next = prev.some((item) => item.id === pendingCall.callId)
                        ? prev.map((item) => (item.id === pendingCall.callId ? toolMessage : item))
                        : [...prev, toolMessage];
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
            const status = data?.canceled ? "canceled" : ok ? "success" : "failed";
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
                let next = prev;
                if (streamed && streamed.text) {
                    const assistantMessage = { id: streamed.messageId, role: "assistant" as const, text: streamed.text, ...(action ? { action } : {}) };
                    next = prev.some((item) => item.id === streamed.messageId)
                        ? prev.map((item) => item.id === streamed.messageId ? { ...item, ...(action ? { action } : {}) } : item)
                        : [...prev, assistantMessage];
                } else if (text || action) {
                    const lastMessage = prev.at(-1);
                    next = lastMessage?.role === "assistant" && lastMessage.text === text
                        ? action ? prev.map((item, index) => index === prev.length - 1 ? { ...item, action } : item) : prev
                        : [...prev, { id: messageId || nanoid(), role: "assistant" as const, text, ...(action ? { action } : {}) }];
                }
                chatMessagesRef.current = next;
                return next;
            });
            setStreamingText(null);
            streamingTextRef.current = null;
            resetThinkings();
            void refreshConversations().then((nextConversations) => {
                const completedConversation = nextConversations.find((conversation) => conversation.id === activeIdRef.current);
                if (!completedConversation || action) return;
                setChatMessages([]);
                chatMessagesRef.current = [];
                setToolCalls([]);
                toolCallsRef.current = [];
            });
        },
        onCanceled: (stoppedMessage) => {
            resetThinkings();
            setStreamingText(null);
            streamingTextRef.current = null;
            setToolCalls((prev) => {
                const next = prev.map((call) => call.status === "executing" ? { ...call, status: "canceled" as const, resultMessage: stoppedMessage } : call);
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
            void refreshConversations().then((nextConversations) => {
                const canceledConversation = nextConversations.find((conversation) => conversation.id === activeIdRef.current);
                if (!canceledConversation) return;
                setChatMessages([]);
                chatMessagesRef.current = [];
                setToolCalls([]);
                toolCallsRef.current = [];
            });
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
            const activityStatus = getPlanTaskActivityStatus(status);
            if (!activityStatus) return;
            setChatMessages((prev) => {
                const next = upsertAgentActivityMessage(prev, {
                    id: `task-${planId}-${taskId}`,
                    type: "plan-task-status",
                    title: "执行创作任务",
                    description: statusMessage,
                    status: activityStatus,
                });
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

    const creditCost = requestCreditCost({ modelCosts: effectiveConfig.modelCosts, model, taskType: "video", count: 1 });
    const activeConversation = conversations.find((item) => item.id === activeId) || null;
    const activeConversationPending = activeConversation ? hasPendingVideoConversation(activeConversation) : false;
    const canGenerate = Boolean(prompt.trim()) && !isStreaming && !activeConversationPending && !isPromptOptimizing && !uploadingReferenceIds.length;
    const allSelected = Boolean(conversations.length) && selectedIds.length === conversations.length;

    useEffect(() => {
        if (!sessionId || sessionId === activeIdRef.current) return;
        activeIdRef.current = sessionId;
        setActiveId(sessionId);
    }, [sessionId]);

    useEffect(() => {
        let cancelled = false;
        void refreshConversations().then(() => {
            if (cancelled) return;
            activeIdRef.current = null;
            setActiveId(null);
        });
        return () => {
            cancelled = true;
        };
    }, [refreshConversations]);

    useEffect(() => {
        if (!hasRunningGeneration(conversations)) return;
        const refreshTimer = window.setInterval(() => {
            void refreshConversations();
        }, 2_000);
        return () => window.clearInterval(refreshTimer);
    }, [conversations, refreshConversations]);

    const addReferences = async (files?: FileList | File[] | null) => {
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
                return;
            }
            setReferences((current) => [...current, ...imagePlaceholders].slice(0, SEEDANCE_REFERENCE_LIMITS.images));
            setVideoReferences((current) => [...current, ...videoPlaceholders].slice(0, SEEDANCE_REFERENCE_LIMITS.videos));
            setUploadingReferenceIds((current) => [...current, ...placeholders.map((placeholder) => placeholder.id)]);

            await Promise.all([
                ...imagePlaceholders.map(async (placeholder, index) => {
                    const file = imageFiles[index];
                    try {
                        const image = await uploadImage(file);
                        setReferences((current) =>
                            current.map((reference) =>
                                reference.id === placeholder.id
                                    ? {
                                          ...placeholder,
                                          type: image.mimeType,
                                          dataUrl: image.url,
                                          storageKey: image.storageKey,
                                          objectStorage: image.objectStorage,
                                      }
                                    : reference,
                            ),
                        );
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
                        setVideoReferences((current) =>
                            current.map((reference) =>
                                reference.id === placeholder.id
                                    ? {
                                          ...placeholder,
                                          type: video.mimeType,
                                          url: video.url,
                                          storageKey: video.storageKey,
                                          bytes: video.bytes,
                                          width: video.width,
                                          height: video.height,
                                          durationMs: video.durationMs,
                                          objectStorage: video.objectStorage,
                                      }
                                    : reference,
                            ),
                        );
                    } catch (error) {
                        setVideoReferences((current) => current.filter((reference) => reference.id !== placeholder.id));
                        message.error(error instanceof Error ? error.message : `上传参考视频 ${placeholder.name} 失败`);
                    } finally {
                        URL.revokeObjectURL(placeholder.url);
                        setUploadingReferenceIds((current) => current.filter((id) => id !== placeholder.id));
                    }
                }),
            ]);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "上传参考素材失败");
        }
    };

    const generate = async () => {
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
        const attachments = [
            ...references.map((reference) => ({ id: reference.id, name: reference.name, url: reference.dataUrl, type: reference.type })),
            ...videoReferences.map((reference) => ({ id: reference.id, name: reference.name, url: reference.url, type: reference.type })),
        ];

        setChatMessages((prev) => {
            const next = [...prev, { id: nanoid(), role: "user" as const, text, attachments }];
            chatMessagesRef.current = next;
            return next;
        });

        const imageRefs = references.map((reference) => ({ url: reference.objectStorage?.url || reference.dataUrl, type: reference.type, name: reference.name, storageKey: reference.storageKey }));
        const videoRefs = videoReferences.map((reference) => ({ url: reference.objectStorage?.url || reference.url, type: reference.type, name: reference.name, storageKey: reference.storageKey }));
        const allRefs = [...imageRefs, ...videoRefs];
        await sendMessage(text, allRefs.length ? allRefs : undefined, {
            model: videoModel,
            size,
            resolution: quality,
            quality: quality.includes("1080") ? "high" : quality.includes("480") ? "low" : "medium",
            seconds,
            watermark: String(watermark).toLowerCase() === "true",
        });

        setPrompt("");
        setReferences([]);
        setVideoReferences([]);
    };

    const regenerateRound = async (round: Round) => {
        const videoModel = round.config.videoModel || round.config.model || model;
        const size = round.config.size;
        const resolution = round.config.vquality;
        if (size) pendingVideoSizeRef.current = size;
        setChatMessages((prev) => {
            const next = [...prev, { id: nanoid(), role: "user", text: round.prompt }];
            chatMessagesRef.current = next;
            return next;
        });
        await sendMessage(round.prompt, undefined, {
            model: videoModel,
            ...(size ? { size } : {}),
            ...(resolution ? {
                resolution,
                quality: resolution.includes("1080") ? "high" : resolution.includes("480") ? "low" : "medium",
            } : {}),
            ...(round.config.videoSeconds ? { seconds: round.config.videoSeconds } : {}),
            ...(round.config.videoWatermark !== undefined && round.config.videoWatermark !== null
                ? { watermark: String(round.config.videoWatermark).toLowerCase() === "true" }
                : {}),
        });
    };

    const newConversation = () => {
        setActiveId(null);
        activeIdRef.current = null;
        setPrompt("");
        setReferences([]);
        setVideoReferences([]);
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
        if (getGenerationConversationStatus(conversation) !== "none" && conversation.generationStatus !== "running") {
            setConversations((current) => current.map((item) => (item.id === conversation.id ? { ...item, generationViewedAt: item.generationCompletedAt } : item)));
            void markGenerationLogViewed(conversation.id).catch(() => void refreshConversations());
        }
        setActiveId(conversation.id);
        activeIdRef.current = conversation.id;
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
        setMobileSidebarOpen(false);
        restoreSession(conversation.id);
    };

    const toggleAll = () => {
        setSelectedIds(allSelected ? [] : conversations.map((item) => item.id));
    };

    const deleteSelected = () => {
        const mediaKeys = conversations.filter((conversation) => selectedIds.includes(conversation.id)).flatMap((conversation) => conversation.rounds.flatMap((round) => (round.result.video?.storageKey ? [round.result.video.storageKey] : [])));
        void Promise.all([deleteStoredMedia(mediaKeys), deleteGenerationLogs(selectedIds)]).then(refreshConversations);
        if (activeId && selectedIds.includes(activeId)) {
            setActiveId(null);
            setPrompt("");
            setReferences([]);
            setVideoReferences([]);
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
                    rounds: conversation.rounds.map((round) =>
                        round.result.video?.id === video.id
                            ? {
                                  ...round,
                                  result: {
                                      ...round.result,
                                      video: {
                                          ...round.result.video,
                                          objectStorage: file,
                                      },
                                  },
                              }
                            : round,
                    ),
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
        const conversation = conversationsRef.current.find((item) => item.id === conversationId);
        const mediaKeys = conversation?.rounds.flatMap((round) => (round.result.video?.storageKey ? [round.result.video.storageKey] : [])) || [];
        await Promise.all([deleteStoredMedia(mediaKeys), deleteGenerationLogs([conversationId])]);
        if (activeIdRef.current === conversationId) {
            newConversation();
        }
        await refreshConversations();
    };

    const conversationItems = buildVideoConversationItems(conversations, activeId, selectedIds);
    const referenceChips: CreationReferenceChip[] = [
        ...references.map((reference, index) => {
            const uploading = uploadingReferenceIds.includes(reference.id);
            return {
                id: reference.id,
                label: uploading ? `${seedanceReferenceLabel("image", index)} 上传中` : seedanceReferenceLabel("image", index),
                preview: (
                    <div className="relative size-11">
                        <Image src={reference.dataUrl} alt={reference.name} width={44} height={44} style={{ objectFit: "cover" }} className="rounded-xl" preview={{ mask: "预览" }} />
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
                        <div className="relative size-11">
                            <video src={reference.url} className="size-11 rounded-xl object-cover" muted />
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
    const composerActions: CreationComposerAction[] = [
        {
            key: "upload",
            label: "素材",
            icon: <Upload className="size-3.5" />,
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
            disabled: !prompt.trim() || isStreaming || activeConversationPending || isPromptOptimizing,
            loading: isPromptOptimizing,
            onClick: () => void optimizePrompt({ operationId: "video-page", generationType: "video", prompt, onSuccess: setPrompt }),
        },
        {
            key: "assets",
            label: "资产库",
            icon: <FolderPlus className="size-3.5" />,
            onClick: () => setAssetPickerOpen(true),
        },
        {
            key: "settings",
            label: "更多设置",
            icon: <Cog className="size-3.5" />,
            onClick: () => setSettingsOpen(true),
        },
    ];
    const chatThreadSection = buildChatThreadSection(
        chatMessages,
        completedThinkings,
        activeThinking,
        streamingText,
        toolCalls,
        (data) => renderResultVideos(data, { onDownload: downloadVideo, onSaveAsset: saveResultToAssets, onUploadObjectStorage: uploadResultToObjectStorage }),
        renderPendingVideoToolCall,
    );
    const livePendingRoundIds = new Set(toolCalls.filter((call) => call.status === "executing").map((call) => call.callId));
    const threadSections = activeConversation
        ? buildVideoThreadSections(activeConversation, livePendingRoundIds, {
              uploadingObjectStorageId,
              onDownload: downloadVideo,
              onSaveAsset: saveResultToAssets,
              onUploadObjectStorage: uploadResultToObjectStorage,
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
                    actions: composerActions,
                    running: isStreaming || activeConversationPending,
                    canSubmit: canGenerate,
                    stopping: isStopping,
                    focusWhenValueSet: focusInitialPrompt,
                    creditCost,
                    onChange: setPrompt,
                    onPasteImages: (files) => void addReferences(files),
                    onSubmit: () => void generate(),
                    onStop: isStreaming ? () => void cancelMessage() : undefined,
                }}
                settings={{
                    open: settingsOpen,
                    title: "视频设置",
                    onClose: () => setSettingsOpen(false),
                    content: (
                        <div className="space-y-4">
                            <VideoSettingsPanel config={config} onConfigChange={updateVideoSettings} theme={theme} showTitle={false} className="space-y-4 px-0 py-0" />
                            <div>
                                <label className="mb-1.5 block text-sm font-semibold text-[var(--studio-ink)]">模型</label>
                                <ModelPicker
                                    config={effectiveConfig}
                                    value={model}
                                    onChange={(value) => updateConfig("videoModel", value)}
                                    capability="video"
                                    fullWidth
                                    onMissingConfig={() => (userRole === "admin" ? openConfigDialog(false) : message.error("请联系管理员配置默认生视频模型"))}
                                />
                            </div>
                        </div>
                    ),
                }}
            />

            <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setPrompt} />
            <AssetPickerModal open={assetPickerOpen} defaultTab="my-assets" onInsert={(payload) => void insertPickedAsset(payload)} onClose={() => setAssetPickerOpen(false)} />
            <Modal title="删除对话" open={deleteConfirmOpen} onCancel={() => setDeleteConfirmOpen(false)} onOk={deleteSelected} okText="删除" okButtonProps={{ danger: true }} cancelText="取消">
                确定删除选中的 {selectedIds.length} 条对话吗？
            </Modal>
        </>
    );
}

function renderResultVideos(
    data: Record<string, unknown>,
    callbacks: {
        onDownload: (video: GeneratedVideo) => void;
        onSaveAsset: (video: GeneratedVideo) => void;
        onUploadObjectStorage: (video: GeneratedVideo) => Promise<void>;
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
                });
            })
            .filter(Boolean),
    );
}

function buildVideoConversationItems(conversations: Conversation[], activeId: string | null, selectedIds: string[]): CreationConversationItem[] {
    return conversations.map((conversation) => {
        const latestVideo = findLatestPlayableVideo(conversation.rounds.map((round) => round.result));

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
    livePendingRoundIds: ReadonlySet<string>,
    handlers: {
        uploadingObjectStorageId: string;
        onDownload: (video: GeneratedVideo) => void;
        onSaveAsset: (video: GeneratedVideo) => void;
        onUploadObjectStorage: (video: GeneratedVideo) => void;
        onRegenerate: (round: Round) => Promise<void>;
    },
): CreationThreadSection[] {
    const sectionMap = new Map<string, CreationThreadSection["rounds"]>();

    for (const round of activeConversation.rounds) {
        if (round.result.status === "pending" && livePendingRoundIds.has(round.id)) {
            continue;
        }
        const label = formatThreadSectionLabel(round.createdAt);
        const rounds = sectionMap.get(label) || [];
        rounds.push({
            id: round.id,
            userText: round.prompt,
            userAttachments: renderVideoRoundReferences(round),
            statusText: buildVideoStatusText(round),
            assistantText: buildVideoAssistantText(round),
            activities: round.activities,
            resultContent: (
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
                                onRegenerate={() => void handlers.onRegenerate(round)}
                            />
                        ) : result.status === "failed" || result.status === "canceled" ? (
                            <FailedCard key={result.id} error={result.error || "生成失败"} canceled={result.status === "canceled"} />
                        ) : (
                            <VideoGeneratingCard key={result.id} size={round.config.size} progress={result.progress} />
                        ),
                    )}
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

function getVideoDisplayResults(round: Round): GenerationResult[] {
    return round.result ? [round.result] : [];
}

function buildVideoStatusText(round: Round): string {
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
    onRegenerate,
}: {
    video: GeneratedVideo;
    uploadingObjectStorage: boolean;
    onDownload: (video: GeneratedVideo) => void;
    onSaveAsset: (video: GeneratedVideo) => void;
    onUploadObjectStorage: (video: GeneratedVideo) => void;
    onRegenerate?: () => void;
}) {
    const [isDownloading, setIsDownloading] = useState(false);
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
            <div className="relative bg-black">
                <video src={video.url} controls className="w-full max-h-96 object-contain" style={{ aspectRatio: video.width && video.height ? `${video.width}/${video.height}` : undefined }} />
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
        </div>
    );
}

function FailedCard({ error, canceled }: { error: string; canceled?: boolean }) {
    return (
        <div className="overflow-hidden rounded-xl border border-red-300/40 bg-red-500/10">
            <div className="flex aspect-video flex-col items-center justify-center gap-3 p-5 text-center">
                <div className="rounded-full bg-[var(--studio-panel-solid)] px-3 py-1 text-sm font-medium text-red-500">{canceled ? "已停止生成" : "生成失败"}</div>
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
        const conversations = await Promise.all(values.map(normalizeConversation));
        return conversations.sort((left, right) => (right.updatedAt || right.createdAt || 0) - (left.updatedAt || left.createdAt || 0));
    } catch {
        return [];
    }
}

async function normalizeConversation(raw: Partial<Conversation>): Promise<Conversation> {
    const rounds = await Promise.all(
        (raw.rounds || []).map(async (round) => {
            // 兼容服务端 saveGenerationRound 写入的 results[] 数组格式，转为前端 result 单数格式
            const normalizedResult = (round as any).result != null ? (round as any).result : Array.isArray((round as any).results) && (round as any).results.length > 0 ? (round as any).results[0] : null;

            const video = normalizedResult?.video ? { ...normalizedResult.video, storageKey: readVideoStorageKey(normalizedResult.video) } : undefined;
            const [normalizedReferences, normalizedVideoReferences, storageInfo] = await Promise.all([
                Promise.all((round.references || []).map(async (reference) => ({ ...reference, dataUrl: await resolveImageUrl(reference.storageKey, reference.dataUrl) }))),
                Promise.all((round.videoReferences || []).map(async (reference) => ({ ...reference, url: reference.storageKey ? await resolveMediaUrl(reference.storageKey, reference.url) : reference.url }))),
                video ? resolveMediaStorageInfo(video.storageKey, video.url, video.objectStorage) : Promise.resolve(null),
            ]);

            return {
                ...round,
                activities: normalizeAgentActivities(round.activities),
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

function readVideoStorageKey(value: unknown): string {
    if (!value || typeof value !== "object") return "";
    const video = value as { storageKey?: unknown; key?: unknown };
    if (typeof video.storageKey === "string" && video.storageKey.trim()) return video.storageKey;
    return typeof video.key === "string" ? video.key : "";
}
