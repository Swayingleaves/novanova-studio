"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ArrowUp, BookOpenText, ChevronDown, FileText, Image as ImageIcon, LoaderCircle, Plus, Search, Sparkles, Square, Video, X } from "lucide-react";
import { App, Button, Modal, Tooltip } from "antd";

import { ModelPicker } from "@/features/settings/components/model-picker";
import { listSkills, type SkillOption } from "@/services/api/server";
import { defaultConfig, normalizeModelOptionValue, useEffectiveConfig, type AiConfig } from "@/features/settings/stores/use-config-store";
import { normalizeImageGenerationCount } from "@/features/generation/components/image-settings-panel";
import { normalizeVideoGenerationCount } from "@/features/generation/components/video-settings-panel";
import { CreditCostDisplay, requestCreditCost } from "@/features/generation/constants/credits";
import { availableVideoModelsForMode, quoteVideoGeneration } from "@/features/generation/lib/video-billing";
import { uploadImage } from "@/features/storage/services/image-storage";
import { uploadMediaFile } from "@/features/storage/services/file-storage";
import type { ObjectStorageFile } from "@/shared/types/object-storage";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasPromptPicker } from "./canvas-prompt-picker";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import type { CanvasGenerationMode, CanvasNode, CanvasNodeKind } from "../types";
import type { CanvasSettingGraphSkillSnapshot } from "../types";
import { isImageNode, isTextNode, isVideoNode, type CanvasNodeAttributes } from "../domain/canvas-node";
import { buildNodeGenerationReferences, labelForKind, type CanvasResourceReference } from "../utils/canvas-resource-references";
import { useCanvasTheme } from "./canvas-theme-provider";
import type { CanvasTheme } from "@/shared/lib/canvas-theme";
import type { GenerationStyleOption, GenerationStyleSnapshot } from "@/services/api/server";
import { GenerationStyleChips, GenerationStyleMenu, useGenerationStyles } from "@/features/generation/components/generation-style-picker";
import { filterGenerationStyles, GENERATION_STYLE_SELECTION_LIMIT_MESSAGE, MAX_GENERATION_STYLE_SELECTION_COUNT } from "@/features/generation/lib/generation-style-library";
import { getStyleCommandRange, parseGenerationStyleMessage, removeStyleCommand } from "@/features/generation/lib/style-command";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type DisplayReference = {
    reference: CanvasResourceReference;
    canInsert: boolean;
};

type CanvasNodePromptPanelProps = {
    node: CanvasNode;
    isRunning: boolean;
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: CanvasNodeAttributes) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string, styleIds?: number[], styleSnapshots?: GenerationStyleSnapshot[]) => void;
    onGeneratePrompt: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string, onResult: (prompt: string) => void, styleIds?: number[]) => void;
    onStop: (nodeId: string) => void;
    onMissingConfig: (mode: CanvasNodeGenerationMode) => void;
    onRemoveReference: (reference: CanvasResourceReference) => void;
    mentionCandidates?: CanvasResourceReference[];
    onMentionSelect?: (reference: CanvasResourceReference) => boolean;
    isPromptGenerating?: boolean;
    mentionReferences?: CanvasResourceReference[];
    onImageSettingsOpenChange?: (open: boolean) => void;
    onApplyContent?: (nodeId: string, content: string) => void;
};

export function CanvasNodePromptPanel({
    node,
    isRunning,
    onPromptChange,
    onConfigChange,
    onGenerate,
    onGeneratePrompt,
    onStop,
    onMissingConfig,
    onRemoveReference,
    mentionCandidates = [],
    onMentionSelect,
    isPromptGenerating = false,
    mentionReferences = [],
    onImageSettingsOpenChange,
    onApplyContent,
}: CanvasNodePromptPanelProps) {
    const globalConfig = useEffectiveConfig();
    const theme = useCanvasTheme();
    const { message } = App.useApp();
    const mode = defaultMode(node.kind);
    const styleCatalog = useGenerationStyles(mode === "image" || mode === "video" ? mode : undefined);
    const persistedSnapshots = useMemo(() => (isImageNode(node) || isVideoNode(node) ? node.generation.generationStyleSnapshots : []), [node]);
    const [selectedStyles, setSelectedStyles] = useState<GenerationStyleOption[]>(() => (persistedSnapshots || []).map((style) => ({ id: style.id, name: style.name, generationType: style.generationType, coverUrl: "", category: "" })));
    const [styleMenuOpen, setStyleMenuOpen] = useState(false);
    const [styleQuery, setStyleQuery] = useState("");
    const [styleCommand, setStyleCommand] = useState<{ start: number; end: number } | null>(null);
    const [highlightedStyleIndex, setHighlightedStyleIndex] = useState(0);
    const [referencePreview, setReferencePreview] = useState<CanvasResourceReference | null>(null);
    const referenceInputRef = useRef<HTMLInputElement>(null);
    const [uploadingReference, setUploadingReference] = useState(false);
    const [mentionQuery, setMentionQuery] = useState("");
    const [mentionMenuOpen, setMentionMenuOpen] = useState(false);
    const [mentionRange, setMentionRange] = useState<{ start: number; end: number } | null>(null);
    const [mentionHighlightedIndex, setMentionHighlightedIndex] = useState(0);
    const [mentionPosition, setMentionPosition] = useState<{ left: number; top: number } | null>(null);
    const [pendingMentionReference, setPendingMentionReference] = useState<CanvasResourceReference | null>(null);
    const promptEditorRef = useRef<PromptEditorHandle>(null);
    const promptPanelRef = useRef<HTMLDivElement>(null);
    const libraryPromptRef = useRef<string | null>(null);
    const config = buildNodeConfig(globalConfig, node, mode);
    const nodePrompt = readNodePrompt(node);
    const hasTextContent = isTextNode(node) && Boolean(node.content.text.trim());
    const hasImageContent = isImageNode(node) && Boolean(node.content.source);
    const isEditingExistingContent = hasTextContent || hasImageContent;
    const displayReferences = useMemo<DisplayReference[]>(() => {
        const references: DisplayReference[] = [];
        const previewUrls = new Set<string>();
        mentionReferences
            .filter((reference) => reference.active && reference.kind !== "text")
            .forEach((reference) => {
                references.push({ reference, canInsert: true });
                if (reference.previewUrl) previewUrls.add(reference.previewUrl);
            });
        buildNodeGenerationReferences(node).forEach((reference) => {
            if (reference.previewUrl && previewUrls.has(reference.previewUrl)) return;
            references.push({ reference, canInsert: false });
            if (reference.previewUrl) previewUrls.add(reference.previewUrl);
        });
        return references;
    }, [mentionReferences, node]);
    const [prompt, setPrompt] = useState(nodePrompt);
    const filteredMentionCandidates = useMemo(() => {
        const query = mentionQuery.trim().toLowerCase();
        return mentionCandidates
            .filter((reference) => reference.nodeId !== node.id)
            .filter((reference) => !query || `${reference.title} ${reference.label} ${reference.kind}`.toLowerCase().includes(query));
    }, [mentionCandidates, mentionQuery, node.id]);
    const videoReferenceCounts = displayReferences.reduce(
        (counts, item) => {
            if (item.reference.kind === "image") counts.images += 1;
            if (item.reference.kind === "video") counts.videos += 1;
            return counts;
        },
        { images: 0, videos: 0 },
    );
    const videoQuote =
        mode === "video"
            ? quoteVideoGeneration({
                  config,
                  model: config.model,
                  mode: config.videoGenerationMode,
                  resolution: config.vquality,
                  seconds: config.videoSeconds,
                  imageReferenceCount: videoReferenceCounts.images,
                  videoReferenceCount: videoReferenceCounts.videos,
                  taskCount: normalizeVideoGenerationCount(config.count),
              })
            : null;
    const creditCost =
        mode === "video"
            ? videoQuote?.available
                ? videoQuote.credits
                : null
            : requestCreditCost({
                  modelCosts: config.modelCosts,
                  model: config.model,
                  taskType: mode,
                  count: mode === "image" ? config.count : 1,
              });

    useEffect(() => {
        setSelectedStyles((persistedSnapshots || []).map((style) => ({ id: style.id, name: style.name, generationType: style.generationType, coverUrl: "", category: "" })));
        setStyleMenuOpen(false);
        setStyleCommand(null);
        setStyleQuery("");
    }, [node.id, persistedSnapshots]);

    useEffect(() => {
        setReferencePreview(null);
        setMentionMenuOpen(false);
        setMentionQuery("");
        setMentionRange(null);
        setMentionHighlightedIndex(0);
        setMentionPosition(null);
        setPendingMentionReference(null);
    }, [node.id]);

    useEffect(() => {
        if (nodePrompt) {
            setPrompt(nodePrompt);
            return;
        }
        if (isEditingExistingContent) {
            setPrompt(libraryPromptRef.current ?? "");
            libraryPromptRef.current = null;
            return;
        }
        setPrompt("");
    }, [isEditingExistingContent, node.id, nodePrompt]);

    // 从连线引用中提取非文本类型标签，用于点击缩略图后生成引用芯片
    const editorReferences = useMemo(() => {
        if (!pendingMentionReference) return mentionReferences;
        const hasReference = mentionReferences.some((reference) => reference.nodeId === pendingMentionReference.nodeId);
        if (!hasReference) return [...mentionReferences, pendingMentionReference];
        // 连线刷新后可能重新计算编号，暂时保留用户刚插入的标签，避免芯片退化为普通文本。
        return mentionReferences.map((reference) => reference.nodeId === pendingMentionReference.nodeId ? { ...reference, label: pendingMentionReference.label, active: true } : reference);
    }, [mentionReferences, pendingMentionReference]);
    useEffect(() => {
        if (pendingMentionReference && !prompt.includes(pendingMentionReference.label)) setPendingMentionReference(null);
    }, [pendingMentionReference, prompt]);
    const requiredLabels = useMemo(() => editorReferences.filter((ref) => ref.active && ref.kind !== "text").map((ref) => ref.label), [editorReferences]);

    // 失焦时无额外处理（芯片可被用户自由删除）
    const handleBlur = useCallback(() => {
        // no-op: 芯片不再自动恢复
    }, []);

    const updatePrompt = (value: string) => {
        setPrompt(value);
        if (!isEditingExistingContent) onPromptChange(node.id, value);
    };
    const filteredStyles = useMemo(() => filterGenerationStyles(styleCatalog.styles, styleQuery), [styleCatalog.styles, styleQuery]);
    const closeStyleMenu = () => {
        setStyleMenuOpen(false);
        setStyleCommand(null);
        setStyleQuery("");
        setHighlightedStyleIndex(0);
    };
    const chooseStyle = (style: GenerationStyleOption) => {
        if (selectedStyles.some((item) => item.id === style.id)) return;
        setSelectedStyles([style]);
        updatePrompt(styleCommand ? removeStyleCommand(prompt, styleCommand.start, styleCommand.end) : prompt);
        closeStyleMenu();
    };

    const closeMentionMenu = () => {
        setMentionMenuOpen(false);
        setMentionQuery("");
        setMentionRange(null);
        setMentionHighlightedIndex(0);
        setMentionPosition(null);
    };

    const chooseMention = (reference: CanvasResourceReference) => {
        if (!mentionRange || !onMentionSelect) return;
        if (!onMentionSelect(reference)) return;
        const existingReference = mentionReferences.find((item) => item.nodeId === reference.nodeId);
        const nextKindIndex = mentionReferences.filter((item) => item.active && item.kind === reference.kind).length;
        const label = existingReference?.label || labelForKind(reference.kind, nextKindIndex);
        setPendingMentionReference({ ...reference, active: true, label });
        const range = { ...mentionRange };
        // 连线状态更新后才会把视频预览信息传回编辑器，下一帧替换可避免先渲染成普通文本。
        requestAnimationFrame(() => promptEditorRef.current?.replaceTextRange(range.start, range.end, label));
        closeMentionMenu();
    };

    const applyPromptFromLibrary = (value: string) => {
        libraryPromptRef.current = value;
        setPrompt(value);
        onPromptChange(node.id, value);
        // 文本节点选择提示词时，同步更新 AI 输入框和节点正文。
        if (isTextNode(node)) onApplyContent?.(node.id, value);
    };

    const submit = () => {
        const text = prompt.trim();
        if (!text || isRunning || isPromptGenerating) return;
        if (mode === "video" && !videoQuote?.available) {
            message.error(videoQuote?.reason || "当前视频配置无法报价");
            return;
        }
        const styleIds = selectedStyles.map((style) => style.id);
        const styleSnapshots = persistedSnapshots?.filter((snapshot) => styleIds.includes(snapshot.id)) || [];
        const usesHistoricalSnapshots = styleSnapshots.length === styleIds.length;
        onGenerate(node.id, mode, formatPromptReferenceLabels(text, requiredLabels), usesHistoricalSnapshots ? undefined : styleIds, usesHistoricalSnapshots && styleSnapshots.length ? styleSnapshots : undefined);
        setPrompt("");
        setSelectedStyles([]);
    };

    const addReferenceFiles = async (files: FileList | null) => {
        if (!files?.length || !isVideoNode(node)) return;
        setUploadingReference(true);
        try {
            const generation = node.generation;
            const imageReferences = [...generation.references];
            const imageStorages = [...generation.referenceObjectStorages];
            const videoReferences = [...(generation.videoReferences || [])];
            const videoStorages = [...(generation.videoReferenceObjectStorages || [])];
            for (const file of Array.from(files)) {
                if (file.type.startsWith("video/")) {
                    const uploaded = await uploadMediaFile(file, "video");
                    videoReferences.push(persistedReferenceValue(uploaded.objectStorage?.url, uploaded.url, uploaded.storageKey));
                    if (uploaded.objectStorage) videoStorages.push(uploaded.objectStorage);
                } else {
                    const uploaded = await uploadImage(file);
                    imageReferences.push(persistedReferenceValue(uploaded.objectStorage?.url, uploaded.url, uploaded.storageKey));
                    if (uploaded.objectStorage) imageStorages.push(uploaded.objectStorage);
                }
            }
            onConfigChange(node.id, { references: imageReferences, referenceObjectStorages: imageStorages, videoReferences, videoReferenceObjectStorages: videoStorages });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "参考素材上传失败");
        } finally {
            setUploadingReference(false);
        }
    };

    const removePersistedReference = (reference: CanvasResourceReference) => {
        if (!isVideoNode(node)) return;
        const url = reference.previewUrl;
        if (!url) return;
        const generation = node.generation;
        const imageStorages = generation.referenceObjectStorages || [];
        const videoStorages = generation.videoReferenceObjectStorages || [];
        const entryUrl = (entry: string, files: ObjectStorageFile[]) => files.find((file) => file.url === entry || file.key === entry.replace(/^(?:image|video):/, ""))?.url || entry;
        onConfigChange(node.id, {
            references: generation.references.filter((entry) => entryUrl(entry, imageStorages) !== url),
            referenceObjectStorages: imageStorages.filter((file) => file.url !== url),
            videoReferences: (generation.videoReferences || []).filter((entry) => entryUrl(entry, videoStorages) !== url),
            videoReferenceObjectStorages: videoStorages.filter((file) => file.url !== url),
        });
    };

    return (
        <div
            data-canvas-no-zoom
            ref={promptPanelRef}
            className="relative cursor-default rounded-2xl border p-3 shadow-2xl"
            style={{ background: theme.node.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheelCapture={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <input
                ref={referenceInputRef}
                type="file"
                accept="image/*,video/*"
                multiple
                className="hidden"
                onChange={(event) => {
                    void addReferenceFiles(event.target.files);
                    event.target.value = "";
                }}
            />

            {displayReferences.length > 0 || (mode === "video" && (config.videoGenerationMode === "image-to-video" || config.videoGenerationMode === "reference-to-video")) ? (
                <div className="mb-3 min-w-0 border-b pb-3" style={{ borderColor: theme.node.stroke }}>
                    <p className="mb-2 text-xs font-medium" style={{ color: theme.node.muted }}>
                        参考内容
                    </p>
                    <div className="thin-scrollbar flex min-w-0 gap-2 overflow-x-auto pb-1">
                        {displayReferences.map(({ reference, canInsert }, index) => (
                            <ReferenceContentItem
                                key={reference.nodeId}
                                reference={reference}
                                index={index + 1}
                                canInsert={canInsert}
                                canRemove={reference.nodeId !== node.id && (canInsert || (mode === "video" && !canInsert))}
                                theme={theme}
                                onPreview={() => setReferencePreview(reference)}
                                onInsert={() => promptEditorRef.current?.insertAtCursor(reference.label)}
                                onRemove={() => (canInsert ? onRemoveReference(reference) : removePersistedReference(reference))}
                            />
                        ))}
                        {mode === "video" && (config.videoGenerationMode === "image-to-video" || config.videoGenerationMode === "reference-to-video") ? (
                            <button
                                type="button"
                                title="上传参考素材"
                                aria-label="上传参考素材"
                                className="grid size-14 shrink-0 place-items-center rounded-xl border transition hover:brightness-110 active:scale-95"
                                style={{ borderColor: theme.node.stroke, background: theme.node.fill, color: theme.node.muted }}
                                disabled={uploadingReference}
                                onClick={() => referenceInputRef.current?.click()}
                            >
                                {uploadingReference ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
                            </button>
                        ) : null}
                    </div>
                </div>
            ) : null}

            <PromptEditor
                ref={promptEditorRef}
                prompt={prompt}
                requiredLabels={requiredLabels}
                references={editorReferences}
                placeholder={promptPlaceholder(mode, hasImageContent, hasTextContent)}
                theme={theme}
                onChange={updatePrompt}
                onSubmit={submit}
                onBlur={handleBlur}
                onMentionInput={(value, cursor, caretRect) => {
                    const beforeCursor = value.slice(0, cursor);
                    const match = beforeCursor.match(/(^|\s)@([^\s@]*)$/);
                    if (!match) {
                        if (mentionMenuOpen) closeMentionMenu();
                        return;
                    }
                    const start = cursor - match[0].length + (match[1] ? match[1].length : 0);
                    setMentionRange({ start, end: cursor });
                    setMentionQuery(match[2]);
                    setMentionHighlightedIndex(0);
                    const panelRect = promptPanelRef.current?.getBoundingClientRect();
                    if (caretRect && panelRect) {
                        setMentionPosition({
                            left: caretRect.right - panelRect.left + 6,
                            top: caretRect.top - panelRect.top - 6,
                        });
                    }
                    setMentionMenuOpen(true);
                }}
                onMentionMenuKeyDown={(event) => {
                    if (!mentionMenuOpen) return false;
                    if (event.key === "ArrowDown") {
                        event.preventDefault();
                        setMentionHighlightedIndex((value) => Math.min(value + 1, Math.max(0, filteredMentionCandidates.length - 1)));
                        return true;
                    }
                    if (event.key === "ArrowUp") {
                        event.preventDefault();
                        setMentionHighlightedIndex((value) => Math.max(value - 1, 0));
                        return true;
                    }
                    if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        const reference = filteredMentionCandidates[mentionHighlightedIndex];
                        if (reference) chooseMention(reference);
                        return true;
                    }
                    if (event.key === "Escape") {
                        event.preventDefault();
                        closeMentionMenu();
                        return true;
                    }
                    return false;
                }}
                onPasteText={(value) => {
                    const parsed = parseGenerationStyleMessage(
                        value,
                        styleCatalog.styles.filter((style) => style.generationType === mode),
                    );
                    if (!parsed || mode === "text") return false;
                    const nextStyles = parsed.styles as GenerationStyleOption[];
                    const additions = nextStyles.filter((style) => !selectedStyles.some((item) => item.id === style.id));
                    const remaining = Math.max(0, MAX_GENERATION_STYLE_SELECTION_COUNT - selectedStyles.length);
                    if (additions.length > remaining) {
                        message.warning(GENERATION_STYLE_SELECTION_LIMIT_MESSAGE);
                    }
                    additions.slice(0, remaining).forEach((style) => setSelectedStyles((current) => (current.some((item) => item.id === style.id) ? current : [...current, style])));
                    updatePrompt(parsed.prompt);
                    return true;
                }}
                onStyleInput={(value, cursor) => {
                    const command = getStyleCommandRange(value, cursor);
                    setStyleCommand(command ? { start: command.start, end: command.end } : null);
                    setStyleQuery(command?.query || "");
                    setStyleMenuOpen(Boolean(command));
                }}
                onStyleMenuKeyDown={(event) => {
                    if (!styleMenuOpen) return false;
                    if (event.key === "ArrowDown") {
                        event.preventDefault();
                        setHighlightedStyleIndex((value) => Math.min(value + 1, Math.max(0, filteredStyles.length - 1)));
                        return true;
                    }
                    if (event.key === "ArrowUp") {
                        event.preventDefault();
                        setHighlightedStyleIndex((value) => Math.max(value - 1, 0));
                        return true;
                    }
                    if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        const style = filteredStyles[highlightedStyleIndex];
                        if (style) chooseStyle(style);
                        return true;
                    }
                    if (event.key === "Escape") {
                        event.preventDefault();
                        closeStyleMenu();
                        return true;
                    }
                    return false;
                }}
            />

            {mentionMenuOpen ? (
                <MentionAssetMenu
                    query={mentionQuery}
                    candidates={filteredMentionCandidates}
                    highlightedIndex={mentionHighlightedIndex}
                    theme={theme}
                    onSelect={chooseMention}
                    onHighlight={setMentionHighlightedIndex}
                    onQueryChange={(value) => {
                        setMentionQuery(value);
                        setMentionHighlightedIndex(0);
                    }}
                    onConfirm={() => {
                        const reference = filteredMentionCandidates[mentionHighlightedIndex];
                        if (reference) chooseMention(reference);
                    }}
                    onClose={closeMentionMenu}
                    position={mentionPosition}
                />
            ) : null}

            {mode === "image" && isImageNode(node) && node.generation.settingGraph ? (
                <SettingGraphSelector
                    selected={node.generation.settingGraph}
                    onSelect={(skill) => onConfigChange(node.id, { settingGraph: toSettingGraphSnapshot(skill) })}
                />
            ) : null}

            {mode !== "text" ? <GenerationStyleChips styles={selectedStyles} onRemove={(id) => setSelectedStyles((current) => current.filter((style) => style.id !== id))} className="mt-2" /> : null}

            {mode === "video" && videoQuote && !videoQuote.available ? (
                <p className="mt-2 text-xs text-red-500">
                    {videoQuote.reason}
                    {videoQuote.reason.includes("至少需要") ? "，可点击上方加号卡片上传参考素材，或在画布中连接图片/视频节点" : ""}
                </p>
            ) : null}

            <div className="mt-2 flex min-w-0 items-center gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                    <CanvasPromptPicker onChoose={applyPromptFromLibrary} />
                    {mode !== "text" ? (
                        <GenerationStyleMenu
                            styles={styleCatalog.styles}
                            selected={selectedStyles}
                            loading={styleCatalog.loading}
                            error={styleCatalog.error}
                            open={styleMenuOpen}
                            query={styleQuery}
                            highlightedIndex={highlightedStyleIndex}
                            placement="topLeft"
                            iconOnly
                            onOpenChange={(open) => {
                                if (open) {
                                    setStyleCommand(null);
                                    setStyleQuery("");
                                    setHighlightedStyleIndex(0);
                                    setStyleMenuOpen(true);
                                } else {
                                    closeStyleMenu();
                                }
                            }}
                            onQueryChange={setStyleQuery}
                            onHighlightedIndexChange={setHighlightedStyleIndex}
                            onSelect={chooseStyle}
                        />
                    ) : null}
                    {mode === "image" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="image" className="!h-10 !min-w-0 !max-w-[180px] flex-1" onMissingConfig={() => onMissingConfig("image")} />
                            <CanvasImageSettingsPopover
                                config={config}
                                placement="topLeft"
                                buttonClassName="!h-10 !w-[140px] !justify-start !rounded-full !px-3"
                                onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: normalizeImageGenerationCount(value) } : { [key]: value })}
                                onOpenChange={onImageSettingsOpenChange}
                            />
                        </>
                    ) : mode === "video" ? (
                        <>
                            <ModelPicker
                                config={config}
                                value={config.model}
                                modelOptions={availableVideoModelsForMode(config, config.videoGenerationMode)}
                                onChange={(model) => onConfigChange(node.id, { model })}
                                capability="video"
                                className="!h-10 !min-w-0 !max-w-[180px] flex-1"
                                onMissingConfig={() => onMissingConfig("video")}
                            />
                            <CanvasVideoSettingsPopover config={config} buttonClassName="!h-10 !w-[140px] !justify-start !rounded-full !px-3" onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} />
                        </>
                    ) : (
                        <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="text" className="!h-10 !min-w-0 !max-w-[180px] flex-1" onMissingConfig={() => onMissingConfig("text")} />
                    )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {mode !== "text" ? (
                        <Tooltip title="AI优化提示词">
                            <Button
                                type="text"
                                className="!size-10 shrink-0 !rounded-full !p-0"
                                icon={<Sparkles className="size-3.5" />}
                                loading={isPromptGenerating}
                                disabled={isRunning || isPromptGenerating || !prompt.trim()}
                                onClick={() =>
                                    onGeneratePrompt(
                                        node.id,
                                        mode,
                                        prompt.trim(),
                                        updatePrompt,
                                        selectedStyles.slice(0, MAX_GENERATION_STYLE_SELECTION_COUNT).map((style) => style.id),
                                    )
                                }
                                aria-label="AI优化提示词"
                            />
                        </Tooltip>
                    ) : null}
                    <Button
                        type="primary"
                        className="!h-10 !min-w-[88px] shrink-0 !justify-center !rounded-full !px-3"
                        danger={isRunning}
                        disabled={isPromptGenerating || (!isRunning && (!prompt.trim() || (mode === "video" && !videoQuote?.available)))}
                        onClick={() => (isRunning ? onStop(node.id) : submit())}
                        aria-label={isRunning ? "停止生成" : creditCost === null ? "当前视频配置无法报价" : `生成，当前会消耗 ${creditCost.toLocaleString()} 积分`}
                    >
                        <span className="flex items-center gap-1.5">
                            {isRunning ? (
                                <>
                                    <LoaderCircle className="size-4 animate-spin" />
                                    <Square className="size-3.5 fill-current" />
                                    <span className="text-xs font-medium">停止</span>
                                </>
                            ) : (
                                <>
                                    {creditCost === null ? <span className="text-xs font-medium">不可报价</span> : <CreditCostDisplay creditCost={creditCost} className="text-xs font-medium" />}
                                    <ArrowUp className="size-4" />
                                </>
                            )}
                        </span>
                    </Button>
                </div>
            </div>
            <Modal title={referencePreview?.title || "参考图"} open={Boolean(referencePreview?.previewUrl)} centered footer={null} width="auto" destroyOnHidden onCancel={() => setReferencePreview(null)}>
                {referencePreview?.previewUrl ? <img src={referencePreview.previewUrl} alt={referencePreview.title || "参考图"} className="max-h-[80vh] max-w-full object-contain" /> : null}
            </Modal>
        </div>
    );
}

function SettingGraphSelector({ selected, onSelect }: { selected: CanvasSettingGraphSkillSnapshot; onSelect: (skill: SkillOption) => void }) {
    const theme = useCanvasTheme();
    const [open, setOpen] = useState(false);
    const [skills, setSkills] = useState<SkillOption[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open || skills.length || loading) return;
        setLoading(true);
        void listSkills("canvasSettingGraph")
            .then((response) => setSkills(response.skills))
            .catch((reason) => setError(reason instanceof Error ? reason.message : "设定图技能加载失败"))
            .finally(() => setLoading(false));
    }, [loading, open, skills.length]);

    return (
        <div className="relative mt-2">
            <button
                type="button"
                className="inline-flex min-h-10 max-w-full items-center gap-2 rounded-xl border px-3 text-sm transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2"
                style={{ borderColor: theme.node.stroke, background: theme.node.fill, color: theme.node.text }}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
            >
                <BookOpenText className="size-4 shrink-0" />
                <span className="truncate">设定图：{selected.name}</span>
                <ChevronDown className="size-4 shrink-0" />
            </button>
            {open ? (
                <div role="menu" aria-label="切换设定图类型" className="absolute left-0 top-full z-20 mt-2 min-w-56 rounded-xl border p-1 shadow-xl" style={{ background: theme.node.panel, borderColor: theme.node.stroke }}>
                    {loading ? <div className="px-3 py-3 text-xs" style={{ color: theme.node.muted }}>加载中…</div> : error ? <div className="px-3 py-3 text-xs" style={{ color: theme.node.muted }}>{error}</div> : skills.length ? skills.map((skill) => (
                        <button key={skill.id} type="button" role="menuitem" className="flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm hover:bg-black/5" style={{ color: theme.node.text }} onClick={() => { onSelect(skill); setOpen(false); }}>
                            {skill.name}
                        </button>
                    )) : <div className="px-3 py-3 text-xs" style={{ color: theme.node.muted }}>暂无可用设定图技能</div>}
                </div>
            ) : null}
        </div>
    );
}

function toSettingGraphSnapshot(skill: SkillOption): CanvasSettingGraphSkillSnapshot {
    return { id: skill.id, name: skill.name, targetType: "canvasSettingGraph", systemPrompt: skill.systemPrompt || "", aspectRatio: skill.aspectRatio || "16:9" };
}

function defaultMode(type: CanvasNodeKind): CanvasNodeGenerationMode {
    return type === "text" ? "text" : type === "video" ? "video" : "image";
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNode, mode: CanvasNodeGenerationMode): AiConfig {
    const defaultModel = mode === "image" ? globalConfig.imageModel : mode === "video" ? globalConfig.videoModel : globalConfig.textModel;
    const generation = isImageNode(node) || isVideoNode(node) ? node.generation : null;
    const model = normalizeModelOptionValue(generation?.model || defaultModel || globalConfig.model || defaultConfig.model, globalConfig.channels);
    return {
        ...globalConfig,
        model,
        videoModel: mode === "video" ? model : globalConfig.videoModel,
        quality: isImageNode(node) ? node.generation.quality || globalConfig.quality || defaultConfig.quality : globalConfig.quality || defaultConfig.quality,
        imageResolution: isImageNode(node) ? node.generation.resolution || globalConfig.imageResolution || defaultConfig.imageResolution : globalConfig.imageResolution || defaultConfig.imageResolution,
        size: generation?.size || globalConfig.size || defaultConfig.size,
        videoSeconds: isVideoNode(node) ? node.generation.seconds || globalConfig.videoSeconds || defaultConfig.videoSeconds : globalConfig.videoSeconds || defaultConfig.videoSeconds,
        vquality: isVideoNode(node) ? node.generation.quality || globalConfig.vquality || defaultConfig.vquality : globalConfig.vquality || defaultConfig.vquality,
        videoGenerationMode: isVideoNode(node) ? node.generation.videoGenerationMode || globalConfig.videoGenerationMode : globalConfig.videoGenerationMode,
        videoWatermark: isVideoNode(node) ? node.generation.watermark || globalConfig.videoWatermark || defaultConfig.videoWatermark : globalConfig.videoWatermark || defaultConfig.videoWatermark,
        count: String(
            mode === "video"
                ? normalizeVideoGenerationCount((isVideoNode(node) ? node.generation.count : undefined) || globalConfig.canvasVideoCount || defaultConfig.canvasVideoCount)
                : normalizeImageGenerationCount((isImageNode(node) ? node.generation.count : undefined) || (mode === "image" ? globalConfig.canvasImageCount || globalConfig.count : globalConfig.count) || defaultConfig.count),
        ),
        canvasVideoCount: String(normalizeVideoGenerationCount((isVideoNode(node) ? node.generation.count : undefined) || globalConfig.canvasVideoCount || defaultConfig.canvasVideoCount)),
    };
}

function readNodePrompt(node: CanvasNode): string {
    return isTextNode(node) ? node.content.text : isImageNode(node) || isVideoNode(node) ? node.generation.prompt : "";
}

function promptPlaceholder(mode: CanvasNodeGenerationMode, hasImageContent: boolean, hasTextContent: boolean) {
    if (mode === "video") return "描述要生成的视频内容";
    if (mode === "image") return hasImageContent ? "请输入你想要把这张图修改成什么" : "描述要生成的图片内容";
    return hasTextContent ? "请输入你想要将本段文本修改成什么" : "请输入你想要生成的文本内容";
}

function videoConfigPatch(key: keyof AiConfig, value: string) {
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoGenerationMode") return { videoGenerationMode: value as AiConfig["videoGenerationMode"] };
    if (key === "videoWatermark") return { watermark: value };
    if (key === "canvasVideoCount") return { count: normalizeVideoGenerationCount(value) };
    return { [key]: value };
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 参考素材持久化取值：优先对象存储地址，其次可直连的 http 地址，最后回退存储键（可经服务端解析）。 */
function persistedReferenceValue(objectStorageUrl?: string, url?: string, storageKey?: string) {
    return objectStorageUrl || (url && /^https?:\/\//i.test(url) ? url : storageKey) || "";
}

/**
 * 将提示词中的引用标签统一格式化为单层反引号，避免重复提交时不断叠加。
 */
function formatPromptReferenceLabels(prompt: string, labels: string[]) {
    const sortedLabels = [...new Set(labels)].sort((first, second) => second.length - first.length);
    if (!sortedLabels.length) return prompt;
    const labelPattern = sortedLabels.map(escapeRegExp).join("|");
    return prompt.replace(new RegExp("`*(" + labelPattern + ")(?!\\d)`*", "g"), "`$1`");
}

// 画布资产引用面板
// @Description        展示已引用和可引用的画布资产，并维护键盘高亮顺序
// @Param              query string 当前@查询关键词
// @Param              candidates CanvasResourceReference[] 画布资产候选
// @Param              highlightedIndex number 当前高亮索引
// @Param              theme CanvasTheme 画布主题
// @Param              onSelect Function 选择资产回调
// @Param              onHighlight Function 更新高亮索引
// @Return             JSX.Element 资产引用面板
function MentionAssetMenu({ query, candidates, highlightedIndex, theme, onSelect, onHighlight, onQueryChange, onConfirm, onClose, position }: { query: string; candidates: CanvasResourceReference[]; highlightedIndex: number; theme: CanvasTheme; onSelect: (reference: CanvasResourceReference) => void; onHighlight: (index: number) => void; onQueryChange: (value: string) => void; onConfirm: () => void; onClose: () => void; position: { left: number; top: number } | null }) {
    const referenced = candidates.filter((reference) => reference.active);
    const available = candidates.filter((reference) => !reference.active);
    const availableGroups = [
        { title: "图片", kind: "image" as const },
        { title: "视频", kind: "video" as const },
        { title: "文本", kind: "text" as const },
    ].map((group) => ({ ...group, items: available.filter((reference) => reference.kind === group.kind) })).filter((group) => group.items.length);
    const flatItems = [...referenced, ...availableGroups.flatMap((group) => group.items)];
    const activeIndex = Math.min(highlightedIndex, Math.max(0, flatItems.length - 1));

    return (
        <div
            className="absolute z-[110] w-[min(24rem,calc(100% - 1.5rem))] overflow-hidden rounded-xl border p-2 shadow-2xl"
            style={{ left: position?.left ?? 12, top: position?.top ?? 48, transform: "translateY(calc(-100% - 0.5rem))", background: theme.node.panel, borderColor: theme.node.stroke }}
            role="listbox"
            aria-label="引用画布资产"
        >
            <div className="flex items-center gap-2 border-b px-2 pb-2 text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                <Search className="size-3.5" />
                <input
                    value={query}
                    onChange={(event) => onQueryChange(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") {
                            event.preventDefault();
                            onConfirm();
                        } else if (event.key === "Escape") {
                            event.preventDefault();
                            onClose();
                        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                            event.preventDefault();
                            const offset = event.key === "ArrowDown" ? 1 : -1;
                            onHighlight(Math.max(0, Math.min(highlightedIndex + offset, Math.max(0, flatItems.length - 1))));
                        }
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    placeholder="搜索画布资产"
                    aria-label="搜索画布资产"
                    className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:opacity-60"
                    style={{ color: theme.node.text }}
                />
            </div>
            <div className="thin-scrollbar max-h-64 overflow-y-auto pt-1">
                {referenced.length || availableGroups.length ? (
                    <>
                        {referenced.length ? <MentionAssetGroup title="已引用" items={referenced} flatItems={flatItems} activeIndex={activeIndex} theme={theme} onSelect={onSelect} onHighlight={onHighlight} /> : null}
                        {availableGroups.length ? (
                            <div className="pt-1">
                                <p className="px-2 py-1 text-[11px] font-medium" style={{ color: theme.node.muted }}>素材引用</p>
                                {availableGroups.map((group) => <MentionAssetGroup key={group.title} title={group.title} items={group.items} flatItems={flatItems} activeIndex={activeIndex} theme={theme} onSelect={onSelect} onHighlight={onHighlight} />)}
                            </div>
                        ) : null}
                    </>
                ) : <div className="px-2 py-6 text-center text-xs" style={{ color: theme.node.muted }}>暂无匹配的画布资产</div>}
            </div>
        </div>
    );
}

// 画布资产引用分组
// @Description        按引用类型渲染资产候选项
// @Param              title string 分组标题
// @Param              items CanvasResourceReference[] 分组资产
// @Param              flatItems CanvasResourceReference[] 键盘导航扁平资产列表
// @Param              activeIndex number 当前高亮索引
// @Param              theme CanvasTheme 画布主题
// @Param              onSelect Function 选择资产回调
// @Param              onHighlight Function 更新高亮索引
// @Return             JSX.Element 资产分组
function MentionAssetGroup({ title, items, flatItems, activeIndex, theme, onSelect, onHighlight }: { title: string; items: CanvasResourceReference[]; flatItems: CanvasResourceReference[]; activeIndex: number; theme: CanvasTheme; onSelect: (reference: CanvasResourceReference) => void; onHighlight: (index: number) => void }) {
    return (
        <div className="pt-1">
            <p className="px-2 py-1 text-[11px] font-medium" style={{ color: theme.node.muted }}>{title}</p>
            {items.map((reference) => {
                const index = flatItems.indexOf(reference);
                return <MentionAssetOption key={reference.nodeId} reference={reference} selected={reference.active} highlighted={index === activeIndex} theme={theme} onSelect={() => onSelect(reference)} onHighlight={() => onHighlight(index)} />;
            })}
        </div>
    );
}

// 画布资产引用选项
// @Description        展示单个资产缩略图、名称和引用状态
// @Param              reference CanvasResourceReference 资产引用
// @Param              selected boolean 是否已引用
// @Param              highlighted boolean 是否键盘高亮
// @Param              theme CanvasTheme 画布主题
// @Param              onSelect Function 选择资产回调
// @Param              onHighlight Function 更新高亮索引
// @Return             JSX.Element 资产选项
function MentionAssetOption({ reference, selected, highlighted, theme, onSelect, onHighlight }: { reference: CanvasResourceReference; selected: boolean; highlighted: boolean; theme: CanvasTheme; onSelect: () => void; onHighlight: () => void }) {
    const Icon = reference.kind === "video" ? Video : reference.kind === "image" ? ImageIcon : FileText;
    return (
        <button type="button" role="option" aria-selected={selected} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition" style={{ background: highlighted ? theme.node.fill : "transparent", color: theme.node.text, opacity: selected ? 0.65 : 1 }} onMouseEnter={onHighlight} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onSelect(); }}>
            <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-md border" style={{ borderColor: theme.node.stroke, background: theme.node.fill, color: theme.node.muted }}>
                {reference.kind === "image" && reference.previewUrl ? <img src={reference.previewUrl} alt="" className="size-full object-cover" /> : reference.kind === "video" && reference.previewUrl ? <video src={reference.previewUrl} className="size-full object-cover" muted preload="metadata" /> : reference.kind === "text" ? <span className="line-clamp-2 px-1 text-[9px] leading-3">{reference.text || reference.title}</span> : <Icon className="size-4" />}
            </span>
            <span className="min-w-0 flex-1 truncate">{reference.title}</span>
            {selected ? <span className="text-[11px]" style={{ color: theme.node.muted }}>已引用</span> : null}
        </button>
    );
}

function stripPromptReferenceDelimiters(prompt: string, labels: string[]) {
    const sortedLabels = [...new Set(labels)].sort((first, second) => second.length - first.length);
    if (!sortedLabels.length) return prompt;
    const labelPattern = sortedLabels.map(escapeRegExp).join("|");
    return prompt.replace(new RegExp("`+(" + labelPattern + ")`+", "g"), "$1");
}

type ReferenceContentItemProps = {
    reference: CanvasResourceReference;
    index: number;
    canInsert: boolean;
    canRemove: boolean;
    theme: CanvasTheme;
    onPreview: () => void;
    onInsert: () => void;
    onRemove: () => void;
};

function ReferenceContentItem({ reference, index, canInsert, canRemove, theme, onPreview, onInsert, onRemove }: ReferenceContentItemProps) {
    const canPreview = !canInsert && reference.kind === "image" && Boolean(reference.previewUrl);
    const Icon = reference.kind === "video" ? Video : reference.kind === "image" ? ImageIcon : FileText;
    const actionLabel = canPreview ? `放大查看${reference.label}` : canInsert ? `在提示词中插入${reference.label}` : reference.label;

    return (
        <div className="group relative size-14 shrink-0">
            <button
                type="button"
                title={actionLabel}
                aria-label={actionLabel}
                className="grid size-full overflow-hidden rounded-xl border transition hover:brightness-110 active:scale-95"
                style={{ borderColor: theme.node.stroke, background: theme.node.fill, color: theme.node.muted, borderRadius: 12, overflow: "hidden" }}
                onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (canPreview) onPreview();
                    else if (canInsert) onInsert();
                }}
            >
                {reference.kind === "image" && reference.previewUrl ? (
                    <img src={reference.previewUrl} alt={reference.title} className="block size-full rounded-xl object-cover" style={{ borderRadius: 12 }} draggable={false} />
                ) : reference.kind === "video" && reference.previewUrl ? (
                    <video src={reference.previewUrl} aria-label={reference.title} className="block size-full rounded-xl bg-black object-cover" style={{ borderRadius: 12 }} muted preload="metadata" />
                ) : reference.kind === "text" ? (
                    <span className="line-clamp-3 px-1.5 text-left text-[10px] leading-4">{reference.text || reference.title}</span>
                ) : (
                    <Icon className="m-auto size-4" />
                )}
            </button>
            {reference.kind !== "text" ? (
                <span className="pointer-events-none absolute bottom-1 left-1 grid size-4 place-items-center rounded-sm" style={{ background: theme.node.panel, color: theme.node.muted }}>
                    <Icon className="size-2.5" />
                </span>
            ) : null}
            <span className={`pointer-events-none absolute right-1 top-1 grid size-4 place-items-center rounded-sm text-[10px] font-medium transition-opacity ${canRemove ? "group-hover:opacity-0" : ""}`} style={{ background: theme.node.panel, color: theme.node.muted }}>
                {index}
            </span>
            {canRemove ? (
                <button
                    type="button"
                    title="移除参考素材"
                    aria-label={`移除${reference.label}`}
                    className="absolute right-1 top-1 grid size-4 place-items-center rounded-sm opacity-0 transition group-hover:opacity-100 focus:opacity-100"
                    style={{ background: theme.node.panel, color: theme.node.muted, border: `1px solid ${theme.node.stroke}` }}
                    onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onRemove();
                    }}
                >
                    <X className="size-2.5" />
                </button>
            ) : null}
        </div>
    );
}

type PromptEditorProps = {
    prompt: string;
    requiredLabels: string[];
    references: CanvasResourceReference[];
    placeholder: string;
    theme: CanvasTheme;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onBlur: () => void;
    onMentionInput?: (value: string, cursor: number, caretRect: DOMRect | null) => void;
    onMentionMenuKeyDown?: (event: React.KeyboardEvent) => boolean;
    onPasteText?: (value: string) => boolean;
    onStyleInput?: (value: string, cursor: number) => void;
    onStyleMenuKeyDown?: (event: React.KeyboardEvent) => boolean;
};

export type PromptEditorHandle = { insertAtCursor: (text: string) => void; replaceTextRange: (start: number, end: number, text: string) => void; focus: () => void };

const PromptEditor = forwardRef<PromptEditorHandle, PromptEditorProps>(function PromptEditor({ prompt, requiredLabels, references, placeholder, theme, onChange, onSubmit, onBlur, onMentionInput, onMentionMenuKeyDown, onPasteText, onStyleInput, onStyleMenuKeyDown }, ref) {
    const editorRef = useRef<HTMLDivElement>(null);
    const isComposingRef = useRef(false);
    const pendingRef = useRef<string | null>(null);
    const suppressInputRef = useRef(false);

    // 根据标签查找引用以获取预览
    const refByLabel = useMemo(() => {
        const map = new Map<string, CanvasResourceReference>();
        references.filter((ref) => ref.active).forEach((ref) => map.set(ref.label, ref));
        return map;
    }, [references]);

    // 将纯文本转为带芯片的 HTML（按 label 长度降序替换，避免 "图片1" 误匹配 "图片10"）
    const buildHTML = useCallback(
        (text: string) => {
            // 生成请求可能为引用标签增加反引号，编辑器回显时隐藏这些协议标记，避免出现在缩略图两侧。
            let html = escapeHTML(stripPromptReferenceDelimiters(text, requiredLabels));
            const sorted = [...requiredLabels].sort((a, b) => b.length - a.length);
            sorted.forEach((label) => {
                const ref = refByLabel.get(label);
                if (!ref) return;
                const thumbHTML = refChipThumbHTML(ref);
                const chip = `<span contenteditable="false" data-ref-label="${escapeAttr(label)}" class="prompt-ref-chip" style="display:inline-flex;align-items:center;gap:2px;padding:0 2px 0 5px;margin:0 2px;border-radius:4px;font-size:13px;line-height:1.4;vertical-align:middle;background:rgba(47,128,255,.12);color:#2f80ff;font-weight:500;border:1px solid rgba(47,128,255,.24);user-select:none;white-space:nowrap;cursor:grab;">${thumbHTML}${escapeHTML(label)}<span data-ref-close="" class="ref-chip-close" style="display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;margin-left:1px;border-radius:50%;font-size:12px;line-height:1;cursor:pointer;flex-shrink:0;">×</span></span>`;
                html = html.replace(new RegExp(escapeRegExp(label), "g"), chip);
            });
            return html;
        },
        [requiredLabels, refByLabel],
    );

    // 挂载时设置初始内容
    useEffect(() => {
        const editor = editorRef.current;
        if (!editor || pendingRef.current !== null) return;
        suppressInputRef.current = true;
        editor.innerHTML = buildHTML(prompt);
        pendingRef.current = prompt;
        suppressInputRef.current = false;
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // 外部 prompt 变化时（提示词库、标签同步等），同步编辑器内容
    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        if (suppressInputRef.current) return;
        // 用户自己输入时 pendingRef 与 prompt 一致，跳过避免覆盖光标位置
        const labelsToRender = requiredLabels.filter((label) => prompt.includes(label));
        const hasReferenceChips = labelsToRender.every((label) => Array.from(editor.querySelectorAll(".prompt-ref-chip")).some((chip) => chip.getAttribute("data-ref-label") === label));
        if (pendingRef.current === prompt && hasReferenceChips) return;
        // 记录当前是否聚焦（用于外部更新后恢复）
        const wasFocused = document.activeElement === editor;
        suppressInputRef.current = true;
        editor.innerHTML = buildHTML(prompt);
        pendingRef.current = prompt;
        suppressInputRef.current = false;
        // 外部更新（非用户输入触发）且之前编辑器有焦点时，保持焦点在末尾
        if (wasFocused) {
            requestAnimationFrame(() => {
                editor.focus();
                placeCaretAtEnd(editor);
            });
        }
    }, [buildHTML, prompt, refByLabel, requiredLabels]);

    // 自动聚焦 & 清理
    useEffect(() => {
        requestAnimationFrame(() => {
            editorRef.current?.focus();
        });
        return () => {
            if (dragIndicatorRef.current) {
                dragIndicatorRef.current.remove();
                dragIndicatorRef.current = null;
            }
        };
    }, []);

    // 从 DOM 提取纯文本：芯片用 data-ref-label，跳过关闭按钮文字
    const extractText = useCallback(() => {
        const editor = editorRef.current;
        if (!editor) return "";
        let text = "";
        const walk = (node: Node) => {
            if (node.nodeType === 3) {
                text += node.textContent || "";
            } else if (node.nodeType === 1) {
                const el = node as Element;
                if (el.classList.contains("prompt-ref-chip")) {
                    text += el.getAttribute("data-ref-label") || "";
                } else if (!el.hasAttribute("data-ref-close")) {
                    el.childNodes.forEach(walk);
                }
            }
        };
        editor.childNodes.forEach(walk);
        return text.replace(/\n/g, "").trim();
    }, []);

    // 获取光标在纯文本中的偏移位置（与 extractText 使用相同的 DOM 遍历逻辑）
    const getTextOffset = useCallback((): number | null => {
        const editor = editorRef.current;
        if (!editor) return null;
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount || !editor.contains(sel.anchorNode)) return null;
        const anchorNode = sel.anchorNode;
        const anchorOffset = sel.anchorOffset;
        let offset = 0;
        const walk = (node: Node): boolean => {
            if (node === anchorNode) {
                if (node.nodeType === 3) offset += anchorOffset;
                return true;
            }
            if (node.nodeType === 3) {
                offset += (node.textContent || "").length;
            } else if (node.nodeType === 1) {
                const el = node as Element;
                if (el.classList.contains("prompt-ref-chip")) {
                    offset += (el.getAttribute("data-ref-label") || "").length;
                } else if (!el.hasAttribute("data-ref-close")) {
                    for (let i = 0; i < el.childNodes.length; i++) {
                        if (walk(el.childNodes[i])) return true;
                    }
                }
            }
            return false;
        };
        for (let i = 0; i < editor.childNodes.length; i++) {
            if (walk(editor.childNodes[i])) break;
        }
        return offset;
    }, []);

    // 暴露给父组件的方法
    useImperativeHandle(
        ref,
        () => ({
            insertAtCursor: (label: string) => {
                const editor = editorRef.current;
                if (!editor) return;
                editor.focus();
                const offset = getTextOffset();
                const current = extractText();
                let next: string;
                if (offset !== null && offset <= current.length) {
                    next = current.slice(0, offset) + label + current.slice(offset);
                } else {
                    next = current.trim() ? `${current.trim()} ${label}` : label;
                }
                pendingRef.current = next;
                suppressInputRef.current = true;
                editor.innerHTML = buildHTML(next);
                suppressInputRef.current = false;
                onChange(next);
                // 光标放到插入文本之后
                requestAnimationFrame(() => {
                    const afterOffset = (offset ?? current.length) + label.length;
                    setCaretAtTextOffset(editor, next, afterOffset);
                });
            },
            replaceTextRange: (start: number, end: number, value: string) => {
                const editor = editorRef.current;
                if (!editor) return;
                const current = extractText();
                const next = current.slice(0, start) + value + current.slice(end);
                pendingRef.current = next;
                suppressInputRef.current = true;
                editor.innerHTML = buildHTML(next);
                suppressInputRef.current = false;
                onChange(next);
                requestAnimationFrame(() => setCaretAtTextOffset(editor, next, start + value.length));
            },
            focus: () => editorRef.current?.focus(),
        }),
        [getTextOffset, extractText, buildHTML, onChange],
    );

    const getCaretRect = useCallback((): DOMRect | null => {
        const editor = editorRef.current;
        const selection = window.getSelection();
        if (!editor || !selection?.rangeCount || !editor.contains(selection.anchorNode)) return null;
        const range = document.createRange();
        range.setStart(selection.anchorNode!, selection.anchorOffset);
        range.collapse(true);
        const rect = range.getBoundingClientRect();
        if (rect.width || rect.height) return rect;
        const editorRect = editor.getBoundingClientRect();
        return new DOMRect(editorRect.left, editorRect.top, 0, 0);
    }, []);

    const handleInput = useCallback(() => {
        if (suppressInputRef.current) return;
        // 清理浏览器自动插入的 <br> 标签（会导致异常换行）
        const editor = editorRef.current;
        if (editor) {
            const brs = editor.querySelectorAll("br");
            if (brs.length) {
                suppressInputRef.current = true;
                brs.forEach((br) => br.remove());
                suppressInputRef.current = false;
            }
        }
        const text = extractText();
        pendingRef.current = text;
        onChange(text);
        const cursor = getTextOffset() ?? text.length;
        onStyleInput?.(text, cursor);
        onMentionInput?.(text, cursor, getCaretRect());
    }, [extractText, getCaretRect, getTextOffset, onChange, onMentionInput, onStyleInput]);

    const handleKeyDown = useCallback(
        (event: React.KeyboardEvent) => {
            if (onMentionMenuKeyDown?.(event)) return;
            if (onStyleMenuKeyDown?.(event)) return;
            if (event.key === "Enter" && !event.shiftKey && !isComposingRef.current) {
                event.preventDefault();
                onSubmit();
            }
        },
        [onMentionMenuKeyDown, onStyleMenuKeyDown, onSubmit],
    );

    const handleBlur = useCallback(() => {
        onBlur();
    }, [onBlur]);

    // 自定义拖拽芯片（mousedown/mousemove/mouseup，避免 HTML5 drag 在 contentEditable 内不可靠）
    const dragChipRef = useRef<HTMLElement | null>(null);
    const isDraggingRef = useRef(false);
    const dragStartRef = useRef({ x: 0, y: 0 });
    const dragIndicatorRef = useRef<HTMLElement | null>(null);

    const getDragIndicator = useCallback(() => {
        if (!dragIndicatorRef.current) {
            const el = document.createElement("span");
            el.style.cssText = "position:fixed;width:2px;height:18px;background:#2f80ff;border-radius:1px;pointer-events:none;z-index:9999;display:none;";
            document.body.appendChild(el);
            dragIndicatorRef.current = el;
        }
        return dragIndicatorRef.current;
    }, []);

    const hideDragIndicator = useCallback(() => {
        if (dragIndicatorRef.current) dragIndicatorRef.current.style.display = "none";
    }, []);

    const handleEditorMouseDown = useCallback((event: React.MouseEvent) => {
        const target = event.target as HTMLElement;
        // 不拖拽关闭按钮
        if (target.closest("[data-ref-close]")) return;
        const chip = (target as Element).closest(".prompt-ref-chip") as HTMLElement | null;
        if (!chip || event.button !== 0) return;
        dragChipRef.current = chip;
        isDraggingRef.current = false;
        dragStartRef.current = { x: event.clientX, y: event.clientY };
    }, []);

    const handleEditorMouseMove = useCallback(
        (event: React.MouseEvent) => {
            if (!dragChipRef.current) return;
            if (!isDraggingRef.current) {
                const dx = event.clientX - dragStartRef.current.x;
                const dy = event.clientY - dragStartRef.current.y;
                if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
                isDraggingRef.current = true;
                dragChipRef.current.style.opacity = "0.25";
            }
            const range = document.caretRangeFromPoint(event.clientX, event.clientY);
            const editor = editorRef.current;
            if (range && editor?.contains(range.startContainer)) {
                const rect = range.getBoundingClientRect();
                const indicator = getDragIndicator();
                indicator.style.display = "block";
                indicator.style.left = `${Math.round(rect.left)}px`;
                indicator.style.top = `${Math.round(rect.top)}px`;
            }
        },
        [getDragIndicator],
    );

    const handleEditorMouseUp = useCallback(
        (event: React.MouseEvent) => {
            hideDragIndicator();
            const chip = dragChipRef.current;
            dragChipRef.current = null;
            if (!chip) return;

            if (isDraggingRef.current) {
                isDraggingRef.current = false;
                chip.style.opacity = "";
                const editor = editorRef.current;
                if (!editor) return;

                const range = document.caretRangeFromPoint(event.clientX, event.clientY);
                if (!range) return;
                const dropNode = range.startContainer;
                if (!editor.contains(dropNode)) return;

                const dropEl = dropNode.nodeType === 3 ? dropNode.parentElement : (dropNode as Element);
                // 防止插入到芯片自身内部
                if (!dropEl || chip.contains(dropEl) || chip === dropEl) return;

                const otherChip = dropEl.closest(".prompt-ref-chip") as HTMLElement | null;
                if (otherChip && otherChip !== chip) {
                    if (event.clientX < otherChip.getBoundingClientRect().left + otherChip.getBoundingClientRect().width / 2) {
                        otherChip.before(chip);
                    } else {
                        otherChip.after(chip);
                    }
                } else {
                    range.collapse(true);
                    range.insertNode(chip);
                }
                // 提取文本后立即重建 innerHTML，修复 DOM 操作造成的结构损坏
                // 清理因芯片移动留下的多余空格
                const text = extractText()
                    .replace(/\s{2,}/g, " ")
                    .trim();
                editor.innerHTML = buildHTML(text);
                pendingRef.current = text;
                onChange(text);
            } else {
                // 没有移动，只是点击芯片——不处理，让 contentEditable 正常处理光标定位
                isDraggingRef.current = false;
            }
        },
        [extractText, onChange, hideDragIndicator],
    );

    // 全局 mouseup 处理（鼠标可能在编辑器外松开）
    useEffect(() => {
        const handleGlobalMouseUp = () => {
            hideDragIndicator();
            if (dragChipRef.current) {
                dragChipRef.current.style.opacity = "";
                dragChipRef.current = null;
            }
            isDraggingRef.current = false;
        };
        window.addEventListener("mouseup", handleGlobalMouseUp);
        return () => window.removeEventListener("mouseup", handleGlobalMouseUp);
    }, [hideDragIndicator]);

    // 阻止浏览器在 contentEditable 中插入块级元素（<div>、<p>、<br>）
    const handleBeforeInput = useCallback((event: React.FormEvent<HTMLDivElement>) => {
        const inputType = (event as unknown as { inputType?: string }).inputType;
        if (inputType === "insertParagraph" || inputType === "insertLineBreak") {
            event.preventDefault();
        }
    }, []);

    // 点击芯片关闭按钮时删除芯片
    const handleEditorClick = useCallback(
        (event: React.MouseEvent) => {
            const target = event.target as HTMLElement;
            const closeBtn = target.closest("[data-ref-close]") as HTMLElement | null;
            if (!closeBtn) return;
            event.preventDefault();
            event.stopPropagation();

            const chip = closeBtn.closest(".prompt-ref-chip") as HTMLElement | null;
            if (!chip) return;
            const editor = editorRef.current;
            if (!editor) return;

            // 先聚焦编辑器
            editor.focus();

            // 移除芯片 DOM
            chip.remove();

            // 提取文本并重建（清理多余空格）
            const text = extractText()
                .replace(/\s{2,}/g, " ")
                .trim();
            pendingRef.current = text;
            onChange(text);
            // 重建 innerHTML 规范化结构
            suppressInputRef.current = true;
            editor.innerHTML = buildHTML(text);
            suppressInputRef.current = false;

            // 光标放到删除位置附近
            requestAnimationFrame(() => placeCaretAtEnd(editor));
        },
        [extractText, onChange, buildHTML],
    );

    const handleCompositionStart = useCallback(() => {
        isComposingRef.current = true;
    }, []);

    // 复制时把芯片替换为标签文字，避免 contenteditable="false" 导致复制为空
    const handleCopy = useCallback((event: React.ClipboardEvent) => {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        if (range.collapsed) return;
        const fragment = range.cloneContents();
        fragment.querySelectorAll(".prompt-ref-chip").forEach((chip) => {
            const label = chip.getAttribute("data-ref-label") || "";
            chip.replaceWith(document.createTextNode(`\`${label}\``));
        });
        fragment.querySelectorAll("[data-ref-close]").forEach((el) => el.remove());
        const text = (fragment.textContent || "").replace(/\n/g, "");
        event.clipboardData.setData("text/plain", text);
        event.preventDefault();
    }, []);

    const handleCompositionEnd = useCallback(() => {
        isComposingRef.current = false;
        handleInput();
    }, [handleInput]);

    const handlePaste = useCallback(
        (event: React.ClipboardEvent<HTMLDivElement>) => {
            const text = event.clipboardData.getData("text/plain");
            if (text && onPasteText?.(text)) event.preventDefault();
        },
        [onPasteText],
    );

    const isEmpty = !prompt;

    return (
        <div className="relative h-32 w-full">
            {isEmpty ? (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center px-3 py-2 text-sm leading-5 opacity-45" style={{ color: theme.node.text }}>
                    {placeholder}
                </div>
            ) : null}
            <style>{".prompt-editor div{display:inline!important}.prompt-editor br{display:none!important}.ref-chip-close{opacity:.45}.prompt-ref-chip:hover .ref-chip-close{opacity:1}.ref-chip-close:hover{background:rgba(0,0,0,.12)}"}</style>
            <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                className="prompt-editor thin-scrollbar absolute inset-0 cursor-text resize-none select-text rounded-xl border px-3 py-2 text-sm leading-5 outline-none transition focus:border-[#2f80ff] focus:ring-2 focus:ring-[#2f80ff]/25"
                style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text, whiteSpace: "pre-wrap", overflowWrap: "break-word", overflowY: "auto" }}
                onInput={handleInput}
                onBeforeInput={handleBeforeInput}
                onKeyDown={handleKeyDown}
                onBlur={handleBlur}
                onClick={handleEditorClick}
                onCopy={handleCopy}
                onPaste={handlePaste}
                onMouseDown={handleEditorMouseDown}
                onMouseMove={handleEditorMouseMove}
                onMouseUp={handleEditorMouseUp}
                onCompositionStart={handleCompositionStart}
                onCompositionEnd={handleCompositionEnd}
            />
        </div>
    );
});

function refChipThumbHTML(ref: CanvasResourceReference) {
    if (ref.kind === "image" && ref.previewUrl) {
        return `<img src="${escapeAttr(ref.previewUrl)}" alt="" style="width:16px;height:16px;border-radius:3px;object-fit:cover;pointer-events:none;" draggable="false" />`;
    }
    // SVG icons as inline data for reliability
    if (ref.kind === "video")
        return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2f80ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`;
    if (ref.kind === "image")
        return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2f80ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2f80ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
}

function escapeHTML(value: string) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string) {
    return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function placeCaretAtEnd(element: HTMLElement) {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
}

/** 在 contentEditable 中将光标定位到纯文本的指定偏移位置 */
function setCaretAtTextOffset(editor: HTMLElement, fullText: string, offset: number) {
    const sel = window.getSelection();
    if (!sel) return;
    const clamped = Math.max(0, Math.min(offset, fullText.length));
    let remaining = clamped;
    const walk = (node: Node): boolean => {
        if (node.nodeType === 3) {
            const len = (node.textContent || "").length;
            if (remaining <= len) {
                const range = document.createRange();
                range.setStart(node, remaining);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
                return true;
            }
            remaining -= len;
        } else if (node.nodeType === 1) {
            const el = node as Element;
            if (el.classList.contains("prompt-ref-chip")) {
                const label = el.getAttribute("data-ref-label") || "";
                if (remaining <= label.length) {
                    // 光标放在芯片之后（不能在芯片内部）
                    const range = document.createRange();
                    range.setStartAfter(el);
                    range.collapse(true);
                    sel.removeAllRanges();
                    sel.addRange(range);
                    return true;
                }
                remaining -= label.length;
            } else if (!el.hasAttribute("data-ref-close")) {
                for (let i = 0; i < el.childNodes.length; i++) {
                    if (walk(el.childNodes[i])) return true;
                }
            }
        }
        return false;
    };
    if (!walk(editor)) {
        placeCaretAtEnd(editor);
    }
}
