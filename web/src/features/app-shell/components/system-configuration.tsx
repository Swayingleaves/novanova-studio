"use client";
import { currentLanguageTag } from "@/features/locale/translate";

import { translateMessage as translate } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";


import { Alert, App, Button, Checkbox, Form, Input, InputNumber, Modal, Select, Space, Switch, Tabs } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { nanoid } from "nanoid";
import { Braces, CheckCircle2, ChevronDown, ChevronUp, Clapperboard, CloudUpload, Copy, Image, Info, Monitor, Pencil, Plus, RefreshCw, Sparkles, TextCursorInput, Trash2, Video, Wifi } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useUserStore } from "@/features/auth/stores/use-user-store";
import { ModelIcon } from "@/features/settings/components/model-picker";
import { MODEL_ICON_OPTIONS } from "@/features/settings/components/model-icon";
import { createModelCapabilityOptions,
    configFromModelConfigs,
    createModelChannel,
    createObjectStorageConfig,
    defaultBaseUrlForApiFormat,
    MODEL_CAPABILITY_OPTIONS,
    modelOptionChannel,
    modelOptionLabelWithRealName,
    normalizeModelOptionValue,
    useConfigStore,
    type AiConfig,
    type ApiCallFormat,
    type CustomModelGroupConfig,
    type ModelCapability,
    type ModelChannel,
    type VideoBillingConfiguration,
    type VideoGenerationMode,
    type VideoResolution,
} from "@/features/settings/stores/use-config-store";
import { createVideoGenerationCapabilityOptions, VIDEO_GENERATION_CAPABILITY_OPTIONS, VIDEO_RESOLUTION_OPTIONS, createVideoBillingConfiguration } from "@/features/generation/lib/video-billing";
import { isObjectStorageReady, objectStorageReadyMessage, testObjectStorageUpload } from "@/features/storage/services/object-storage";
import { isOpenAiTextModel, isReasoningEffortDisabled, reasoningEffortOptions } from "@/features/settings/lib/model-thinking-configuration";
import {
    createChannel,
    createModelConfig,
    createObjectStorage as createServerObjectStorage,
    deleteChannel as deleteServerChannel,
    deleteModelConfig,
    deleteObjectStorage as deleteServerObjectStorage,
    getCreditSettings,
    getCheckInRewardSettings,
    getInvitationRewardSettings,
    refreshChannelModels as refreshServerChannelModels,
    setDefaultModel,
    setDefaultObjectStorage as setServerDefaultObjectStorage,
    updateChannel as updateServerChannel,
    updateCheckInRewardSettings,
    updateCreditSettings,
    updateInvitationRewardSettings,
    updateModelConfig,
    updateObjectStorage as updateServerObjectStorage,
    type ServerModelConfig,
} from "@/services/api/server";
import type { ObjectStorageConfig, ObjectStorageProvider } from "@/shared/types/object-storage";
import { blockingModelConfigDependencyIssues, createDraftModelConfigs, modelConfigDependencyIssues, reconcileModelConfigDraft, updateModelConfigSelection } from "./model-config-draft";
import { cloneImageSizeMappings, IMAGE_RESOLUTIONS, normalizeImageSizeMappings, type ImageResolution, type ImageSizeMappings } from "@/features/generation/lib/image-size-mappings";
import { ImageSizeMappingsEditor } from "./image-size-mappings-editor";
import { ModelSelectModal, type ChannelModelGroup } from "./model-select-modal";
import { ModelConfigCopyModal } from "./model-config-copy-modal";
import { applyCustomConfigCopy } from "./model-config-copy";
import type { CustomGroupField, CustomModelMode } from "./model-config-copy";
import { ModelConfigAutoFillModal } from "./model-config-auto-fill-modal";
import { VideoGenerationConstraintsEditor } from "./video-generation-constraints-editor";
import { videoConstraintConfigurationIssues } from "@/features/generation/lib/video-generation-constraints";
import { useConfigurationLeaveGuard } from "./use-configuration-leave-guard";
import { CommunityConfigManagement } from "./community-config-management";
import { communityDraftIssue, communityDraftSignature, createCommunityDrafts, type CommunityConfigDraft } from "./community-config";
import { saveCommunityConfigs } from "@/services/api/community";
import { useCommunityStore } from "@/features/community/stores/use-community-store";

type ConfigurationTabKey = "channels" | "models" | "credits" | "invitationReward" | "checkIn" | "objectStorage" | "community";

type ModelGroup = {
    capability: ModelCapability;
    modelKey: "imageModel" | "videoModel" | "textModel";
    modelsKey: "imageModels" | "videoModels" | "textModels";
    defaultLabel: string;
    optionsLabel: string;
};

const createModelGroups = (translator: typeof translate = translate): ModelGroup[] => ([
    { capability: "image", modelKey: "imageModel", modelsKey: "imageModels", get defaultLabel() { return translator("appShell.defaultImageModel"); }, get optionsLabel() { return translator("appShell.availableImageModels"); } },
    { capability: "video", modelKey: "videoModel", modelsKey: "videoModels", get defaultLabel() { return translator("appShell.defaultVideoModel"); }, get optionsLabel() { return translator("appShell.availableVideoModels"); } },
    { capability: "text", modelKey: "textModel", modelsKey: "textModels", get defaultLabel() { return translator("appShell.defaultTextModel"); }, get optionsLabel() { return translator("appShell.availableTextModels"); } },
]);

const createCapabilityGroups = (translator: typeof translate = translate): Array<{ capability: ModelCapability; modelsKey: "textModels" | "imageModels" | "videoModels"; label: string }> => ([
    { capability: "text", modelsKey: "textModels", get label() { return translator("appShell.textModel"); } },
    { capability: "image", modelsKey: "imageModels", get label() { return translator("appShell.imageModel"); } },
    { capability: "video", modelsKey: "videoModels", get label() { return translator("appShell.videoModel"); } },
]);

const modelIconSelectOptions = MODEL_ICON_OPTIONS.map((option) => ({
    value: option.value,
    label: (
        <span className="inline-flex items-center gap-2">
            {option.path ? <img src={option.path} alt="" className="size-4" /> : option.value === "clapperboard" ? <Clapperboard className="size-4 opacity-70" /> : null}
            <span>{option.label}</span>
        </span>
    ),
}));

const createApiFormatOptions = (translator: typeof translate = translate): Array<{ label: string; value: ApiCallFormat }> => ([
    { label: "OpenAI", value: "openai" },
    { label: "New API", value: "newapi" },
    { label: "Evolink", value: "evolink" },
    { label: "Gemini", value: "gemini" },
    { label: "Agnes", value: "agnes" },
    { label: "Anthropic", value: "anthropic" },
    { label: "Seedance", value: "seedance" },
    { label: "MiniMax", value: "minimax" },
    { get label() { return translator("appShell.custom"); }, value: "custom" },
]);

const createObjectStorageProviderOptions = (translator: typeof translate = translate): Array<{ label: string; value: ObjectStorageProvider }> => ([
    { get label() { return translator("appShell.tencentCloudCOS"); }, value: "tencentCos" },
    { get label() { return translator("appShell.alibabaCloudOSS"); }, value: "aliyunOss" },
    { get label() { return translator("appShell.qiniuCloudKodo"); }, value: "qiniuKodo" },
]);

const createQiniuRegionOptions = (translator: typeof translate = translate) => ([
    { get label() { return translator("appShell.eastChinaZhejiangZ0"); }, value: "z0" },
    { get label() { return translator("appShell.eastChinaZhejiang2CnEast2"); }, value: "cn-east-2" },
    { get label() { return translator("appShell.northChinaHebeiZ1"); }, value: "z1" },
    { get label() { return translator("appShell.southChinaGuangdongZ2"); }, value: "z2" },
    { get label() { return translator("appShell.northAmericaLosAngelesNa0"); }, value: "na0" },
    { get label() { return translator("appShell.asiaPacificSingaporeAs0"); }, value: "as0" },
]);

const createObjectStorageProviderFields = (translator: typeof translate = translate): Record<ObjectStorageProvider, { accessKeyLabel: string; secretKeyLabel: string; bucketPlaceholder: string; regionLabel: string; regionPlaceholder: string; publicBaseUrlExtra: string }> => ({
    tencentCos: {
        accessKeyLabel: "SecretId",
        secretKeyLabel: "SecretKey",
        bucketPlaceholder: "example-1250000000",
        regionLabel: "Region",
        regionPlaceholder: "ap-guangzhou",
        get publicBaseUrlExtra() { return translator("appShell.defaultsToHttpsCosMyqcloudCom"); },
    },
    aliyunOss: {
        accessKeyLabel: "AccessKey ID",
        secretKeyLabel: "AccessKey Secret",
        bucketPlaceholder: "example-bucket",
        get regionLabel() { return translator("appShell.regionID"); },
        regionPlaceholder: "cn-hangzhou",
        get publicBaseUrlExtra() { return translator("appShell.leaveBlankToGenerateTheURLFromBucketAnd"); },
    },
    qiniuKodo: {
        accessKeyLabel: "AccessKey",
        secretKeyLabel: "SecretKey",
        bucketPlaceholder: "example-bucket",
        get regionLabel() { return translator("appShell.region"); },
        get regionPlaceholder() { return translator("appShell.selectARegion"); },
        get publicBaseUrlExtra() { return translator("appShell.enterACDNOrCustomDomainBoundToThis"); },
    },
});

export function SystemConfiguration() {
    const translate = useTranslation();
    const { message, modal } = App.useApp();
    const user = useUserStore((state) => state.user);
    const config = useConfigStore((state) => state.config);
    const modelConfigs = useConfigStore((state) => state.modelConfigs);
    const objectStorages = useConfigStore((state) => state.objectStorages);
    const refreshChannels = useConfigStore((state) => state.refreshChannels);
    const refreshModelConfiguration = useConfigStore((state) => state.refreshModelConfiguration);
    const refreshObjectStorages = useConfigStore((state) => state.refreshObjectStorages);
    const [activeTab, setActiveTab] = useState<ConfigurationTabKey>("channels");
    const [draftsReady, setDraftsReady] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [savingTab, setSavingTab] = useState<ConfigurationTabKey | "">("");
    const [loadingChannelId, setLoadingChannelId] = useState("");
    const [refreshingObjectStorages, setRefreshingObjectStorages] = useState(false);
    const [testingObjectStorageId, setTestingObjectStorageId] = useState("");
    const [testedObjectStorageId, setTestedObjectStorageId] = useState("");
    const [objectStorageTestUrl, setObjectStorageTestUrl] = useState("");
    const [collapsedChannelIds, setCollapsedChannelIds] = useState<string[]>([]);
    const [collapsedModelCapabilityTypes, setCollapsedModelCapabilityTypes] = useState<ModelCapability[]>([]);
    const [collapsedObjectStorageIds, setCollapsedObjectStorageIds] = useState<string[]>([]);
    const [channelBaseline, setChannelBaseline] = useState<ModelChannel[]>([]);
    const [draftChannels, setDraftChannels] = useState<ModelChannel[]>([]);
    const [modelConfigBaseline, setModelConfigBaseline] = useState<ServerModelConfig[]>([]);
    const [draftModelConfigs, setDraftModelConfigs] = useState<ServerModelConfig[]>([]);
    const [objectStorageBaseline, setObjectStorageBaseline] = useState<ObjectStorageConfig[]>([]);
    const [draftObjectStorages, setDraftObjectStorages] = useState<ObjectStorageConfig[]>([]);
    const [creditBaseline, setCreditBaseline] = useState(100);
    const [draftInitialCredits, setDraftInitialCredits] = useState(100);
    const [invitationRewardBaseline, setInvitationRewardBaseline] = useState(0);
    const [draftInvitationRewardCredits, setDraftInvitationRewardCredits] = useState(0);
    const [checkInBaseline, setCheckInBaseline] = useState(0);
    const [draftCheckInCredits, setDraftCheckInCredits] = useState(0);
    const [communityBaseline, setCommunityBaseline] = useState<CommunityConfigDraft[]>([]);
    const [draftCommunityConfigs, setDraftCommunityConfigs] = useState<CommunityConfigDraft[]>([]);
    const [editingModelConfig, setEditingModelConfig] = useState<ServerModelConfig | null>(null);
    const [modelPicker, setModelPicker] = useState<{ capability: ModelCapability; mode: "options" | "default" } | null>(null);
    const [editingCustomBodyParameters, setEditingCustomBodyParameters] = useState("{}");
    const [collapsedEditingCapabilities, setCollapsedEditingCapabilities] = useState<string[]>([]);
    const [modelConfigCopyTarget, setModelConfigCopyTarget] = useState<ServerModelConfig | null>(null);
    const [autoFillConfigMode, setAutoFillConfigMode] = useState<VideoGenerationMode | null>(null);
    const editingModelIsMedia = Boolean(editingModelConfig && (editingModelConfig.modelType === "image" || editingModelConfig.modelType === "video"));

    const resetChannelDraft = useCallback((resetCollapsed = false) => {
        const channels = cloneChannels(useConfigStore.getState().config.channels);
        setChannelBaseline(channels);
        setDraftChannels(cloneChannels(channels));
        if (resetCollapsed) setCollapsedChannelIds(channels.map((channel) => channel.id));
    }, []);

    const resetModelConfigDraft = useCallback(() => {
        const configs = cloneModelConfigs(useConfigStore.getState().modelConfigs);
        setModelConfigBaseline(configs);
        setDraftModelConfigs(cloneModelConfigs(configs));
        setCollapsedModelCapabilityTypes(createCapabilityGroups(translate).map((group) => group.capability));
    }, []);

    const resetObjectStorageDraft = useCallback(() => {
        const storages = cloneObjectStorages(useConfigStore.getState().objectStorages);
        setObjectStorageBaseline(storages);
        setDraftObjectStorages(cloneObjectStorages(storages));
        setCollapsedObjectStorageIds(storages.map((storage) => storage.id));
    }, []);

    const resetCommunityDraft = useCallback(() => {
        const drafts = createCommunityDrafts(useCommunityStore.getState().configs);
        setCommunityBaseline(drafts);
        setDraftCommunityConfigs(drafts.map((draft) => ({ ...draft })));
    }, []);

    const resetAllDrafts = useCallback(() => {
        resetChannelDraft(true);
        resetModelConfigDraft();
        resetObjectStorageDraft();
        resetCommunityDraft();
        setTestedObjectStorageId("");
        setObjectStorageTestUrl("");
    }, [resetChannelDraft, resetModelConfigDraft, resetObjectStorageDraft, resetCommunityDraft]);

    useEffect(() => {
        if (user?.role !== "admin") return;
        setDraftsReady(false);
        setLoadError("");
        let active = true;
        void Promise.all([refreshModelConfiguration(), refreshObjectStorages(), getCreditSettings(), getInvitationRewardSettings(), getCheckInRewardSettings(), useCommunityStore.getState().refresh()])
            .then(([, , creditSettings, invitationRewardSettings, checkInSettings]) => {
                if (!active) return;
                resetAllDrafts();
                setCreditBaseline(creditSettings.initialCredits);
                setDraftInitialCredits(creditSettings.initialCredits);
                setInvitationRewardBaseline(invitationRewardSettings.invitationRewardCredits);
                setDraftInvitationRewardCredits(invitationRewardSettings.invitationRewardCredits);
                setCheckInBaseline(checkInSettings.checkInCredits);
                setDraftCheckInCredits(checkInSettings.checkInCredits);
                setDraftsReady(true);
            })
            .catch((error) => {
                if (!active) return;
                setLoadError(error instanceof Error ? error.message : translate("appShell.failedToLoadConfiguration"));
            });
        return () => {
            active = false;
        };
    }, [loadAttempt, user?.role, refreshModelConfiguration, refreshObjectStorages, resetAllDrafts]);

    const draftConfig = useMemo(() => {
        const nextConfig = configFromModelConfigs(draftChannels, draftModelConfigs, config);
        // 管理界面保留失效配置，允许用户看见并移除；业务模型目录仍只展示可用模型。
        for (const group of createModelGroups(translate)) nextConfig[group.modelsKey] = draftModelConfigs.filter((item) => item.modelType === group.capability).map(modelConfigValue);
        return nextConfig;
    }, [config, draftChannels, draftModelConfigs, translate.locale]);
    const dependencyIssues = useMemo(() => modelConfigDependencyIssues(channelBaseline, draftModelConfigs), [channelBaseline, draftModelConfigs, translate.locale]);
    // 「我的模型」的模型选择走弹窗：左侧渠道、右侧该渠道的模型。
    const modelGroups = useMemo(() => createChannelModelGroups(draftConfig, uniqueModels([...draftConfig.models, ...draftModelConfigs.map(modelConfigValue)]), translate), [draftConfig, draftModelConfigs, translate.locale]);
    const capabilityModelGroups = useMemo(
        () => new Map(createModelGroups(translate).map((group) => [group.capability, createChannelModelGroups(draftConfig, draftConfig[group.modelsKey], translate)])),
        [draftConfig, translate.locale],
    );
    const modelPickerGroup = modelPicker ? createModelGroups(translate).find((group) => group.capability === modelPicker.capability) : undefined;
    const modelPickerGroups: ChannelModelGroup[] = !modelPicker || !modelPickerGroup ? [] : modelPicker.mode === "options" ? modelGroups : capabilityModelGroups.get(modelPicker.capability) || [];
    const modelPickerValues = !modelPicker || !modelPickerGroup ? [] : modelPicker.mode === "options" ? draftConfig[modelPickerGroup.modelsKey] : draftConfig[modelPickerGroup.modelKey] ? [draftConfig[modelPickerGroup.modelKey]] : [];
    const channelsDirty = !sameValue(draftChannels, channelBaseline);
    const modelConfigsDirty = !sameValue(draftModelConfigs, modelConfigBaseline);
    const objectStoragesDirty = !sameValue(draftObjectStorages, objectStorageBaseline);
    const creditsDirty = draftInitialCredits !== creditBaseline;
    const invitationRewardDirty = draftInvitationRewardCredits !== invitationRewardBaseline;
    const checkInDirty = draftCheckInCredits !== checkInBaseline;
    const communityDirty = communityDraftSignature(draftCommunityConfigs) !== communityDraftSignature(communityBaseline);
    const editingModelBaseline = editingModelConfig && draftModelConfigs.find((item) => item.id === editingModelConfig.id);
    const modelEditorDirty = Boolean(editingModelConfig && (!sameValue(editingModelConfig, editingModelBaseline) || editingCustomBodyParameters !== JSON.stringify(editingModelBaseline?.customBodyParameters || {}, null, 2)));
    const hasUnsavedChanges = channelsDirty || modelConfigsDirty || objectStoragesDirty || creditsDirty || invitationRewardDirty || checkInDirty || communityDirty || modelEditorDirty;
    const isSaving = Boolean(savingTab);
    useConfigurationLeaveGuard(draftsReady && hasUnsavedChanges);

    const updateDraftChannel = (id: string, patch: Partial<ModelChannel>) => {
        setDraftChannels((channels) => channels.map((channel) => (channel.id === id ? { ...channel, ...patch, models: patch.models ? uniqueModels(patch.models) : channel.models } : channel)));
    };

    const updateChannelApiFormat = (channel: ModelChannel, apiFormat: ApiCallFormat) => {
        const baseUrl = !channel.baseUrl.trim() || channel.baseUrl.trim() === defaultBaseUrlForApiFormat(channel.apiFormat) ? defaultBaseUrlForApiFormat(apiFormat) : channel.baseUrl;
        updateDraftChannel(channel.id, { apiFormat, baseUrl });
    };

    const addChannel = () => {
        const channel = createModelChannel({ name: translate("appShell.channel", { value0: draftChannels.length + 1 }) });
        setDraftChannels((channels) => [channel, ...channels]);
        setCollapsedChannelIds((ids) => ids.filter((id) => id !== channel.id));
    };

    const removeChannel = (id: string) => {
        modal.confirm({
            title: translate("appShell.confirmDeletion"),
            content: translate("appShell.thisChannelWillBeDeletedFromTheServerWhen"),
            okText: translate("appShell.delete"),
            okType: "danger",
            cancelText: translate("appShell.cancel"),
            onOk: () => {
                setDraftChannels((channels) => channels.filter((channel) => channel.id !== id));
                setCollapsedChannelIds((ids) => ids.filter((item) => item !== id));
            },
        });
    };

    const toggleChannelCollapsed = (id: string) => {
        setCollapsedChannelIds((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]));
    };

    const refreshChannelModels = async (channel: ModelChannel) => {
        if (!channel.baseUrl.trim() || !channel.apiKey.trim()) {
            message.error(translate("appShell.enterThisChannelSBaseURLAndAPIKey"));
            return;
        }
        setLoadingChannelId(channel.id);
        try {
            const result = await refreshServerChannelModels(channel);
            updateDraftChannel(channel.id, { models: result.models });
            message.success(translate("appShell.modelsUpdatedSaveYourChanges", { value0: channel.name }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("appShell.failedToLoadModels"));
        } finally {
            setLoadingChannelId("");
        }
    };

    const saveChannels = async () => {
        const baselineById = new Map(channelBaseline.map((channel) => [channel.id, channel]));
        const draftIds = new Set(draftChannels.map((channel) => channel.id));
        const deletedChannels = channelBaseline.filter((channel) => !draftIds.has(channel.id));
        if (deletedChannels.some((channel) => modelConfigBaseline.some((model) => model.channelId === channel.id))) {
            message.error(translate("appShell.deleteLinkedModelsInMyModelsAndSaveBefore"));
            return;
        }
        setSavingTab("channels");
        try {
            const channelIdMapping = new Map<string, string>();
            for (const channel of draftChannels) {
                const baseline = baselineById.get(channel.id);
                if (!baseline) {
                    const created = await createChannel(channel);
                    channelIdMapping.set(channel.id, created.id);
                } else if (!sameValue(channel, baseline)) {
                    await updateServerChannel(channel);
                }
            }
            for (const channel of deletedChannels) await deleteServerChannel(channel.id);
            await refreshChannels();
            resetChannelDraft();
            if (channelIdMapping.size) {
                setDraftModelConfigs((configs) =>
                    configs.map((configItem) => {
                        const mappedId = channelIdMapping.get(configItem.channelId);
                        return mappedId ? { ...configItem, channelId: mappedId } : configItem;
                    }),
                );
            }
            message.success(translate("appShell.channelConfigurationSaved"));
        } catch (error) {
            await refreshChannels().catch(() => undefined);
            setChannelBaseline(cloneChannels(useConfigStore.getState().config.channels));
            message.error(error instanceof Error ? error.message : translate("appShell.failedToSaveChannelConfiguration"));
        } finally {
            setSavingTab("");
        }
    };

    const updateCapabilityModels = (group: ModelGroup, models: string[]) => {
        const values = uniqueModels(models.map((model) => normalizeModelOptionValue(model, draftChannels)).filter(Boolean));
        if (values.some((value) => !value.includes("::"))) {
            message.warning(translate("appShell.addModelsInMyChannelsBeforeConfiguringOptions"));
            return false;
        }
        setDraftModelConfigs((configs) => updateModelConfigSelection(configs, modelConfigBaseline, group.capability, values, createDraftModelConfig));
        return true;
    };

    const openModelConfigEditor = (configItem: ServerModelConfig) => {
        setEditingModelConfig(cloneModelConfig(configItem));
        setEditingCustomBodyParameters(JSON.stringify(configItem.customBodyParameters || {}, null, 2));
        setCollapsedEditingCapabilities(defaultCollapsedEditingCapabilities(configItem));
        setModelConfigCopyTarget(null);
    };

    const toggleEditingCapabilityCollapsed = (capability: string) => {
        setCollapsedEditingCapabilities((capabilities) => (capabilities.includes(capability) ? capabilities.filter((item) => item !== capability) : [...capabilities, capability]));
    };

    const updateEditingModelConfig = (patch: Partial<ServerModelConfig>) => {
        setEditingModelConfig((configItem) => (configItem ? { ...configItem, ...patch } : configItem));
    };

    /** 从其他同类型自定义模型复制指定模式的调用配置，覆盖目标已有内容。 */
    const copyCustomConfigFromModel = (source: ServerModelConfig, modes: CustomModelMode[]) => {
        if (!modelConfigCopyTarget) return;
        const { config: nextConfig, copiedModes } = applyCustomConfigCopy(modelConfigCopyTarget, source, modes);
        if (!copiedModes.length) return;
        // 编辑弹窗持有独立副本，复制结果要同步过去，否则点击确定会被旧值覆盖。
        if (editingModelConfig && editingModelConfig.id === nextConfig.id) {
            setEditingModelConfig(nextConfig);
        }
        setDraftModelConfigs((configs) => configs.map((configItem) => (configItem.id === nextConfig.id ? nextConfig : configItem)));
        setModelConfigCopyTarget(null);
        message.success(translate("appShell.copiedCustomConfig", { value0: copiedModes.length }));
    };

    /** 用同一模型的其他模式补全当前模式的空字段，已有内容保持不变。 */
    const autoFillCustomConfig = (nextConfig: ServerModelConfig, filledFields: CustomGroupField[]) => {
        setEditingModelConfig(nextConfig);
        setAutoFillConfigMode(null);
        if (filledFields.length) message.success(translate("appShell.autoFilledFields", { value0: filledFields.length }));
    };

    /** 图片分辨率价格留空表示该档位沿用模型单价。 */
    const updateImageResolutionPrice = (resolution: ImageResolution, value: number | null) => {
        setEditingModelConfig((configItem) => {
            if (!configItem) return configItem;
            const resolutionPrices = { ...(configItem.imageBillingConfiguration?.resolutionPrices || {}) };
            if (value === null) delete resolutionPrices[resolution];
            else resolutionPrices[resolution] = value;
            return { ...configItem, imageBillingConfiguration: Object.keys(resolutionPrices).length ? { resolutionPrices } : null };
        });
    };

    const saveModelConfigEditor = () => {
        if (!editingModelConfig) return;
        const issue = customVideoConfigurationIssue(editingModelConfig);
        if (issue) {
            setCollapsedEditingCapabilities((current) => current.filter((key) => key !== `video:${issue.mode}`));
            message.error(issue.message);
            requestAnimationFrame(() => {
                const section = document.querySelector<HTMLElement>(`[data-video-constraints="${issue.mode}"]`);
                section?.scrollIntoView({ block: "center", behavior: "smooth" });
                section?.querySelector<HTMLElement>(`[id="${issue.mode}-${issue.field}"]`)?.focus();
            });
            return;
        }
        let customBodyParameters: Record<string, unknown>;
        let imageSizeMappings: ImageSizeMappings | null;
        try {
            const parsed = JSON.parse(editingCustomBodyParameters.trim() || "{}");
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(translate("appShell.customModelJSONMustBeAnObject"));
            customBodyParameters = parsed as Record<string, unknown>;
            imageSizeMappings = editingModelConfig.modelType === "image" ? normalizeImageSizeMappings(editingModelConfig.imageSizeMappings) : null;
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("appShell.invalidCustomModelJSON"));
            return;
        }
        const nextConfig = {
            ...editingModelConfig,
            customBodyParameters,
            imageSizeMappings,
            displayName: editingModelConfig.displayName === editingModelConfig.modelName ? null : editingModelConfig.displayName,
        };
        setDraftModelConfigs((configs) => configs.map((configItem) => (configItem.id === nextConfig.id ? nextConfig : configItem)));
        setEditingModelConfig(null);
        setModelConfigCopyTarget(null);
    };

    const formatEditingCustomBodyParameters = () => {
        try {
            const parsed = JSON.parse(editingCustomBodyParameters.trim() || "{}");
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(translate("appShell.customModelJSONMustBeAnObject"));
            setEditingCustomBodyParameters(JSON.stringify(parsed, null, 2));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("appShell.invalidCustomModelJSON"));
        }
    };

    const toggleModelCapabilityCollapsed = (modelType: ModelCapability) => {
        setCollapsedModelCapabilityTypes((types) => (types.includes(modelType) ? types.filter((type) => type !== modelType) : [...types, modelType]));
    };

    const setDefaultDraftModel = (modelType: ModelCapability, model: string) => {
        setDraftModelConfigs((configs) => configs.map((configItem) => (configItem.modelType === modelType ? { ...configItem, defaultModel: modelConfigValue(configItem) === model } : configItem)));
    };

    const confirmModelPicker = (values: string[]) => {
        if (!modelPicker || !modelPickerGroup) return;
        if (modelPicker.mode === "options") {
            // 依赖失效的模型会被拒绝，保留弹窗让用户取消勾选。
            if (!updateCapabilityModels(modelPickerGroup, values)) return;
        } else {
            setDefaultDraftModel(modelPicker.capability, values[0] || "");
        }
        setModelPicker(null);
    };

    /** 弹窗里已存在的模型配置可以直接打开配置弹窗编辑，未保存的模型先确认加入再配置。 */
    const configurePickedModel = (model: string) => {
        const configItem = draftModelConfigs.find((item) => item.modelType === modelPicker?.capability && modelConfigValue(item) === model);
        if (configItem) openModelConfigEditor(configItem);
    };

    const saveModelConfigs = async () => {
        const invalid = draftModelConfigs.find((configuration) => customVideoConfigurationIssue(configuration));
        if (invalid) {
            openModelConfigEditor(invalid);
            message.error(customVideoConfigurationIssue(invalid)!.message);
            return;
        }
        const baselineById = new Map(modelConfigBaseline.map((configItem) => [configItem.id, configItem]));
        // 未修改的旧失效配置不阻塞其他模型，新增、修改或设置默认时仍必须校验依赖。
        const blockingIssues = blockingModelConfigDependencyIssues(channelBaseline, draftModelConfigs, modelConfigBaseline, sameModelConfigForUpdate);
        if (blockingIssues.length) {
            message.error(translate("appShell.cannotSaveSaveItsChannelOrRemoveTheModel", { value0: blockingIssues.map(({ configuration, channelName, reason }) => `${channelName} / ${configuration.modelName}（${reason}）`).join("；") }));
            return;
        }
        const draftIds = new Set(draftModelConfigs.map((configItem) => configItem.id));
        let nextDrafts = draftModelConfigs;
        setSavingTab("models");
        try {
            nextDrafts = await createDraftModelConfigs(draftModelConfigs, modelConfigBaseline, async (configItem) => {
                const normalizedConfig = normalizeModelConfigForSave(configItem);
                return createModelConfig({
                    channelId: normalizedConfig.channelId,
                    modelName: normalizedConfig.modelName,
                    modelType: normalizedConfig.modelType,
                    capabilities: normalizedConfig.capabilities,
                    sortOrder: normalizedConfig.sortOrder,
                    creditCost: normalizedConfig.creditCost,
                    creditUnit: normalizedConfig.creditUnit,
                    thinkingEnabled: normalizedConfig.thinkingEnabled,
                    reasoningEffort: normalizedConfig.reasoningEffort,
                    requestConcurrency: normalizedConfig.requestConcurrency,
                    convertImageSizeToPixels: normalizedConfig.convertImageSizeToPixels,
                    imageSizeMappings: normalizedConfig.imageSizeMappings,
                    customBodyParameters: normalizedConfig.customBodyParameters,
                    videoBillingConfiguration: normalizedConfig.videoBillingConfiguration,
                    imageBillingConfiguration: normalizedConfig.imageBillingConfiguration,
                    displayName: normalizedConfig.displayName,
                    modelIcon: normalizedConfig.modelIcon,
                    isCustomModel: normalizedConfig.isCustomModel,
                    customModelConfig: normalizedConfig.customModelConfig,
                });
            }, (configurations, saved) => {
                nextDrafts = configurations;
                baselineById.set(saved.id, saved);
                setDraftModelConfigs(nextDrafts);
                setModelConfigBaseline([...baselineById.values()]);
            });
            for (const configItem of nextDrafts) {
                const baseline = baselineById.get(configItem.id);
                if (baseline && !sameModelConfigForUpdate(configItem, baseline)) {
                    const normalizedConfig = normalizeModelConfigForSave(configItem);
                    const saved = await updateModelConfig({
                        id: normalizedConfig.id,
                        modelType: normalizedConfig.modelType,
                        capabilities: normalizedConfig.capabilities,
                        sortOrder: normalizedConfig.sortOrder,
                        creditCost: normalizedConfig.creditCost,
                        creditUnit: normalizedConfig.creditUnit,
                        thinkingEnabled: normalizedConfig.thinkingEnabled,
                        reasoningEffort: normalizedConfig.reasoningEffort,
                        requestConcurrency: normalizedConfig.requestConcurrency,
                        convertImageSizeToPixels: normalizedConfig.convertImageSizeToPixels,
                        imageSizeMappings: normalizedConfig.imageSizeMappings,
                        customBodyParameters: normalizedConfig.customBodyParameters,
                        videoBillingConfiguration: normalizedConfig.videoBillingConfiguration,
                        imageBillingConfiguration: normalizedConfig.imageBillingConfiguration,
                        displayName: normalizedConfig.displayName,
                        modelIcon: normalizedConfig.modelIcon,
                        isCustomModel: normalizedConfig.isCustomModel,
                        customModelConfig: normalizedConfig.customModelConfig,
                    });
                    baselineById.set(saved.id, saved);
                }
            }
            for (const group of createModelGroups(translate)) {
                const nextDefault = nextDrafts.find((configItem) => configItem.modelType === group.capability && configItem.defaultModel);
                const currentDefault = modelConfigBaseline.find((configItem) => configItem.modelType === group.capability && configItem.defaultModel);
                if (nextDefault && nextDefault.id !== currentDefault?.id) await setDefaultModel(nextDefault.id, group.capability);
            }
            for (const configItem of modelConfigBaseline) {
                if (!draftIds.has(configItem.id)) {
                    await deleteModelConfig(configItem.id);
                    baselineById.delete(configItem.id);
                }
            }
            await refreshModelConfiguration();
            resetModelConfigDraft();
            message.success(translate("appShell.modelConfigurationSaved"));
        } catch (error) {
            let refreshMessage = "";
            try {
                await refreshModelConfiguration();
                const persisted = cloneModelConfigs(useConfigStore.getState().modelConfigs);
                setModelConfigBaseline(persisted);
                nextDrafts = reconcileModelConfigDraft(nextDrafts, persisted);
            } catch {
                // 读取失败时只保留已经由创建响应确认的结果，不把旧缓存当作新快照。
                setModelConfigBaseline([...baselineById.values()]);
                refreshMessage = "；重新读取配置失败，已保留草稿和已成功保存的模型";
            }
            setDraftModelConfigs(nextDrafts);
            message.error(`${error instanceof Error ? error.message : translate("appShell.failedToSaveModelConfiguration")}${refreshMessage}`);
        } finally {
            setSavingTab("");
        }
    };

    const saveCreditSettings = async () => {
        setSavingTab("credits");
        try {
            const settings = await updateCreditSettings(draftInitialCredits);
            setCreditBaseline(settings.initialCredits);
            setDraftInitialCredits(settings.initialCredits);
            message.success(translate("appShell.creditSettingsSaved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("appShell.failedToSaveCreditSettings"));
        } finally {
            setSavingTab("");
        }
    };

    const saveInvitationRewardSettings = async () => {
        setSavingTab("invitationReward");
        try {
            const settings = await updateInvitationRewardSettings(draftInvitationRewardCredits);
            setInvitationRewardBaseline(settings.invitationRewardCredits);
            setDraftInvitationRewardCredits(settings.invitationRewardCredits);
            message.success(translate("appShell.referralSettingsSaved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("appShell.failedToSaveReferralSettings"));
        } finally {
            setSavingTab("");
        }
    };

    const saveCheckInRewardSettings = async () => {
        setSavingTab("checkIn");
        try {
            const settings = await updateCheckInRewardSettings({ checkInCredits: draftCheckInCredits });
            setCheckInBaseline(settings.checkInCredits);
            setDraftCheckInCredits(settings.checkInCredits);
            message.success(translate("appShell.checkInSettingsSaved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("appShell.failedToSaveCheckInSettings"));
        } finally {
            setSavingTab("");
        }
    };

    const saveCommunityConfigSettings = async () => {
        const issue = communityDraftIssue(draftCommunityConfigs);
        if (issue) {
            message.error(
                issue === "name"
                    ? translate("administration.communityNameRequired")
                    : issue === "url"
                      ? translate("administration.communityImageUrlInvalid")
                      : translate("administration.communityDuplicate"),
            );
            return;
        }
        setSavingTab("community");
        try {
            await saveCommunityConfigs(draftCommunityConfigs.map((item) => ({ name: item.name.trim(), imageUrl: item.imageUrl.trim() })));
            const saved = draftCommunityConfigs.map((item) => ({ ...item, name: item.name.trim(), imageUrl: item.imageUrl.trim() }));
            setCommunityBaseline(saved.map((item) => ({ ...item })));
            setDraftCommunityConfigs(saved);
            // 保存后立即刷新全局浮层数据，不必等用户重新载入页面。
            void useCommunityStore.getState().refresh();
            message.success(translate("administration.communitySaved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("administration.communitySaveFailed"));
        } finally {
            setSavingTab("");
        }
    };

    const updateDraftObjectStorage = (id: string, patch: Partial<ObjectStorageConfig>) => {
        setDraftObjectStorages((storages) => storages.map((storage) => (storage.id === id ? { ...storage, ...patch } : storage)));
    };

    const addObjectStorage = () => {
        const storage = createObjectStorageConfig({
            id: `draft-${nanoid()}`,
            name: translate("appShell.objectStorage", { value0: draftObjectStorages.length + 1 }),
            defaultStorage: draftObjectStorages.length === 0 || isDefaultObjectStoragePlaceholder(draftObjectStorages[0]),
        });
        setDraftObjectStorages((storages) => (isDefaultObjectStoragePlaceholder(storages[0]) ? [storage] : [storage, ...storages]));
        setCollapsedObjectStorageIds((ids) => [...ids, storage.id]);
    };

    const setDraftDefaultObjectStorage = (id: string) => {
        setDraftObjectStorages((storages) => storages.map((storage) => ({ ...storage, defaultStorage: storage.id === id })));
    };

    const toggleObjectStorageCollapsed = (id: string) => {
        setCollapsedObjectStorageIds((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]));
    };

    const removeObjectStorage = (id: string) => {
        const storage = draftObjectStorages.find((item) => item.id === id);
        if (!storage) return;
        if (draftObjectStorages.length <= 1) {
            message.warning(translate("appShell.keepAtLeastOneObjectStorage"));
            return;
        }
        if (storage.defaultStorage) {
            message.warning(translate("appShell.chooseAnotherDefaultBeforeDeletingThisStorage"));
            return;
        }
        modal.confirm({
            title: translate("appShell.confirmDeletion"),
            content: translate("appShell.thisObjectStorageConfigurationWillBeDeletedFromThe"),
            okText: translate("appShell.delete"),
            okType: "danger",
            cancelText: translate("appShell.cancel"),
            onOk: () => {
                setDraftObjectStorages((storages) => storages.filter((item) => item.id !== id));
                setCollapsedObjectStorageIds((ids) => ids.filter((item) => item !== id));
            },
        });
    };

    const refreshObjectStorageDrafts = async () => {
        setRefreshingObjectStorages(true);
        try {
            await refreshObjectStorages();
            resetObjectStorageDraft();
            message.success(translate("appShell.objectStorageRefreshed"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("appShell.failedToRefreshObjectStorage"));
        } finally {
            setRefreshingObjectStorages(false);
        }
    };

    const handleRefreshObjectStorages = () => {
        if (!objectStoragesDirty) {
            void refreshObjectStorageDrafts();
            return;
        }
        modal.confirm({
            title: translate("appShell.discardUnsavedChanges"),
            content: translate("appShell.refreshingWillDiscardUnsavedChangesInTheObjectStorage"),
            okText: translate("appShell.discardAndRefresh"),
            okType: "danger",
            cancelText: translate("appShell.cancel"),
            onOk: refreshObjectStorageDrafts,
        });
    };

    const saveObjectStorages = async () => {
        const persistedStorageIds = new Set(objectStorageBaseline.filter((storage) => storage.id !== "default").map((storage) => storage.id));
        const baselineById = new Map(objectStorageBaseline.map((storage) => [storage.id, storage]));
        const draftIds = new Set(draftObjectStorages.map((storage) => storage.id));
        const selectedDefault = draftObjectStorages.find((storage) => storage.defaultStorage);
        if (!selectedDefault) {
            message.error(translate("appShell.setDefaultObjectStorage"));
            return;
        }
        const incompleteStorage = draftObjectStorages.find((storage) => !isObjectStorageReady(storage));
        if (incompleteStorage) {
            message.error(`${incompleteStorage.name}：${objectStorageReadyMessage(incompleteStorage)}`);
            return;
        }
        let nextDrafts = draftObjectStorages;
        setSavingTab("objectStorage");
        try {
            const savedStorageIds = new Map<string, string>();
            for (const storage of draftObjectStorages) {
                if (persistedStorageIds.has(storage.id)) continue;
                const saved = await createServerObjectStorage({ ...storage, id: storage.id === "default" ? "" : storage.id });
                savedStorageIds.set(storage.id, saved.id);
                nextDrafts = nextDrafts.map((item) => (item.id === storage.id ? saved : item));
            }
            if (savedStorageIds.size) setDraftObjectStorages(nextDrafts);
            for (const storage of nextDrafts) {
                const baseline = baselineById.get(storage.id);
                if (baseline && persistedStorageIds.has(storage.id) && !sameValue(storage, baseline)) {
                    await updateServerObjectStorage(storage);
                }
            }
            const nextDefault = nextDrafts.find((storage) => storage.defaultStorage);
            const currentDefault = objectStorageBaseline.find((storage) => storage.defaultStorage && persistedStorageIds.has(storage.id));
            if (nextDefault && nextDefault.id !== currentDefault?.id) await setServerDefaultObjectStorage(nextDefault.id);
            for (const storage of objectStorageBaseline) {
                if (persistedStorageIds.has(storage.id) && !draftIds.has(storage.id)) await deleteServerObjectStorage(storage.id);
            }
            await refreshObjectStorages();
            resetObjectStorageDraft();
            message.success(translate("appShell.objectStorageSaved"));
        } catch (error) {
            await refreshObjectStorages().catch(() => undefined);
            setObjectStorageBaseline(cloneObjectStorages(useConfigStore.getState().objectStorages));
            setDraftObjectStorages(nextDrafts);
            message.error(error instanceof Error ? error.message : translate("appShell.failedToSaveObjectStorage"));
        } finally {
            setSavingTab("");
        }
    };

    const testObjectStorage = async (storageId: string) => {
        if (objectStoragesDirty) {
            message.warning(translate("appShell.saveStorageConfigurationBeforeTesting"));
            return;
        }
        const storage = draftObjectStorages.find((item) => item.id === storageId);
        if (!storage || !isObjectStorageReady(storage)) {
            message.error(objectStorageReadyMessage(storage));
            return;
        }
        setTestingObjectStorageId(storageId);
        setTestedObjectStorageId("");
        setObjectStorageTestUrl("");
        try {
            const result = await testObjectStorageUpload(storage);
            updateDraftObjectStorage(storageId, { lastTestedAt: result.uploadedAt });
            setTestedObjectStorageId(storageId);
            setObjectStorageTestUrl(result.url);
            message.success(translate("appShell.storageTestSucceededSaveToRecordTestTime"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("appShell.objectStorageTestFailed"));
        } finally {
            setTestingObjectStorageId("");
        }
    };

    const changeActiveTab = (tabKey: string) => {
        setActiveTab(tabKey as ConfigurationTabKey);
    };

    if (user?.role !== "admin") return null;

    return (
        <div className="min-w-0">
            {loadError ? <Alert type="error" showIcon title={loadError} action={<Button onClick={() => setLoadAttempt((attempt) => attempt + 1)}>{translate("appShell.retryConfiguration")}</Button>} /> : !draftsReady ? (
                <div className="flex h-40 items-center justify-center text-sm text-[var(--studio-muted)]">{translate("appShell.loadingConfiguration")}</div>
            ) : (
                <Tabs
                    activeKey={activeTab}
                    tabPlacement="start"
                    tabBarStyle={{ width: 112 }}
                    onChange={changeActiveTab}
                    items={[
                        {
                            key: "channels",
                            label: translate("appShell.myChannels"),
                            children: (
                                <Form layout="vertical" requiredMark={false}>
                                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-3">
                                        <div className="min-w-0 flex-1">
                                            <span>{translate("appShell.configureChannelAPIsUsedForGenerationHere")}</span>
                                        </div>
                                        <div className="flex shrink-0 gap-2">
                                            <Button type="primary" disabled={!channelsDirty || isSaving} loading={savingTab === "channels"} onClick={() => void saveChannels()}>
                                                {translate("appShell.save")}</Button>
                                            <Button icon={<Plus className="size-4" />} disabled={isSaving} onClick={addChannel}>
                                                {translate("appShell.addChannel")}</Button>
                                        </div>
                                    </div>
                                    <div className="space-y-3">
                                        {draftChannels.map((channel) => {
                                            const collapsed = collapsedChannelIds.includes(channel.id);
                                            return (
                                                <section key={channel.id} className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-panel)] p-3">
                                                    <div className={collapsed ? "flex items-center justify-between gap-3" : "mb-3 flex items-center justify-between gap-3"}>
                                                        <div className="min-w-0">
                                                            <div className="truncate text-sm font-semibold">{channel.name || translate("appShell.unnamedChannel")}</div>
                                                            <div className="mt-1 text-xs text-[var(--studio-muted)]">
                                                                {apiFormatLabel(channel.apiFormat)} {translate("appShell.configured")}{channel.models.length} {translate("appShell.models")}</div>
                                                        </div>
                                                        <div className="flex shrink-0 gap-2">
                                                            <Button size="small" icon={collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />} onClick={() => toggleChannelCollapsed(channel.id)}>
                                                                {collapsed ? translate("appShell.expand") : translate("appShell.collapse")}
                                                            </Button>
                                                            <Button
                                                                size="small"
                                                                disabled={isSaving || channel.apiFormat === "minimax" || channel.apiFormat === "custom"}
                                                                loading={loadingChannelId === channel.id}
                                                                title={channel.apiFormat === "minimax" ? translate("appShell.configureMiniMaxH3ManuallyForMiniMax") : channel.apiFormat === "custom" ? translate("appShell.configureModelListManuallyForCustomFormats") : undefined}
                                                                onClick={() => void refreshChannelModels(channel)}
                                                            >
                                                                {translate("appShell.fetchModels")}</Button>
                                                            <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={isSaving} onClick={() => removeChannel(channel.id)} />
                                                        </div>
                                                    </div>
                                                    {collapsed ? null : (
                                                        <div className="grid gap-4 md:grid-cols-2">
                                                            <Form.Item label={translate("appShell.channelName")} className="mb-0">
                                                                <Input value={channel.name} disabled={isSaving} onChange={(event) => updateDraftChannel(channel.id, { name: event.target.value })} />
                                                            </Form.Item>
                                                            <Form.Item label={translate("appShell.aPIFormat")} className="mb-0">
                                                                <Select value={channel.apiFormat} disabled={isSaving} options={createApiFormatOptions(translate)} onChange={(value: ApiCallFormat) => updateChannelApiFormat(channel, value)} />
                                                            </Form.Item>
                                                            <Form.Item label="Base URL" className="mb-0">
                                                                <Input value={channel.baseUrl} disabled={isSaving} onChange={(event) => updateDraftChannel(channel.id, { baseUrl: event.target.value })} />
                                                            </Form.Item>
                                                            <Form.Item label="API Key" className="mb-0">
                                                                <Input.Password value={channel.apiKey} disabled={isSaving} onChange={(event) => updateDraftChannel(channel.id, { apiKey: event.target.value })} />
                                                            </Form.Item>
                                                            <Form.Item label={translate("appShell.models_ea4bf0")} className="mb-0 md:col-span-2">
                                                                <Select
                                                                    mode="tags"
                                                                    showSearch
                                                                    allowClear
                                                                    maxTagCount="responsive"
                                                                    placeholder={channel.apiFormat === "minimax" ? translate("appShell.enterMiniMaxH3") : channel.apiFormat === "custom" ? translate("appShell.enterModelNameCustomFormatsCannotFetchModels") : translate("appShell.enterModelNameOrFetchModels")}
                                                                    value={channel.models}
                                                                    disabled={isSaving}
                                                                    onChange={(models) => updateDraftChannel(channel.id, { models })}
                                                                />
                                                            </Form.Item>
                                                        </div>
                                                    )}
                                                </section>
                                            );
                                        })}
                                    </div>
                                </Form>
                            ),
                        },
                        {
                            key: "models",
                            label: translate("appShell.myModels"),
                            children: (
                                <Form layout="vertical" requiredMark={false}>
                                    {dependencyIssues.length ? (
                                        <Alert
                                            className="mb-4"
                                            type="warning"
                                            showIcon
                                            title={translate("appShell.someModelsDifferFromSavedChannelLists")}
                                            description={(
                                                <div className="space-y-2">
                                                    <div>{translate("appShell.unchangedInvalidSettingsDoNotBlockOtherModelsSave")}</div>
                                                    {dependencyIssues.map(({ configuration, channelName, reason }) => (
                                                        <div key={configuration.id} className="flex flex-wrap items-center justify-between gap-2">
                                                            <span className="break-all">{channelName} / {configuration.modelName}（{reason}）</span>
                                                            <Button size="small" danger disabled={isSaving} aria-label={translate("appShell.removeConfiguration", { value0: channelName, value1: configuration.modelName })} onClick={() => setDraftModelConfigs((configurations) => configurations.filter((item) => item.id !== configuration.id))}>{translate("appShell.remove")}</Button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        />
                                    ) : null}
                                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-3">
                                        <div>
                                            <div className="text-sm font-semibold">{translate("appShell.defaultModelsOptions")}</div>
                                            <div className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">{translate("appShell.optionsControlModelDropdownsDisplayOrChannelNamesDistinguish")}</div>
                                        </div>
                                        <Button type="primary" disabled={!modelConfigsDirty || isSaving} loading={savingTab === "models"} onClick={() => void saveModelConfigs()}>
                                            {translate("appShell.save")}</Button>
                                    </div>
                                    <div className="grid gap-4 md:grid-cols-2">
                                        {createModelGroups(translate).map((group) => (
                                            <Form.Item key={group.modelsKey} label={group.optionsLabel} className="mb-0">
                                                <ModelFieldTrigger
                                                    config={draftConfig}
                                                    models={draftConfig[group.modelsKey]}
                                                    multiple
                                                    placeholder={draftConfig.models.length ? translate("appShell.selectOrEnter", { value0: group.optionsLabel }) : translate("appShell.enterOrFetchChannelModelsFirst")}
                                                    actionLabel={translate("appShell.selectModels")}
                                                    disabled={isSaving}
                                                    onOpen={() => setModelPicker({ capability: group.capability, mode: "options" })}
                                                />
                                            </Form.Item>
                                        ))}
                                    </div>
                                    <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                        {createModelGroups(translate).map((group) => (
                                            <Form.Item key={group.modelKey} label={group.defaultLabel} className="mb-0">
                                                <ModelFieldTrigger
                                                    config={draftConfig}
                                                    models={draftConfig[group.modelKey] ? [draftConfig[group.modelKey]] : []}
                                                    placeholder={translate("settings.selectModel")}
                                                    actionLabel={translate("appShell.selectModels")}
                                                    disabled={isSaving}
                                                    onOpen={() => setModelPicker({ capability: group.capability, mode: "default" })}
                                                />
                                            </Form.Item>
                                        ))}
                                    </div>
                                    <div className="mt-6 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-3">
                                        <div className="text-sm font-semibold">{translate("appShell.modelCapabilities")}</div>
                                        <div className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">{translate("appShell.editAModelToConfigureItsDisplayNameCredits")}</div>
                                        <div className="mt-3 space-y-4">
                                            {createCapabilityGroups(translate).map((group) => {
                                                const models = draftConfig[group.modelsKey];
                                                if (!models.length) return null;
                                                const collapsed = collapsedModelCapabilityTypes.includes(group.capability);
                                                return (
                                                    <div key={group.capability}>
                                                        <div className="mb-2 flex items-center justify-between gap-3">
                                                            <div className="text-xs font-medium text-[var(--studio-muted)]">{group.label}</div>
                                                            <Button size="small" icon={collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />} onClick={() => toggleModelCapabilityCollapsed(group.capability)}>
                                                                {collapsed ? translate("appShell.expand") : translate("appShell.collapse")}
                                                            </Button>
                                                        </div>
                                                        {collapsed ? null : (
                                                            <div className="space-y-2">
                                                                {models.map((model) => {
                                                                    const modelConfig = draftModelConfigs.find((item) => item.modelType === group.capability && modelConfigValue(item) === model);
                                                                    if (!modelConfig) return null;
                                                                    return (
                                                                        <div key={model} className="flex items-center justify-between gap-3 rounded border border-[var(--studio-line)] bg-[var(--studio-panel)] px-3 py-2">
                                                                            <span className="min-w-0 truncate text-sm">{modelOptionLabelWithRealName(draftConfig, model)}</span>
                                                                            <div className="flex shrink-0 items-center gap-2">
                                                                                {modelConfig.defaultModel ? <span className="text-xs text-[var(--studio-muted)]">{translate("appShell.default")}</span> : null}
                                                                                <Button size="small" icon={<Pencil className="size-3.5" />} disabled={isSaving} onClick={() => openModelConfigEditor(modelConfig)}>
                                                                                    {translate("appShell.edit")}</Button>
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </Form>
                            ),
                        },
                        {
                            key: "credits",
                            label: translate("appShell.creditSettings"),
                            children: (
                                <Form layout="vertical" requiredMark={false} className="max-w-xl">
                                    <div className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4">
                                        <div className="text-sm font-semibold">{translate("appShell.initialCreditsForNewUsers")}</div>
                                        <div className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">{translate("appShell.appliesOnlyToNewRegisteredAdminCreatedOrFirst")}</div>
                                        <div className="mt-5 flex flex-wrap items-end gap-3">
                                            <Form.Item label={translate("appShell.initialCredits")} className="mb-0">
                                                <InputNumber min={0} precision={0} value={draftInitialCredits} disabled={isSaving} className="w-40" onChange={(value) => setDraftInitialCredits(Math.max(0, Number(value) || 0))} />
                                            </Form.Item>
                                            <Button type="primary" disabled={!creditsDirty || isSaving} loading={savingTab === "credits"} onClick={() => void saveCreditSettings()}>
                                                {translate("appShell.save")}</Button>
                                        </div>
                                    </div>
                                </Form>
                            ),
                        },
                        {
                            key: "invitationReward",
                            label: translate("appShell.referralReward"),
                            children: (
                                <Form layout="vertical" requiredMark={false} className="max-w-xl">
                                    <div className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4">
                                        <div className="text-sm font-semibold">{translate("appShell.referralRegistrationCredits")}</div>
                                        <div className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">
                                            {translate("appShell.referralRewardsGoToTheInviterAfterEmailRegistration")}</div>
                                        <div className="mt-5 flex flex-wrap items-end gap-3">
                                            <Form.Item label={translate("appShell.creditsPerNewUser")} className="mb-0">
                                                <InputNumber
                                                    min={0}
                                                    precision={0}
                                                    value={draftInvitationRewardCredits}
                                                    disabled={isSaving}
                                                    className="w-48"
                                                    onChange={(value) => setDraftInvitationRewardCredits(Math.max(0, Number(value) || 0))}
                                                />
                                            </Form.Item>
                                            <Button
                                                type="primary"
                                                disabled={!invitationRewardDirty || isSaving}
                                                loading={savingTab === "invitationReward"}
                                                onClick={() => void saveInvitationRewardSettings()}
                                            >
                                                {translate("appShell.save")}</Button>
                                        </div>
                                    </div>
                                </Form>
                            ),
                        },
                        {
                            key: "checkIn",
                            label: translate("appShell.checkInCredits"),
                            children: (
                                <Form layout="vertical" requiredMark={false} className="max-w-xl">
                                    <div className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4">
                                        <div className="text-sm font-semibold">{translate("appShell.dailyCheckInCredits")}</div>
                                        <div className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">
                                            {translate("appShell.dailyCheckInGrantsTheseCreditsValidFor24")}</div>
                                        <div className="mt-5 flex flex-wrap items-end gap-3">
                                            <Form.Item label={translate("appShell.dailyCheckInCredits")} className="mb-0">
                                                <InputNumber
                                                    min={0}
                                                    precision={0}
                                                    value={draftCheckInCredits}
                                                    disabled={isSaving}
                                                    className="w-40"
                                                    onChange={(value) => setDraftCheckInCredits(Math.max(0, Number(value) || 0))}
                                                />
                                            </Form.Item>
                                            <Button
                                                type="primary"
                                                disabled={!checkInDirty || isSaving}
                                                loading={savingTab === "checkIn"}
                                                onClick={() => void saveCheckInRewardSettings()}
                                            >
                                                {translate("appShell.save")}</Button>
                                        </div>
                                    </div>
                                </Form>
                            ),
                        },
                        {
                            key: "objectStorage",
                            label: translate("appShell.objectStorage_2caed1"),
                            children: (
                                <Form layout="vertical" requiredMark={false}>
                                    <div className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-3">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 text-sm font-semibold">
                                                <CloudUpload className="size-4" />
                                                {translate("appShell.cloudStorage")}</div>
                                            <div className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">{translate("appShell.keysAreEncryptedOnTheServerDefaultStorageIs")}</div>
                                        </div>
                                        <div className="flex shrink-0 gap-2">
                                            <Button icon={<RefreshCw className="size-4" />} disabled={isSaving} loading={refreshingObjectStorages} onClick={handleRefreshObjectStorages}>
                                                {translate("appShell.refresh")}</Button>
                                            <Button type="primary" disabled={!objectStoragesDirty || isSaving} loading={savingTab === "objectStorage"} onClick={() => void saveObjectStorages()}>
                                                {translate("appShell.save")}</Button>
                                            <Button icon={<Plus className="size-4" />} disabled={isSaving} onClick={addObjectStorage}>
                                                {translate("appShell.add")}</Button>
                                        </div>
                                    </div>
                                    <div className="space-y-3">
                                        {draftObjectStorages.map((storage) => {
                                            const collapsed = collapsedObjectStorageIds.includes(storage.id);
                                            const providerFields = createObjectStorageProviderFields(translate)[storage.provider];
                                            return (
                                                <section key={storage.id} className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-panel)] p-3">
                                                    <div className={collapsed ? "flex items-center justify-between gap-3" : "mb-3 flex items-center justify-between gap-3"}>
                                                        <div className="min-w-0">
                                                            <div className="truncate text-sm font-semibold">{storage.name || translate("appShell.unnamedObjectStorage")}</div>
                                                            <div className="mt-1 text-xs text-[var(--studio-muted)]">
                                                                {storage.defaultStorage ? translate("appShell.default_bdefaa") : ""}
                                                                {storage.lastTestedAt ? translate("appShell.lastTested", { value0: formatTimestamp(storage.lastTestedAt) }) : translate("appShell.notTested")}
                                                            </div>
                                                        </div>
                                                        <div className="flex shrink-0 gap-2">
                                                            <Button size="small" icon={collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />} onClick={() => toggleObjectStorageCollapsed(storage.id)}>
                                                                {collapsed ? translate("appShell.expand") : translate("appShell.collapse")}
                                                            </Button>
                                                            <Button size="small" disabled={storage.defaultStorage || isSaving} onClick={() => setDraftDefaultObjectStorage(storage.id)}>
                                                                {translate("appShell.setAsDefault")}</Button>
                                                            <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={isSaving} onClick={() => removeObjectStorage(storage.id)} />
                                                        </div>
                                                    </div>
                                                    {collapsed ? null : (
                                                        <div className="grid gap-4 md:grid-cols-2">
                                                            <Form.Item label={translate("appShell.configurationName")} className="mb-0">
                                                                <Input value={storage.name} disabled={isSaving} onChange={(event) => updateDraftObjectStorage(storage.id, { name: event.target.value })} />
                                                            </Form.Item>
                                                            <Form.Item label={translate("appShell.provider")} className="mb-0">
                                                                <Select
                                                                    value={storage.provider}
                                                                    options={createObjectStorageProviderOptions(translate)}
                                                                    disabled={isSaving}
                                                                    onChange={(provider) =>
                                                                        updateDraftObjectStorage(storage.id, {
                                                                            provider: provider as ObjectStorageProvider,
                                                                            accessKey: "",
                                                                            secretKey: "",
                                                                            bucket: "",
                                                                            region: "",
                                                                            endpoint: "",
                                                                            publicBaseUrl: "",
                                                                            lastTestedAt: "",
                                                                        })
                                                                    }
                                                                />
                                                            </Form.Item>
                                                            <Form.Item label={translate("appShell.storageDirectory")} extra={translate("appShell.uploadKeyDirectoryImagesOrVideosDateFilename")} className="mb-0">
                                                                <Input value={storage.directory} placeholder="novanova-studio" disabled={isSaving} onChange={(event) => updateDraftObjectStorage(storage.id, { directory: event.target.value })} />
                                                            </Form.Item>
                                                            <Form.Item label={providerFields.accessKeyLabel} className="mb-0">
                                                                <Input value={storage.accessKey} autoComplete="off" disabled={isSaving} onChange={(event) => updateDraftObjectStorage(storage.id, { accessKey: event.target.value })} />
                                                            </Form.Item>
                                                            <Form.Item label={providerFields.secretKeyLabel} className="mb-0">
                                                                <Input.Password value={storage.secretKey} autoComplete="new-password" disabled={isSaving} onChange={(event) => updateDraftObjectStorage(storage.id, { secretKey: event.target.value })} />
                                                            </Form.Item>
                                                            <Form.Item label="Bucket" className="mb-0">
                                                                <Input value={storage.bucket} placeholder={providerFields.bucketPlaceholder} disabled={isSaving} onChange={(event) => updateDraftObjectStorage(storage.id, { bucket: event.target.value })} />
                                                            </Form.Item>
                                                            <Form.Item label={providerFields.regionLabel} className="mb-0">
                                                                {storage.provider === "qiniuKodo" ? (
                                                                    <Select
                                                                        value={storage.region || undefined}
                                                                        options={createQiniuRegionOptions(translate)}
                                                                        placeholder={providerFields.regionPlaceholder}
                                                                        disabled={isSaving}
                                                                        onChange={(region) => updateDraftObjectStorage(storage.id, { region })}
                                                                    />
                                                                ) : (
                                                                    <Input
                                                                        value={storage.region}
                                                                        placeholder={providerFields.regionPlaceholder}
                                                                        disabled={isSaving}
                                                                        onChange={(event) => updateDraftObjectStorage(storage.id, { region: event.target.value })}
                                                                    />
                                                                )}
                                                            </Form.Item>
                                                            {storage.provider === "aliyunOss" ? (
                                                                <Form.Item label="Endpoint" extra={translate("appShell.enterAnOSSEndpointIncludingHttpOrHttps")} className="mb-0 md:col-span-2">
                                                                    <Input
                                                                        value={storage.endpoint}
                                                                        placeholder="https://oss-cn-hangzhou.aliyuncs.com"
                                                                        disabled={isSaving}
                                                                        onChange={(event) => updateDraftObjectStorage(storage.id, { endpoint: event.target.value })}
                                                                    />
                                                                </Form.Item>
                                                            ) : null}
                                                            <Form.Item label={translate("appShell.publicURL")} required={storage.provider === "qiniuKodo"} extra={providerFields.publicBaseUrlExtra} className="mb-0 md:col-span-2">
                                                                <Input
                                                                    value={storage.publicBaseUrl}
                                                                    placeholder="https://cdn.example.com"
                                                                    disabled={isSaving}
                                                                    onChange={(event) => updateDraftObjectStorage(storage.id, { publicBaseUrl: event.target.value })}
                                                                />
                                                            </Form.Item>
                                                        </div>
                                                    )}
                                                    <div className="mt-4 flex flex-wrap items-center gap-2">
                                                        <Button icon={<Wifi className="size-4" />} disabled={!isObjectStorageReady(storage) || isSaving} loading={testingObjectStorageId === storage.id} onClick={() => void testObjectStorage(storage.id)}>
                                                            {translate("appShell.testUpload")}</Button>
                                                        {objectStorageTestUrl && testedObjectStorageId === storage.id ? (
                                                            <Button type="link" className="h-auto p-0 text-xs" href={objectStorageTestUrl} target="_blank" rel="noreferrer">
                                                                {translate("appShell.openTestFile")}</Button>
                                                        ) : null}
                                                    </div>
                                                </section>
                                            );
                                        })}
                                    </div>
                                </Form>
                            ),
                        },
                        {
                            key: "community",
                            label: translate("administration.communityConfig"),
                            children: (
                                <CommunityConfigManagement
                                    items={draftCommunityConfigs}
                                    dirty={communityDirty}
                                    saving={savingTab === "community"}
                                    onChange={setDraftCommunityConfigs}
                                    onSave={() => void saveCommunityConfigSettings()}
                                />
                            ),
                        },
                    ]}
                />
            )}
            {modelPicker && modelPickerGroup ? (
                <ModelSelectModal
                    config={draftConfig}
                    title={modelPicker.mode === "options" ? modelPickerGroup.optionsLabel : modelPickerGroup.defaultLabel}
                    groups={modelPickerGroups}
                    value={modelPickerValues}
                    multiple={modelPicker.mode === "options"}
                    configurableValues={draftModelConfigs.filter((item) => item.modelType === modelPicker.capability).map(modelConfigValue)}
                    onConfigure={configurePickedModel}
                    onCancel={() => setModelPicker(null)}
                    onConfirm={confirmModelPicker}
                />
            ) : null}
            <Modal
                title={
                    editingModelConfig ? (
                        <div className="flex items-center gap-3">
                            {editingModelConfig.modelType === "video" ? (
                                <span className="flex size-10 items-center justify-center rounded-lg bg-violet-500/15 text-violet-500">
                                    <Video className="size-5" />
                                </span>
                            ) : null}
                            <div>
                                <div className="text-lg font-semibold">{modelOptionLabelWithRealName(draftConfig, modelConfigValue(editingModelConfig))} {translate("appShell.configure")}</div>
                                {editingModelConfig.modelType === "video" ? <div className="mt-0.5 text-xs font-normal text-[var(--studio-muted)]">{translate("appShell.configureBillingResolutionPricesAndCapabilities")}</div> : null}
                            </div>
                        </div>
                    ) : (
                        translate("appShell.modelSettings")
                    )
                }
                open={Boolean(editingModelConfig)}
                centered
                // 从模型选择弹窗里打开配置时叠在弹窗之上。
                zIndex={modelPicker ? 1200 : undefined}
                width={editingModelConfig?.modelType === "video" ? 980 : 760}
                destroyOnHidden
                okText={translate("appShell.confirm")}
                cancelText={translate("appShell.cancel")}
                onCancel={() => setEditingModelConfig(null)}
                onOk={saveModelConfigEditor}
            >
                {editingModelConfig?.modelType === "video" && editingModelIsMedia ? (
                    <div className="space-y-5">
                        <section className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <div className="flex items-center gap-1.5 text-sm font-semibold">
                                        {translate("appShell.customModel")}<Info className="size-4 text-[var(--studio-muted)]" />
                                    </div>
                                    <p className="mt-1 text-xs text-[var(--studio-muted)]">{translate("appShell.useRequestAndResponseExamplesForEachModeTo")}</p>
                                </div>
                                <Switch checked={Boolean(editingModelConfig.isCustomModel)} onChange={(checked) => updateEditingModelConfig({ isCustomModel: checked })} />
                            </div>
                        </section>

                        <section className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4">
                            <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                                {translate("appShell.displayName")}<Info className="size-4 text-[var(--studio-muted)]" />
                            </div>
                            <Input
                                maxLength={255}
                                placeholder={editingModelConfig.modelName}
                                value={editingModelConfig.displayName || editingModelConfig.modelName}
                                onChange={(event) => updateEditingModelConfig({ displayName: event.target.value.trim() || null })}
                            />
                            <p className="mt-2 text-xs text-[var(--studio-muted)]">{translate("appShell.userFacingNameDefaultsToModelNameAndDoes")}</p>
                        </section>

                        <section className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4">
                            <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                                {translate("appShell.displayIcon")}<Info className="size-4 text-[var(--studio-muted)]" />
                            </div>
                            <Select
                                value={editingModelConfig.modelIcon || ""}
                                options={modelIconSelectOptions}
                                className="w-full"
                                onChange={(modelIcon: string) => updateEditingModelConfig({ modelIcon: modelIcon || null })}
                            />
                            <p className="mt-2 text-xs text-[var(--studio-muted)]">{translate("appShell.displayIconAutoMatchDetectsItFromModelOr")}</p>
                        </section>

                        <section className="grid gap-4 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4 md:grid-cols-2">
                            <div>
                                <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                                    {translate("appShell.billingMethod")}<Info className="size-4 text-[var(--studio-muted)]" />
                                </div>
                                <Select
                                    value={editingModelConfig.videoBillingConfiguration?.billingUnit || "generation"}
                                    options={[
                                        { value: "generation", label: translate("appShell.perRun") },
                                        { value: "second", label: translate("appShell.perSecond") },
                                    ]}
                                    className="w-full"
                                    onChange={(billingUnit: ServerModelConfig["creditUnit"]) =>
                                        updateEditingModelConfig({
                                            creditUnit: billingUnit,
                                            videoBillingConfiguration: {
                                                ...(editingModelConfig.videoBillingConfiguration || createVideoBillingConfiguration()),
                                                billingUnit,
                                            },
                                        })
                                    }
                                />
                            </div>
                            <div>
                                <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                                    {editingModelConfig.videoBillingConfiguration?.billingUnit === "second" ? translate("appShell.extensionDurationS") : translate("appShell.minimumDurationS")} <Info className="size-4 text-[var(--studio-muted)]" />
                                </div>
                                <Space.Compact className="w-full">
                                    <InputNumber
                                        min={1}
                                        precision={0}
                                        value={editingModelConfig.videoBillingConfiguration?.minimumDurationSeconds || 3}
                                        style={{ width: "100%" }}
                                        onChange={(value) =>
                                            updateEditingModelConfig({
                                                videoBillingConfiguration: {
                                                    ...(editingModelConfig.videoBillingConfiguration || createVideoBillingConfiguration()),
                                                    minimumDurationSeconds: Math.max(1, Math.floor(Number(value) || 1)),
                                                },
                                            })
                                        }
                                    />
                                    <Button disabled className="pointer-events-none">{translate("appShell.s")}</Button>
                                </Space.Compact>
                            </div>
                        </section>

                        <section className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4">
                            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <div className="flex items-center gap-1.5 text-base font-semibold">
                                        {translate("appShell.capabilitiesAndResolutionPricing")}<Info className="size-4 text-[var(--studio-muted)]" />
                                    </div>
                                    <p className="mt-1 text-xs text-[var(--studio-muted)]">{translate("appShell.configureCapabilitiesAndCreditPricesByResolution")}</p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    {editingModelConfig.isCustomModel ? (
                                        <Button size="small" icon={<Copy className="size-3.5" />} disabled={isSaving} onClick={() => setModelConfigCopyTarget(editingModelConfig)}>
                                            {translate("appShell.copyConfig")}
                                        </Button>
                                    ) : null}
                                    <span className="rounded-md border border-[var(--studio-line)] px-2.5 py-1 text-xs text-[var(--studio-muted)]">
                                        {translate("appShell.pricing")}{editingModelConfig.videoBillingConfiguration?.billingUnit === "second" ? translate("appShell.creditsS") : translate("appShell.creditsRun")}
                                    </span>
                                </div>
                            </div>
                            <div className="space-y-4">
                                <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--studio-line)] p-4">
                                    <div><div className="font-medium">{translate("appShell.audioInputSupported")}</div><p className="text-xs text-[var(--studio-muted)]">{translate("appShell.allowAudioReferencesForThisVideoModelUniversalReference")}</p></div>
                                    <Switch aria-label={translate("appShell.audioInputSupported")} checked={editingModelConfig.capabilities.includes("audio-input")} disabled={isSaving || !editingModelConfig.capabilities.includes("audio-input") && !editingModelConfig.capabilities.includes("reference-to-video")} onChange={(checked) => {
                                        const group = editingModelConfig.customModelConfig?.["reference-to-video"];
                                        setEditingModelConfig({
                                            ...editingModelConfig,
                                            capabilities: checked ? uniqueModels([...editingModelConfig.capabilities, "audio-input"]) : editingModelConfig.capabilities.filter((value) => value !== "audio-input"),
                                            ...(editingModelConfig.isCustomModel && group ? { customModelConfig: { ...editingModelConfig.customModelConfig, "reference-to-video": { ...group, videoGenerationConstraints: { ...group.videoGenerationConstraints, maximumAudioCount: checked ? undefined : 0 } } } } : {}),
                                        });
                                    }} />
                                </div>
                                {createVideoGenerationCapabilityOptions(translate).map((mode, index) => {
                                    const prices = editingModelConfig.videoBillingConfiguration?.modePrices?.[mode.value] || {};
                                    const modeEnabled = editingModelConfig.capabilities.includes(mode.value);
                                    const modeCollapsed = collapsedEditingCapabilities.includes(`video:${mode.value}`);
                                    const modeIcon = index === 0 ? <TextCursorInput className="size-5" /> : index === 1 ? <Image className="size-5" /> : <Sparkles className="size-5" />;
                                    const modeColor = index === 0 ? "border-violet-500/50 bg-violet-500/5" : index === 1 ? "border-blue-500/50 bg-blue-500/5" : "border-emerald-500/50 bg-emerald-500/5";
                                    const iconColor = index === 0 ? "bg-violet-500/15 text-violet-500" : index === 1 ? "bg-blue-500/15 text-blue-500" : "bg-emerald-500/15 text-emerald-500";
                                    const description = index === 0 ? translate("appShell.generateVideoFromText") : index === 1 ? translate("appShell.generateVideoFromImage") : translate("appShell.generateVideoFromTextImagesAndMultimodalReferences");
                                    return (
                                        <div key={mode.value} className={`rounded-lg border p-4 transition-colors ${modeEnabled ? modeColor : "border-[var(--studio-line)] opacity-70"}`}>
                                            <div className={modeCollapsed ? "flex items-start justify-between gap-4" : "flex items-start justify-between gap-4 border-b border-[var(--studio-line)] pb-3"}>
                                                <div className="flex min-w-0 items-center gap-3">
                                                    <span className={`flex size-10 shrink-0 items-center justify-center rounded-md ${iconColor}`}>{modeIcon}</span>
                                                    <div>
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <span className="font-semibold">{mode.label}</span>
                                                            {modeEnabled ? (
                                                                <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">{translate("appShell.enabled")}</span>
                                                            ) : (
                                                                <span className="rounded bg-[var(--studio-panel)] px-2 py-0.5 text-xs text-[var(--studio-muted)]">{translate("appShell.disabled")}</span>
                                                            )}
                                                        </div>
                                                        <p className="mt-1 text-xs text-[var(--studio-muted)]">{description}</p>
                                                    </div>
                                                </div>
                                                <div className="flex shrink-0 items-center gap-2">
                                                    <Button
                                                        type="text"
                                                        size="small"
                                                        aria-label={`${mode.label}${modeCollapsed ? translate("appShell.expand") : translate("appShell.collapse")}`}
                                                        aria-expanded={!modeCollapsed}
                                                        title={translate("appShell.configuration", { value0: modeCollapsed ? translate("appShell.expand") : translate("appShell.collapse"), value1: mode.label })}
                                                        icon={modeCollapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
                                                        onClick={() => toggleEditingCapabilityCollapsed(`video:${mode.value}`)}
                                                    />
                                                    <Switch
                                                        checked={modeEnabled}
                                                        onChange={(checked) =>
                                                            updateEditingModelConfig({
                                                                capabilities: checked ? uniqueModels([...editingModelConfig.capabilities, mode.value]) : editingModelConfig.capabilities.filter((value) => value !== mode.value),
                                                                ...(!checked ? { videoBillingConfiguration: clearVideoModePrices(editingModelConfig.videoBillingConfiguration || createVideoBillingConfiguration(), mode.value) } : {}),
                                                            })
                                                        }
                                                    />
                                                </div>
                                            </div>
                                            {modeCollapsed ? null : <div className="pt-3">
                                                <div className="mb-2 text-xs font-medium text-[var(--studio-muted)]">{translate("appShell.resolutionPricing")}{editingModelConfig.videoBillingConfiguration?.billingUnit === "second" ? translate("appShell.creditsS") : translate("appShell.creditsRun")}）</div>
                                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                                                    {VIDEO_RESOLUTION_OPTIONS.filter((resolution) => resolution.value !== "auto").map((resolution) => (
                                                        <label key={resolution.value} className="flex min-w-0 items-center gap-2 rounded-md border border-[var(--studio-line)] bg-[var(--studio-panel)] px-2.5 py-2">
                                                            <span
                                                                className={`flex size-7 shrink-0 items-center justify-center rounded text-[10px] font-semibold ${resolution.value === "480p" ? "bg-violet-500/15 text-violet-500" : resolution.value === "720p" ? "bg-blue-500/15 text-blue-500" : resolution.value === "1080p" ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : resolution.value === "2k" ? "bg-rose-500/15 text-rose-500" : resolution.value === "4k" ? "bg-purple-500/15 text-purple-500" : "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400"}`}
                                                            >
                                                                <Monitor className="size-3.5" />
                                                            </span>
                                                            <span className="min-w-0 flex-1">
                                                                <span className="block text-xs font-medium">{resolution.label}</span>
                                                                <InputNumber
                                                                    min={0}
                                                                    precision={0}
                                                                    placeholder={translate("appShell.notConfigured")}
                                                                    value={prices[resolution.value]}
                                                                    className="mt-0.5 w-full"
                                                                    disabled={!modeEnabled}
                                                                    controls={false}
                                                                    onChange={(value) =>
                                                                        updateEditingModelConfig({
                                                                            videoBillingConfiguration: updateVideoResolutionPrice(editingModelConfig.videoBillingConfiguration || createVideoBillingConfiguration(), mode.value, resolution.value, value),
                                                                        })
                                                                    }
                                                                />
                                                            </span>
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>}
                                            {modeCollapsed || !modeEnabled || !editingModelConfig.isCustomModel ? null : <div>
                                                <div className="mt-3 flex items-center justify-between gap-3">
                                                    <span className="text-sm font-semibold">{translate("appShell.videoConstraintSection")}</span>
                                                    <AutoFillButton onClick={() => setAutoFillConfigMode(mode.value)} />
                                                </div>
                                                <VideoGenerationConstraintsEditor
                                                    mode={mode.value}
                                                    constraints={editingModelConfig.customModelConfig?.[mode.value]?.videoGenerationConstraints}
                                                    audioEnabled={editingModelConfig.capabilities.includes("audio-input")}
                                                    billingMinimum={editingModelConfig.videoBillingConfiguration?.minimumDurationSeconds || 1}
                                                    onChange={(videoGenerationConstraints) => updateEditingModelConfig({ customModelConfig: { ...editingModelConfig.customModelConfig, [mode.value]: { ...emptyCustomModelGroup(), ...editingModelConfig.customModelConfig?.[mode.value], videoGenerationConstraints } } })}
                                                />
                                            </div>}
                                            {modeCollapsed ? null : editingModelConfig.isCustomModel ? (
                                                <CustomModelGroupEditor
                                                    label={mode.label}
                                                    group={editingModelConfig.customModelConfig?.[mode.value]}
                                                    isVideo
                                                    onAutoFill={() => setAutoFillConfigMode(mode.value)}
                                                    onChange={(group) =>
                                                        updateEditingModelConfig({
                                                            customModelConfig: { ...(editingModelConfig.customModelConfig || {}), [mode.value]: group },
                                                        })
                                                    }
                                                />
                                            ) : null}
                                        </div>
                                    );
                                })}
                            </div>
                        </section>

                        <div className="grid gap-5 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
                            <section>
                                <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                                    {translate("appShell.concurrency")}<Info className="size-4 text-[var(--studio-muted)]" />
                                </div>
                                <div className="flex items-center gap-2">
                                    <InputNumber min={1} precision={0} value={editingModelConfig.requestConcurrency} className="w-52" onChange={(value) => updateEditingModelConfig({ requestConcurrency: Math.max(1, Math.floor(Number(value) || 1)) })} />
                                    <span className="text-sm text-[var(--studio-muted)]">{translate("appShell.tasks")}</span>
                                </div>
                            </section>
                            <section>
                                <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold">{translate("appShell.capabilities")}</div>
                                <div className="flex flex-wrap gap-2">
                                    {createModelCapabilityOptions(translate).video.filter((option) => editingModelConfig.capabilities.includes(option.value)).map((option) => (
                                        <span key={option.value} className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-600 dark:text-emerald-400">
                                            <CheckCircle2 className="size-3.5" />
                                            {option.label}
                                        </span>
                                    ))}
                                    {!editingModelConfig.capabilities.length ? <span className="text-xs text-[var(--studio-muted)]">{translate("appShell.videoGenerationIsDisabled")}</span> : null}
                                </div>
                            </section>
                        </div>

                        <section className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-1.5 text-sm font-semibold">
                                    {translate("appShell.customJSONOptional")}<Info className="size-4 text-[var(--studio-muted)]" />
                                </div>
                                <Button size="small" icon={<Braces className="size-3.5" />} onClick={formatEditingCustomBodyParameters}>
                                    {translate("appShell.format")}</Button>
                            </div>
                            <Input.TextArea value={editingCustomBodyParameters} autoSize={{ minRows: 5, maxRows: 12 }} spellCheck={false} className="font-mono text-xs" onChange={(event) => setEditingCustomBodyParameters(event.target.value)} />
                            <p className="mt-2 text-xs text-[var(--studio-muted)]">{translate("appShell.mergedOnlyIntoJSONPOSTBodiesDuplicateFieldsOverride")}</p>
                        </section>
                    </div>
                ) : editingModelConfig ? (
                    <Form layout="vertical" requiredMark={false}>
                        {editingModelConfig.modelType !== "text" ? (
                            <Form.Item label={translate("appShell.customModel")} extra={translate("appShell.useRequestAndResponseExamplesForEachCapabilityTo")}>
                                <Switch checked={Boolean(editingModelConfig.isCustomModel)} onChange={(checked) => updateEditingModelConfig({ isCustomModel: checked })} />
                            </Form.Item>
                        ) : null}
                        <Form.Item label={translate("appShell.displayName")} extra={translate("appShell.userFacingNameDefaultsToModelNameAndDoes")}>
                            <Input
                                maxLength={255}
                                placeholder={editingModelConfig.modelName}
                                value={editingModelConfig.displayName || editingModelConfig.modelName}
                                onChange={(event) => updateEditingModelConfig({ displayName: event.target.value.trim() || null })}
                            />
                        </Form.Item>
                        <Form.Item label={translate("appShell.displayIcon")} extra={translate("appShell.displayIconAutoMatchDetectsItFromModelOr")}>
                            <Select
                                value={editingModelConfig.modelIcon || ""}
                                options={modelIconSelectOptions}
                                className="w-full"
                                onChange={(modelIcon: string) => updateEditingModelConfig({ modelIcon: modelIcon || null })}
                            />
                        </Form.Item>
                        {editingModelConfig.modelType !== "video" ? (
                            <Form.Item label={translate("appShell.creditsPerRun")}>
                                <InputNumber min={0} precision={0} value={editingModelConfig.creditCost} className="w-full" onChange={(value) => updateEditingModelConfig({ creditCost: Math.max(0, Number(value) || 0) })} />
                            </Form.Item>
                        ) : null}
                        {editingModelConfig.modelType === "image" ? (
                            <Form.Item label={translate("appShell.concurrency")}>
                                <InputNumber min={1} precision={0} value={editingModelConfig.requestConcurrency} className="w-full" onChange={(value) => updateEditingModelConfig({ requestConcurrency: Math.max(1, Math.floor(Number(value) || 1)) })} />
                            </Form.Item>
                        ) : null}
                        {editingModelConfig.modelType === "image" ? (
                            <Form.Item
                                label={translate("appShell.convertImageSizeToPixels")}
                                htmlFor="convert-image-size-to-pixels"
                                extra={<span id="convert-image-size-to-pixels-description">{translate("appShell.convertImageSizeToPixelsDescription")}</span>}
                            >
                                <Switch
                                    id="convert-image-size-to-pixels"
                                    aria-label={translate("appShell.convertImageSizeToPixels")}
                                    aria-describedby="convert-image-size-to-pixels-description"
                                    checked={Boolean(editingModelConfig.convertImageSizeToPixels)}
                                    onChange={(checked) => updateEditingModelConfig({ convertImageSizeToPixels: checked })}
                                />
                            </Form.Item>
                        ) : null}
                        {editingModelConfig.modelType === "image" && editingModelConfig.convertImageSizeToPixels ? (
                            <Form.Item>
                                <ImageSizeMappingsEditor value={editingModelConfig.imageSizeMappings ?? cloneImageSizeMappings()}
                                    onChange={(imageSizeMappings) => updateEditingModelConfig({ imageSizeMappings })} />
                            </Form.Item>
                        ) : null}
                        <Form.Item label={translate("appShell.capabilities")}>
                            {editingModelConfig.modelType === "image" && editingModelConfig.isCustomModel ? (
                                <div className="space-y-3">
                                    <div className="flex flex-wrap items-center justify-end gap-2">
                                        <Button size="small" icon={<Copy className="size-3.5" />} disabled={isSaving} onClick={() => setModelConfigCopyTarget(editingModelConfig)}>
                                            {translate("appShell.copyConfig")}
                                        </Button>
                                    </div>
                                    {createModelCapabilityOptions(translate).image.map((option) => (
                                        <div key={option.value} className="rounded-md border border-[var(--studio-line)] bg-[var(--studio-panel)] p-3">
                                            <div className="flex items-center justify-between gap-3">
                                                <Checkbox
                                                    checked={editingModelConfig.capabilities.includes(option.value)}
                                                    onChange={(event) =>
                                                        updateEditingModelConfig({
                                                            capabilities: event.target.checked ? uniqueModels([...editingModelConfig.capabilities, option.value]) : editingModelConfig.capabilities.filter((value) => value !== option.value),
                                                        })
                                                    }
                                                >
                                                    {option.label}
                                                </Checkbox>
                                                <Button
                                                    type="text"
                                                    size="small"
                                                    aria-label={`${option.label}${collapsedEditingCapabilities.includes(`image:${option.value}`) ? translate("appShell.expand") : translate("appShell.collapse")}`}
                                                    aria-expanded={!collapsedEditingCapabilities.includes(`image:${option.value}`)}
                                                    title={translate("appShell.configuration", { value0: collapsedEditingCapabilities.includes(`image:${option.value}`) ? translate("appShell.expand") : translate("appShell.collapse"), value1: option.label })}
                                                    icon={collapsedEditingCapabilities.includes(`image:${option.value}`) ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
                                                    onClick={() => toggleEditingCapabilityCollapsed(`image:${option.value}`)}
                                                />
                                            </div>
                                            {editingModelConfig.capabilities.includes(option.value) && !collapsedEditingCapabilities.includes(`image:${option.value}`) ? (
                                                <CustomModelGroupEditor
                                                    label={option.label}
                                                    group={editingModelConfig.customModelConfig?.[option.value]}
                                                    isVideo={false}
                                                    onChange={(group) =>
                                                        updateEditingModelConfig({
                                                            customModelConfig: { ...(editingModelConfig.customModelConfig || {}), [option.value]: group },
                                                        })
                                                    }
                                                />
                                            ) : null}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="flex flex-wrap gap-x-4 gap-y-2">
                                    {createModelCapabilityOptions(translate)[editingModelConfig.modelType].map((option) => (
                                        <Checkbox
                                            key={option.value}
                                            checked={editingModelConfig.capabilities.includes(option.value)}
                                            onChange={(event) =>
                                                updateEditingModelConfig({
                                                    capabilities: event.target.checked ? uniqueModels([...editingModelConfig.capabilities, option.value]) : editingModelConfig.capabilities.filter((value) => value !== option.value),
                                                })
                                            }
                                        >
                                            {option.label}
                                        </Checkbox>
                                    ))}
                                </div>
                            )}
                        </Form.Item>
                        {editingModelConfig.modelType === "text" && isOpenAiTextModel(editingModelConfig, draftChannels) ? (
                            <>
                                <Form.Item label={translate("appShell.enableThinking")}>
                                    <Switch checked={editingModelConfig.thinkingEnabled} onChange={(thinkingEnabled) => updateEditingModelConfig({ thinkingEnabled })} />
                                </Form.Item>
                                <Form.Item label={translate("appShell.thinkingIntensity")}>
                                    <Select
                                        value={editingModelConfig.reasoningEffort}
                                        disabled={isReasoningEffortDisabled(false, editingModelConfig.thinkingEnabled)}
                                        options={reasoningEffortOptions}
                                        onChange={(reasoningEffort: "high" | "max") => updateEditingModelConfig({ reasoningEffort })}
                                    />
                                </Form.Item>
                            </>
                        ) : null}
                        {editingModelConfig.modelType === "image" ? (
                            <div className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4">
                                <div className="text-sm font-semibold">{translate("appShell.imageResolutionPricing")}</div>
                                <div className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">{translate("appShell.imageResolutionPricingHint")}</div>
                                <div className="mt-3 grid grid-cols-3 gap-3">
                                    {IMAGE_RESOLUTIONS.map((resolution) => (
                                        <label key={resolution} className="block">
                                            <span className="mb-1 block text-xs text-[var(--studio-muted)]">{resolution}</span>
                                            <InputNumber
                                                min={0}
                                                precision={0}
                                                className="w-full"
                                                placeholder={translate("appShell.inheritModelUnitPrice")}
                                                value={editingModelConfig.imageBillingConfiguration?.resolutionPrices?.[resolution]}
                                                onChange={(value) => updateImageResolutionPrice(resolution, value === null ? null : Math.max(0, Math.floor(Number(value) || 0)))}
                                            />
                                        </label>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                        <Form.Item label={translate("appShell.customJSON")} extra={translate("appShell.mergedOnlyIntoJSONPOSTBodiesDuplicateFieldsOverride")}>
                            <Input.TextArea value={editingCustomBodyParameters} autoSize={{ minRows: 5, maxRows: 12 }} spellCheck={false} onChange={(event) => setEditingCustomBodyParameters(event.target.value)} />
                        </Form.Item>
                    </Form>
                ) : null}
            </Modal>
            {modelConfigCopyTarget ? (
                <ModelConfigCopyModal
                    target={modelConfigCopyTarget}
                    configs={draftModelConfigs}
                    config={draftConfig}
                    onCancel={() => setModelConfigCopyTarget(null)}
                    onCopy={copyCustomConfigFromModel}
                />
            ) : null}
            {autoFillConfigMode && editingModelConfig ? (
                <ModelConfigAutoFillModal
                    config={editingModelConfig}
                    mode={autoFillConfigMode}
                    onCancel={() => setAutoFillConfigMode(null)}
                    onFill={autoFillCustomConfig}
                />
            ) : null}
        </div>
    );
}

function cloneChannels(channels: ModelChannel[]) {
    return channels.map((channel) => ({ ...channel, models: [...channel.models] }));
}

function cloneModelConfigs(configs: ServerModelConfig[]) {
    return configs.map(cloneModelConfig);
}

function cloneModelConfig(config: ServerModelConfig): ServerModelConfig {
    return {
        ...config,
        capabilities: [...config.capabilities],
        customBodyParameters: { ...(config.customBodyParameters || {}) },
        customModelConfig: cloneCustomModelConfig(config.customModelConfig),
        imageSizeMappings: config.modelType === "image" ? cloneImageSizeMappings(config.imageSizeMappings) : null,
        videoBillingConfiguration: config.modelType === "video" ? cloneVideoBillingConfiguration(config.videoBillingConfiguration || createVideoBillingConfiguration()) : null,
        imageBillingConfiguration: config.modelType === "image" && config.imageBillingConfiguration
            ? { resolutionPrices: { ...(config.imageBillingConfiguration.resolutionPrices || {}) } }
            : null,
    };
}

function cloneCustomModelConfig(config: ServerModelConfig["customModelConfig"] | null | undefined): ServerModelConfig["customModelConfig"] {
    return structuredClone(config || {});
}

/** 校验全部启用的自定义视频模式，保留模式与字段便于定位。 */
function customVideoConfigurationIssue(config: ServerModelConfig) {
    if (!config.isCustomModel || config.modelType !== "video") return null;
    for (const { value: mode } of VIDEO_GENERATION_CAPABILITY_OPTIONS) {
        if (!config.capabilities.includes(mode)) continue;
        const issue = videoConstraintConfigurationIssues(mode, config.customModelConfig?.[mode]?.videoGenerationConstraints,
            config.capabilities.includes("audio-input"), config.videoBillingConfiguration?.minimumDurationSeconds || 1)[0];
        if (issue) return { mode, ...issue };
    }
    return null;
}

/**
 * 打开模型配置时默认折叠的能力项。
 * 视频折叠整个能力卡片（含分辨率价格），图片折叠自定义调用配置编辑器。
 * 非自定义模型不预置折叠：它没有自定义调用配置，展开更省一次点击。
 */
function defaultCollapsedEditingCapabilities(config: ServerModelConfig) {
    if (!config.isCustomModel) return [];
    if (config.modelType === "video") return VIDEO_GENERATION_CAPABILITY_OPTIONS.map((option) => `video:${option.value}`);
    if (config.modelType === "image") return MODEL_CAPABILITY_OPTIONS.image.map((option) => `image:${option.value}`);
    return [];
}

function normalizeModelConfigForSave(config: ServerModelConfig): ServerModelConfig {
    const supportedCapabilities = new Set(MODEL_CAPABILITY_OPTIONS[config.modelType].map((option) => option.value));
    const capabilities = config.capabilities.filter((capability) => supportedCapabilities.has(capability));
    const videoBillingConfiguration = config.modelType === "video" && config.videoBillingConfiguration
        ? {
              ...config.videoBillingConfiguration,
              modePrices: Object.fromEntries(
                  Object.entries(config.videoBillingConfiguration.modePrices || {}).filter(([mode]) => mode !== "audio-input" && supportedCapabilities.has(mode) && capabilities.includes(mode)),
              ) as VideoBillingConfiguration["modePrices"],
          }
        : config.videoBillingConfiguration;
    // 自定义模型配置只保留已勾选能力的键，避免残留未启用能力的模板。
    const customModelConfig = config.isCustomModel
        ? Object.fromEntries(Object.entries(config.customModelConfig || {}).filter(([mode]) => mode !== "audio-input" && supportedCapabilities.has(mode) && capabilities.includes(mode)))
        : {};
    return {
        ...config,
        capabilities,
        videoBillingConfiguration,
        imageBillingConfiguration: config.modelType === "image" ? normalizeImageBillingConfiguration(config.imageBillingConfiguration) : null,
        isCustomModel: config.isCustomModel && config.modelType !== "text",
        convertImageSizeToPixels: config.modelType === "image" && Boolean(config.convertImageSizeToPixels),
        imageSizeMappings: config.modelType === "image" ? normalizeImageSizeMappings(config.imageSizeMappings) : null,
        customModelConfig,
    };
}

/** 图片分辨率价目表只保留1K、2K、4K的已填写价格，全空表示沿用模型单价。 */
function normalizeImageBillingConfiguration(configuration: ServerModelConfig["imageBillingConfiguration"]): ServerModelConfig["imageBillingConfiguration"] {
    const prices = Object.fromEntries(
        IMAGE_RESOLUTIONS.map((resolution) => [resolution, configuration?.resolutionPrices?.[resolution]])
            .filter(([, price]) => typeof price === "number" && Number.isFinite(price)),
    ) as Record<string, number>;
    return Object.keys(prices).length ? { resolutionPrices: prices } : null;
}

function cloneObjectStorages(storages: ObjectStorageConfig[]) {
    return storages.map((storage) => ({ ...storage }));
}

function createDraftModelConfig(channelId: string, modelName: string, modelType: ModelCapability): ServerModelConfig {
    return {
        id: `draft-${nanoid()}`,
        channelId,
        modelName,
        modelType,
        capabilities: [],
        defaultModel: false,
        sortOrder: 0,
        creditCost: 0,
        creditUnit: "generation",
        thinkingEnabled: true,
        reasoningEffort: "high",
        requestConcurrency: 1,
        convertImageSizeToPixels: false,
        imageSizeMappings: modelType === "image" ? cloneImageSizeMappings() : null,
        customBodyParameters: {},
        videoBillingConfiguration: modelType === "video" ? createVideoBillingConfiguration() : null,
        imageBillingConfiguration: null,
        displayName: null,
        modelIcon: null,
        isCustomModel: false,
        customModelConfig: {},
    };
}

function sameValue(first: unknown, second: unknown) {
    return JSON.stringify(first) === JSON.stringify(second);
}

function sameModelConfigForUpdate(first: ServerModelConfig, second: ServerModelConfig) {
    return (
        first.modelType === second.modelType &&
        first.sortOrder === second.sortOrder &&
        first.creditCost === second.creditCost &&
        first.creditUnit === second.creditUnit &&
        first.requestConcurrency === second.requestConcurrency &&
        first.convertImageSizeToPixels === second.convertImageSizeToPixels &&
        sameValue(first.imageSizeMappings, second.imageSizeMappings) &&
        first.thinkingEnabled === second.thinkingEnabled &&
        first.reasoningEffort === second.reasoningEffort &&
        (first.displayName || null) === (second.displayName || null) &&
        (first.modelIcon || null) === (second.modelIcon || null) &&
        first.isCustomModel === second.isCustomModel &&
        sameValue(first.capabilities, second.capabilities) &&
        sameValue(first.customBodyParameters, second.customBodyParameters) &&
        sameValue(first.customModelConfig, second.customModelConfig) &&
        sameValue(first.videoBillingConfiguration, second.videoBillingConfiguration) &&
        sameValue(first.imageBillingConfiguration, second.imageBillingConfiguration)
    );
}

function cloneVideoBillingConfiguration(configuration: VideoBillingConfiguration): VideoBillingConfiguration {
    return {
        ...configuration,
        modePrices: Object.fromEntries(Object.entries(configuration.modePrices || {}).map(([mode, prices]) => [mode, { ...prices }])) as VideoBillingConfiguration["modePrices"],
    };
}

function updateVideoResolutionPrice(configuration: VideoBillingConfiguration, mode: VideoGenerationMode, resolution: VideoResolution, value: number | null) {
    const modePrices = { ...(configuration.modePrices || {}) };
    const prices = { ...(modePrices[mode] || {}) };
    if (value === null) delete prices[resolution];
    else prices[resolution] = Math.max(0, Math.floor(Number(value) || 0));
    modePrices[mode] = prices;
    return { ...configuration, modePrices };
}

function clearVideoModePrices(configuration: VideoBillingConfiguration, mode: VideoGenerationMode): VideoBillingConfiguration {
    return {
        ...configuration,
        modePrices: { ...configuration.modePrices, [mode]: {} },
    };
}

function modelConfigValue(config: Pick<ServerModelConfig, "channelId" | "modelName">) {
    return `${config.channelId}::${config.modelName}`;
}

function uniqueModels(models: string[]) {
    return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));
}

/** 按渠道聚合模型，供模型选择弹窗渲染。 */
function createChannelModelGroups(config: AiConfig, models: string[], translator: typeof translate = translate): ChannelModelGroup[] {
    const channels = config.channels.map((channel) => ({ channelId: channel.id, channelName: channel.name.trim() || translator("appShell.unnamedChannel"), models: [] as string[] }));
    const channelsById = new Map(channels.map((channel) => [channel.channelId, channel]));
    const unassigned: string[] = [];
    for (const model of models) {
        const channel = channelsById.get(modelOptionChannel(config, model)?.id || "");
        if (channel) channel.models.push(model);
        else unassigned.push(model);
    }
    const groups: ChannelModelGroup[] = channels
        .filter((channel) => channel.models.length)
        .map((channel) => ({ channelId: channel.channelId, channelName: channel.channelName, models: channel.models.map((model) => ({ value: model, label: modelOptionLabelWithRealName(config, model, false) })) }));
    if (unassigned.length) {
        groups.push({ channelId: "", channelName: translator("appShell.noChannelModels"), models: unassigned.map((model) => ({ value: model, label: modelOptionLabelWithRealName(config, model, false) })) });
    }
    return groups;
}

/** 模型选择弹窗的触发器：展示已选模型，点击按钮打开弹窗。 */
function ModelFieldTrigger({ config, models, multiple = false, placeholder, actionLabel, disabled, onOpen }: {
    config: AiConfig;
    models: string[];
    multiple?: boolean;
    placeholder: string;
    actionLabel: string;
    disabled: boolean;
    onOpen: () => void;
}) {
    return (
        <div className="flex min-h-8 items-center gap-2 rounded-md border border-[var(--studio-line)] bg-[var(--studio-panel)] px-2 py-1">
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                {!models.length ? (
                    <span className="truncate text-sm text-[var(--studio-muted)]">{placeholder}</span>
                ) : multiple ? (
                    <>
                        {models.slice(0, 2).map((model) => (
                            <span key={model} className="max-w-[8.5rem] shrink-0 truncate rounded bg-[var(--studio-surface-hover)] px-1.5 py-0.5 text-xs text-[var(--studio-text)]">{modelOptionLabelWithRealName(config, model)}</span>
                        ))}
                        {models.length > 2 ? <span className="shrink-0 text-xs text-[var(--studio-muted)]">+{models.length - 2}</span> : null}
                    </>
                ) : (
                    <ModelOptionLabel config={config} model={models[0]} showChannel />
                )}
            </div>
            <Button size="small" disabled={disabled} onClick={onOpen}>{actionLabel}</Button>
        </div>
    );
}

/** 模型展示：图标 + 展示名，渠道后缀在关闭态展示。 */
function ModelOptionLabel({ config, model, showChannel = false }: { config: AiConfig; model: string; showChannel?: boolean }) {
    return (
        <span className="flex min-w-0 items-center gap-2">
            <ModelIcon config={config} model={model} />
            <span className="truncate">{modelOptionLabelWithRealName(config, model, showChannel)}</span>
        </span>
    );
}

/** 空的自定义模型分组配置。 */
function emptyCustomModelGroup(): CustomModelGroupConfig {
    return {
        requestPath: "",
        requestMethod: "POST",
        requestModelName: "",
        requestTemplate: "",
        aiRequestPrompt: "",
        responseExample: "",
        resultPath: "",
        queryPath: "",
        queryMethod: "GET",
        queryRequestTemplate: "",
        aiQueryPrompt: "",
        queryResponseExample: "",
        queryResultPath: "",
    };
}

const customRequestMethodOptions = [
    { value: "POST", label: "POST" },
    { value: "GET", label: "GET" },
];

/** 自定义模型请求模板可插入的系统占位符。 */
const customTemplatePlaceholderOptions = [
    { label: "{{prompt}}", value: "{{prompt}}" },
    { label: "{{model}}", value: "{{model}}" },
    { label: "{{references}}", value: "{{references}}" },
    { label: "{{videoReferences}}", value: "{{videoReferences}}" },
    { label: "{{audioReferences}}", value: "{{audioReferences}}" },
    { label: "{{size}}", value: "{{size}}" },
    { label: "{{resolution}}", value: "{{resolution}}" },
    { label: "{{seconds}}", value: "{{seconds}}" },
    { label: "{{count}}", value: "{{count}}" },
    { label: "{{taskId}}", value: "{{taskId}}" },
];

/** 查询方法默认 GET，选项顺序与默认值保持一致。 */
const customQueryMethodOptions = [
    { value: "GET", label: "GET" },
    { value: "POST", label: "POST" },
];

/** 用同一模型的其他模式补全当前模式的空字段。 */
function AutoFillButton({ onClick }: { onClick: () => void }) {
    const translate = useTranslation();
    return (
        <Button size="small" icon={<Sparkles className="size-3.5" />} onClick={onClick}>
            {translate("appShell.autoFill")}
        </Button>
    );
}

/** 自定义模型单个能力/模式分组的调用配置编辑器。 */
function CustomModelGroupEditor({
    label,
    group,
    isVideo,
    onAutoFill,
    onChange,
}: {
    label: string;
    group: CustomModelGroupConfig | undefined;
    isVideo: boolean;
    onAutoFill?: () => void;
    onChange: (group: CustomModelGroupConfig) => void;
}) {
    const translate = useTranslation();
    const requestTemplateRef = useRef<TextAreaRef | null>(null);
    const queryRequestTemplateRef = useRef<TextAreaRef | null>(null);
    const current = { ...emptyCustomModelGroup(), ...(group || {}) };
    const update = (patch: Partial<CustomModelGroupConfig>) => onChange({ ...current, ...patch });
    const requestIsPost = current.requestMethod !== "GET";
    const queryIsPost = current.queryMethod !== "GET";
    const insertPlaceholder = (placeholder: string, ref: React.RefObject<TextAreaRef | null>, field: "requestTemplate" | "queryRequestTemplate") => {
        const textArea = ref.current?.resizableTextArea?.textArea;
        const latest = textArea?.value ?? current[field];
        const start = textArea?.selectionStart ?? latest.length;
        const end = textArea?.selectionEnd ?? latest.length;
        const next = latest.slice(0, start) + placeholder + latest.slice(end);
        update({ [field]: next } as Partial<CustomModelGroupConfig>);
        requestAnimationFrame(() => {
            textArea?.setSelectionRange(start + placeholder.length, start + placeholder.length);
            textArea?.focus();
        });
    };
    return (
        <div className="mt-3 space-y-3 rounded-md border border-[var(--studio-line)] bg-[var(--studio-panel)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold text-[var(--studio-muted)]">{translate("appShell.customAPIConfiguration")}{label}）</div>
                {onAutoFill ? <AutoFillButton onClick={onAutoFill} /> : null}
            </div>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_112px]">
                <div>
                    <div className="mb-1 text-xs text-[var(--studio-muted)]">{translate("appShell.requestPath")}</div>
                    <Input value={current.requestPath} placeholder={translate("appShell.apiV1RequiredAppendedToBaseURL")} onChange={(event) => update({ requestPath: event.target.value })} />
                </div>
                <div>
                    <div className="mb-1 text-xs text-[var(--studio-muted)]">{translate("appShell.requestMethod")}</div>
                    <Select value={current.requestMethod} options={customRequestMethodOptions} className="w-full" onChange={(value: "GET" | "POST") => update({ requestMethod: value })} />
                </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
                <div>
                    <div className="mb-1 text-xs text-[var(--studio-muted)]">{translate("appShell.modelRequestName")}</div>
                    <Input value={current.requestModelName} placeholder={translate("appShell.modelNameUsedByTheRequestBodyPlaceholder")} onChange={(event) => update({ requestModelName: event.target.value })} />
                </div>
                <div>
                    <div className="mb-1 text-xs text-[var(--studio-muted)]">{translate("appShell.resultPath")}</div>
                    <Input value={current.resultPath} placeholder={translate("appShell.eGDataImageUrl")} onChange={(event) => update({ resultPath: event.target.value })} />
                </div>
            </div>
            {requestIsPost ? (
                <div className="space-y-2">
                    <div className="rounded-md border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-2.5">
                        <div className="mb-1 text-xs text-[var(--studio-muted)]">{translate("appShell.aIRequestPromptOptionalGeneratesRequestBody")}</div>
                        <Input.TextArea
                            value={current.aiRequestPrompt}
                            autoSize={{ minRows: 2, maxRows: 5 }}
                            placeholder={translate("appShell.eGBuildAComfyUIWorkflowBodyWithPrompt")}
                            onChange={(event) => update({ aiRequestPrompt: event.target.value })}
                        />
                        <p className="mt-1 text-xs text-[var(--studio-muted)]">{translate("appShell.aIGeneratesRequestBodiesFromThePromptAndActual")}</p>
                    </div>
                    <div>
                        <div className="mb-1 text-xs text-[var(--studio-muted)]">{translate("appShell.requestExampleJSONTemplateRequiredWithoutAIPrompt")}</div>
                        <div className="mb-1 flex flex-wrap items-center gap-1">
                            <span className="text-xs text-[var(--studio-muted)]">{translate("appShell.insertPlaceholder")}</span>
                            {customTemplatePlaceholderOptions.map((option) => (
                                <Button key={option.value} size="small" className="!px-1.5 font-mono text-[11px]" onClick={() => insertPlaceholder(option.value, requestTemplateRef, "requestTemplate")}>
                                    {option.label}
                                </Button>
                            ))}
                        </div>
                        <p className="mb-1 text-xs text-[var(--studio-muted)]">{translate("appShell.referenceActualParametersWithPlaceholdersEG")}{"{{prompt}}"}{translate("appShell.fieldsWithoutPlaceholdersAreSentAsEnteredAndMay")}</p>
                        <Input.TextArea
                            ref={requestTemplateRef}
                            value={current.requestTemplate}
                            autoSize={{ minRows: 3, maxRows: 8 }}
                            spellCheck={false}
                            className="font-mono text-xs"
                            placeholder='{"model":"{{model}}","prompt":"{{prompt}}","image":{{references}}}'
                            onChange={(event) => update({ requestTemplate: event.target.value })}
                        />
                    </div>
                </div>
            ) : null}
            <div>
                <div className="mb-1 text-xs text-[var(--studio-muted)]">{translate("appShell.responseExampleJSONStructure")}</div>
                <Input.TextArea
                    value={current.responseExample}
                    autoSize={{ minRows: 2, maxRows: 6 }}
                    spellCheck={false}
                    className="font-mono text-xs"
                    placeholder='{"data":{"image":{"url":"https://..."}}}'
                    onChange={(event) => update({ responseExample: event.target.value })}
                />
            </div>
            {isVideo ? (
                <>
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_112px]">
                        <div>
                            <div className="mb-1 text-xs text-[var(--studio-muted)]">{translate("appShell.queryPathAsyncPollingSupports")}{"{{taskId}}"}{translate("appShell.placeholders")}</div>
                            <Input value={current.queryPath} placeholder="/api/v1/.../result/{{taskId}}" onChange={(event) => update({ queryPath: event.target.value })} />
                        </div>
                        <div>
                            <div className="mb-1 text-xs text-[var(--studio-muted)]">{translate("appShell.queryMethod")}</div>
                            <Select value={current.queryMethod} options={customQueryMethodOptions} className="w-full" onChange={(value: "GET" | "POST") => update({ queryMethod: value })} />
                        </div>
                    </div>
                    {queryIsPost ? (
                        <div className="space-y-2">
                            <div className="rounded-md border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-2.5">
                                <div className="mb-1 text-xs text-[var(--studio-muted)]">{translate("appShell.aIQueryPromptOptionalGeneratesQueryBody")}</div>
                                <Input.TextArea
                                    value={current.aiQueryPrompt}
                                    autoSize={{ minRows: 2, maxRows: 4 }}
                                    placeholder={translate("appShell.eGBuildQueryBodyFromTaskIDIncluding")}
                                    onChange={(event) => update({ aiQueryPrompt: event.target.value })}
                                />
                                <p className="mt-1 text-xs text-[var(--studio-muted)]">{translate("appShell.aIGeneratesQueryBodyUsingThisPromptAndTask")}</p>
                            </div>
                            <div>
                                <div className="mb-1 text-xs text-[var(--studio-muted)]">{translate("appShell.queryExampleJSONTemplateRequiredWithoutAIPrompt")}</div>
                                <div className="mb-1 flex flex-wrap items-center gap-1">
                                    <span className="text-xs text-[var(--studio-muted)]">{translate("appShell.insertPlaceholder")}</span>
                                    {customTemplatePlaceholderOptions.map((option) => (
                                        <Button key={option.value} size="small" className="!px-1.5 font-mono text-[11px]" onClick={() => insertPlaceholder(option.value, queryRequestTemplateRef, "queryRequestTemplate")}>
                                            {option.label}
                                        </Button>
                                    ))}
                                </div>
                                <p className="mb-1 text-xs text-[var(--studio-muted)]">{translate("appShell.use")}{"{{taskId}}"}{translate("appShell.referenceThePollingTaskIDFieldsWithoutPlaceholdersAre")}</p>
                                <Input.TextArea
                                    ref={queryRequestTemplateRef}
                                    value={current.queryRequestTemplate}
                                    autoSize={{ minRows: 2, maxRows: 6 }}
                                    spellCheck={false}
                                    className="font-mono text-xs"
                                    placeholder='{"task_id":"{{taskId}}"}'
                                    onChange={(event) => update({ queryRequestTemplate: event.target.value })}
                                />
                            </div>
                        </div>
                    ) : null}
                    <div>
                        <div className="mb-1 text-xs text-[var(--studio-muted)]">{translate("appShell.queryResponseExampleJSON")}</div>
                        <Input.TextArea
                            value={current.queryResponseExample}
                            autoSize={{ minRows: 2, maxRows: 6 }}
                            spellCheck={false}
                            className="font-mono text-xs"
                            onChange={(event) => update({ queryResponseExample: event.target.value })}
                        />
                    </div>
                    <div>
                        <div className="mb-1 text-xs text-[var(--studio-muted)]">{translate("appShell.queryResultPathRequiredWithQueryPath")}</div>
                        <Input value={current.queryResultPath} placeholder={translate("appShell.eGDataVideoUrl")} onChange={(event) => update({ queryResultPath: event.target.value })} />
                    </div>
                </>
            ) : null}
        </div>
    );
}

function apiFormatLabel(apiFormat: ApiCallFormat) {
    if (apiFormat === "newapi") return "New API";
    if (apiFormat === "evolink") return "Evolink";
    if (apiFormat === "agnes") return "Agnes";
    if (apiFormat === "gemini") return "Gemini";
    if (apiFormat === "anthropic") return "Anthropic";
    if (apiFormat === "seedance") return "Seedance";
    if (apiFormat === "minimax") return "MiniMax";
    if (apiFormat === "custom") return translate("appShell.custom");
    return "OpenAI";
}

function formatTimestamp(value: string) {
    return new Date(value).toLocaleString(currentLanguageTag(), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function isDefaultObjectStoragePlaceholder(storage: ObjectStorageConfig | undefined) {
    return storage?.id === "default" && storage.name === "默认对象存储" && storage.directory === "novanova-studio" && !storage.accessKey && !storage.secretKey && !storage.bucket && !storage.region && !storage.endpoint && !storage.publicBaseUrl;
}
