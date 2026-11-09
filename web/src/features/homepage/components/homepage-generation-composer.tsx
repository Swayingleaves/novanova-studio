"use client";

import { BookOpen, Cog, FolderPlus, HelpCircle, LoaderCircle, Sparkles, Upload, VideoIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { App, Image, Modal, Segmented } from "antd";
import { nanoid } from "nanoid";

import { showInsufficientCredits } from "@/features/credits/insufficient-credits";
import { useInsufficientCreditsPrompt } from "@/features/credits/use-insufficient-credits-prompt";
import { AssetPickerModal, type InsertAssetPayload } from "@/features/assets/components/asset-picker-modal";
import { CreationComposer } from "@/features/generation/components/creation-composer";
import { CreationSettingsModal } from "@/features/generation/components/creation-settings-modal";
import { ImageSettingsPanel, imageQualityLabel, imageResolutionLabel, imageSizeLabel } from "@/features/generation/components/image-settings-panel";
import { RecentReferenceAssetPicker } from "@/features/generation/components/recent-reference-asset-picker";
import { VideoSettingsPanel, videoResolutionLabel, videoSecondsLabel, videoSizeLabel } from "@/features/generation/components/video-settings-panel";
import type { CreationComposerAction, CreationReferenceChip, CreationStyleOption } from "@/features/generation/components/creation-workspace-types";
import { requestCreditCost } from "@/features/generation/constants/credits";
import { useCreationMode } from "@/features/generation/hooks/use-creation-mode";
import { usePromptOptimization } from "@/features/generation/hooks/use-prompt-optimization";
import { useRecentReferenceAssets } from "@/features/generation/hooks/use-recent-reference-assets";
import { formatImageGenerationSettingsSummary, formatVideoGenerationSettingsSummary } from "@/features/generation/lib/generation-settings-summary";
import { imageReferenceLabel } from "@/features/generation/lib/image-reference-prompt";
import { reconcileImageMentions, type PromptImageReference } from "@/features/generation/lib/image-reference-mentions";
import { loadImageLastUsedSettings, loadVideoLastUsedSettings, saveImageLastUsedSettings, saveVideoLastUsedSettings, type ImageLastUsedSettings, type VideoLastUsedSettings } from "@/features/generation/lib/last-used-generation-settings";
import { SEEDANCE_REFERENCE_LIMITS, seedanceReferenceLabel } from "@/features/generation/lib/seedance-video";
import { availableVideoModelsForMode, quoteVideoGeneration, videoGenerationReferenceIssue } from "@/features/generation/lib/video-billing";
import { readVideoGenerationConstraintIssue, readVideoModelConfiguration } from "@/features/generation/lib/video-generation-constraints";
import type { CreationMode } from "@/features/generation/lib/creation-mode-preference";
import { writeCreationMode } from "@/features/generation/lib/creation-mode-preference";
import type { RecentReferenceAsset } from "@/features/generation/lib/recent-reference-assets";
import type { ReferenceImage } from "@/features/generation/types/image";
import type { ReferenceVideo } from "@/features/generation/types/media";
import { clearHomepageCreationHandoff, storeHomepageCreationHandoff, type HomepageCreationTarget } from "@/features/homepage/lib/homepage-creation-handoff";
import { openHomepageGeneration } from "@/features/homepage/lib/homepage-navigation";
import { useTranslation } from "@/features/locale/use-translation";
import { PromptSelectDialog } from "@/features/prompts/components/prompt-select-dialog";
import { useModelConfigurationGuard } from "@/features/settings/hooks/use-model-configuration-guard";
import { ModelPicker } from "@/features/settings/components/model-picker";
import { modelOptionLabel, useConfigStore, useEffectiveConfig, type AiConfig, type VideoGenerationMode } from "@/features/settings/stores/use-config-store";
import { uploadMediaFile } from "@/features/storage/services/file-storage";
import { uploadImage } from "@/features/storage/services/image-storage";
import { useThemeStore } from "@/features/theme/stores/use-theme-store";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { useModelCreditBalance } from "@/features/team/credit-balance";
import { canvasThemes } from "@/shared/lib/canvas-theme";
import { listGenerationStyles, listSkills, type SkillOption } from "@/services/api/server";

type HomepageGenerationComposerProps = {
    prompt: string;
    onPromptChange: (value: string) => void;
    target: HomepageCreationTarget;
    onTargetChange: (target: HomepageCreationTarget) => void;
};

function hasPlayableVideoUrl(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

export function HomepageGenerationComposer({ prompt, onPromptChange, target, onTargetChange }: HomepageGenerationComposerProps) {
    const translate = useTranslation();
    const { message } = App.useApp();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const awaitingAuthRef = useRef(false);
    const previousReferencesRef = useRef<PromptImageReference[]>([]);
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const configHydrated = useConfigStore((state) => state.hydrated);
    const effectiveConfig = useEffectiveConfig();
    const ensureModelConfiguration = useModelConfigurationGuard();
    const user = useUserStore((state) => state.user);
    const showAuthModal = useUserStore((state) => state.showAuthModal);
    const { recentReferenceAssets, recordRecentReferenceAsset } = useRecentReferenceAssets(user?.id);
    const { mode: creationMode, changeMode: changeCreationMode } = useCreationMode(target);
    const { optimizingOperationId, optimizePrompt } = usePromptOptimization();
    const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
    const theme = canvasThemes[resolvedTheme];
    const [images, setImages] = useState<ReferenceImage[]>([]);
    const [videos, setVideos] = useState<ReferenceVideo[]>([]);
    const [uploadingReferenceIds, setUploadingReferenceIds] = useState<string[]>([]);
    const [styleOptions, setStyleOptions] = useState<CreationStyleOption[]>([]);
    const [selectedStyles, setSelectedStyles] = useState<CreationStyleOption[]>([]);
    const [styleLoading, setStyleLoading] = useState(false);
    const [styleError, setStyleError] = useState<string | null>(null);
    const [skillOptions, setSkillOptions] = useState<SkillOption[]>([]);
    const [selectedSkill, setSelectedSkill] = useState<SkillOption | null>(null);
    const [skillLoading, setSkillLoading] = useState(false);
    const [skillError, setSkillError] = useState<string | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
    const [imageSettingsModified, setImageSettingsModified] = useState(false);
    const [videoSettingsModified, setVideoSettingsModified] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const isPromptOptimizing = optimizingOperationId === `homepage-${target}`;
    const loggedIn = Boolean(user);
    const imageModel = effectiveConfig.imageModel || effectiveConfig.model;
    const videoModel = effectiveConfig.videoModel || effectiveConfig.model;
    const workflowSkill = Boolean(selectedSkill?.workflowType);

    useEffect(() => {
        if (showAuthModal) {
            setSubmitting(false);
            return;
        }
        if (!awaitingAuthRef.current) return;
        awaitingAuthRef.current = false;
        if (!useUserStore.getState().user) clearHomepageCreationHandoff();
    }, [showAuthModal]);

    useEffect(() => {
        let cancelled = false;
        setStyleLoading(true);
        setStyleError(null);
        void listGenerationStyles(target)
            .then((result) => {
                if (!cancelled) setStyleOptions(result.styles);
            })
            .catch((error) => {
                if (!cancelled) setStyleError(error instanceof Error ? error.message : translate(target === "image" ? "image.failedToLoadImageStyles" : "video.failedToLoadVideoStyles"));
            })
            .finally(() => {
                if (!cancelled) setStyleLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [target, translate]);

    useEffect(() => {
        let cancelled = false;
        setSkillLoading(true);
        setSkillError(null);
        void listSkills(target)
            .then((result) => {
                if (!cancelled) setSkillOptions(result.skills);
            })
            .catch((error) => {
                if (!cancelled) setSkillError(error instanceof Error ? error.message : translate(target === "image" ? "image.failedToLoadSkills" : "video.failedToLoadSkills"));
            })
            .finally(() => {
                if (!cancelled) setSkillLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [target, translate]);

    useEffect(() => {
        let cancelled = false;
        const pending = target === "image"
            ? loadImageLastUsedSettings().then((settings) => {
                if (cancelled) return;
                updateConfig("quality", settings.quality);
                updateConfig("imageResolution", settings.imageResolution);
                updateConfig("size", settings.size);
                updateConfig("count", settings.count);
            })
            : loadVideoLastUsedSettings().then((settings) => {
                if (cancelled) return;
                updateConfig("vquality", settings.vquality);
                updateConfig("videoGenerationMode", settings.videoGenerationMode);
                updateConfig("size", settings.size);
                updateConfig("videoSeconds", settings.videoSeconds);
                updateConfig("videoWatermark", settings.videoWatermark);
            });
        void pending.catch((error) => console.error("读取上次生成设置失败", error));
        return () => {
            cancelled = true;
        };
    }, [target, updateConfig]);

    const imageReferences = useMemo<PromptImageReference[]>(() => images.map((reference, index) => ({
        id: reference.id,
        name: reference.name,
        label: imageReferenceLabel(index),
        previewUrl: reference.dataUrl,
        kind: "image" as const,
        disabled: uploadingReferenceIds.includes(reference.id),
    })), [images, uploadingReferenceIds, translate.locale]);
    const videoReferences = useMemo<PromptImageReference[]>(() => videos.filter((reference) => hasPlayableVideoUrl(reference.url)).map((reference, index) => ({
        id: reference.id,
        name: reference.name,
        label: seedanceReferenceLabel("video", index),
        previewUrl: reference.url,
        kind: "video" as const,
        disabled: uploadingReferenceIds.includes(reference.id),
    })), [videos, uploadingReferenceIds, translate.locale]);
    const promptReferences = target === "video" ? [...imageReferences, ...videoReferences] : imageReferences;

    useEffect(() => {
        const previous = previousReferencesRef.current;
        previousReferencesRef.current = promptReferences;
        const currentLabels = new Map(promptReferences.map((reference) => [reference.id, reference.label]));
        if (!previous.some((reference) => currentLabels.get(reference.id) !== reference.label)) return;
        onPromptChange(reconcileImageMentions(prompt, previous, promptReferences));
    }, [onPromptChange, prompt, promptReferences]);

    const updateImageSetting = (key: keyof ImageLastUsedSettings, value: string) => {
        if (String(config[key]) !== value) setImageSettingsModified(true);
        updateConfig(key, value);
        void saveImageLastUsedSettings({ [key]: value }).catch((error) => console.error("保存上次图片生成设置失败", error));
    };
    const updateVideoSetting = (key: keyof VideoLastUsedSettings, value: string) => {
        if (String(config[key]) !== value) setVideoSettingsModified(true);
        updateConfig(key, value);
        void saveVideoLastUsedSettings({ [key]: value }).catch((error) => console.error("保存上次视频生成设置失败", error));
    };
    const resolveModeForReferences = (addedImages: number, addedVideos: number): VideoGenerationMode => {
        if (config.videoGenerationMode !== "text-to-video") return config.videoGenerationMode;
        if (videos.length + addedVideos > 0) return "reference-to-video";
        if (images.length + addedImages > 0) return "image-to-video";
        return config.videoGenerationMode;
    };
    const canAddVideos = (addedImages: number, addedVideos: number, mode: VideoGenerationMode) => {
        const custom = readVideoModelConfiguration(effectiveConfig, videoModel)?.isCustomModel;
        const issue = custom
            ? readVideoGenerationConstraintIssue({ config: effectiveConfig, model: videoModel, mode, imageCount: images.length + addedImages, videoCount: videos.length + addedVideos, addingReferences: true })
            : images.length + addedImages > SEEDANCE_REFERENCE_LIMITS.images
                ? translate("video.addUpToReferenceImages", { value0: SEEDANCE_REFERENCE_LIMITS.images })
                : videos.length + addedVideos > SEEDANCE_REFERENCE_LIMITS.videos
                    ? translate("generation.atMostSeedanceReferenceVideos", { value0: SEEDANCE_REFERENCE_LIMITS.videos })
                    : "";
        if (issue) message.warning(issue);
        return !issue;
    };

    const addImageFiles = async (files?: FileList | File[] | null) => {
        const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
        if (!imageFiles.length) return;
        const placeholders = imageFiles.map((file) => ({ id: nanoid(), name: file.name, type: file.type, dataUrl: URL.createObjectURL(file) }));
        setImages((current) => [...current, ...placeholders]);
        setUploadingReferenceIds((current) => [...current, ...placeholders.map((item) => item.id)]);
        await Promise.all(placeholders.map(async (placeholder, index) => {
            try {
                const file = imageFiles[index];
                const image = await uploadImage(file);
                recordRecentReferenceAsset({ kind: "image", url: image.objectStorage?.url || image.url, storageKey: image.storageKey, name: file.name });
                setImages((current) => current.map((item) => item.id === placeholder.id ? { ...placeholder, name: file.name, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey, objectStorage: image.objectStorage } : item));
            } catch (error) {
                setImages((current) => current.filter((item) => item.id !== placeholder.id));
                message.error(error instanceof Error ? error.message : translate("image.failedToUploadReference", { value0: placeholder.name }));
            } finally {
                URL.revokeObjectURL(placeholder.dataUrl);
                setUploadingReferenceIds((current) => current.filter((id) => id !== placeholder.id));
            }
        }));
    };

    const addVideoFiles = async (files?: FileList | File[] | null) => {
        const selectedFiles = Array.from(files || []);
        if (selectedFiles.some((file) => !file.type.startsWith("image/") && !file.type.startsWith("video/"))) message.warning(translate("video.unsupportedReferencesIgnored"));
        const imageFiles = selectedFiles.filter((file) => file.type.startsWith("image/") && file.size <= SEEDANCE_REFERENCE_LIMITS.imageMaxBytes);
        const videoFiles = selectedFiles.filter((file) => file.type.startsWith("video/") && file.size <= SEEDANCE_REFERENCE_LIMITS.videoMaxBytes);
        const mode = resolveModeForReferences(imageFiles.length, videoFiles.length);
        if (!canAddVideos(imageFiles.length, videoFiles.length, mode)) return;
        if (mode !== config.videoGenerationMode) updateVideoSetting("videoGenerationMode", mode);
        if (selectedFiles.some((file) => file.type.startsWith("image/") && file.size > SEEDANCE_REFERENCE_LIMITS.imageMaxBytes)) message.warning(translate("video.referenceImagesOver30MBIgnored"));
        if (selectedFiles.some((file) => file.type.startsWith("video/") && file.size > SEEDANCE_REFERENCE_LIMITS.videoMaxBytes)) message.warning(translate("video.referenceVideosOver50MBIgnored"));
        const imagePlaceholders = imageFiles.map((file) => ({ id: nanoid(), name: file.name, type: file.type, dataUrl: URL.createObjectURL(file) }));
        const videoPlaceholders = videoFiles.map((file) => ({ id: nanoid(), name: file.name, type: file.type, url: URL.createObjectURL(file) }));
        if (!imagePlaceholders.length && !videoPlaceholders.length) return;
        setImages((current) => [...current, ...imagePlaceholders]);
        setVideos((current) => [...current, ...videoPlaceholders]);
        setUploadingReferenceIds((current) => [...current, ...imagePlaceholders.map((item) => item.id), ...videoPlaceholders.map((item) => item.id)]);
        await Promise.all([
            ...imagePlaceholders.map(async (placeholder, index) => {
                try {
                    const file = imageFiles[index];
                    const image = await uploadImage(file);
                    recordRecentReferenceAsset({ kind: "image", url: image.objectStorage?.url || image.url, storageKey: image.storageKey, name: file.name });
                    setImages((current) => current.map((item) => item.id === placeholder.id ? { ...placeholder, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey, objectStorage: image.objectStorage } : item));
                } catch (error) {
                    setImages((current) => current.filter((item) => item.id !== placeholder.id));
                    message.error(error instanceof Error ? error.message : translate("video.failedToUploadReference", { value0: placeholder.name }));
                } finally {
                    URL.revokeObjectURL(placeholder.dataUrl);
                    setUploadingReferenceIds((current) => current.filter((id) => id !== placeholder.id));
                }
            }),
            ...videoPlaceholders.map(async (placeholder, index) => {
                try {
                    const file = videoFiles[index];
                    const video = await uploadMediaFile(file, "video-reference");
                    recordRecentReferenceAsset({ kind: "video", url: video.objectStorage?.url || video.url, storageKey: video.storageKey, name: file.name, durationMs: video.durationMs });
                    setVideos((current) => current.map((item) => item.id === placeholder.id ? { ...placeholder, type: video.mimeType, url: video.url, storageKey: video.storageKey, bytes: video.bytes, width: video.width, height: video.height, durationMs: video.durationMs, objectStorage: video.objectStorage } : item));
                } catch (error) {
                    setVideos((current) => current.filter((item) => item.id !== placeholder.id));
                    message.error(error instanceof Error ? error.message : translate("video.failedToUploadReferenceVideo", { value0: placeholder.name }));
                } finally {
                    URL.revokeObjectURL(placeholder.url);
                    setUploadingReferenceIds((current) => current.filter((id) => id !== placeholder.id));
                }
            }),
        ]);
    };

    const addFiles = (files?: FileList | File[] | null) => {
        if (target === "image") void addImageFiles(files);
        else void addVideoFiles(files);
    };
    const addRecentReference = (asset: RecentReferenceAsset) => {
        if (target === "image") {
            if (asset.kind !== "image" || images.some((reference) => reference.dataUrl === asset.url)) return;
            setImages((current) => [...current, { id: nanoid(), name: asset.name || translate("image.recentReferenceImages"), type: "image/*", dataUrl: asset.url }]);
            return;
        }
        const mode = resolveModeForReferences(asset.kind === "image" ? 1 : 0, asset.kind === "video" ? 1 : 0);
        if (asset.kind === "video") {
            if (videos.some((reference) => reference.url === asset.url) || !canAddVideos(0, 1, mode)) return;
            setVideos((current) => [...current, { id: nanoid(), name: asset.name || translate("generation.referenceVideo_6ae00d"), type: "video/*", url: asset.url, durationMs: asset.durationMs }]);
        } else {
            if (images.some((reference) => reference.dataUrl === asset.url) || !canAddVideos(1, 0, mode)) return;
            setImages((current) => [...current, { id: nanoid(), name: asset.name || translate("video.recentReferenceImages"), type: "image/*", dataUrl: asset.url }]);
        }
        if (mode !== config.videoGenerationMode) updateVideoSetting("videoGenerationMode", mode);
    };
    const insertPickedAsset = (payload: InsertAssetPayload) => {
        if (payload.kind === "text") onPromptChange(payload.content);
        else if (payload.kind === "image") {
            if (!payload.storageKey) message.error(translate(target === "image" ? "image.imageAssetHasNoMediaStorageKeyUploadIt" : "video.imageAssetHasNoMediaStorageKeyUploadIt"));
            else if (target === "video") {
                const mode = resolveModeForReferences(1, 0);
                if (canAddVideos(1, 0, mode)) {
                    setImages((current) => [...current, { id: nanoid(), name: payload.title, type: payload.mimeType, dataUrl: payload.dataUrl, storageKey: payload.storageKey, objectStorage: payload.objectStorage }]);
                    if (mode !== config.videoGenerationMode) updateVideoSetting("videoGenerationMode", mode);
                }
            } else {
                setImages((current) => [...current, { id: nanoid(), name: payload.title, type: payload.mimeType, dataUrl: payload.dataUrl, storageKey: payload.storageKey, objectStorage: payload.objectStorage }]);
            }
        } else if (target === "image") message.warning(translate("image.imageWorkspaceAcceptsTextOrImageReferences"));
        else if (!hasPlayableVideoUrl(payload.url)) message.error(translate("video.videoAssetURLIsEmpty"));
        else {
            const mode = resolveModeForReferences(0, 1);
            if (canAddVideos(0, 1, mode)) {
                setVideos((current) => [...current, { id: nanoid(), name: payload.title, type: "video/mp4", url: payload.url, storageKey: payload.storageKey, width: payload.width, height: payload.height, objectStorage: payload.objectStorage }]);
                if (mode !== config.videoGenerationMode) updateVideoSetting("videoGenerationMode", mode);
            }
        }
        setAssetPickerOpen(false);
    };

    const imageCredit = requestCreditCost({ modelCosts: effectiveConfig.modelCosts, model: imageModel, taskType: "image", count: 1, resolution: config.imageResolution });
    const imageBalance = useModelCreditBalance("image");
    const videoBalance = useModelCreditBalance("video");
    const videoQuote = quoteVideoGeneration({
        config: effectiveConfig,
        model: videoModel,
        mode: config.videoGenerationMode,
        resolution: config.vquality,
        seconds: config.videoSeconds,
        size: config.size,
        imageReferenceCount: images.length,
        videoReferenceCount: videos.length,
        requireReferences: false,
    });
    const imageBalanceInsufficient = useInsufficientCreditsPrompt({
        enabled: loggedIn && configHydrated && target === "image" && effectiveConfig.modelCosts.some((item) => item.model === imageModel && item.taskType === "image"),
        requiredCredits: imageCredit,
        availableCredits: imageBalance,
        contextKey: "homepage-image",
    });
    const videoBalanceInsufficient = useInsufficientCreditsPrompt({
        enabled: loggedIn && configHydrated && target === "video" && !workflowSkill && videoQuote.available,
        requiredCredits: videoQuote.available ? videoQuote.credits : null,
        availableCredits: videoBalance,
        contextKey: "homepage-video",
    });
    const referenceIssue = target === "video" && !workflowSkill
        ? readVideoGenerationConstraintIssue({ config: effectiveConfig, model: videoModel, mode: config.videoGenerationMode, size: config.size, seconds: config.videoSeconds, imageCount: images.length, videoCount: videos.length }) || videoGenerationReferenceIssue(config.videoGenerationMode, images.length, videos.length)
        : "";
    const quoteIssue = target === "video" && loggedIn && configHydrated && !workflowSkill && !videoQuote.available ? videoQuote.reason : "";
    const balanceInsufficient = target === "image" ? imageBalanceInsufficient : videoBalanceInsufficient;
    const creditCost = !loggedIn || !configHydrated ? undefined : target === "image" ? imageCredit : workflowSkill ? undefined : videoQuote.available ? videoQuote.credits : null;
    const canSubmit = (loggedIn ? configHydrated : true) && Boolean(prompt.trim()) && !balanceInsufficient && !isPromptOptimizing && !uploadingReferenceIds.length && !referenceIssue && !quoteIssue && !submitting;
    const settingsSummary = target === "image"
        ? imageSettingsModified ? formatImageGenerationSettingsSummary({ quality: imageQualityLabel(config.quality || "medium"), resolution: imageResolutionLabel(config.imageResolution || "2K"), ratio: imageSizeLabel(config.size || "1:1"), model: modelOptionLabel(effectiveConfig, imageModel) }) : ""
        : videoSettingsModified ? formatVideoGenerationSettingsSummary({ resolution: videoResolutionLabel(config.vquality || "720p"), ratio: videoSizeLabel(config.size || "16:9"), duration: videoSecondsLabel(config.videoSeconds || "5", { ...effectiveConfig, model: videoModel, videoModel, vquality: config.vquality, size: config.size, videoSeconds: config.videoSeconds }), model: modelOptionLabel(effectiveConfig, videoModel) }) : "";
    const visibleImages = target === "video" ? images : images;
    const referenceChips: CreationReferenceChip[] = [
        ...(target === "image" || target === "video" ? visibleImages : []).map((reference, index) => {
            const uploading = uploadingReferenceIds.includes(reference.id);
            const label = target === "video" ? seedanceReferenceLabel("image", index) : imageReferenceLabel(index);
            return {
                id: reference.id,
                label: uploading ? translate(target === "image" ? "image.uploading" : "video.uploading", { value0: label }) : label,
                preview: (
                    <div className="relative size-11">
                        <Image src={reference.dataUrl} alt={reference.name} width={44} height={44} style={{ objectFit: "cover" }} className="rounded-xl" preview={uploading ? false : { mask: translate(target === "image" ? "image.preview" : "video.preview") }} />
                        {uploading ? <span className="pointer-events-none absolute inset-0 grid place-items-center rounded-xl bg-black/35 text-white"><LoaderCircle className="size-4 animate-spin" /></span> : null}
                    </div>
                ),
                onRemove: () => setImages((current) => current.filter((item) => item.id !== reference.id)),
            };
        }),
        ...(target === "video" ? videos.filter((reference) => hasPlayableVideoUrl(reference.url)).map((reference, index) => {
            const uploading = uploadingReferenceIds.includes(reference.id);
            const label = seedanceReferenceLabel("video", index);
            return {
                id: reference.id,
                label: uploading ? translate("video.uploading", { value0: label }) : label,
                preview: (
                    <div className={`group relative size-11 ${uploading ? "" : "cursor-pointer"}`} onClick={() => { if (!uploading) setVideoPreviewUrl(reference.url); }}>
                        <video src={reference.url} className="size-11 rounded-xl object-cover" muted />
                        {uploading ? <span className="absolute inset-0 grid place-items-center rounded-xl bg-black/35 text-white"><LoaderCircle className="size-4 animate-spin" /></span> : <span className="pointer-events-none absolute inset-0 grid place-items-center rounded-xl bg-black/0 text-white opacity-0 transition-opacity group-hover:bg-black/35 group-hover:opacity-100"><VideoIcon className="size-5" /></span>}
                    </div>
                ),
                onRemove: () => setVideos((current) => current.filter((item) => item.id !== reference.id)),
            };
        }) : []),
    ];
    const composerActions: CreationComposerAction[] = [
        {
            key: "upload",
            label: translate(target === "image" ? "image.referenceImage" : "video.assets"),
            icon: <Upload className="size-3.5" />,
            popoverContent: (
                <RecentReferenceAssetPicker
                    assets={recentReferenceAssets.filter((asset) => target === "video" || asset.kind === "image")}
                    selectedUrls={[...images.map((reference) => reference.dataUrl), ...videos.map((reference) => reference.url)]}
                    onSelect={addRecentReference}
                />
            ),
            onClick: () => fileInputRef.current?.click(),
        },
        { key: "prompt-library", label: translate(target === "image" ? "image.promptLibrary" : "video.promptLibrary"), icon: <BookOpen className="size-3.5" />, onClick: () => setPromptDialogOpen(true) },
        {
            key: "optimize-prompt",
            label: translate(target === "image" ? "image.optimizePromptWithAI" : "video.optimizePromptWithAI"),
            icon: <Sparkles className="size-3.5" />,
            placement: "submit",
            iconOnly: true,
            disabled: !prompt.trim() || isPromptOptimizing || submitting,
            loading: isPromptOptimizing,
            onClick: () => void optimizePrompt({
                operationId: `homepage-${target}`,
                generationType: target,
                prompt,
                generationStyleIds: selectedStyles.map((style) => style.id),
                imageReferences: promptReferences,
                onSuccess: (optimizedPrompt) => onPromptChange(reconcileImageMentions(optimizedPrompt, promptReferences, previousReferencesRef.current)),
            }),
        },
        { key: "assets", label: translate(target === "image" ? "image.assetLibrary" : "video.assetLibrary"), icon: <FolderPlus className="size-3.5" />, onClick: () => setAssetPickerOpen(true) },
        { key: "settings", label: settingsSummary || translate(target === "image" ? "image.moreSettings" : "video.moreSettings"), className: settingsSummary ? "creation-composer-action-settings" : undefined, icon: <Cog className="size-3.5" />, onClick: () => setSettingsOpen(true) },
    ];

    const switchTarget = (next: HomepageCreationTarget) => {
        if (next === target) return;
        setSelectedStyles([]);
        setSelectedSkill(null);
        onTargetChange(next);
    };
    const handleCreationModeChange = (nextMode: CreationMode) => {
        if (nextMode === "chat") {
            setSelectedStyles([]);
            setSelectedSkill(null);
        }
        changeCreationMode(nextMode);
    };
    const submit = () => {
        const text = prompt.trim();
        if (!text || !canSubmit) return;
        if (loggedIn) {
            if (!ensureModelConfiguration(target, target === "image" ? imageModel : videoModel)) return;
            if (creationMode !== "chat" && !ensureModelConfiguration("text")) return;
            if (balanceInsufficient) {
                showInsufficientCredits();
                return;
            }
        }
        writeCreationMode(target, creationMode);
        const stored = storeHomepageCreationHandoff({
            target,
            prompt: text,
            creationMode,
            styles: creationMode === "chat" ? [] : selectedStyles,
            skill: creationMode === "chat" ? null : selectedSkill,
            images,
            videos: target === "video" ? videos : [],
            imageSettings: { quality: config.quality, imageResolution: config.imageResolution, size: config.size, count: config.count, imageModel: config.imageModel || "" },
            videoSettings: { videoGenerationMode: config.videoGenerationMode, vquality: config.vquality, size: config.size, videoSeconds: config.videoSeconds, videoWatermark: config.videoWatermark, videoModel: config.videoModel || "" },
        });
        if (!stored) {
            message.error(translate("page.creationHandoffFailed"));
            return;
        }
        setSubmitting(true);
        openHomepageGeneration(target);
        if (!useUserStore.getState().user && useUserStore.getState().showAuthModal) awaitingAuthRef.current = true;
    };

    return (
        <>
            <input ref={fileInputRef} type="file" accept={target === "video" ? "image/*,video/*" : "image/*"} multiple className="hidden" onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} />
            <CreationComposer
                embedded
                agentLabel={target === "image" ? "Image Agent" : "Video Agent"}
                value={prompt}
                placeholder={translate(target === "image" ? "image.describeSubjectStyleCompositionLightingAndPurpose" : "video.describeCameraMotionSubjectActionAtmosphereAndVisualStyle")}
                references={referenceChips}
                imageReferences={promptReferences}
                styleOptions={styleOptions}
                selectedStyles={selectedStyles}
                styleLoading={styleLoading}
                styleError={styleError}
                skillOptions={skillOptions}
                selectedSkill={selectedSkill}
                skillLoading={skillLoading}
                skillError={skillError}
                actions={composerActions}
                creationMode={creationMode}
                onCreationModeChange={handleCreationModeChange}
                running={false}
                canSubmit={canSubmit}
                creditCost={creditCost}
                toolbarLeading={(
                    <Segmented
                        className="creation-composer-mode"
                        aria-label={translate("page.creationType")}
                        value={target}
                        options={[{ label: translate("common.image"), value: "image" }, { label: translate("common.video"), value: "video" }]}
                        onChange={(value) => switchTarget(value as HomepageCreationTarget)}
                    />
                )}
                notice={quoteIssue || referenceIssue ? <p className="mb-2 flex items-start gap-1.5 text-xs leading-5 text-[var(--studio-muted)]"><HelpCircle className="mt-0.5 size-3.5 shrink-0" />{quoteIssue || referenceIssue}</p> : undefined}
                onChange={onPromptChange}
                onStyleSelect={(style) => setSelectedStyles([style])}
                onStyleRemove={(styleId) => setSelectedStyles((current) => current.filter((style) => style.id !== styleId))}
                onSkillSelect={setSelectedSkill}
                onSkillRemove={() => setSelectedSkill(null)}
                onPasteImages={(files) => addFiles(files)}
                onSubmit={submit}
            />
            <CreationSettingsModal open={settingsOpen} title={translate(target === "image" ? "image.imageSettings" : "video.videoSettings")} onClose={() => setSettingsOpen(false)}>
                <div className="space-y-4">
                    {target === "image" ? <ImageSettingsPanel config={config} onConfigChange={updateImageSetting} theme={theme} showTitle={false} showCount={false} className="space-y-4 px-0 py-0" /> : <VideoSettingsPanel config={config} onConfigChange={updateVideoSetting} theme={theme} showTitle={false} className="space-y-4 px-0 py-0" />}
                    <div>
                        <label className="mb-1.5 block text-sm font-semibold text-[var(--studio-ink)]">{translate(target === "image" ? "image.model" : "video.model")}</label>
                        <ModelPicker
                            config={effectiveConfig}
                            value={target === "image" ? imageModel : videoModel}
                            onChange={(value) => {
                                if (target === "image") {
                                    if (value !== imageModel) setImageSettingsModified(true);
                                    updateConfig("imageModel", value);
                                } else {
                                    if (value !== videoModel) setVideoSettingsModified(true);
                                    updateConfig("videoModel", value);
                                }
                            }}
                            capability={target}
                            modelOptions={target === "video" ? availableVideoModelsForMode(effectiveConfig, config.videoGenerationMode) : undefined}
                            fullWidth
                        />
                    </div>
                </div>
            </CreationSettingsModal>
            <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={onPromptChange} />
            <AssetPickerModal open={assetPickerOpen} defaultTab="my-assets" onInsert={insertPickedAsset} onClose={() => setAssetPickerOpen(false)} />
            <Modal open={Boolean(videoPreviewUrl)} title={translate("video.referenceVideoPreview")} footer={null} onCancel={() => setVideoPreviewUrl(null)} width={720} centered destroyOnHidden>
                {videoPreviewUrl ? <video src={videoPreviewUrl} controls autoPlay className="max-h-[70vh] w-full rounded-xl bg-black" /> : null}
            </Modal>
        </>
    );
}
