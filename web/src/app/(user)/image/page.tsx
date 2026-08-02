"use client";

import { BookOpen, CloudUpload, Download, FolderPlus, ImagePlus, PenLine, Cog, LoaderCircle, Palette, RefreshCw, Sparkles, Upload } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { App, Button, Image, Modal, Tag, Tooltip, Typography } from "antd";
import { nanoid } from "nanoid";

import { ImageGeneratingCard, renderPendingImageToolCall } from "./components/pending-image-tool-call";
import { regenerateImageRound } from "./image-round-regenerate";
import { AssetPickerModal, type InsertAssetPayload } from "@/features/assets/components/asset-picker-modal";
import { useAssetStore } from "@/features/assets/stores/use-asset-store";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { CreationWorkspace } from "@/features/generation/components/creation-workspace";
import { ImageSettingsPanel, imageQualityLabel, imageResolutionLabel, imageSizeLabel } from "@/features/generation/components/image-settings-panel";
import { requestCreditCost } from "@/features/generation/constants/credits";
import type { CreationComposerAction, CreationConversationItem, CreationReferenceChip, CreationStyleOption, CreationThreadRound, CreationThreadSection } from "@/features/generation/components/creation-workspace-types";
import { useAgentChatSSE } from "@/features/chat/use-agent-chat-sse";
import { useAgentThinking } from "@/features/chat/use-agent-thinking";
import type { AgentActivityState, ChatMessageItem, ToolCallState } from "@/features/chat/types";
import { buildChatThreadSection } from "@/features/generation/components/chat-thread-section";
import { createToolExecutionActivity, finishRunningAgentActivities, getPlanTaskActivityStatus, normalizeAgentActivities, updateAgentActivityMessage, upsertAgentActivityMessage } from "@/features/generation/components/agent-activity";
import { findLatestPendingConversation, hasPendingImageConversation } from "@/features/generation/lib/generation-conversation-recovery";
import { getGenerationConversationStatus, hasRunningGeneration, type GenerationLogStatusFields } from "@/features/generation/lib/generation-log-status";
import { usePromptOptimization } from "@/features/generation/hooks/use-prompt-optimization";
import { imageReferenceLabel } from "@/features/generation/lib/image-reference-prompt";
import { formatImageGenerationSettingsSummary } from "@/features/generation/lib/generation-settings-summary";
import { loadImageLastUsedSettings, saveImageLastUsedSettings, type ImageLastUsedSettings } from "@/features/generation/lib/last-used-generation-settings";
import { formatGenerationStyleMessage } from "@/features/generation/lib/style-command";
import { formatBytes } from "@/features/generation/lib/image-utils";
import type { ReferenceImage } from "@/features/generation/types/image";
import { PromptSelectDialog } from "@/features/prompts/components/prompt-select-dialog";
import { ModelPicker } from "@/features/settings/components/model-picker";
import { modelOptionLabel, useConfigStore, useEffectiveConfig, type AiConfig } from "@/features/settings/stores/use-config-store";
import { deleteStoredImages, resolveImageStorageInfo, resolveImageUrl, reuseOrUploadImage, uploadImage } from "@/features/storage/services/image-storage";
import { downloadMedia } from "@/features/storage/services/media-download";
import { uploadRemoteObjectToStorage } from "@/features/storage/services/object-storage";
import { useThemeStore } from "@/features/theme/stores/use-theme-store";
import { canvasThemes } from "@/shared/lib/canvas-theme";
import { clearInitialPromptFromLocation, readInitialPromptFromLocation } from "@/shared/lib/initial-prompt";
import type { ObjectStorageFile } from "@/shared/types/object-storage";
import { deleteGenerationLogs, listGenerationLogs, listGenerationStyles, markGenerationLogViewed, renameGenerationLogTitle, type GenerationStyleSnapshot } from "@/services/api/server";

type GeneratedImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType?: string;
    objectStorage?: ObjectStorageFile;
};

type GenerationResult = {
    id: string;
    status: "pending" | "success" | "failed" | "canceled";
    image?: GeneratedImage;
    error?: string;
};

type RoundConfig = Pick<AiConfig, "model" | "imageModel" | "quality" | "imageResolution" | "size" | "count"> & {
    resolution?: string;
};

type Round = {
    id: string;
    prompt: string;
    generationPrompt?: string;
    generationStyleSnapshots?: GenerationStyleSnapshot[];
    references: ReferenceImage[];
    config: RoundConfig;
    results: GenerationResult[];
    createdAt: number;
    assistantText?: string;
    activities?: AgentActivityState[];
};

const IMAGE_PREVIEW_BASE_HEIGHT = 240;
const IMAGE_PREVIEW_MIN_WIDTH = 220;
const IMAGE_PREVIEW_MAX_WIDTH = 520;

type Conversation = GenerationLogStatusFields & {
    id: string;
    title: string;
    rounds: Round[];
    createdAt: number;
    updatedAt: number;
};

export default function ImagePage() {
    const { message, modal } = App.useApp();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const configHydrated = useConfigStore((state) => state.hydrated);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const userRole = useUserStore((state) => state.user?.role);
    const addAsset = useAssetStore((state) => state.addAsset);
    const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
    const theme = canvasThemes[resolvedTheme];
    const { optimizingOperationId, optimizePrompt } = usePromptOptimization();
    const isPromptOptimizing = optimizingOperationId === "image-page";

    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [prompt, setPrompt] = useState("");
    const [styleOptions, setStyleOptions] = useState<CreationStyleOption[]>([]);
    const [selectedStyles, setSelectedStyles] = useState<CreationStyleOption[]>([]);
    const [styleLoading, setStyleLoading] = useState(false);
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [uploadingReferenceIds, setUploadingReferenceIds] = useState<string[]>([]);
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [imageDraftSettingsModified, setImageDraftSettingsModified] = useState(false);
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
        let cancelled = false;
        setStyleLoading(true);
        void listGenerationStyles("image")
            .then((result) => {
                if (!cancelled) setStyleOptions(result.styles);
            })
            .catch((error) => {
                if (!cancelled) message.error(error instanceof Error ? error.message : "图片风格加载失败");
            })
            .finally(() => {
                if (!cancelled) setStyleLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [message]);

    useEffect(() => {
        if (!configHydrated) return;
        void loadImageLastUsedSettings()
            .then((settings) => {
                updateConfig("quality", settings.quality);
                updateConfig("imageResolution", settings.imageResolution);
                updateConfig("size", settings.size);
                updateConfig("count", settings.count);
            })
            .catch((error) => console.error("读取上次图片生成设置失败", error));
    }, [configHydrated, updateConfig]);

    const updateImageSettings = (key: keyof ImageLastUsedSettings, value: string) => {
        updateConfig(key, value);
        void saveImageLastUsedSettings({ [key]: value }).catch((error) => console.error("保存上次图片生成设置失败", error));
    };

    const handleImageSettingsChange = (key: keyof ImageLastUsedSettings, value: string) => {
        if (String(config[key]) !== value) {
            setImageDraftSettingsModified(true);
        }
        updateImageSettings(key, value);
    };

    // Agent chat state
    const [chatMessages, setChatMessages] = useState<ChatMessageItem[]>([]);
    const { completedThinkings, activeThinking, onThoughtDelta, onThoughtComplete, resetThinkings } = useAgentThinking();
    const [toolCalls, setToolCalls] = useState<ToolCallState[]>([]);
    const [streamingText, setStreamingText] = useState<{ messageId: string; text: string } | null>(null);
    const model = effectiveConfig.imageModel || effectiveConfig.model;
    const agentCreationSettings = {
        model,
        size: config.size,
        resolution: config.imageResolution,
        quality: config.quality,
        count: 1,
        ...(selectedStyles.length ? { generationStyleIds: selectedStyles.map((style) => style.id) } : {}),
    };

    // Refs to access latest state in SSE callbacks (updated inline to avoid React batch staleness)
    const streamingTextRef = useRef(streamingText);
    const toolCallsRef = useRef(toolCalls);
    const chatMessagesRef = useRef(chatMessages);
    const activeIdRef = useRef(activeId);
    const conversationsRef = useRef(conversations);

    const refreshConversations = useCallback(async () => {
        let nextConversations = await readConversations();
        const activeConversation = nextConversations.find((conversation) => conversation.id === activeIdRef.current);
        if (activeConversation && getGenerationConversationStatus(activeConversation) !== "none" && activeConversation.generationStatus !== "running") {
            try {
                await markGenerationLogViewed(activeConversation.id);
                nextConversations = nextConversations.map((conversation) => (conversation.id === activeConversation.id ? { ...conversation, generationViewedAt: conversation.generationCompletedAt } : conversation));
            } catch (error) {
                console.error("标记图片生成记录已读失败", error);
            }
        }
        conversationsRef.current = nextConversations;
        setConversations(nextConversations);
        return nextConversations;
    }, []);

    const { sessionId, isStreaming, isStopping, sendMessage, cancelMessage, resetSession, restoreSession } = useAgentChatSSE({
        entrySource: "imagePage",
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
            setToolCalls((prev) => {
                const next = prev.some((item) => item.callId === call.callId)
                    ? prev.map((item) => (item.callId === call.callId ? call : item))
                    : [...prev, call];
                toolCallsRef.current = next;
                return next;
            });
            setChatMessages((prev) => {
                const next = upsertAgentActivityMessage(prev, createToolExecutionActivity(call));
                chatMessagesRef.current = next;
                return next;
            });
            // 只对生图/编辑工具在聊天区展示卡片，内部工具（query_history 等）不占聊天位
            const isImageTool = call.name === "generate_image" || call.name === "edit_image";
            if (isImageTool) {
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
                const toolText = call.name === "generate_image" ? "正在生成图片..." : "正在编辑图片...";
                setChatMessages((prev) => {
                    const toolMessage = { id: call.callId, role: "tool" as const, text: toolText, detail: call };
                    const next = prev.some((item) => item.id === call.callId)
                        ? prev.map((item) => (item.id === call.callId ? toolMessage : item))
                        : [...prev, toolMessage];
                    chatMessagesRef.current = next;
                    return next;
                });
                // 工具开始执行时清空流式文本，避免 LLM 预回复文本与工具结果重复显示
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
            // 同步更新 chatMessages 中对应消息的 detail，否则 buildChatThreadSection 看到的永远是 executing
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
            // 将流式文本保存为持久消息
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
            // 刷新侧栏（后端已保存生成记录）。历史会话追加生成完成后，交回历史视图展示，避免同一轮重复渲染。
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

    const creditCost = requestCreditCost({ modelCosts: effectiveConfig.modelCosts, model, taskType: "image", count: 1 });
    const activeConversation = conversations.find((item) => item.id === activeId) || null;
    const latestRound = activeConversation?.rounds.at(-1);
    const draftSettingsSummary = imageDraftSettingsModified ? buildImageSettingsSummary(config, effectiveConfig, model) : "";
    const historySettingsSummary = !imageDraftSettingsModified && activeId && latestRound?.config ? buildImageSettingsSummary(latestRound.config, effectiveConfig, latestRound.config.imageModel || latestRound.config.model || "") : "";
    const settingsSummary = draftSettingsSummary || historySettingsSummary;
    const activeConversationPending = activeConversation ? hasPendingImageConversation(activeConversation) : false;
    const canGenerate = Boolean(prompt.trim()) && !isStreaming && !activeConversationPending && !isPromptOptimizing && !uploadingReferenceIds.length;
    const allSelected = Boolean(conversations.length) && selectedIds.length === conversations.length;

    useEffect(() => {
        if (!sessionId || sessionId === activeIdRef.current) return;
        activeIdRef.current = sessionId;
        setActiveId(sessionId);
    }, [sessionId]);

    useEffect(() => {
        let cancelled = false;
        void refreshConversations().then((nextConversations) => {
            if (cancelled || activeIdRef.current) return;
            const pendingConversation = findLatestPendingConversation(nextConversations, hasPendingImageConversation);
            if (!pendingConversation) return;
            activeIdRef.current = pendingConversation.id;
            setActiveId(pendingConversation.id);
            restoreSession(pendingConversation.id);
        });
        return () => {
            cancelled = true;
        };
    }, [refreshConversations, restoreSession]);

    useEffect(() => {
        if (!hasRunningGeneration(conversations)) return;
        const refreshTimer = window.setInterval(() => {
            void refreshConversations();
        }, 2_000);
        return () => window.clearInterval(refreshTimer);
    }, [conversations, refreshConversations]);

    const addReferences = async (files?: FileList | File[] | null) => {
        const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
        const placeholders = imageFiles.map((file) => ({
            id: nanoid(),
            name: file.name,
            type: file.type,
            dataUrl: URL.createObjectURL(file),
        }));
        if (!placeholders.length) {
            return;
        }
        setReferences((current) => [...current, ...placeholders]);
        setUploadingReferenceIds((current) => [...current, ...placeholders.map((placeholder) => placeholder.id)]);
        await Promise.all(
            placeholders.map(async (placeholder, index) => {
                try {
                    const file = imageFiles[index];
                    const image = await uploadImage(file);
                    setReferences((current) =>
                        current.map((reference) =>
                            reference.id === placeholder.id
                                ? {
                                      ...placeholder,
                                      name: file.name,
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
        );
    };

    const generate = async () => {
        const text = prompt.trim();
        if (!text) {
            message.error("请输入生图提示词");
            return;
        }

        resetThinkings();

        // Add user message to chat
        setChatMessages((prev) => {
            const next = [...prev, { id: nanoid(), role: "user" as const, text, generationStyles: selectedStyles }];
            chatMessagesRef.current = next;
            return next;
        });

        // Send via Agent SSE — chat model resolved server-side from user config
        const refs = references.map((r) => ({ url: r.dataUrl, type: r.type, name: r.name, storageKey: r.storageKey }));
        await sendMessage(text, refs.length ? refs : undefined, agentCreationSettings);

        setPrompt("");
        setReferences([]);
        setSelectedStyles([]);
    };

    const regenerateRound = async (round: Round) => {
        await regenerateImageRound(round, {
            fallbackModel: model,
            appendUserMessage: (text, generationStyles) => {
                setChatMessages((prev) => {
                    const next = [...prev, { id: nanoid(), role: "user" as const, text, generationStyles }];
                    chatMessagesRef.current = next;
                    return next;
                });
            },
            sendMessage,
        });
        setSelectedStyles([]);
    };

    const newConversation = () => {
        setActiveId(null);
        activeIdRef.current = null;
        setImageDraftSettingsModified(false);
        setPrompt("");
        setReferences([]);
        setSelectedStyles([]);
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
        setImageDraftSettingsModified(false);
        // 清空 chat 状态，切换为历史记录视图
        setChatMessages([]);
        chatMessagesRef.current = [];
        setToolCalls([]);
        toolCallsRef.current = [];
        resetThinkings();
        setStreamingText(null);
        streamingTextRef.current = null;
        setPrompt("");
        setReferences([]);
        setSelectedStyles([]);
        setMobileSidebarOpen(false);
        restoreSession(conversation.id);
    };

    const toggleAll = () => {
        setSelectedIds(allSelected ? [] : conversations.map((item) => item.id));
    };

    const deleteSelected = () => {
        const imageKeys = conversations
            .filter((conversation) => selectedIds.includes(conversation.id))
            .flatMap((conversation) => conversation.rounds.flatMap((round) => round.results.flatMap((result) => (result.image?.storageKey ? [result.image.storageKey] : []))));
        void Promise.all([deleteStoredImages(imageKeys), deleteGenerationLogs(selectedIds)]).then(refreshConversations);
        if (activeId && selectedIds.includes(activeId)) {
            setActiveId(null);
            activeIdRef.current = null;
            setImageDraftSettingsModified(false);
            setPrompt("");
            setReferences([]);
            setSelectedStyles([]);
        }
        setSelectedIds([]);
        setManagementMode(false);
        setDeleteConfirmOpen(false);
    };

    const downloadImage = async (image: GeneratedImage, index: number) => {
        try {
            await downloadMedia(image, `image-${index + 1}.png`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "图片下载失败");
        }
    };

    const addResultToReferences = async (image: GeneratedImage, index: number) => {
        try {
            const stored = await reuseOrUploadImage(image);
            setReferences((current) => [
                ...current,
                {
                    id: nanoid(),
                    name: `result-${index + 1}.png`,
                    type: stored.mimeType,
                    dataUrl: stored.url,
                    storageKey: stored.storageKey,
                    objectStorage: stored.objectStorage || image.objectStorage,
                },
            ]);
            message.success("已加入参考图");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "加入参考图失败");
        }
    };

    const saveResultToAssets = (image: GeneratedImage, index: number) => {
        if (!image.storageKey) {
            message.error("生成图片缺少媒体存储键，请重新生成后再添加素材");
            return;
        }
        addAsset({
            kind: "image",
            title: `生成结果 ${index + 1}`,
            coverUrl: image.dataUrl,
            tags: [],
            source: "生图工作台",
            data: {
                dataUrl: image.dataUrl,
                storageKey: image.storageKey,
                width: image.width,
                height: image.height,
                bytes: image.bytes,
                mimeType: image.mimeType || "image/png",
                objectStorage: image.objectStorage,
            },
            metadata: {
                source: "image-page",
            },
        });
        message.success("已加入我的资产");
    };

    const uploadResultToObjectStorage = async (image: GeneratedImage, index: number) => {
        if (image.objectStorage?.url) {
            try {
                await navigator.clipboard.writeText(image.objectStorage.url);
                message.success("云储存地址已复制");
            } catch {
                message.error("云储存地址复制失败");
            }
            return;
        }

        setUploadingObjectStorageId(image.id);
        try {
            const file = await uploadRemoteObjectToStorage({
                storageKey: image.storageKey,
                sourceUrl: image.dataUrl,
                kind: "image",
                mimeType: image.mimeType,
            });
            setConversations((current) =>
                current.map((conversation) => ({
                    ...conversation,
                    rounds: conversation.rounds.map((round) => ({
                        ...round,
                        results: round.results.map((result) => (result.image?.id === image.id ? { ...result, image: { ...result.image, objectStorage: file } } : result)),
                    })),
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
                setReferences((current) => [
                    ...current,
                    {
                        id: nanoid(),
                        name: payload.title,
                        type: payload.mimeType,
                        dataUrl: payload.dataUrl,
                        storageKey: payload.storageKey,
                        objectStorage: payload.objectStorage,
                    },
                ]);
            }
        } else {
            message.warning("生图工作台只能使用文本或图片素材");
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
        const imageKeys = conversation?.rounds.flatMap((round) => round.results.flatMap((result) => (result.image?.storageKey ? [result.image.storageKey] : []))) || [];
        await Promise.all([deleteStoredImages(imageKeys), deleteGenerationLogs([conversationId])]);
        if (activeIdRef.current === conversationId) {
            newConversation();
        }
        await refreshConversations();
    };

    const conversationItems = buildImageConversationItems(conversations, activeId, selectedIds);
    const referenceChips: CreationReferenceChip[] = references.map((reference, index) => {
        const uploading = uploadingReferenceIds.includes(reference.id);
        return {
            id: reference.id,
            label: uploading ? `${imageReferenceLabel(index)} 上传中` : imageReferenceLabel(index),
            preview: (
                <div className="relative size-11">
                    <img src={reference.dataUrl} alt={reference.name} className="size-11 rounded-xl object-cover" />
                    {uploading ? (
                        <span className="absolute inset-0 grid place-items-center rounded-xl bg-black/35 text-white">
                            <LoaderCircle className="size-4 animate-spin" />
                        </span>
                    ) : null}
                </div>
            ),
            onRemove: () => setReferences((current) => current.filter((item) => item.id !== reference.id)),
        };
    });
    const composerActions: CreationComposerAction[] = [
        {
            key: "upload",
            label: "参考图",
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
            onClick: () => void optimizePrompt({ operationId: "image-page", generationType: "image", prompt, generationStyleIds: selectedStyles.map((style) => style.id), onSuccess: setPrompt }),
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
    const displayedConversation =
        activeConversation && isStreaming && activeConversationPending
            ? // 当前轮次已落库但仍在流式生成时，聊天区保留乐观状态，历史区只展示已完成轮次。
              {
                  ...activeConversation,
                  rounds: activeConversation.rounds.filter((round) => !round.results.some((result) => result.status === "pending")),
              }
            : activeConversation;
    const threadSections = displayedConversation
        ? buildImageThreadSections(displayedConversation, {
              uploadingObjectStorageId,
              onEdit: addResultToReferences,
              onDownload: downloadImage,
              onSaveAsset: saveResultToAssets,
              onUploadObjectStorage: uploadResultToObjectStorage,
              onRegenerate: regenerateRound,
          })
        : [];

    const chatThreadSection = buildChatThreadSection(
        chatMessages,
        completedThinkings,
        activeThinking,
        streamingText,
        toolCalls,
        (data) =>
            renderResultImages(data, {
                uploadingObjectStorageId,
                onEdit: addResultToReferences,
                onDownload: downloadImage,
                onSaveAsset: saveResultToAssets,
                onUploadObjectStorage: uploadResultToObjectStorage,
            }),
        renderPendingImageToolCall,
    );
    // 历史记录与当前生成中消息同时展示；当前待生成轮次仅在聊天区渲染。
    const allThreadSections = chatThreadSection ? [...threadSections, chatThreadSection] : threadSections;

    return (
        <>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
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
                                        Image Generation Workspace
                                    </div>
                                    <h2 className="text-[clamp(52px,8vw,108px)] font-black uppercase leading-[0.82] text-[var(--studio-ink)]">
                                        Image
                                        <br />
                                        <span className="text-transparent [-webkit-text-stroke:1px_var(--studio-ink)]">Agent</span>
                                    </h2>
                                    <p className="mt-7 max-w-lg text-base leading-7 text-[var(--studio-text)]">从一个提示词开始组织构图、材质与光线。生成结果会按轮次保留在这里，便于继续比较与细化。</p>
                                </div>
                            </div>
                        </div>
                    ),
                }}
                composer={{
                    agentLabel: "Image Agent",
                    value: prompt,
                    placeholder: "描述画面主体、风格、构图、光线和用途...",
                    references: referenceChips,
                    styleOptions,
                    selectedStyles,
                    styleLoading,
                    actions: composerActions,
                    running: isStreaming || activeConversationPending,
                    canSubmit: canGenerate,
                    stopping: isStopping,
                    focusWhenValueSet: focusInitialPrompt,
                    creditCost,
                    onChange: setPrompt,
                    onStyleSelect: (style) => {
                        setSelectedStyles((current) => {
                            if (current.some((selected) => selected.id === style.id)) {
                                message.info("该风格已选择");
                                return current;
                            }
                            if (current.length >= 3) {
                                message.warning("最多选择3个风格");
                                return current;
                            }
                            return [...current, style];
                        });
                    },
                    onStyleRemove: (styleId) => setSelectedStyles((current) => current.filter((style) => style.id !== styleId)),
                    onPasteImages: (files) => void addReferences(files),
                    onSubmit: () => void generate(),
                    onStop: isStreaming ? () => void cancelMessage() : undefined,
                }}
                settings={{
                    open: settingsOpen,
                    title: "图片设置",
                    onClose: () => setSettingsOpen(false),
                    content: (
                        <div className="space-y-4">
                            <ImageSettingsPanel config={config} onConfigChange={handleImageSettingsChange} theme={theme} showTitle={false} showCount={false} className="space-y-4 px-0 py-0" />
                            <div>
                                <label className="mb-1.5 block text-sm font-semibold text-[var(--studio-ink)]">模型</label>
                                <ModelPicker
                                    config={effectiveConfig}
                                    value={model}
                                    onChange={(value) => {
                                        if (value !== model) {
                                            setImageDraftSettingsModified(true);
                                        }
                                        updateConfig("imageModel", value);
                                    }}
                                    capability="image"
                                    fullWidth
                                    onMissingConfig={() => (userRole === "admin" ? openConfigDialog(false) : message.error("请联系管理员配置默认生图模型"))}
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

/** 从后端 resultData 渲染可交互的小尺寸图片卡片，兼容 urls 和 items 两种格式 */
function renderResultImages(
    data: Record<string, unknown>,
    handlers: {
        uploadingObjectStorageId: string;
        onEdit: (image: GeneratedImage, index: number) => void;
        onDownload: (image: GeneratedImage, index: number) => void;
        onSaveAsset: (image: GeneratedImage, index: number) => void;
        onUploadObjectStorage: (image: GeneratedImage, index: number) => void;
    },
): React.ReactNode {
    const images = extractGeneratedImages(data);
    if (!images.length) return null;
    return (
        <div className="flex flex-wrap items-start gap-3">
            {images.map((image, index) => (
                <ResultCard
                    key={image.id}
                    image={image}
                    index={index}
                    uploadingObjectStorage={handlers.uploadingObjectStorageId === image.id}
                    onEdit={handlers.onEdit}
                    onDownload={handlers.onDownload}
                    onSaveAsset={handlers.onSaveAsset}
                    onUploadObjectStorage={handlers.onUploadObjectStorage}
                />
            ))}
        </div>
    );
}

function extractGeneratedImages(data: Record<string, unknown>): GeneratedImage[] {
    const items = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];
    if (items.length) {
        return items
            .map((item, index) => {
                const dataUrl = readString(item.url) || readString(item.dataUrl);
                return {
                    id: readString(item.id) || readString(item.storageKey) || readString(item.key) || `image-${index + 1}`,
                    dataUrl,
                    storageKey: readString(item.storageKey) || readString(item.key) || undefined,
                    durationMs: readNumber(item.durationMs),
                    width: readNumber(item.width),
                    height: readNumber(item.height),
                    bytes: readNumber(item.bytes),
                    mimeType: readString(item.mimeType) || undefined,
                    objectStorage: readObjectStorage(item.objectStorage),
                };
            })
            .filter((image) => Boolean(image.dataUrl));
    }

    const urls = Array.isArray(data.urls) ? (data.urls as unknown[]) : [];
    return urls
        .map((url, index) => {
            const dataUrl = typeof url === "string" ? url : "";
            return {
                id: `image-${index + 1}`,
                dataUrl,
                durationMs: 0,
                width: 0,
                height: 0,
                bytes: 0,
            };
        })
        .filter((image) => Boolean(image.dataUrl));
}

function readString(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function readNumber(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readObjectStorage(value: unknown): ObjectStorageFile | undefined {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    return value as ObjectStorageFile;
}

/** 根据图片设置生成 composer 按钮摘要，历史配置缺字段时沿用面板默认值。 */
function buildImageSettingsSummary(settings: Partial<Pick<AiConfig, "quality" | "imageResolution" | "size">> & { resolution?: string }, modelConfig: AiConfig, model: string): string {
    return formatImageGenerationSettingsSummary({
        quality: imageQualityLabel(settings.quality || "medium"),
        resolution: imageResolutionLabel(settings.imageResolution || settings.resolution || "2K"),
        ratio: imageSizeLabel(settings.size || "1:1"),
        model: modelOptionLabel(modelConfig, model),
    });
}

function buildImageConversationItems(conversations: Conversation[], activeId: string | null, selectedIds: string[]): CreationConversationItem[] {
    return conversations.map((conversation) => {
        const latestImage = conversation.rounds
            .slice()
            .reverse()
            .flatMap((round) => round.results)
            .find((result) => result.status === "success" && result.image)?.image;

        return {
            id: conversation.id,
            title: conversation.title,
            subtitle: `${formatConversationTime(conversation.updatedAt)} · ${conversation.rounds.length} 轮`,
            preview: latestImage ? (
                <img src={latestImage.dataUrl} alt="" className="size-10 rounded-xl object-cover" />
            ) : (
                <div className="grid size-10 place-items-center rounded-xl bg-[var(--studio-media)]">
                    <ImagePlus className="size-4 text-[var(--studio-muted)]" />
                </div>
            ),
            active: activeId === conversation.id,
            selected: selectedIds.includes(conversation.id),
            status: getGenerationConversationStatus(conversation),
        };
    });
}

function buildImageThreadSections(
    activeConversation: Conversation,
    handlers: {
        uploadingObjectStorageId: string;
        onEdit: (image: GeneratedImage, index: number) => void;
        onDownload: (image: GeneratedImage, index: number) => void;
        onSaveAsset: (image: GeneratedImage, index: number) => void;
        onUploadObjectStorage: (image: GeneratedImage, index: number) => void;
        onRegenerate: (round: Round) => Promise<void>;
    },
): CreationThreadSection[] {
    const sectionMap = new Map<string, CreationThreadSection["rounds"]>();

    for (const round of activeConversation.rounds) {
        const label = formatThreadSectionLabel(round.createdAt);
        const rounds = sectionMap.get(label) || [];
        rounds.push({
            id: round.id,
            userText: round.prompt,
            userCopyText: formatGenerationStyleMessage(round.prompt, round.generationStyleSnapshots),
            userAttachments: round.references.length || round.generationStyleSnapshots?.length
                ? (
                    <div className="space-y-2">
                        {renderGenerationStyleSnapshots(round.generationStyleSnapshots)}
                        {round.references.length ? renderImageRoundReferences(round) : null}
                    </div>
                )
                : undefined,
            statusText: buildImageStatusText(round),
            assistantText: buildImageAssistantText(round),
            activities: round.activities,
            resultContent: (
                <div className="flex flex-wrap items-start gap-3">
                    {round.results.map((result, index) =>
                        result.status === "success" && result.image ? (
                            <ResultCard
                                key={result.id}
                                image={result.image}
                                index={index}
                                uploadingObjectStorage={handlers.uploadingObjectStorageId === result.image.id}
                                onEdit={handlers.onEdit}
                                onDownload={handlers.onDownload}
                                onSaveAsset={handlers.onSaveAsset}
                                onUploadObjectStorage={handlers.onUploadObjectStorage}
                                onRegenerate={() => void handlers.onRegenerate(round)}
                            />
                        ) : result.status === "failed" || result.status === "canceled" ? (
                            <FailedCard key={result.id} error={result.error || "生成失败"} canceled={result.status === "canceled"} />
                        ) : (
                            <ImageGeneratingCard key={result.id} size={round.config.size} />
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

function renderImageRoundReferences(round: Round) {
    const visibleReferences = round.references.filter((reference) => Boolean(reference.dataUrl?.trim()));
    return (
        <div className="flex flex-wrap gap-2">
            {visibleReferences.map((reference, index) => (
                <img key={reference.id} src={reference.dataUrl} alt={reference.name} className="size-14 rounded-xl object-cover ring-1 ring-[var(--studio-line)]" title={imageReferenceLabel(index)} />
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

function buildImageStatusText(round: Round): string {
    const pendingCount = round.results.filter((result) => result.status === "pending").length;
    const successCount = round.results.filter((result) => result.status === "success").length;
    const failedCount = round.results.filter((result) => result.status === "failed").length;
    const canceledCount = round.results.filter((result) => result.status === "canceled").length;

    if (pendingCount) {
        return "生成中";
    }
    if (successCount && failedCount) {
        return `已完成 ${successCount} 张，失败 ${failedCount} 张`;
    }
    if (successCount) {
        return canceledCount ? `已完成 ${successCount} 张，已停止 ${canceledCount} 张` : `已完成 ${successCount} 张`;
    }
    if (canceledCount) return "已停止生成";
    return "生成失败";
}

function buildImageAssistantText(round: Round): string {
    // 优先使用 Agent 对话中 LLM 的真实回复
    if (round.assistantText) return round.assistantText;
    const pendingCount = round.results.filter((result) => result.status === "pending").length;
    const successCount = round.results.filter((result) => result.status === "success").length;
    const failedCount = round.results.filter((result) => result.status === "failed").length;
    const canceledCount = round.results.filter((result) => result.status === "canceled").length;

    if (pendingCount) return "生成中…";
    if (successCount && failedCount) return `已完成 ${successCount} 张，失败 ${failedCount} 张`;
    if (successCount) return canceledCount ? `已完成 ${successCount} 张，已停止 ${canceledCount} 张` : `已完成 ${successCount} 张`;
    if (canceledCount) return "已停止生成，你可以直接重新生成。";
    return "生成失败";
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
    image,
    index,
    uploadingObjectStorage,
    onEdit,
    onDownload,
    onSaveAsset,
    onUploadObjectStorage,
    onRegenerate,
}: {
    image: GeneratedImage;
    index: number;
    uploadingObjectStorage: boolean;
    onEdit: (image: GeneratedImage, index: number) => void;
    onDownload: (image: GeneratedImage, index: number) => void;
    onSaveAsset: (image: GeneratedImage, index: number) => void;
    onUploadObjectStorage: (image: GeneratedImage, index: number) => void;
    onRegenerate?: () => void;
}) {
    const [loadedMeta, setLoadedMeta] = useState<{ width: number; height: number; bytes: number }>({ width: image.width, height: image.height, bytes: image.bytes });
    const [isDownloading, setIsDownloading] = useState(false);
    const displayWidth = image.width > 0 ? image.width : loadedMeta.width;
    const displayHeight = image.height > 0 ? image.height : loadedMeta.height;
    const displayBytes = image.bytes > 0 ? image.bytes : loadedMeta.bytes;
    const hasSize = displayWidth > 0 && displayHeight > 0;
    const hasBytes = displayBytes > 0;
    const previewAspectRatio = hasSize ? `${displayWidth}/${displayHeight}` : "1 / 1";
    const previewWidth = buildImagePreviewWidth(displayWidth, displayHeight);

    useEffect(() => {
        let cancelled = false;
        const picture = new window.Image();
        picture.onload = () => {
            if (cancelled) return;
            setLoadedMeta((current) => ({
                ...current,
                width: picture.naturalWidth || current.width,
                height: picture.naturalHeight || current.height,
            }));
        };
        picture.src = image.dataUrl;

        if (image.bytes <= 0 && /^https?:\/\//i.test(image.dataUrl)) {
            void readImageContentLength(image.dataUrl).then((bytes) => {
                if (!cancelled && bytes > 0) {
                    setLoadedMeta((current) => ({ ...current, bytes }));
                }
            });
        }

        return () => {
            cancelled = true;
        };
    }, [image.dataUrl, image.bytes]);

    const downloadResult = async () => {
        if (isDownloading) return;
        setIsDownloading(true);
        try {
            await onDownload(image, index);
        } finally {
            setIsDownloading(false);
        }
    };

    return (
        <div
            className="group w-full overflow-hidden rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] transition hover:-translate-y-0.5 hover:border-[var(--studio-primary-line)] sm:w-auto"
            style={{ width: `min(100%, ${previewWidth}px)` }}
        >
            <div className="relative overflow-hidden bg-[var(--studio-media)]" style={{ aspectRatio: previewAspectRatio }}>
                <Image src={image.dataUrl} alt={`结果 ${index + 1}`} style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }} />
                <div className="absolute left-2 top-2 rounded-full bg-black/60 px-2.5 py-0.5 text-xs font-medium text-white">#{index + 1}</div>
            </div>
            <div className="space-y-2.5 border-t border-[var(--studio-line)] px-3 py-2.5">
                <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-[var(--studio-muted)]">
                    {hasSize ? (
                        <span>
                            {displayWidth}x{displayHeight}
                        </span>
                    ) : null}
                    {hasBytes ? <span>{formatBytes(displayBytes)}</span> : null}
                    {image.objectStorage?.url ? (
                        <Tag className="!m-0 !text-[10px]" color="blue">
                            云储存
                        </Tag>
                    ) : null}
                </div>
                <div className="flex gap-1">
                    <Tooltip title={image.objectStorage?.url ? "复制云储存地址" : "上传到云储存"}>
                        <Button size="small" className="!h-7 !w-7 !min-w-0 !rounded-full !p-0" loading={uploadingObjectStorage} icon={<CloudUpload className="size-3.5" />} onClick={() => void onUploadObjectStorage(image, index)} />
                    </Tooltip>
                    <Tooltip title="添加到素材">
                        <Button size="small" className="!h-7 !w-7 !min-w-0 !rounded-full !p-0" icon={<FolderPlus className="size-3.5" />} onClick={() => void onSaveAsset(image, index)} />
                    </Tooltip>
                    <Tooltip title="加入参考图">
                        <Button size="small" className="!h-7 !w-7 !min-w-0 !rounded-full !p-0" icon={<PenLine className="size-3.5" />} onClick={() => void onEdit(image, index)} />
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

function buildImagePreviewWidth(width: number, height: number): number {
    if (width <= 0 || height <= 0) {
        return IMAGE_PREVIEW_BASE_HEIGHT;
    }
    const ratio = width / height;
    return Math.round(Math.min(IMAGE_PREVIEW_MAX_WIDTH, Math.max(IMAGE_PREVIEW_MIN_WIDTH, IMAGE_PREVIEW_BASE_HEIGHT * ratio)));
}

async function readImageContentLength(url: string): Promise<number> {
    try {
        const response = await fetch(url, { method: "HEAD" });
        const value = Number(response.headers.get("content-length") || 0);
        return Number.isFinite(value) ? value : 0;
    } catch {
        return 0;
    }
}

function FailedCard({ error, canceled }: { error: string; canceled?: boolean }) {
    return (
        <div className="w-full overflow-hidden rounded-xl border border-red-300/40 bg-red-500/10 sm:w-[240px]">
            <div className="flex aspect-square flex-col items-center justify-center gap-3 p-5 text-center">
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
        const values = await listGenerationLogs<Conversation>("image");
        const conversations = await Promise.all(values.map(normalizeConversation));
        return conversations.sort((left, right) => (right.updatedAt || right.createdAt || 0) - (left.updatedAt || left.createdAt || 0));
    } catch {
        return [];
    }
}

async function normalizeConversation(raw: Partial<Conversation>): Promise<Conversation> {
    const rounds = await Promise.all(
        (raw.rounds || []).map(async (round) => ({
            ...round,
            activities: normalizeAgentActivities(round.activities),
            references: await Promise.all((round.references || []).map(async (reference) => ({ ...reference, dataUrl: await resolveImageUrl(reference.storageKey, reference.dataUrl) }))),
            results: await Promise.all(
                (round.results || []).map(async (result) => {
                    if (!result.image) return result;
                    const storageInfo = await resolveImageStorageInfo(result.image.storageKey, result.image.dataUrl, result.image.objectStorage);
                    return {
                        ...result,
                        image: {
                            ...result.image,
                            dataUrl: storageInfo.url,
                            objectStorage: storageInfo.objectStorage,
                        },
                    };
                }),
            ),
        })),
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
