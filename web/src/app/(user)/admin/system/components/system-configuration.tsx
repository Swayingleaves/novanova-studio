"use client";

import { creditText } from "@/shared/lib/credit-amounts";
import type { CreditAmount } from "@/shared/lib/credit-amounts";
import { useCopyText } from "@/shared/hooks/use-copy-text";

import { currentLanguageTag } from "@/features/locale/translate";

import { translateMessage as translate } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";

import { Alert, App, Button, Checkbox, Form, Input, InputNumber, Modal, Segmented, Select, Space, Switch, Tabs } from "antd";
import { nanoid } from "nanoid";
import { Braces, CheckCircle2, ChevronDown, ChevronUp, Clapperboard, CloudUpload, Copy, Image, Info, Monitor, Pencil, Plus, RefreshCw, Search, Sparkles, TextCursorInput, Trash2, Upload, Video, Wifi } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { canManageCurrentSpace, useTeamStore } from "@/features/team/stores/use-team-store";
import { ModelIcon } from "@/features/settings/components/model-picker";
import { groupModelOptionsByChannel } from "@/features/settings/lib/model-picker-groups";
import { MODEL_ICON_OPTIONS } from "@/features/settings/components/model-icon";
import {
    createModelCapabilityOptions,
    configFromModelConfigs,
    createModelChannel,
    createObjectStorageConfig,
    defaultBaseUrlForApiFormat,
    MODEL_CAPABILITY_OPTIONS,
    modelOptionChannel,
    modelOptionLabelWithRealName,
    normalizeModelOptionValue,
    sortModelOptions,
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
import { createVideoGenerationCapabilityOptions, DEFAULT_VIDEO_MAXIMUM_DURATION_SECONDS, resolveBillingMaximumDurationSeconds, UNLIMITED_VIDEO_DURATION_SECONDS, VIDEO_GENERATION_CAPABILITY_OPTIONS, VIDEO_RESOLUTION_OPTIONS, createVideoBillingConfiguration } from "@/features/generation/lib/video-billing";
import { isObjectStorageReady, objectStorageReadyMessage, testObjectStorageUpload } from "@/features/storage/services/object-storage";
import { isReasoningEffortDisabled, reasoningEffortOptions, supportsThinkingConfiguration } from "@/features/settings/lib/model-thinking-configuration";
import {
    createChannel,
    createModelConfig,
    createObjectStorage as createServerObjectStorage,
    deleteChannel as deleteServerChannel,
    deleteModelConfig,
    deleteObjectStorage as deleteServerObjectStorage,
    getCreditSettings,
    getCheckInRewardSettings,
    getFirstPurchaseBonusSettings,
    getInvitationRewardSettings,
    getTimeoutSettings,
    updateTimeoutSettings,
    refreshChannelModels as refreshServerChannelModels,
    setDefaultModel,
    setDefaultObjectStorage as setServerDefaultObjectStorage,
    updateChannel as updateServerChannel,
    updateCheckInRewardSettings,
    updateCreditSettings,
    updateFirstPurchaseBonusSettings,
    updateInvitationRewardSettings,
    updateModelConfig,
    updateObjectStorage as updateServerObjectStorage,
    type ServerModelConfig,
    type TimeoutSettings,
} from "@/services/api/server";
import type { ObjectStorageConfig, ObjectStorageProvider } from "@/shared/types/object-storage";
import { blockingModelConfigDependencyIssues, createDraftModelConfigs, modelConfigDependencyIssues, reconcileModelConfigDraft, updateModelConfigSelection } from "./model-config-draft";
import { useConfigurationLeaveGuard } from "../use-configuration-leave-guard";
import { cloneImageSizeMappings, IMAGE_RESOLUTIONS, normalizeImageSizeMappings, type ImageResolution, type ImageSizeMappings } from "@/features/generation/lib/image-size-mappings";
import { ImageSizeMappingsEditor } from "./image-size-mappings-editor";
import { ModelSelectModal, type ChannelModelGroup } from "./model-select-modal";
import { ModelConfigCopyModal } from "./model-config-copy-modal";
import { ModelConfigImportModal } from "./model-config-import-modal";
import { buildCustomModelTransferJson } from "./model-config-transfer";
import { ModelConfigTextArea } from "./model-config-textarea";
import { applyCustomConfigCopy } from "./model-config-copy";
import type { CustomGroupField, CustomModelMode } from "./model-config-copy";
import { ModelConfigAutoFillModal } from "./model-config-auto-fill-modal";
import { VideoGenerationConstraintsEditor } from "./video-generation-constraints-editor";
import { videoConstraintConfigurationIssues } from "@/features/generation/lib/video-generation-constraints";
import { CreditProductManagement } from "./credit-product-management";
import { CommunityConfigManagement } from "./community-config-management";
import { communityDraftIssue, communityDraftSignature, createCommunityDrafts, type CommunityConfigDraft } from "../community-config";
import { saveCommunityConfigs } from "@/services/api/community";
import { useCommunityStore } from "@/features/community/stores/use-community-store";
import { ExternalLinkConfigManagement } from "./external-link-config-management";
import { createExternalLinkDraft, emptyExternalLinkDraft, externalLinkDraftIssue, externalLinkDraftSignature, type ExternalLinkDraft } from "../external-link-config";
import { saveExternalLinkConfig } from "@/services/api/external-link";
import { useExternalLinkStore } from "@/features/external-link/stores/use-external-link-store";
import { getVideoExportSettings, saveVideoExportSettings } from "@/services/api/video-export-settings";
import { useVideoExportSettingsStore } from "@/features/comic-drama/stores/use-video-export-settings-store";

export type ConfigurationTabKey = "channels" | "models" | "credits" | "creditProducts" | "invitationReward" | "checkIn" | "firstPurchaseBonus" | "objectStorage" | "timeouts" | "community" | "externalLink" | "videoExport";

const defaultTimeoutSettings = (): TimeoutSettings => ({
    aiRequestBodyTimeoutSeconds: 60,
    storyboardAgentTimeoutSeconds: 600,
    scriptAgentTimeoutSeconds: 600,
    storyBibleAgentTimeoutSeconds: 600,
    taskWaitTimeoutSeconds: 300,
    videoTaskWaitTimeoutSeconds: 900,
    videoCompositionExecutionTimeoutSeconds: 1800,
    tencentCosSocketTimeoutMilliseconds: 120000,
});

const timeoutSettingsSignature = (settings: TimeoutSettings) =>
    [
        settings.aiRequestBodyTimeoutSeconds,
        settings.storyboardAgentTimeoutSeconds,
        settings.scriptAgentTimeoutSeconds,
        settings.storyBibleAgentTimeoutSeconds,
        settings.taskWaitTimeoutSeconds,
        settings.videoTaskWaitTimeoutSeconds,
        settings.videoCompositionExecutionTimeoutSeconds,
        settings.tencentCosSocketTimeoutMilliseconds,
    ].join(",");

type ModelGroup = {
    capability: ModelCapability;
    modelKey: "imageModel" | "videoModel" | "textModel";
    modelsKey: "imageModels" | "videoModels" | "textModels";
    defaultLabel: string;
    optionsLabel: string;
};

const createModelGroups = (translator: typeof translate = translate): ModelGroup[] => [
    {
        capability: "image",
        modelKey: "imageModel",
        modelsKey: "imageModels",
        get defaultLabel() {
            return translator("appShell.defaultImageModel");
        },
        get optionsLabel() {
            return translator("appShell.availableImageModels");
        },
    },
    {
        capability: "video",
        modelKey: "videoModel",
        modelsKey: "videoModels",
        get defaultLabel() {
            return translator("appShell.defaultVideoModel");
        },
        get optionsLabel() {
            return translator("appShell.availableVideoModels");
        },
    },
    {
        capability: "text",
        modelKey: "textModel",
        modelsKey: "textModels",
        get defaultLabel() {
            return translator("appShell.defaultTextModel");
        },
        get optionsLabel() {
            return translator("appShell.availableTextModels");
        },
    },
];

const createCapabilityGroups = (translator: typeof translate = translate): Array<{ capability: ModelCapability; modelsKey: "textModels" | "imageModels" | "videoModels"; label: string }> => [
    {
        capability: "text",
        modelsKey: "textModels",
        get label() {
            return translator("appShell.textModel");
        },
    },
    {
        capability: "image",
        modelsKey: "imageModels",
        get label() {
            return translator("appShell.imageModel");
        },
    },
    {
        capability: "video",
        modelsKey: "videoModels",
        get label() {
            return translator("appShell.videoModel");
        },
    },
];

const modelIconSelectOptions = MODEL_ICON_OPTIONS.map((option) => ({
    value: option.value,
    label: (
        <span className="inline-flex items-center gap-2">
            {option.path ? <img src={option.path} alt="" className={option.value === "qwen" ? "model-icon-qwen size-4" : "size-4"} /> : option.value === "clapperboard" ? <Clapperboard className="size-4 opacity-70" /> : null}
            <span>{option.label}</span>
        </span>
    ),
}));

const createApiFormatOptions = (translator: typeof translate = translate): Array<{ label: ReactNode; value: ApiCallFormat }> => [
    { label: "OpenAI", value: "openai" },
    {
        get label() {
            return apiFormatLabelNode("nana");
        },
        value: "nana",
    },
    { label: "New API", value: "newapi" },
    { label: "Evolink", value: "evolink" },
    { label: "Gemini", value: "gemini" },
    { label: "Agnes", value: "agnes" },
    { label: "Anthropic", value: "anthropic" },
    { label: "Seedance", value: "seedance" },
    { label: "MiniMax", value: "minimax" },
    {
        get label() {
            return translator("appShell.custom");
        },
        value: "custom",
    },
];

const createObjectStorageProviderOptions = (translator: typeof translate = translate): Array<{ label: string; value: ObjectStorageProvider }> => [
    {
        get label() {
            return translator("appShell.tencentCloudCOS");
        },
        value: "tencentCos",
    },
    {
        get label() {
            return translator("appShell.alibabaCloudOSS");
        },
        value: "aliyunOss",
    },
    {
        get label() {
            return translator("appShell.qiniuCloudKodo");
        },
        value: "qiniuKodo",
    },
    {
        get label() {
            return translator("appShell.cloudflareR2");
        },
        value: "cloudflareR2",
    },
];

const createQiniuRegionOptions = (translator: typeof translate = translate) => [
    {
        get label() {
            return translator("appShell.eastChinaZhejiangZ0");
        },
        value: "z0",
    },
    {
        get label() {
            return translator("appShell.eastChinaZhejiang2CnEast2");
        },
        value: "cn-east-2",
    },
    {
        get label() {
            return translator("appShell.northChinaHebeiZ1");
        },
        value: "z1",
    },
    {
        get label() {
            return translator("appShell.southChinaGuangdongZ2");
        },
        value: "z2",
    },
    {
        get label() {
            return translator("appShell.northAmericaLosAngelesNa0");
        },
        value: "na0",
    },
    {
        get label() {
            return translator("appShell.asiaPacificSingaporeAs0");
        },
        value: "as0",
    },
];

const createObjectStorageProviderFields = (
    translator: typeof translate = translate,
): Record<ObjectStorageProvider, { accessKeyLabel: string; secretKeyLabel: string; bucketPlaceholder: string; regionLabel: string; regionPlaceholder: string; endpointPlaceholder?: string; publicBaseUrlExtra: string }> => ({
    tencentCos: {
        accessKeyLabel: "SecretId",
        secretKeyLabel: "SecretKey",
        bucketPlaceholder: "example-1250000000",
        regionLabel: "Region",
        regionPlaceholder: "ap-guangzhou",
        get publicBaseUrlExtra() {
            return translator("appShell.defaultsToHttpsCosMyqcloudCom");
        },
    },
    aliyunOss: {
        accessKeyLabel: "AccessKey ID",
        secretKeyLabel: "AccessKey Secret",
        bucketPlaceholder: "example-bucket",
        get regionLabel() {
            return translator("appShell.regionID");
        },
        regionPlaceholder: "cn-hangzhou",
        get publicBaseUrlExtra() {
            return translator("appShell.leaveBlankToGenerateTheURLFromBucketAnd");
        },
    },
    qiniuKodo: {
        accessKeyLabel: "AccessKey",
        secretKeyLabel: "SecretKey",
        bucketPlaceholder: "example-bucket",
        get regionLabel() {
            return translator("appShell.region");
        },
        get regionPlaceholder() {
            return translator("appShell.selectARegion");
        },
        get publicBaseUrlExtra() {
            return translator("appShell.enterACDNOrCustomDomainBoundToThis");
        },
    },
    cloudflareR2: {
        accessKeyLabel: "Access Key ID",
        secretKeyLabel: "Secret Access Key",
        bucketPlaceholder: "example-bucket",
        regionLabel: "Region",
        regionPlaceholder: "auto",
        endpointPlaceholder: "https://<ACCOUNT_ID>.r2.cloudflarestorage.com",
        get publicBaseUrlExtra() {
            return translator("appShell.enterACloudflareR2PublicURL");
        },
    },
});

/**
 * 系统配置面板。
 *
 * @param activeTab 受控的当前配置页签，由管理后台左侧菜单驱动
 * @param onTabChange 页签变化回调，用于把当前页签同步给左侧菜单
 * @return 配置面板
 */
export function SystemConfiguration({ activeTab: controlledActiveTab, onTabChange }: { activeTab?: ConfigurationTabKey; onTabChange?: (tabKey: ConfigurationTabKey) => void }) {
    const translate = useTranslation();
    const { message, modal } = App.useApp();
    const copyText = useCopyText();
    const team = useTeamStore((state) => state.team);
    const config = useConfigStore((state) => state.config);
    const modelConfigs = useConfigStore((state) => state.modelConfigs);
    const objectStorages = useConfigStore((state) => state.objectStorages);
    const refreshChannels = useConfigStore((state) => state.refreshChannels);
    const refreshModelConfiguration = useConfigStore((state) => state.refreshModelConfiguration);
    const refreshObjectStorages = useConfigStore((state) => state.refreshObjectStorages);
    const [innerActiveTab, setInnerActiveTab] = useState<ConfigurationTabKey>("channels");
    const activeTab = controlledActiveTab ?? innerActiveTab;
    const [draftsReady, setDraftsReady] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [savingTab, setSavingTab] = useState<ConfigurationTabKey | "">("");
    const [loadingChannelId, setLoadingChannelId] = useState("");
    const [refreshingObjectStorages, setRefreshingObjectStorages] = useState(false);
    const [testingObjectStorageId, setTestingObjectStorageId] = useState("");
    const [testedObjectStorageId, setTestedObjectStorageId] = useState("");
    const [objectStorageTestUrl, setObjectStorageTestUrl] = useState("");
    const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
    const [channelFormatFilter, setChannelFormatFilter] = useState<string>("");
    const [channelSearch, setChannelSearch] = useState("");
    const [activeModelCapabilityTab, setActiveModelCapabilityTab] = useState<ModelCapability>("image");
    const [modelCapabilitySearch, setModelCapabilitySearch] = useState("");
    const [modelCapabilityChannelFilter, setModelCapabilityChannelFilter] = useState<string>("");
    const [collapsedObjectStorageIds, setCollapsedObjectStorageIds] = useState<string[]>([]);
    const [channelBaseline, setChannelBaseline] = useState<ModelChannel[]>([]);
    const [draftChannels, setDraftChannels] = useState<ModelChannel[]>([]);
    const [modelConfigBaseline, setModelConfigBaseline] = useState<ServerModelConfig[]>([]);
    const [draftModelConfigs, setDraftModelConfigs] = useState<ServerModelConfig[]>([]);
    const [objectStorageBaseline, setObjectStorageBaseline] = useState<ObjectStorageConfig[]>([]);
    const [draftObjectStorages, setDraftObjectStorages] = useState<ObjectStorageConfig[]>([]);
    const [creditBaseline, setCreditBaseline] = useState<CreditAmount>(100);
    const [draftInitialCredits, setDraftInitialCredits] = useState<CreditAmount>(100);
    const [invitationRewardBaseline, setInvitationRewardBaseline] = useState<CreditAmount>(0);
    const [draftInvitationRewardCredits, setDraftInvitationRewardCredits] = useState<CreditAmount>(0);
    const [checkInBaseline, setCheckInBaseline] = useState<CreditAmount>(0);
    const [draftCheckInCredits, setDraftCheckInCredits] = useState<CreditAmount>(0);
    const [firstPurchaseBonusBaseline, setFirstPurchaseBonusBaseline] = useState<CreditAmount>(0);
    const [draftFirstPurchaseBonusPercent, setDraftFirstPurchaseBonusPercent] = useState<CreditAmount>(0);
    const [communityBaseline, setCommunityBaseline] = useState<CommunityConfigDraft[]>([]);
    const [draftCommunityConfigs, setDraftCommunityConfigs] = useState<CommunityConfigDraft[]>([]);
    const [externalLinkBaseline, setExternalLinkBaseline] = useState<ExternalLinkDraft>(emptyExternalLinkDraft);
    const [draftExternalLink, setDraftExternalLink] = useState<ExternalLinkDraft>(emptyExternalLinkDraft);
    const [timeoutBaseline, setTimeoutBaseline] = useState<TimeoutSettings>(defaultTimeoutSettings);
    const [draftTimeoutSettings, setDraftTimeoutSettings] = useState<TimeoutSettings>(defaultTimeoutSettings);
    const [videoExportBaseline, setVideoExportBaseline] = useState<boolean>(true);
    const [draftVideoExportEnabled, setDraftVideoExportEnabled] = useState<boolean>(true);
    const [editingModelConfig, setEditingModelConfig] = useState<ServerModelConfig | null>(null);
    const [modelPicker, setModelPicker] = useState<{ capability: ModelCapability; mode: "options" | "default" } | null>(null);
    const [editingCustomBodyParameters, setEditingCustomBodyParameters] = useState("{}");
    const [collapsedEditingCapabilities, setCollapsedEditingCapabilities] = useState<string[]>([]);
    const [modelEditorTab, setModelEditorTab] = useState<"basic" | "capabilities" | "advanced">("basic");
    const [activeEditingVideoMode, setActiveEditingVideoMode] = useState<VideoGenerationMode>("text-to-video");
    const [activeEditingImageMode, setActiveEditingImageMode] = useState<string>("text-to-image");
    const [modelConfigCopyTarget, setModelConfigCopyTarget] = useState<ServerModelConfig | null>(null);
    const [modelConfigImportTarget, setModelConfigImportTarget] = useState<ServerModelConfig | null>(null);
    const [autoFillConfigMode, setAutoFillConfigMode] = useState<VideoGenerationMode | null>(null);
    const editingModelIsMedia = Boolean(editingModelConfig && (editingModelConfig.modelType === "image" || editingModelConfig.modelType === "video"));

    const resetChannelDraft = useCallback(() => {
        const channels = cloneChannels(useConfigStore.getState().managedChannels);
        setChannelBaseline(channels);
        setDraftChannels(cloneChannels(channels));
        setEditingChannelId(null);
    }, []);

    const resetModelConfigDraft = useCallback(() => {
        const configs = cloneModelConfigs(useConfigStore.getState().modelConfigs);
        setModelConfigBaseline(configs);
        setDraftModelConfigs(cloneModelConfigs(configs));
    }, []);

    const resetObjectStorageDraft = useCallback(() => {
        const storages = cloneObjectStorages(useConfigStore.getState().objectStorages);
        setObjectStorageBaseline(storages);
        setDraftObjectStorages(cloneObjectStorages(storages));
        setCollapsedObjectStorageIds(storages.map((storage) => storage.id));
    }, []);

    // 社群配置只属于平台空间，团队空间不读取也不展示该页签。
    const resetCommunityDraft = useCallback(() => {
        const configs = useTeamStore.getState().team ? [] : useCommunityStore.getState().configs;
        const drafts = createCommunityDrafts(configs);
        setCommunityBaseline(drafts);
        setDraftCommunityConfigs(drafts.map((draft) => ({ ...draft })));
    }, []);

    // 展示外链同样是平台级配置，团队空间不读取也不展示该页签。
    const resetExternalLinkDraft = useCallback(() => {
        const draft = useTeamStore.getState().team ? emptyExternalLinkDraft() : createExternalLinkDraft(useExternalLinkStore.getState().config);
        setExternalLinkBaseline(draft);
        setDraftExternalLink({ ...draft });
    }, []);

    const resetAllDrafts = useCallback(() => {
        resetChannelDraft();
        resetModelConfigDraft();
        resetObjectStorageDraft();
        resetCommunityDraft();
        resetExternalLinkDraft();
        setTestedObjectStorageId("");
        setObjectStorageTestUrl("");
    }, [resetChannelDraft, resetModelConfigDraft, resetObjectStorageDraft, resetCommunityDraft, resetExternalLinkDraft]);

    useEffect(() => {
        if (!canManageCurrentSpace()) return;
        setDraftsReady(false);
        setLoadError("");
        let active = true;
        void Promise.all([
            refreshModelConfiguration(),
            refreshObjectStorages(),
            useTeamStore.getState().team ? Promise.resolve({ initialCredits: "0" }) : getCreditSettings(),
            useTeamStore.getState().team ? Promise.resolve({ invitationRewardCredits: "0" }) : getInvitationRewardSettings(),
            useTeamStore.getState().team ? Promise.resolve({ checkInCredits: "0" }) : getCheckInRewardSettings(),
            useTeamStore.getState().team ? Promise.resolve({ percent: "0" }) : getFirstPurchaseBonusSettings(),
            useTeamStore.getState().team ? Promise.resolve() : useCommunityStore.getState().refresh(),
            useTeamStore.getState().team ? Promise.resolve() : useExternalLinkStore.getState().refresh(),
            useTeamStore.getState().team ? Promise.resolve(defaultTimeoutSettings()) : getTimeoutSettings(),
            useTeamStore.getState().team ? Promise.resolve({ enabled: true }) : getVideoExportSettings(),
        ])
            .then(([, , creditSettings, invitationRewardSettings, checkInSettings, firstPurchaseBonusSettings, , , timeoutSettings, videoExportSettings]) => {
                if (!active) return;
                resetAllDrafts();
                setCreditBaseline(creditSettings.initialCredits);
                setDraftInitialCredits(creditSettings.initialCredits);
                setInvitationRewardBaseline(invitationRewardSettings.invitationRewardCredits);
                setDraftInvitationRewardCredits(invitationRewardSettings.invitationRewardCredits);
                setCheckInBaseline(checkInSettings.checkInCredits);
                setDraftCheckInCredits(checkInSettings.checkInCredits);
                setFirstPurchaseBonusBaseline(firstPurchaseBonusSettings.percent);
                setDraftFirstPurchaseBonusPercent(firstPurchaseBonusSettings.percent);
                setTimeoutBaseline(timeoutSettings);
                setDraftTimeoutSettings(timeoutSettings);
                const videoExportEnabled = videoExportSettings ? Boolean(videoExportSettings.enabled) : true;
                setVideoExportBaseline(videoExportEnabled);
                setDraftVideoExportEnabled(videoExportEnabled);
                useVideoExportSettingsStore.getState().setEnabled(videoExportEnabled);
                setDraftsReady(true);
            })
            .catch((error) => {
                if (!active) return;
                setLoadError(error instanceof Error ? error.message : translate("appShell.failedToLoadConfiguration"));
            });
        return () => {
            active = false;
        };
    }, [loadAttempt, refreshModelConfiguration, refreshObjectStorages, resetAllDrafts]);

    const draftConfig = useMemo(() => {
        const nextConfig = configFromModelConfigs(draftChannels, draftModelConfigs, config);
        // 管理界面保留失效配置，允许用户看见并移除；业务模型目录仍只展示可用模型。
        for (const group of createModelGroups(translate)) nextConfig[group.modelsKey] = sortModelOptions(draftModelConfigs.filter((item) => item.modelType === group.capability).map(modelConfigValue), nextConfig);
        return nextConfig;
    }, [config, draftChannels, draftModelConfigs, translate.locale]);
    const dependencyIssues = useMemo(() => modelConfigDependencyIssues(channelBaseline, draftModelConfigs), [channelBaseline, draftModelConfigs, translate.locale]);
    // 「我的模型」的模型选择走弹窗：左侧渠道、右侧该渠道的模型。
    const modelGroups = useMemo(() => createChannelModelGroups(draftConfig, uniqueModels([...draftConfig.models, ...draftModelConfigs.map(modelConfigValue)]), translate), [draftConfig, draftModelConfigs, translate.locale]);
    const capabilityModelGroups = useMemo(() => new Map(createModelGroups(translate).map((group) => [group.capability, createChannelModelGroups(draftConfig, draftConfig[group.modelsKey], translate)])), [draftConfig, translate.locale]);
    const modelPickerGroup = modelPicker ? createModelGroups(translate).find((group) => group.capability === modelPicker.capability) : undefined;
    const modelPickerGroups: ChannelModelGroup[] = !modelPicker || !modelPickerGroup ? [] : modelPicker.mode === "options" ? modelGroups : capabilityModelGroups.get(modelPicker.capability) || [];
    const modelPickerValues = !modelPicker || !modelPickerGroup ? [] : modelPicker.mode === "options" ? draftConfig[modelPickerGroup.modelsKey] : draftConfig[modelPickerGroup.modelKey] ? [draftConfig[modelPickerGroup.modelKey]] : [];
    const channelsDirty = !sameValue(draftChannels, channelBaseline);
    const modelConfigsDirty = !sameValue(draftModelConfigs, modelConfigBaseline);
    const objectStoragesDirty = !sameValue(draftObjectStorages, objectStorageBaseline);
    const creditsDirty = draftInitialCredits !== creditBaseline;
    const invitationRewardDirty = draftInvitationRewardCredits !== invitationRewardBaseline;
    const checkInDirty = draftCheckInCredits !== checkInBaseline;
    const firstPurchaseBonusDirty = draftFirstPurchaseBonusPercent !== firstPurchaseBonusBaseline;
    const communityDirty = communityDraftSignature(draftCommunityConfigs) !== communityDraftSignature(communityBaseline);
    const externalLinkDirty = externalLinkDraftSignature(draftExternalLink) !== externalLinkDraftSignature(externalLinkBaseline);
    const timeoutDirty = timeoutSettingsSignature(draftTimeoutSettings) !== timeoutSettingsSignature(timeoutBaseline);
    const videoExportDirty = draftVideoExportEnabled !== videoExportBaseline;
    const editingModelBaseline = editingModelConfig && draftModelConfigs.find((item) => item.id === editingModelConfig.id);
    const modelEditorDirty = Boolean(editingModelConfig && (!sameValue(editingModelConfig, editingModelBaseline) || editingCustomBodyParameters !== JSON.stringify(editingModelBaseline?.customBodyParameters || {}, null, 2)));
    const hasUnsavedChanges = channelsDirty || modelConfigsDirty || objectStoragesDirty || creditsDirty || invitationRewardDirty || checkInDirty || firstPurchaseBonusDirty || communityDirty || externalLinkDirty || timeoutDirty || videoExportDirty || modelEditorDirty;
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
        setEditingChannelId(channel.id);
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
                setEditingChannelId((current) => (current === id ? null : current));
            },
        });
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
            await refreshModelConfiguration();
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
            setChannelBaseline(cloneChannels(useConfigStore.getState().managedChannels));
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
        setDraftModelConfigs((configs) => updateModelConfigSelection(configs, modelConfigBaseline, group.capability, values,
            (channelId, modelName, modelType) => createDraftModelConfig(channelId, modelName, modelType,
                draftChannels.find((channel) => channel.id === channelId)?.apiFormat)));
        return true;
    };

    const openModelConfigEditor = (configItem: ServerModelConfig) => {
        setEditingModelConfig(cloneModelConfig(configItem));
        setEditingCustomBodyParameters(JSON.stringify(configItem.customBodyParameters || {}, null, 2));
        setCollapsedEditingCapabilities(defaultCollapsedEditingCapabilities(configItem));
        setModelEditorTab("basic");
        const firstVideoMode = VIDEO_GENERATION_CAPABILITY_OPTIONS.find((item) => configItem.capabilities.includes(item.value))?.value || "text-to-video";
        setActiveEditingVideoMode(firstVideoMode);
        const firstImageMode = MODEL_CAPABILITY_OPTIONS.image.find((item) => configItem.capabilities.includes(item.value))?.value || "text-to-image";
        setActiveEditingImageMode(firstImageMode);
        setModelConfigCopyTarget(null);
        setModelConfigImportTarget(null);
    };

    const toggleEditingCapabilityCollapsed = (capability: string) => {
        setCollapsedEditingCapabilities((capabilities) => (capabilities.includes(capability) ? capabilities.filter((item) => item !== capability) : [...capabilities, capability]));
    };

    const updateEditingModelConfig = (patch: Partial<ServerModelConfig>) => {
        setEditingModelConfig((configItem) => (configItem ? { ...configItem, ...patch } : configItem));
    };

    /** 把当前编辑中的完整配置复制成 JSON，便于在其他实例直接导入。 */
    const copyEditingModelConfig = () => {
        if (!editingModelConfig) return;
        let customBodyParameters = editingModelConfig.customBodyParameters;
        try {
            const parsed = JSON.parse(editingCustomBodyParameters.trim() || "{}");
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                message.error(translate("appShell.customModelJSONMustBeAnObject"));
                return;
            }
            customBodyParameters = parsed as Record<string, unknown>;
        } catch {
            message.error(translate("appShell.invalidCustomModelJSON"));
            return;
        }
        copyText(buildCustomModelTransferJson({ ...editingModelConfig, customBodyParameters }), translate("appShell.customModelConfigCopied"));
    };

    /** 把导入的配置写入编辑副本，用户点确定后才会进入草稿。 */
    const importEditingModelConfig = (patch: Partial<ServerModelConfig>) => {
        if (!editingModelConfig) return;
        setEditingModelConfig((configItem) => (configItem ? { ...configItem, ...patch } : configItem));
        if (patch.customBodyParameters) setEditingCustomBodyParameters(JSON.stringify(patch.customBodyParameters, null, 2));
        setModelConfigImportTarget(null);
        message.success(translate("appShell.importConfigApplied"));
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
    const updateImageResolutionPrice = (resolution: ImageResolution, value: string) => {
        setEditingModelConfig((configItem) => {
            if (!configItem) return configItem;
            const resolutionPrices = { ...(configItem.imageBillingConfiguration?.resolutionPrices || {}) };
            if (value.trim() === "") delete resolutionPrices[resolution];
            else resolutionPrices[resolution] = value;
            return { ...configItem, imageBillingConfiguration: Object.keys(resolutionPrices).length ? { resolutionPrices } : null };
        });
    };

    const saveModelConfigEditor = () => {
        if (!editingModelConfig) return;
        const issue = customVideoConfigurationIssue(editingModelConfig);
        if (issue) {
            setModelEditorTab("capabilities");
            setActiveEditingVideoMode(issue.mode);
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
            setModelEditorTab("advanced");
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

    const setDefaultDraftModel = (modelType: ModelCapability, model: string) => {
        setDraftModelConfigs((configs) => configs.map((configItem) => (configItem.modelType === modelType ? { ...configItem, defaultModel: modelConfigValue(configItem) === model } : configItem)));
    };

    /** 开关只改草稿，保存时随模型配置一起提交；关闭的模型不会出现在用户下拉中。 */
    const setDraftModelEnabled = (modelConfigId: string, enabled: boolean) => {
        setDraftModelConfigs((configs) => configs.map((configItem) => (configItem.id === modelConfigId ? { ...configItem, enabled } : configItem)));
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
            nextDrafts = await createDraftModelConfigs(
                draftModelConfigs,
                modelConfigBaseline,
                async (configItem) => {
                    const normalizedConfig = normalizeModelConfigForSave(configItem);
                    return createModelConfig({
                        channelId: normalizedConfig.channelId,
                        modelName: normalizedConfig.modelName,
                        modelType: normalizedConfig.modelType,
                        capabilities: normalizedConfig.capabilities,
                        enabled: normalizedConfig.enabled,
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
                        description: normalizedConfig.description ?? null,
                        isCustomModel: normalizedConfig.isCustomModel,
                        customModelConfig: normalizedConfig.customModelConfig,
                    });
                },
                (configurations, saved) => {
                    nextDrafts = configurations;
                    baselineById.set(saved.id, saved);
                    setDraftModelConfigs(nextDrafts);
                    setModelConfigBaseline([...baselineById.values()]);
                },
            );
            for (const configItem of nextDrafts) {
                const baseline = baselineById.get(configItem.id);
                if (baseline && !sameModelConfigForUpdate(configItem, baseline)) {
                    const normalizedConfig = normalizeModelConfigForSave(configItem);
                    const saved = await updateModelConfig({
                        id: normalizedConfig.id,
                        modelType: normalizedConfig.modelType,
                        capabilities: normalizedConfig.capabilities,
                        enabled: normalizedConfig.enabled,
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
                        description: normalizedConfig.description ?? null,
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

    const saveFirstPurchaseBonusSettings = async () => {
        setSavingTab("firstPurchaseBonus");
        try {
            const settings = await updateFirstPurchaseBonusSettings(draftFirstPurchaseBonusPercent);
            setFirstPurchaseBonusBaseline(settings.percent);
            setDraftFirstPurchaseBonusPercent(settings.percent);
            message.success(translate("appShell.firstPurchaseBonusSaved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("appShell.failedToSaveFirstPurchaseBonus"));
        } finally {
            setSavingTab("");
        }
    };

    const saveTimeoutSettings = async () => {
        setSavingTab("timeouts");
        try {
            const settings = await updateTimeoutSettings(draftTimeoutSettings);
            setTimeoutBaseline(settings);
            setDraftTimeoutSettings(settings);
            message.success(translate("administration.timeoutSettingsSaved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("administration.timeoutSettingsSaveFailed"));
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

    const saveExternalLinkSettings = async () => {
        const issue = externalLinkDraftIssue(draftExternalLink);
        if (issue) {
            message.error(
                issue === "title"
                    ? translate("administration.externalLinkTitleRequired")
                    : issue === "url"
                      ? translate("administration.externalLinkUrlInvalid")
                      : translate("administration.externalLinkCoverUrlInvalid"),
            );
            return;
        }
        const saved = {
            title: draftExternalLink.title.trim(),
            url: draftExternalLink.url.trim(),
            description: draftExternalLink.description.trim(),
            coverUrl: draftExternalLink.coverUrl.trim(),
        };
        setSavingTab("externalLink");
        try {
            await saveExternalLinkConfig(saved);
            setExternalLinkBaseline(saved);
            setDraftExternalLink(saved);
            // 保存后立即刷新全局顶部入口，不必等用户重新载入页面。
            void useExternalLinkStore.getState().refresh();
            message.success(translate("administration.externalLinkSaved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("administration.externalLinkSaveFailed"));
        } finally {
            setSavingTab("");
        }
    };

    const clearExternalLinkSettings = async () => {
        setSavingTab("externalLink");
        try {
            await saveExternalLinkConfig(emptyExternalLinkDraft());
            const empty = emptyExternalLinkDraft();
            setExternalLinkBaseline(empty);
            setDraftExternalLink(empty);
            void useExternalLinkStore.getState().refresh();
            message.success(translate("administration.externalLinkRemoved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("administration.externalLinkSaveFailed"));
        } finally {
            setSavingTab("");
        }
    };

    const saveVideoExportConfigSettings = async () => {
        setSavingTab("videoExport");
        try {
            const saved = await saveVideoExportSettings(draftVideoExportEnabled);
            const enabled = Boolean(saved.enabled);
            setVideoExportBaseline(enabled);
            setDraftVideoExportEnabled(enabled);
            useVideoExportSettingsStore.getState().setEnabled(enabled);
            message.success(translate("administration.videoExportSettingsSaved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("administration.videoExportSettingsSaveFailed"));
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
        const nextTab = tabKey as ConfigurationTabKey;
        setInnerActiveTab(nextTab);
        onTabChange?.(nextTab);
    };

    if (!canManageCurrentSpace()) return null;

    return (
        <div className="min-w-0">
            {loadError ? (
                <Alert type="error" showIcon title={loadError} action={<Button onClick={() => setLoadAttempt((attempt) => attempt + 1)}>{translate("appShell.retryConfiguration")}</Button>} />
            ) : !draftsReady ? (
                <div className="flex h-40 items-center justify-center text-sm text-[var(--studio-muted)]">{translate("appShell.loadingConfiguration")}</div>
            ) : (
                <Tabs
                    activeKey={activeTab}
                    onChange={changeActiveTab}
                    className="[&>.ant-tabs-nav]:hidden!"
                    items={[
                        {
                            key: "channels",
                            label: translate("appShell.myChannels"),
                            children: (() => {
                                const formatOptions = createApiFormatOptions(translate);
                                const formatCounts = new Map<ApiCallFormat, number>();
                                for (const channel of draftChannels) {
                                    formatCounts.set(channel.apiFormat, (formatCounts.get(channel.apiFormat) || 0) + 1);
                                }
                                const activeFormatTabs = formatOptions.filter((option) => formatCounts.has(option.value));
                                const effectiveFormat = channelFormatFilter && formatCounts.has(channelFormatFilter as ApiCallFormat) ? channelFormatFilter : "";
                                const keyword = channelSearch.trim().toLowerCase();
                                const filteredChannels = draftChannels.filter((channel) => {
                                    if (effectiveFormat && channel.apiFormat !== effectiveFormat) return false;
                                    if (!keyword) return true;
                                    return [channel.name, channel.baseUrl, ...channel.models].some((text) => text.toLowerCase().includes(keyword));
                                });
                                const editingChannel = editingChannelId ? draftChannels.find((item) => item.id === editingChannelId) || null : null;
                                return (
                                    <div>
                                        <div
                                            className={`sticky top-2 z-20 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3.5 shadow-sm backdrop-blur-md transition-colors ${
                                                channelsDirty
                                                    ? "border-[var(--studio-primary-line)] bg-[var(--studio-panel)]/95"
                                                    : "border-[var(--studio-line)] bg-[var(--studio-surface-soft)]/95"
                                            }`}
                                        >
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2 text-sm font-semibold">
                                                    <span>{translate("appShell.myChannels")}</span>
                                                    {channelsDirty ? (
                                                        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--studio-primary-soft)] px-2 py-0.5 text-xs font-medium text-[var(--studio-primary)]">
                                                            <span className="size-1.5 rounded-full bg-[var(--studio-primary)]" />
                                                            {translate("appShell.unsavedChanges")}
                                                        </span>
                                                    ) : null}
                                                </div>
                                                <div className="mt-0.5 text-xs text-[var(--studio-muted)]">{translate("appShell.configureChannelAPIsUsedForGenerationHere")}</div>
                                            </div>
                                            <div className="flex shrink-0 gap-2">
                                                <Button type="primary" disabled={!channelsDirty || isSaving} loading={savingTab === "channels"} onClick={() => void saveChannels()}>
                                                    {translate("appShell.save")}
                                                </Button>
                                                <Button icon={<Plus className="size-4" />} disabled={isSaving} onClick={addChannel}>
                                                    {translate("appShell.addChannel")}
                                                </Button>
                                            </div>
                                        </div>

                                        <div className="mb-4 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-3">
                                            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" role="tablist" aria-label={translate("appShell.aPIFormat")}>
                                                <button
                                                    type="button"
                                                    role="tab"
                                                    aria-selected={!effectiveFormat}
                                                    className={`cursor-pointer rounded-lg border px-2.5 py-1 text-xs! font-medium transition-colors ${
                                                        !effectiveFormat
                                                            ? "border-[var(--studio-primary-line)] bg-[var(--studio-primary-soft)] text-[var(--studio-primary)]!"
                                                            : "border-transparent bg-[var(--studio-panel)] text-[var(--studio-muted)]! hover:border-[var(--studio-line)] hover:text-[var(--studio-ink)]!"
                                                    }`}
                                                    onClick={() => setChannelFormatFilter("")}
                                                >
                                                    {translate("appShell.allFormats")} ({draftChannels.length})
                                                </button>
                                                {activeFormatTabs.map((option) => {
                                                    const active = effectiveFormat === option.value;
                                                    return (
                                                        <button
                                                            key={option.value}
                                                            type="button"
                                                            role="tab"
                                                            aria-selected={active}
                                                            className={`inline-flex cursor-pointer items-center gap-1 rounded-lg border px-2.5 py-1 text-xs! font-medium transition-colors ${
                                                                active
                                                                    ? "border-[var(--studio-primary-line)] bg-[var(--studio-primary-soft)] text-[var(--studio-primary)]!"
                                                                    : "border-transparent bg-[var(--studio-panel)] text-[var(--studio-muted)]! hover:border-[var(--studio-line)] hover:text-[var(--studio-ink)]!"
                                                            }`}
                                                            onClick={() => setChannelFormatFilter(option.value)}
                                                        >
                                                            <span>{apiFormatLabelNode(option.value)}</span>
                                                            <span>({formatCounts.get(option.value)})</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                            <Input
                                                allowClear
                                                prefix={<Search className="size-3.5 text-[var(--studio-muted)]" />}
                                                placeholder={translate("appShell.searchChannels")}
                                                value={channelSearch}
                                                onChange={(event) => setChannelSearch(event.target.value)}
                                                className="w-full shrink-0 sm:w-60!"
                                            />
                                        </div>

                                        {filteredChannels.length ? (
                                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                                                {filteredChannels.map((channel) => {
                                                    const hasKey = Boolean(channel.apiKey?.trim());
                                                    const canFetch = channel.apiFormat !== "minimax" && channel.apiFormat !== "custom";
                                                    return (
                                                        <section
                                                            key={channel.id}
                                                            className="flex flex-col justify-between rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel)] p-4 transition-colors hover:border-[var(--studio-primary-line)]/60"
                                                        >
                                                            <div>
                                                                <div className="flex items-start justify-between gap-2">
                                                                    <div className="min-w-0 flex-1">
                                                                        <div className="truncate text-sm font-semibold text-[var(--studio-ink)]" title={channel.name || translate("appShell.unnamedChannel")}>
                                                                            {channel.name || translate("appShell.unnamedChannel")}
                                                                        </div>
                                                                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[var(--studio-muted)]">
                                                                            {apiFormatLabelNode(channel.apiFormat)}
                                                                        </div>
                                                                    </div>
                                                                    <span
                                                                        className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                                                                            hasKey
                                                                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                                                                : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                                                        }`}
                                                                    >
                                                                        <span className={`size-1.5 rounded-full ${hasKey ? "bg-emerald-500" : "bg-amber-500"}`} />
                                                                        {hasKey ? translate("appShell.apiKeyConfigured") : translate("appShell.apiKeyMissing")}
                                                                    </span>
                                                                </div>
                                                                <div className="mt-3 space-y-1.5">
                                                                    <div className="truncate rounded-md bg-[var(--studio-surface-soft)] px-2.5 py-1.5 font-mono text-xs text-[var(--studio-muted)]" title={channel.baseUrl || "-"}>
                                                                        {channel.baseUrl || "-"}
                                                                    </div>
                                                                    <div className="text-xs text-[var(--studio-muted)]">
                                                                        {translate("appShell.configured")} {channel.models.length} {translate("appShell.models")}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--studio-line)] pt-3">
                                                                <div className="flex items-center gap-1.5">
                                                                    <Button size="small" icon={<Pencil className="size-3.5" />} disabled={isSaving} onClick={() => setEditingChannelId(channel.id)}>
                                                                        {translate("appShell.edit")}
                                                                    </Button>
                                                                    <Button
                                                                        size="small"
                                                                        disabled={isSaving || !canFetch}
                                                                        loading={loadingChannelId === channel.id}
                                                                        title={
                                                                            channel.apiFormat === "minimax"
                                                                                ? translate("appShell.configureMiniMaxH3ManuallyForMiniMax")
                                                                                : channel.apiFormat === "custom"
                                                                                  ? translate("appShell.configureModelListManuallyForCustomFormats")
                                                                                  : undefined
                                                                        }
                                                                        onClick={() => void refreshChannelModels(channel)}
                                                                    >
                                                                        {translate("appShell.fetchModels")}
                                                                    </Button>
                                                                </div>
                                                                <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} disabled={isSaving} onClick={() => removeChannel(channel.id)} />
                                                            </div>
                                                        </section>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <div className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel)] px-4 py-10 text-center text-sm text-[var(--studio-muted)]">
                                                {translate("appShell.noMatchingChannels")}
                                            </div>
                                        )}

                                        <Modal
                                            title={editingChannel ? `${editingChannel.name || translate("appShell.unnamedChannel")} · ${translate("appShell.channelSettings")}` : translate("appShell.channelSettings")}
                                            open={Boolean(editingChannel)}
                                            centered
                                            width={680}
                                            destroyOnHidden
                                            footer={
                                                <div className="flex items-center justify-between gap-2">
                                                    {editingChannel ? (
                                                        <Button
                                                            disabled={isSaving || editingChannel.apiFormat === "minimax" || editingChannel.apiFormat === "custom"}
                                                            loading={loadingChannelId === editingChannel.id}
                                                            icon={<RefreshCw className="size-3.5" />}
                                                            onClick={() => void refreshChannelModels(editingChannel)}
                                                        >
                                                            {translate("appShell.fetchModels")}
                                                        </Button>
                                                    ) : <span />}
                                                    <Button type="primary" onClick={() => setEditingChannelId(null)}>
                                                        {translate("appShell.confirm")}
                                                    </Button>
                                                </div>
                                            }
                                            onCancel={() => setEditingChannelId(null)}
                                        >
                                            {editingChannel ? (
                                                <Form layout="vertical" requiredMark={false} className="mt-3">
                                                    <div className="grid gap-4 md:grid-cols-2">
                                                        <Form.Item label={translate("appShell.channelName")} className="mb-0">
                                                            <Input value={editingChannel.name} disabled={isSaving} onChange={(event) => updateDraftChannel(editingChannel.id, { name: event.target.value })} />
                                                        </Form.Item>
                                                        <Form.Item label={translate("appShell.aPIFormat")} className="mb-0">
                                                            <Select value={editingChannel.apiFormat} disabled={isSaving} options={createApiFormatOptions(translate)} onChange={(value: ApiCallFormat) => updateChannelApiFormat(editingChannel, value)} />
                                                        </Form.Item>
                                                        <Form.Item label="Base URL" className="mb-0">
                                                            <Space.Compact className="w-full">
                                                                <Input value={editingChannel.baseUrl} disabled={isSaving} onChange={(event) => updateDraftChannel(editingChannel.id, { baseUrl: event.target.value })} />
                                                                <Button
                                                                    icon={<Copy className="size-3.5" />}
                                                                    disabled={!editingChannel.baseUrl.trim()}
                                                                    aria-label="复制 Base URL"
                                                                    onClick={() => copyText(editingChannel.baseUrl.trim(), "Base URL")}
                                                                />
                                                            </Space.Compact>
                                                        </Form.Item>
                                                        <Form.Item label="API Key" className="mb-0">
                                                            <Space.Compact className="w-full">
                                                                <Input.Password value={editingChannel.apiKey} disabled={isSaving} onChange={(event) => updateDraftChannel(editingChannel.id, { apiKey: event.target.value })} />
                                                                <Button
                                                                    icon={<Copy className="size-3.5" />}
                                                                    disabled={!editingChannel.apiKey.trim()}
                                                                    aria-label="复制 API Key"
                                                                    onClick={() => copyText(editingChannel.apiKey.trim(), "API Key")}
                                                                />
                                                            </Space.Compact>
                                                        </Form.Item>
                                                        <Form.Item label={translate("appShell.models_ea4bf0")} className="mb-0 md:col-span-2">
                                                            <Select
                                                                mode="tags"
                                                                showSearch
                                                                allowClear
                                                                maxTagCount="responsive"
                                                                placeholder={
                                                                    editingChannel.apiFormat === "minimax"
                                                                        ? translate("appShell.enterMiniMaxH3")
                                                                        : editingChannel.apiFormat === "custom"
                                                                          ? translate("appShell.enterModelNameCustomFormatsCannotFetchModels")
                                                                          : translate("appShell.enterModelNameOrFetchModels")
                                                                }
                                                                value={editingChannel.models}
                                                                disabled={isSaving}
                                                                onChange={(models) => updateDraftChannel(editingChannel.id, { models })}
                                                            />
                                                        </Form.Item>
                                                    </div>
                                                </Form>
                                            ) : null}
                                        </Modal>
                                    </div>
                                );
                            })(),
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
                                            description={
                                                <div className="space-y-2">
                                                    <div>{translate("appShell.unchangedInvalidSettingsDoNotBlockOtherModelsSave")}</div>
                                                    {dependencyIssues.map(({ configuration, channelName, reason }) => (
                                                        <div key={configuration.id} className="flex flex-wrap items-center justify-between gap-2">
                                                            <span className="break-all">
                                                                {channelName} / {configuration.modelName}（{reason}）
                                                            </span>
                                                            <Button
                                                                size="small"
                                                                danger
                                                                disabled={isSaving}
                                                                aria-label={translate("appShell.removeConfiguration", { value0: channelName, value1: configuration.modelName })}
                                                                onClick={() => setDraftModelConfigs((configurations) => configurations.filter((item) => item.id !== configuration.id))}
                                                            >
                                                                {translate("appShell.remove")}
                                                            </Button>
                                                        </div>
                                                    ))}
                                                </div>
                                            }
                                        />
                                    ) : null}
                                    <div
                                        className={`sticky top-2 z-20 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3.5 shadow-sm backdrop-blur-md transition-colors ${
                                            modelConfigsDirty
                                                ? "border-[var(--studio-primary-line)] bg-[var(--studio-panel)]/95"
                                                : "border-[var(--studio-line)] bg-[var(--studio-surface-soft)]/95"
                                        }`}
                                    >
                                        <div>
                                            <div className="flex items-center gap-2 text-sm font-semibold">
                                                <span>{translate("appShell.defaultModelsOptions")}</span>
                                                {modelConfigsDirty ? (
                                                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--studio-primary-soft)] px-2 py-0.5 text-xs font-medium text-[var(--studio-primary)]">
                                                        <span className="size-1.5 rounded-full bg-[var(--studio-primary)]" />
                                                        {translate("appShell.unsavedChanges")}
                                                    </span>
                                                ) : null}
                                            </div>
                                            <div className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">{translate("appShell.optionsControlModelDropdownsDisplayOrChannelNamesDistinguish")}</div>
                                        </div>
                                        <Button type="primary" disabled={!modelConfigsDirty || isSaving} loading={savingTab === "models"} onClick={() => void saveModelConfigs()}>
                                            {translate("appShell.save")}
                                        </Button>
                                    </div>
                                    <div className="grid gap-4 lg:grid-cols-3">
                                        {createModelGroups(translate).map((group) => {
                                            const GroupIcon = group.capability === "image" ? Image : group.capability === "video" ? Video : TextCursorInput;
                                            const selectedCount = draftConfig[group.modelsKey].length;
                                            return (
                                                <section key={group.capability} className="flex flex-col gap-3 rounded-xl border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--studio-ink)]">
                                                            <GroupIcon className="size-4 text-[var(--studio-muted)]" />
                                                            <span>{group.optionsLabel.replace(/可选项$/, "")}</span>
                                                        </div>
                                                        <span className="rounded-full border border-[var(--studio-line)] bg-[var(--studio-panel)] px-2 py-0.5 text-xs text-[var(--studio-muted)]">
                                                            {translate("appShell.configuredModelCount", { value0: selectedCount })}
                                                        </span>
                                                    </div>
                                                    <Form.Item label={group.defaultLabel} className="mb-0">
                                                        <ModelFieldTrigger
                                                            config={draftConfig}
                                                            models={draftConfig[group.modelKey] ? [draftConfig[group.modelKey]] : []}
                                                            placeholder={translate("settings.selectModel")}
                                                            actionLabel={translate("appShell.selectModels")}
                                                            disabled={isSaving}
                                                            onOpen={() => setModelPicker({ capability: group.capability, mode: "default" })}
                                                        />
                                                    </Form.Item>
                                                    <Form.Item label={group.optionsLabel} className="mb-0">
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
                                                </section>
                                            );
                                        })}
                                    </div>
                                    {(() => {
                                        const capabilityGroups = createCapabilityGroups(translate);
                                        const activeGroup = capabilityGroups.find((group) => group.capability === activeModelCapabilityTab) || capabilityGroups[0];
                                        const activeModels = draftConfig[activeGroup.modelsKey];
                                        const allChannelGroups = groupModelOptionsByChannel(activeModels, draftConfig, translate("settings.defaultChannel"));
                                        const effectiveChannelFilter = allChannelGroups.some((group) => group.channelId === modelCapabilityChannelFilter) ? modelCapabilityChannelFilter : "";
                                        const keyword = modelCapabilitySearch.trim().toLowerCase();
                                        const filteredModels = activeModels.filter((model) => {
                                            const modelConfig = draftModelConfigs.find((item) => item.modelType === activeGroup.capability && modelConfigValue(item) === model);
                                            if (!modelConfig) return false;
                                            if (effectiveChannelFilter) {
                                                const channelId = modelOptionChannel(draftConfig, model)?.id || "__default__";
                                                if (channelId !== effectiveChannelFilter) return false;
                                            }
                                            if (!keyword) return true;
                                            const channelName = modelOptionChannel(draftConfig, model)?.name || "";
                                            return [modelConfig.displayName || "", modelConfig.modelName, channelName, modelConfig.description || ""].some((text) => text.toLowerCase().includes(keyword));
                                        });
                                        const groupedByChannel = groupModelOptionsByChannel(filteredModels, draftConfig, translate("settings.defaultChannel"));
                                        return (
                                            <div className="mt-5 rounded-xl border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4">
                                                <div className="flex flex-wrap items-start justify-between gap-3">
                                                    <div>
                                                        <div className="text-sm font-semibold">{translate("appShell.modelCapabilities")}</div>
                                                        <div className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">{translate("appShell.editAModelToConfigureItsDisplayNameCredits")}</div>
                                                    </div>
                                                    <Segmented
                                                        value={activeGroup.capability}
                                                        options={capabilityGroups.map((group) => ({
                                                            value: group.capability,
                                                            label: `${group.label} (${draftConfig[group.modelsKey].length})`,
                                                        }))}
                                                        onChange={(nextValue) => {
                                                            setActiveModelCapabilityTab(nextValue as ModelCapability);
                                                            setModelCapabilityChannelFilter("");
                                                        }}
                                                    />
                                                </div>
                                                <div className="mt-3 flex flex-wrap items-center justify-between gap-2.5 border-b border-[var(--studio-line)] pb-3">
                                                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" role="tablist" aria-label={translate("appShell.allChannels")}>
                                                        <button
                                                            type="button"
                                                            role="tab"
                                                            aria-selected={!effectiveChannelFilter}
                                                            className={`cursor-pointer rounded-lg border px-2.5 py-1 text-xs! font-medium transition-colors ${
                                                                !effectiveChannelFilter
                                                                    ? "border-[var(--studio-primary-line)] bg-[var(--studio-primary-soft)] text-[var(--studio-primary)]!"
                                                                    : "border-transparent bg-[var(--studio-panel)] text-[var(--studio-muted)]! hover:border-[var(--studio-line)] hover:text-[var(--studio-ink)]!"
                                                            }`}
                                                            onClick={() => setModelCapabilityChannelFilter("")}
                                                        >
                                                            {translate("appShell.allChannels")} ({activeModels.length})
                                                        </button>
                                                        {allChannelGroups.map((group) => {
                                                            const active = effectiveChannelFilter === group.channelId;
                                                            return (
                                                                <button
                                                                    key={group.channelId}
                                                                    type="button"
                                                                    role="tab"
                                                                    aria-selected={active}
                                                                    className={`cursor-pointer rounded-lg border px-2.5 py-1 text-xs! font-medium transition-colors ${
                                                                        active
                                                                            ? "border-[var(--studio-primary-line)] bg-[var(--studio-primary-soft)] text-[var(--studio-primary)]!"
                                                                            : "border-transparent bg-[var(--studio-panel)] text-[var(--studio-muted)]! hover:border-[var(--studio-line)] hover:text-[var(--studio-ink)]!"
                                                                    }`}
                                                                    onClick={() => setModelCapabilityChannelFilter(group.channelId)}
                                                                >
                                                                    {group.channelName} ({group.models.length})
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                    <Input
                                                        allowClear
                                                        prefix={<Search className="size-3.5 text-[var(--studio-muted)]" />}
                                                        placeholder={translate("appShell.searchModels")}
                                                        value={modelCapabilitySearch}
                                                        onChange={(event) => setModelCapabilitySearch(event.target.value)}
                                                        className="w-full shrink-0 sm:w-56!"
                                                    />
                                                </div>
                                                <div className="mt-3 space-y-3">
                                                    {groupedByChannel.length ? (
                                                        groupedByChannel.map((channelGroup) => (
                                                            <div key={channelGroup.channelId} className="overflow-hidden rounded-lg border border-[var(--studio-line)] bg-[var(--studio-panel)]">
                                                                {!effectiveChannelFilter ? (
                                                                    <div className="flex items-center justify-between gap-2 border-b border-[var(--studio-line)] bg-[var(--studio-surface-soft)]/80 px-4 py-2">
                                                                        <span className="truncate text-xs font-semibold text-[var(--studio-ink)]">{channelGroup.channelName}</span>
                                                                        <span className="shrink-0 rounded-full border border-[var(--studio-line)] bg-[var(--studio-panel)] px-2 py-0.5 text-xs text-[var(--studio-muted)]">
                                                                            {channelGroup.models.length}
                                                                        </span>
                                                                    </div>
                                                                ) : null}
                                                                <div className="divide-y divide-[var(--studio-line)]">
                                                                    {channelGroup.models.map((model) => {
                                                                        const modelConfig = draftModelConfigs.find((item) => item.modelType === activeGroup.capability && modelConfigValue(item) === model);
                                                                        if (!modelConfig) return null;
                                                                        const displayName = modelConfig.displayName || modelConfig.modelName;
                                                                        const hasAlias = Boolean(modelConfig.displayName && modelConfig.displayName !== modelConfig.modelName);
                                                                        const billingSummary = formatModelBillingSummary(modelConfig, translate);
                                                                        return (
                                                                            <div key={model} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-[var(--studio-surface-soft)]/70">
                                                                                <div className="flex min-w-0 flex-1 items-start gap-3">
                                                                                    <div className="mt-0.5 shrink-0">
                                                                                        <ModelIcon config={draftConfig} model={model} />
                                                                                    </div>
                                                                                    <div className="min-w-0 flex-1">
                                                                                        <div className="flex flex-wrap items-center gap-1.5">
                                                                                            <span className="truncate text-sm font-medium text-[var(--studio-ink)]">{displayName}</span>
                                                                                            {hasAlias ? <span className="truncate text-xs text-[var(--studio-muted)]">({modelConfig.modelName})</span> : null}
                                                                                            {modelConfig.defaultModel ? (
                                                                                                <span className="rounded bg-[var(--studio-primary-soft)] px-1.5 py-0.5 text-xs font-medium text-[var(--studio-primary)]">
                                                                                                    {translate("appShell.default")}
                                                                                                </span>
                                                                                            ) : null}
                                                                                            {modelConfig.isCustomModel ? (
                                                                                                <span className="rounded border border-[var(--studio-line)] px-1.5 py-0.5 text-xs text-[var(--studio-muted)]">
                                                                                                    {translate("appShell.customModel")}
                                                                                                </span>
                                                                                            ) : null}
                                                                                        </div>
                                                                                        {modelConfig.description ? (
                                                                                            <div className="mt-1 truncate text-xs text-[var(--studio-muted)]" title={modelConfig.description}>
                                                                                                {modelConfig.description}
                                                                                            </div>
                                                                                        ) : null}
                                                                                    </div>
                                                                                </div>
                                                                                <div className="flex shrink-0 items-center gap-3">
                                                                                    <div className="hidden items-center gap-2 text-xs text-[var(--studio-muted)] md:flex">
                                                                                        {billingSummary ? <span>{billingSummary}</span> : null}
                                                                                        {modelConfig.capabilities.length ? (
                                                                                            <span className="rounded bg-[var(--studio-surface-soft)] px-1.5 py-0.5">
                                                                                                {translate("appShell.capabilityCount", { value0: modelConfig.capabilities.length })}
                                                                                            </span>
                                                                                        ) : null}
                                                                                    </div>
                                                                                    <span title={modelConfig.defaultModel ? translate("appShell.defaultModelCannotBeDisabled") : translate("appShell.disabledModelsHiddenFromUserDropdown")}>
                                                                                        <Switch
                                                                                            size="small"
                                                                                            checked={modelConfig.enabled}
                                                                                            checkedChildren={translate("appShell.modelEnabled")}
                                                                                            unCheckedChildren={translate("appShell.modelDisabled")}
                                                                                            disabled={isSaving || modelConfig.defaultModel}
                                                                                            onChange={(checked) => setDraftModelEnabled(modelConfig.id, checked)}
                                                                                        />
                                                                                    </span>
                                                                                    <Button size="small" icon={<Pencil className="size-3.5" />} disabled={isSaving} onClick={() => openModelConfigEditor(modelConfig)}>
                                                                                        {translate("appShell.edit")}
                                                                                    </Button>
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                        ))
                                                    ) : (
                                                        <div className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-panel)] px-4 py-8 text-center text-sm text-[var(--studio-muted)]">
                                                            {translate("appShell.noMatchingModels")}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })()}
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
                                                <InputNumber<string> stringMode min="0" precision={6} value={String(draftInitialCredits)} disabled={isSaving} className="w-40" onChange={(value) => setDraftInitialCredits(creditText(value || "0"))} />
                                            </Form.Item>
                                            <Button type="primary" disabled={!creditsDirty || isSaving} loading={savingTab === "credits"} onClick={() => void saveCreditSettings()}>
                                                {translate("appShell.save")}
                                            </Button>
                                        </div>
                                    </div>
                                </Form>
                            ),
                        },
                        {
                            key: "creditProducts",
                            label: translate("credits.creditProducts"),
                            children: <CreditProductManagement />,
                        },
                        {
                            key: "invitationReward",
                            label: translate("appShell.referralReward"),
                            children: (
                                <Form layout="vertical" requiredMark={false} className="max-w-xl">
                                    <div className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4">
                                        <div className="text-sm font-semibold">{translate("appShell.referralRegistrationCredits")}</div>
                                        <div className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">{translate("appShell.referralRewardsGoToTheInviterAfterEmailRegistration")}</div>
                                        <div className="mt-5 flex flex-wrap items-end gap-3">
                                            <Form.Item label={translate("appShell.creditsPerNewUser")} className="mb-0">
                                                <InputNumber<string>
                                                    stringMode
                                                    min="0"
                                                    precision={6}
                                                    value={String(draftInvitationRewardCredits)}
                                                    disabled={isSaving}
                                                    className="w-48"
                                                    onChange={(value) => setDraftInvitationRewardCredits(creditText(value || "0"))}
                                                />
                                            </Form.Item>
                                            <Button type="primary" disabled={!invitationRewardDirty || isSaving} loading={savingTab === "invitationReward"} onClick={() => void saveInvitationRewardSettings()}>
                                                {translate("appShell.save")}
                                            </Button>
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
                                        <div className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">{translate("appShell.dailyCheckInGrantsTheseCreditsValidFor24")}</div>
                                        <div className="mt-5 flex flex-wrap items-end gap-3">
                                            <Form.Item label={translate("appShell.dailyCheckInCredits")} className="mb-0">
                                                <InputNumber<string> stringMode min="0" precision={6} value={String(draftCheckInCredits)} disabled={isSaving} className="w-40" onChange={(value) => setDraftCheckInCredits(creditText(value || "0"))} />
                                            </Form.Item>
                                            <Button type="primary" disabled={!checkInDirty || isSaving} loading={savingTab === "checkIn"} onClick={() => void saveCheckInRewardSettings()}>
                                                {translate("appShell.save")}
                                            </Button>
                                        </div>
                                    </div>
                                </Form>
                            ),
                        },
                        {
                            key: "firstPurchaseBonus",
                            label: translate("appShell.firstPurchaseBonus"),
                            children: (
                                <Form layout="vertical" requiredMark={false} className="max-w-xl">
                                    <div className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4">
                                        <div className="text-sm font-semibold">{translate("appShell.firstPurchaseBonus")}</div>
                                        <div className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">{translate("appShell.firstPurchaseBonusDescription")}</div>
                                        <div className="mt-5 flex flex-wrap items-end gap-3">
                                            <Form.Item label={translate("appShell.firstPurchaseBonusPercent")} className="mb-0">
                                                <InputNumber<string>
                                                    stringMode
                                                    min="0"
                                                    max="100"
                                                    precision={2}
                                                    suffix="%"
                                                    value={String(draftFirstPurchaseBonusPercent)}
                                                    disabled={isSaving}
                                                    className="w-40"
                                                    onChange={(value) => setDraftFirstPurchaseBonusPercent(creditText(value || "0"))}
                                                />
                                            </Form.Item>
                                            <Button type="primary" disabled={!firstPurchaseBonusDirty || isSaving} loading={savingTab === "firstPurchaseBonus"} onClick={() => void saveFirstPurchaseBonusSettings()}>
                                                {translate("appShell.save")}
                                            </Button>
                                        </div>
                                        <div className="mt-3 text-xs leading-5 text-[var(--studio-muted)]">{translate("appShell.firstPurchaseBonusRateHint")}</div>
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
                                                {translate("appShell.cloudStorage")}
                                            </div>
                                            <div className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">{translate("appShell.keysAreEncryptedOnTheServerDefaultStorageIs")}</div>
                                        </div>
                                        <div className="flex shrink-0 gap-2">
                                            <Button icon={<RefreshCw className="size-4" />} disabled={isSaving} loading={refreshingObjectStorages} onClick={handleRefreshObjectStorages}>
                                                {translate("appShell.refresh")}
                                            </Button>
                                            <Button type="primary" disabled={!objectStoragesDirty || isSaving} loading={savingTab === "objectStorage"} onClick={() => void saveObjectStorages()}>
                                                {translate("appShell.save")}
                                            </Button>
                                            <Button icon={<Plus className="size-4" />} disabled={isSaving} onClick={addObjectStorage}>
                                                {translate("appShell.add")}
                                            </Button>
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
                                                                {translate("appShell.setAsDefault")}
                                                            </Button>
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
                                                                            region: provider === "cloudflareR2" ? "auto" : "",
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
                                                            {storage.provider === "aliyunOss" || storage.provider === "cloudflareR2" ? (
                                                                <Form.Item label="Endpoint" extra={translate(storage.provider === "cloudflareR2" ? "appShell.enterACloudflareR2Endpoint" : "appShell.enterAnOSSEndpointIncludingHttpOrHttps")} className="mb-0 md:col-span-2">
                                                                    <Input
                                                                        value={storage.endpoint}
                                                                        placeholder={providerFields.endpointPlaceholder || "https://oss-cn-hangzhou.aliyuncs.com"}
                                                                        disabled={isSaving}
                                                                        onChange={(event) => updateDraftObjectStorage(storage.id, { endpoint: event.target.value })}
                                                                    />
                                                                </Form.Item>
                                                            ) : null}
                                                            <Form.Item label={translate("appShell.publicURL")} required={storage.provider === "qiniuKodo" || storage.provider === "cloudflareR2"} extra={providerFields.publicBaseUrlExtra} className="mb-0 md:col-span-2">
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
                                                            {translate("appShell.testUpload")}
                                                        </Button>
                                                        {objectStorageTestUrl && testedObjectStorageId === storage.id ? (
                                                            <Button type="link" className="h-auto p-0 text-xs" href={objectStorageTestUrl} target="_blank" rel="noreferrer">
                                                                {translate("appShell.openTestFile")}
                                                            </Button>
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
                            key: "timeouts",
                            label: translate("administration.timeoutSettings"),
                            children: (
                                <Form layout="vertical" requiredMark={false} className="max-w-4xl">
                                    <div className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4">
                                        <div className="text-sm font-semibold">{translate("administration.timeoutSettings")}</div>
                                        <div className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">{translate("administration.timeoutSettingsHint")}</div>
                                        <div className="mt-5 grid gap-x-6 gap-y-4 md:grid-cols-2">
                                            {([
                                                ["aiRequestBodyTimeoutSeconds", "administration.timeoutAiRequestBody", "administration.timeoutAiRequestBodyHint", 86400, "administration.timeoutSecondsUnit"],
                                                ["storyboardAgentTimeoutSeconds", "administration.timeoutStoryboardAgent", "administration.timeoutStoryboardAgentHint", 86400, "administration.timeoutSecondsUnit"],
                                                ["scriptAgentTimeoutSeconds", "administration.timeoutScriptAgent", "administration.timeoutScriptAgentHint", 86400, "administration.timeoutSecondsUnit"],
                                                ["storyBibleAgentTimeoutSeconds", "administration.timeoutStoryBibleAgent", "administration.timeoutStoryBibleAgentHint", 86400, "administration.timeoutSecondsUnit"],
                                                ["taskWaitTimeoutSeconds", "administration.timeoutTaskWait", "administration.timeoutTaskWaitHint", 86400, "administration.timeoutSecondsUnit"],
                                                ["videoTaskWaitTimeoutSeconds", "administration.timeoutVideoTaskWait", "administration.timeoutVideoTaskWaitHint", 86400, "administration.timeoutSecondsUnit"],
                                                ["videoCompositionExecutionTimeoutSeconds", "administration.timeoutVideoComposition", "administration.timeoutVideoCompositionHint", 86400, "administration.timeoutSecondsUnit"],
                                                ["tencentCosSocketTimeoutMilliseconds", "administration.timeoutCosSocket", "administration.timeoutCosSocketHint", 3600000, "administration.timeoutMillisecondsUnit"],
                                            ] as const).map(([key, labelKey, hintKey, max, unitKey]) => (
                                                <Form.Item key={key} label={<span className="block">{translate(labelKey)}</span>} extra={translate(hintKey)} className="mb-0">
                                                    <InputNumber
                                                        min={1}
                                                        max={max}
                                                        precision={0}
                                                        suffix={translate(unitKey)}
                                                        value={draftTimeoutSettings[key]}
                                                        disabled={isSaving}
                                                        className="w-full!"
                                                        onChange={(value) => setDraftTimeoutSettings((current) => ({ ...current, [key]: typeof value === "number" ? value : current[key] }))}
                                                    />
                                                </Form.Item>
                                            ))}
                                        </div>
                                        <Button type="primary" className="mt-5" disabled={!timeoutDirty || isSaving} loading={savingTab === "timeouts"} onClick={() => void saveTimeoutSettings()}>
                                            {translate("appShell.save")}
                                        </Button>
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
                        {
                            key: "externalLink",
                            label: translate("administration.externalLinkConfig"),
                            children: (
                                <ExternalLinkConfigManagement
                                    draft={draftExternalLink}
                                    dirty={externalLinkDirty}
                                    saving={savingTab === "externalLink"}
                                    onChange={setDraftExternalLink}
                                    onSave={() => void saveExternalLinkSettings()}
                                    onClear={() => void clearExternalLinkSettings()}
                                />
                            ),
                        },
                        {
                            key: "videoExport",
                            label: translate("administration.videoExportSettings"),
                            children: (
                                <Form layout="vertical" requiredMark={false} className="max-w-xl">
                                    <div className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4">
                                        <div className="flex items-center gap-2 text-sm font-semibold">
                                            <Video className="size-4" aria-hidden="true" />
                                            {translate("administration.videoExportSettings")}
                                        </div>
                                        <div className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">{translate("administration.videoExportSettingsHint")}</div>
                                        <div className="mt-5 flex items-center justify-between gap-4 rounded-md border border-[var(--studio-line)] bg-[var(--studio-panel)] px-3.5 py-3">
                                            <div className="min-w-0">
                                                <div className="text-sm font-medium">{translate("administration.videoExportStoryboardLabel")}</div>
                                                <div className="mt-0.5 text-xs text-[var(--studio-muted)]">{translate("administration.videoExportStoryboardDescription")}</div>
                                            </div>
                                            <Switch
                                                checked={draftVideoExportEnabled}
                                                checkedChildren={translate("administration.videoExportEnabled")}
                                                unCheckedChildren={translate("administration.videoExportDisabled")}
                                                disabled={isSaving}
                                                aria-label={translate("administration.videoExportStoryboardLabel")}
                                                onChange={(checked) => setDraftVideoExportEnabled(checked)}
                                            />
                                        </div>
                                        <Button
                                            type="primary"
                                            className="mt-5"
                                            disabled={!videoExportDirty || isSaving}
                                            loading={savingTab === "videoExport"}
                                            onClick={() => void saveVideoExportConfigSettings()}
                                        >
                                            {translate("appShell.save")}
                                        </Button>
                                    </div>
                                </Form>
                            ),
                        },
                    ].filter((item) => !team || !["credits", "creditProducts", "invitationReward", "checkIn", "firstPurchaseBonus", "community", "externalLink", "timeouts", "videoExport"].includes(item.key))}
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
                                <div className="text-lg font-semibold">
                                    {modelOptionLabelWithRealName(draftConfig, modelConfigValue(editingModelConfig))} {translate("appShell.configure")}
                                </div>
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
                width={editingModelConfig?.modelType === "video" ? 960 : 780}
                styles={{ body: { maxHeight: "72vh", overflowY: "auto", paddingTop: 8 } }}
                destroyOnHidden
                okText={translate("appShell.confirm")}
                cancelText={translate("appShell.cancel")}
                onCancel={() => setEditingModelConfig(null)}
                onOk={saveModelConfigEditor}
            >
                {editingModelConfig ? (() => {
                    const isVideo = editingModelConfig.modelType === "video" && editingModelIsMedia;
                    const isImage = editingModelConfig.modelType === "image";
                    const videoModes = createVideoGenerationCapabilityOptions(translate);
                    const selectedVideoMode = videoModes.find((item) => item.value === activeEditingVideoMode) || videoModes[0];
                    const selectedVideoModeIndex = videoModes.findIndex((item) => item.value === selectedVideoMode.value);
                    const imageModes = createModelCapabilityOptions(translate).image;
                    const selectedImageMode = imageModes.find((item) => item.value === activeEditingImageMode) || imageModes[0];
                    const hasVideoConstraintError = isVideo && Boolean(customVideoConfigurationIssue(editingModelConfig));

                    const basicTabContent = (
                        <div className="space-y-4">
                            <section className="space-y-3 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4">
                                <div className="grid gap-4 md:grid-cols-2">
                                    <div>
                                        <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
                                            {translate("appShell.displayName")}
                                            <Info className="size-3.5 text-[var(--studio-muted)]" />
                                        </div>
                                        <Input
                                            maxLength={255}
                                            placeholder={editingModelConfig.modelName}
                                            value={editingModelConfig.displayName || editingModelConfig.modelName}
                                            onChange={(event) => updateEditingModelConfig({ displayName: event.target.value.trim() || null })}
                                        />
                                        <p className="mt-1 text-xs text-[var(--studio-muted)]">{translate("appShell.userFacingNameDefaultsToModelNameAndDoes")}</p>
                                    </div>
                                    <div>
                                        <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
                                            {translate("appShell.displayIcon")}
                                            <Info className="size-3.5 text-[var(--studio-muted)]" />
                                        </div>
                                        <Select value={editingModelConfig.modelIcon || ""} options={modelIconSelectOptions} className="w-full" onChange={(modelIcon: string) => updateEditingModelConfig({ modelIcon: modelIcon || null })} />
                                        <p className="mt-1 text-xs text-[var(--studio-muted)]">{translate("appShell.displayIconAutoMatchDetectsItFromModelOr")}</p>
                                    </div>
                                </div>
                                <div>
                                    <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
                                        {translate("appShell.modelDescription")}
                                        <Info className="size-3.5 text-[var(--studio-muted)]" />
                                    </div>
                                    <Input.TextArea
                                        maxLength={500}
                                        showCount
                                        autoSize={{ minRows: 2, maxRows: 3 }}
                                        placeholder={translate("appShell.modelDescriptionPlaceholder")}
                                        value={editingModelConfig.description || ""}
                                        onChange={(event) => updateEditingModelConfig({ description: event.target.value || null })}
                                    />
                                    <p className="mt-1 text-xs text-[var(--studio-muted)]">{translate("appShell.modelDescriptionHelper")}</p>
                                </div>
                            </section>

                            {isVideo ? (
                                <section className="grid gap-4 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4 md:grid-cols-4">
                                    <div>
                                        <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
                                            {translate("appShell.billingMethod")}
                                            <Info className="size-3.5 text-[var(--studio-muted)]" />
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
                                        <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
                                            {translate("appShell.minimumDurationS")}
                                            <Info className="size-3.5 text-[var(--studio-muted)]" />
                                        </div>
                                        <InputNumber
                                            min={1}
                                            precision={0}
                                            suffix={translate("appShell.s")}
                                            className="w-full!"
                                            value={editingModelConfig.videoBillingConfiguration?.minimumDurationSeconds || 3}
                                            onChange={(value) => {
                                                const current = editingModelConfig.videoBillingConfiguration || createVideoBillingConfiguration();
                                                const nextMin = Math.max(1, Math.floor(Number(value) || 1));
                                                updateEditingModelConfig({
                                                    videoBillingConfiguration: {
                                                        ...current,
                                                        minimumDurationSeconds: nextMin,
                                                        ...(current.maximumDurationSeconds != null && current.maximumDurationSeconds !== UNLIMITED_VIDEO_DURATION_SECONDS && current.maximumDurationSeconds < nextMin ? { maximumDurationSeconds: nextMin } : {}),
                                                    },
                                                });
                                            }}
                                        />
                                    </div>
                                    <div>
                                        <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
                                            {translate("appShell.maximumDurationS")}
                                            <Info className="size-3.5 text-[var(--studio-muted)]" />
                                        </div>
                                        <InputNumber
                                            min={UNLIMITED_VIDEO_DURATION_SECONDS}
                                            precision={0}
                                            suffix={translate("appShell.s")}
                                            placeholder={translate("appShell.maximumDurationPlaceholder")}
                                            className="w-full!"
                                            value={editingModelConfig.videoBillingConfiguration?.maximumDurationSeconds ?? null}
                                            onChange={(value) =>
                                                updateEditingModelConfig({
                                                    videoBillingConfiguration: {
                                                        ...(editingModelConfig.videoBillingConfiguration || createVideoBillingConfiguration()),
                                                        maximumDurationSeconds: value === null || value === undefined ? null : Math.floor(Number(value)),
                                                    },
                                                })
                                            }
                                        />
                                    </div>
                                    <div>
                                        <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
                                            {translate("appShell.concurrency")}
                                            <Info className="size-3.5 text-[var(--studio-muted)]" />
                                        </div>
                                        <InputNumber
                                            min={1}
                                            precision={0}
                                            suffix={translate("appShell.tasks")}
                                            className="w-full!"
                                            value={editingModelConfig.requestConcurrency}
                                            onChange={(value) => updateEditingModelConfig({ requestConcurrency: Math.max(1, Math.floor(Number(value) || 1)) })}
                                        />
                                    </div>
                                </section>
                            ) : (
                                <section className="space-y-4 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4">
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <div>
                                            <div className="mb-1.5 text-sm font-semibold">{translate("appShell.creditsPerRun")}</div>
                                            <InputNumber<string> min="0" stringMode precision={6} value={String(editingModelConfig.creditCost)} className="w-full!" onChange={(value) => updateEditingModelConfig({ creditCost: creditText(value || "0") })} />
                                        </div>
                                        {isImage ? (
                                            <div>
                                                <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
                                                    {translate("appShell.concurrency")}
                                                    <Info className="size-3.5 text-[var(--studio-muted)]" />
                                                </div>
                                                <InputNumber
                                                    min={1}
                                                    precision={0}
                                                    suffix={translate("appShell.tasks")}
                                                    className="w-full!"
                                                    value={editingModelConfig.requestConcurrency}
                                                    onChange={(value) => updateEditingModelConfig({ requestConcurrency: Math.max(1, Math.floor(Number(value) || 1)) })}
                                                />
                                            </div>
                                        ) : null}
                                        {supportsThinkingConfiguration(editingModelConfig) ? (
                                            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-end gap-3">
                                                <div>
                                                    <div className="mb-1.5 text-sm font-semibold">{translate("appShell.enableThinking")}</div>
                                                    <Switch checked={editingModelConfig.thinkingEnabled} onChange={(thinkingEnabled) => updateEditingModelConfig({ thinkingEnabled })} />
                                                </div>
                                                <div>
                                                    <div className="mb-1.5 text-sm font-semibold">{translate("appShell.thinkingIntensity")}</div>
                                                    <Select
                                                        className="w-full"
                                                        value={editingModelConfig.reasoningEffort}
                                                        disabled={isReasoningEffortDisabled(false, editingModelConfig.thinkingEnabled)}
                                                        options={reasoningEffortOptions}
                                                        onChange={(reasoningEffort: "high" | "max") => updateEditingModelConfig({ reasoningEffort })}
                                                    />
                                                </div>
                                            </div>
                                        ) : null}
                                    </div>
                                    {isImage ? (
                                        <div className="border-t border-[var(--studio-line)] pt-3">
                                            <div className="text-sm font-semibold">{translate("appShell.imageResolutionPricing")}</div>
                                            <div className="mt-0.5 text-xs leading-5 text-[var(--studio-muted)]">{translate("appShell.imageResolutionPricingHint")}</div>
                                            <div className="mt-2.5 grid grid-cols-3 gap-3">
                                                {IMAGE_RESOLUTIONS.map((resolution) => (
                                                    <label key={resolution} className="block">
                                                        <span className="mb-1 block text-xs text-[var(--studio-muted)]">{resolution}</span>
                                                        <InputNumber<string>
                                                            stringMode
                                                            min="0"
                                                            precision={6}
                                                            className="w-full!"
                                                            placeholder={translate("appShell.inheritModelUnitPrice")}
                                                            value={formatImageResolutionPrice(editingModelConfig.imageBillingConfiguration?.resolutionPrices?.[resolution])}
                                                            onChange={(value) => updateImageResolutionPrice(resolution, value === null || String(value).trim() === "" ? "" : creditText(value))}
                                                        />
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                    ) : null}
                                </section>
                            )}
                        </div>
                    );

                    const customModelSwitchBar = editingModelConfig.modelType !== "text" ? (
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] px-4 py-3">
                            <div>
                                <div className="flex items-center gap-1.5 text-sm font-semibold">
                                    {translate("appShell.customModel")}
                                    <Info className="size-3.5 text-[var(--studio-muted)]" />
                                </div>
                                <p className="mt-0.5 text-xs text-[var(--studio-muted)]">
                                    {isVideo ? translate("appShell.useRequestAndResponseExamplesForEachModeTo") : translate("appShell.useRequestAndResponseExamplesForEachCapabilityTo")}
                                </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                {editingModelConfig.isCustomModel ? (
                                    <>
                                        <Button size="small" icon={<Copy className="size-3.5" />} disabled={isSaving} onClick={copyEditingModelConfig}>
                                            {translate("appShell.copyConfig")}
                                        </Button>
                                        <Button size="small" icon={<Upload className="size-3.5" />} disabled={isSaving} onClick={() => setModelConfigImportTarget(editingModelConfig)}>
                                            {translate("appShell.importConfig")}
                                        </Button>
                                    </>
                                ) : null}
                                <Switch checked={Boolean(editingModelConfig.isCustomModel)} onChange={(checked) => updateEditingModelConfig({ isCustomModel: checked })} />
                            </div>
                        </div>
                    ) : null;

                    const capabilitiesTabContent = isVideo ? (
                        <div className="space-y-3">
                            {customModelSwitchBar}
                            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] px-4 py-2.5">
                                <div className="flex items-center gap-3">
                                    <Switch
                                        size="small"
                                        aria-label={translate("appShell.audioInputSupported")}
                                        checked={editingModelConfig.capabilities.includes("audio-input")}
                                        disabled={isSaving || (!editingModelConfig.capabilities.includes("audio-input") && !editingModelConfig.capabilities.includes("reference-to-video"))}
                                        onChange={(checked) => {
                                            const group = editingModelConfig.customModelConfig?.["reference-to-video"];
                                            setEditingModelConfig({
                                                ...editingModelConfig,
                                                capabilities: checked ? uniqueModels([...editingModelConfig.capabilities, "audio-input"]) : editingModelConfig.capabilities.filter((value) => value !== "audio-input"),
                                                ...(editingModelConfig.isCustomModel && group
                                                    ? {
                                                          customModelConfig: {
                                                              ...editingModelConfig.customModelConfig,
                                                              "reference-to-video": { ...group, videoGenerationConstraints: { ...group.videoGenerationConstraints, maximumAudioCount: checked ? undefined : 0 } },
                                                          },
                                                      }
                                                    : {}),
                                            });
                                        }}
                                    />
                                    <div>
                                        <span className="text-sm font-medium">{translate("appShell.audioInputSupported")}</span>
                                        <span className="ml-2 text-xs text-[var(--studio-muted)]">{translate("appShell.allowAudioReferencesForThisVideoModelUniversalReference")}</span>
                                    </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    {editingModelConfig.isCustomModel ? (
                                        <Button size="small" icon={<Copy className="size-3.5" />} disabled={isSaving} onClick={() => setModelConfigCopyTarget(editingModelConfig)}>
                                            {translate("appShell.copyConfigFromModel")}
                                        </Button>
                                    ) : null}
                                    <span className="rounded-md border border-[var(--studio-line)] bg-[var(--studio-panel)] px-2 py-0.5 text-xs text-[var(--studio-muted)]">
                                        {translate("appShell.pricing")}
                                        {editingModelConfig.videoBillingConfiguration?.billingUnit === "second" ? translate("appShell.creditsS") : translate("appShell.creditsRun")}
                                    </span>
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5" role="tablist">
                                {videoModes.map((mode) => {
                                    const active = mode.value === selectedVideoMode.value;
                                    const enabled = editingModelConfig.capabilities.includes(mode.value);
                                    const modeHasError =
                                        editingModelConfig.isCustomModel &&
                                        enabled &&
                                        videoConstraintConfigurationIssues(
                                            mode.value,
                                            editingModelConfig.customModelConfig?.[mode.value]?.videoGenerationConstraints,
                                            editingModelConfig.capabilities.includes("audio-input"),
                                            editingModelConfig.videoBillingConfiguration?.minimumDurationSeconds || 1,
                                            resolveBillingMaximumDurationSeconds(editingModelConfig.videoBillingConfiguration),
                                        ).length > 0;
                                    return (
                                        <button
                                            key={mode.value}
                                            type="button"
                                            role="tab"
                                            aria-selected={active}
                                            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm! font-medium transition-colors ${
                                                active
                                                    ? "border-[var(--studio-primary-line)] bg-[var(--studio-primary-soft)] text-[var(--studio-primary)]!"
                                                    : "border-[var(--studio-line)] bg-[var(--studio-panel)] text-[var(--studio-muted)]! hover:text-[var(--studio-ink)]!"
                                            }`}
                                            onClick={() => setActiveEditingVideoMode(mode.value)}
                                        >
                                            <span className={`size-2 rounded-full ${modeHasError ? "bg-rose-500" : enabled ? "bg-emerald-500" : "bg-[var(--studio-line)]"}`} />
                                            <span>{mode.label}</span>
                                        </button>
                                    );
                                })}
                            </div>

                            {(() => {
                                const mode = selectedVideoMode;
                                const prices = editingModelConfig.videoBillingConfiguration?.modePrices?.[mode.value] || {};
                                const modeEnabled = editingModelConfig.capabilities.includes(mode.value);
                                const description = selectedVideoModeIndex === 0 ? translate("appShell.generateVideoFromText") : selectedVideoModeIndex === 1 ? translate("appShell.generateVideoFromImage") : translate("appShell.generateVideoFromTextImagesAndMultimodalReferences");
                                return (
                                    <div className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4">
                                        <div className="flex items-center justify-between gap-3 border-b border-[var(--studio-line)] pb-3">
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-semibold">{mode.label}</span>
                                                    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${modeEnabled ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-[var(--studio-panel)] text-[var(--studio-muted)]"}`}>
                                                        {modeEnabled ? translate("appShell.enabled") : translate("appShell.disabled")}
                                                    </span>
                                                </div>
                                                <p className="mt-0.5 text-xs text-[var(--studio-muted)]">{description}</p>
                                            </div>
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

                                        <div className="pt-3">
                                            <div className="mb-2 text-xs font-medium text-[var(--studio-muted)]">
                                                {translate("appShell.resolutionPricing")}
                                                {editingModelConfig.videoBillingConfiguration?.billingUnit === "second" ? translate("appShell.creditsS") : translate("appShell.creditsRun")}）
                                            </div>
                                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                                {VIDEO_RESOLUTION_OPTIONS.filter((resolution) => resolution.value !== "auto").map((resolution) => (
                                                    <label key={resolution.value} className="block rounded-md border border-[var(--studio-line)] bg-[var(--studio-panel)] px-2.5 py-1.5">
                                                        <span className="block text-xs font-medium text-[var(--studio-muted)]">{resolution.label}</span>
                                                        <InputNumber<string>
                                                            stringMode
                                                            min="0"
                                                            precision={6}
                                                            size="small"
                                                            placeholder={translate("appShell.notConfigured")}
                                                            value={prices[resolution.value] === undefined ? undefined : String(prices[resolution.value])}
                                                            className="mt-1 w-full!"
                                                            disabled={!modeEnabled}
                                                            controls={false}
                                                            onChange={(value) =>
                                                                updateEditingModelConfig({
                                                                    videoBillingConfiguration: updateVideoResolutionPrice(editingModelConfig.videoBillingConfiguration || createVideoBillingConfiguration(), mode.value, resolution.value, value),
                                                                })
                                                            }
                                                        />
                                                    </label>
                                                ))}
                                            </div>
                                        </div>

                                        {modeEnabled && editingModelConfig.isCustomModel ? (
                                            <div>
                                                <div className="mt-3 flex items-center justify-between gap-3">
                                                    <span className="text-sm font-semibold">{translate("appShell.videoConstraintSection")}</span>
                                                    <AutoFillButton onClick={() => setAutoFillConfigMode(mode.value)} />
                                                </div>
                                                <VideoGenerationConstraintsEditor
                                                    mode={mode.value}
                                                    constraints={editingModelConfig.customModelConfig?.[mode.value]?.videoGenerationConstraints}
                                                    audioEnabled={editingModelConfig.capabilities.includes("audio-input")}
                                                    billingMinimum={editingModelConfig.videoBillingConfiguration?.minimumDurationSeconds || 1}
                                                    billingMaximum={resolveBillingMaximumDurationSeconds(editingModelConfig.videoBillingConfiguration)}
                                                    onChange={(videoGenerationConstraints) =>
                                                        updateEditingModelConfig({
                                                            customModelConfig: {
                                                                ...editingModelConfig.customModelConfig,
                                                                [mode.value]: { ...emptyCustomModelGroup(), ...editingModelConfig.customModelConfig?.[mode.value], videoGenerationConstraints },
                                                            },
                                                        })
                                                    }
                                                />
                                            </div>
                                        ) : null}

                                        {editingModelConfig.isCustomModel ? (
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
                            })()}
                        </div>
                    ) : isImage && editingModelConfig.isCustomModel ? (
                        <div className="space-y-3">
                            {customModelSwitchBar}
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-1.5" role="tablist">
                                    {imageModes.map((option) => {
                                        const active = option.value === selectedImageMode.value;
                                        const enabled = editingModelConfig.capabilities.includes(option.value);
                                        return (
                                            <button
                                                key={option.value}
                                                type="button"
                                                role="tab"
                                                aria-selected={active}
                                                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm! font-medium transition-colors ${
                                                    active
                                                        ? "border-[var(--studio-primary-line)] bg-[var(--studio-primary-soft)] text-[var(--studio-primary)]!"
                                                        : "border-[var(--studio-line)] bg-[var(--studio-panel)] text-[var(--studio-muted)]! hover:text-[var(--studio-ink)]!"
                                                }`}
                                                onClick={() => setActiveEditingImageMode(option.value)}
                                            >
                                                <span className={`size-2 rounded-full ${enabled ? "bg-emerald-500" : "bg-[var(--studio-line)]"}`} />
                                                <span>{option.label}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                                <Button size="small" icon={<Copy className="size-3.5" />} disabled={isSaving} onClick={() => setModelConfigCopyTarget(editingModelConfig)}>
                                    {translate("appShell.copyConfigFromModel")}
                                </Button>
                            </div>
                            <div className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4">
                                <div className="flex items-center justify-between gap-3 border-b border-[var(--studio-line)] pb-3">
                                    <span className="text-sm font-semibold">{selectedImageMode.label}</span>
                                    <Switch
                                        checked={editingModelConfig.capabilities.includes(selectedImageMode.value)}
                                        onChange={(checked) =>
                                            updateEditingModelConfig({
                                                capabilities: checked
                                                    ? uniqueModels([...editingModelConfig.capabilities, selectedImageMode.value])
                                                    : editingModelConfig.capabilities.filter((value) => value !== selectedImageMode.value),
                                            })
                                        }
                                    />
                                </div>
                                {editingModelConfig.capabilities.includes(selectedImageMode.value) ? (
                                    <CustomModelGroupEditor
                                        label={selectedImageMode.label}
                                        group={editingModelConfig.customModelConfig?.[selectedImageMode.value]}
                                        isVideo={false}
                                        onChange={(group) =>
                                            updateEditingModelConfig({
                                                customModelConfig: { ...(editingModelConfig.customModelConfig || {}), [selectedImageMode.value]: group },
                                            })
                                        }
                                    />
                                ) : null}
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {customModelSwitchBar}
                            <section className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4">
                                <div className="mb-3 text-sm font-semibold">{translate("appShell.capabilities")}</div>
                                <div className="flex flex-wrap gap-x-5 gap-y-2.5">
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
                            </section>
                        </div>
                    );

                    const advancedTabContent = (
                        <div className="space-y-4">
                            {isImage ? (
                                <section className="space-y-3 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <div className="text-sm font-semibold">{translate("appShell.convertImageSizeToPixels")}</div>
                                            <p id="convert-image-size-to-pixels-description" className="mt-0.5 text-xs text-[var(--studio-muted)]">
                                                {translate("appShell.convertImageSizeToPixelsDescription")}
                                            </p>
                                        </div>
                                        <Switch
                                            id="convert-image-size-to-pixels"
                                            aria-label={translate("appShell.convertImageSizeToPixels")}
                                            aria-describedby="convert-image-size-to-pixels-description"
                                            checked={Boolean(editingModelConfig.convertImageSizeToPixels)}
                                            onChange={(checked) => updateEditingModelConfig({ convertImageSizeToPixels: checked })}
                                        />
                                    </div>
                                    {editingModelConfig.convertImageSizeToPixels ? (
                                        <ImageSizeMappingsEditor value={editingModelConfig.imageSizeMappings ?? cloneImageSizeMappings()} onChange={(imageSizeMappings) => updateEditingModelConfig({ imageSizeMappings })} />
                                    ) : null}
                                </section>
                            ) : null}
                            <section className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4">
                                <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                                    <div className="flex items-center gap-1.5 text-sm font-semibold">
                                        {translate("appShell.customJSONOptional")}
                                        <Info className="size-3.5 text-[var(--studio-muted)]" />
                                    </div>
                                    <Button size="small" icon={<Braces className="size-3.5" />} onClick={formatEditingCustomBodyParameters}>
                                        {translate("appShell.format")}
                                    </Button>
                                </div>
                                <Input.TextArea value={editingCustomBodyParameters} autoSize={{ minRows: 5, maxRows: 12 }} spellCheck={false} className="font-mono text-xs" onChange={(event) => setEditingCustomBodyParameters(event.target.value)} />
                                <p className="mt-2 text-xs text-[var(--studio-muted)]">{translate("appShell.mergedOnlyIntoJSONPOSTBodiesDuplicateFieldsOverride")}</p>
                            </section>
                        </div>
                    );

                    return (
                        <Tabs
                            activeKey={modelEditorTab}
                            onChange={(key) => setModelEditorTab(key as "basic" | "capabilities" | "advanced")}
                            items={[
                                { key: "basic", label: translate("appShell.editorTabBasic"), children: basicTabContent },
                                {
                                    key: "capabilities",
                                    label: (
                                        <span className="inline-flex items-center gap-1.5">
                                            <span>{translate("appShell.editorTabCapabilities")}</span>
                                            {hasVideoConstraintError ? <span className="size-2 rounded-full bg-rose-500" /> : null}
                                        </span>
                                    ),
                                    children: capabilitiesTabContent,
                                },
                                { key: "advanced", label: translate("appShell.editorTabAdvanced"), children: advancedTabContent },
                            ]}
                        />
                    );
                })() : null}
            </Modal>
            {modelConfigCopyTarget ? <ModelConfigCopyModal target={modelConfigCopyTarget} configs={draftModelConfigs} config={draftConfig} onCancel={() => setModelConfigCopyTarget(null)} onCopy={copyCustomConfigFromModel} /> : null}
            {modelConfigImportTarget ? <ModelConfigImportModal target={modelConfigImportTarget} onCancel={() => setModelConfigImportTarget(null)} onImport={importEditingModelConfig} /> : null}
            {autoFillConfigMode && editingModelConfig ? <ModelConfigAutoFillModal config={editingModelConfig} mode={autoFillConfigMode} onCancel={() => setAutoFillConfigMode(null)} onFill={autoFillCustomConfig} /> : null}
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
        imageBillingConfiguration: config.modelType === "image" && config.imageBillingConfiguration ? { resolutionPrices: { ...(config.imageBillingConfiguration.resolutionPrices || {}) } } : null,
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
        const issue = videoConstraintConfigurationIssues(mode, config.customModelConfig?.[mode]?.videoGenerationConstraints, config.capabilities.includes("audio-input"), config.videoBillingConfiguration?.minimumDurationSeconds || 1, resolveBillingMaximumDurationSeconds(config.videoBillingConfiguration))[0];
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
    const videoBillingConfiguration =
        config.modelType === "video" && config.videoBillingConfiguration
            ? {
                  ...config.videoBillingConfiguration,
                  maximumDurationSeconds: config.videoBillingConfiguration.maximumDurationSeconds ?? DEFAULT_VIDEO_MAXIMUM_DURATION_SECONDS,
                  modePrices: Object.fromEntries(
                      Object.entries(config.videoBillingConfiguration.modePrices || {}).filter(([mode]) => mode !== "audio-input" && supportedCapabilities.has(mode) && capabilities.includes(mode)),
                  ) as VideoBillingConfiguration["modePrices"],
              }
            : config.videoBillingConfiguration;
    // 自定义模型配置只保留已勾选能力的键，避免残留未启用能力的模板。
    const customModelConfig = config.isCustomModel ? Object.fromEntries(Object.entries(config.customModelConfig || {}).filter(([mode]) => mode !== "audio-input" && supportedCapabilities.has(mode) && capabilities.includes(mode))) : {};
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

/** 图片分辨率价格输入框的显示值，未配置时返回空串；Decimal 不接受空字符串。 */
function formatImageResolutionPrice(price: CreditAmount | null | undefined) {
    return price === null || price === undefined || String(price).trim() === "" ? "" : creditText(price);
}

/** 图片分辨率价目表只保留1K、2K、4K的已填写价格，全空表示沿用模型单价。 */
function normalizeImageBillingConfiguration(configuration: ServerModelConfig["imageBillingConfiguration"]): ServerModelConfig["imageBillingConfiguration"] {
    const prices = Object.fromEntries(IMAGE_RESOLUTIONS.map((resolution) => [resolution, configuration?.resolutionPrices?.[resolution]]).filter(([, price]) => String(price ?? "").trim() !== "")) as Record<string, CreditAmount>;
    return Object.keys(prices).length ? { resolutionPrices: prices } : null;
}

function cloneObjectStorages(storages: ObjectStorageConfig[]) {
    return storages.map((storage) => ({ ...storage }));
}

function createDraftModelConfig(channelId: string, modelName: string, modelType: ModelCapability, apiFormat?: ApiCallFormat): ServerModelConfig {
    return {
        id: `draft-${nanoid()}`,
        channelId,
        modelName,
        modelType,
        capabilities: apiFormat === "nana" ? nanaDefaultCapabilities(modelName, modelType) : [],
        defaultModel: false,
        enabled: true,
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
        description: null,
        isCustomModel: false,
        customModelConfig: {},
    };
}

/** NANA-API 模型按名称预置推荐能力，减少新增模型时的手工勾选；保存前仍可在模型弹窗中调整。 */
function nanaDefaultCapabilities(modelName: string, modelType: ModelCapability): string[] {
    if (modelType === "text") return ["chat"];
    if (modelType === "image") return ["text-to-image", "image-to-image"];
    const name = modelName.trim().toLowerCase();
    if (name.includes("seedance")) return ["text-to-video", "image-to-video", "reference-to-video"];
    if (name.includes("minimax")) return name.includes("ref") ? ["reference-to-video"] : ["text-to-video"];
    if (/(?:^|[^a-z0-9])wan(?:x|\d)/.test(name)) return ["text-to-video", "image-to-video", "reference-to-video", "first-last-frame-to-video"];
    return [];
}

function sameValue(first: unknown, second: unknown) {
    return JSON.stringify(first) === JSON.stringify(second);
}

/** 返回模型列表行的紧凑计费摘要（如「按秒 · 3~15秒」或「1 积分/次」）。 */
function formatModelBillingSummary(config: ServerModelConfig, translator: typeof translate) {
    if (config.modelType === "video") {
        const billing = config.videoBillingConfiguration;
        if (!billing) return "";
        const unitLabel = billing.billingUnit === "second" ? translator("appShell.perSecond") : translator("appShell.perRun");
        const min = billing.minimumDurationSeconds || 1;
        const max = resolveBillingMaximumDurationSeconds(billing);
        const range = max === null ? `${min}${translator("appShell.s")}+` : `${min}~${max}${translator("appShell.s")}`;
        return `${unitLabel} · ${range}`;
    }
    const cost = creditText(config.creditCost || 0);
    return `${cost} ${translator("appShell.creditsRun")}`;
}

function sameModelConfigForUpdate(first: ServerModelConfig, second: ServerModelConfig) {
    return (
        first.modelType === second.modelType &&
        first.enabled === second.enabled &&
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
        (first.description?.trim() || null) === (second.description?.trim() || null) &&
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

function updateVideoResolutionPrice(configuration: VideoBillingConfiguration, mode: VideoGenerationMode, resolution: VideoResolution, value: CreditAmount | null) {
    const modePrices = { ...(configuration.modePrices || {}) };
    const prices = { ...(modePrices[mode] || {}) };
    if (value === null) delete prices[resolution];
    else prices[resolution] = creditText(value);
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
        .map((channel) => ({
            channelId: channel.channelId,
            channelName: channel.channelName,
            models: sortModelOptions(channel.models, config).map((model) => ({ value: model, label: modelOptionLabelWithRealName(config, model, false) })),
        }));
    if (unassigned.length) {
        groups.push({
            channelId: "",
            channelName: translator("appShell.noChannelModels"),
            models: sortModelOptions(unassigned, config).map((model) => ({ value: model, label: modelOptionLabelWithRealName(config, model, false) })),
        });
    }
    return groups;
}

/** 模型选择弹窗的触发器：展示已选模型，点击按钮打开弹窗。 */
function ModelFieldTrigger({ config, models, multiple = false, placeholder, actionLabel, disabled, onOpen }: { config: AiConfig; models: string[]; multiple?: boolean; placeholder: string; actionLabel: string; disabled: boolean; onOpen: () => void }) {
    return (
        <div className="flex min-h-8 items-center gap-2 rounded-md border border-[var(--studio-line)] bg-[var(--studio-panel)] px-2 py-1">
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                {!models.length ? (
                    <span className="truncate text-sm text-[var(--studio-muted)]">{placeholder}</span>
                ) : multiple ? (
                    <>
                        {models.slice(0, 2).map((model) => (
                            <span key={model} className="max-w-[8.5rem] shrink-0 truncate rounded bg-[var(--studio-surface-hover)] px-1.5 py-0.5 text-xs text-[var(--studio-text)]">
                                {modelOptionLabelWithRealName(config, model)}
                            </span>
                        ))}
                        {models.length > 2 ? <span className="shrink-0 text-xs text-[var(--studio-muted)]">+{models.length - 2}</span> : null}
                    </>
                ) : (
                    <ModelOptionLabel config={config} model={models[0]} showChannel />
                )}
            </div>
            <Button size="small" disabled={disabled} onClick={onOpen}>
                {actionLabel}
            </Button>
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

/** 查询方法默认 GET，选项顺序与默认值保持一致。 */
const customQueryMethodOptions = [
    { value: "GET", label: "GET" },
    { value: "POST", label: "POST" },
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
function CustomModelGroupEditor({ label, group, isVideo, onAutoFill, onChange }: { label: string; group: CustomModelGroupConfig | undefined; isVideo: boolean; onAutoFill?: () => void; onChange: (group: CustomModelGroupConfig) => void }) {
    const translate = useTranslation();
    const current = { ...emptyCustomModelGroup(), ...(group || {}) };
    const update = (patch: Partial<CustomModelGroupConfig>) => onChange({ ...current, ...patch });
    const requestIsPost = current.requestMethod !== "GET";
    const queryIsPost = current.queryMethod !== "GET";
    // 图片能力按开关决定是否走异步查询；视频一直是「配了查询字段即异步」
    const imageAsync = !isVideo && current.asyncQuery === true;
    /** 放大弹窗标题带上能力/模式名称，避免多个分组同时展开时分不清正在编辑哪一项。 */
    const fieldTitle = (name: string) => `${name} · ${label}`;
    return (
        <div className="mt-3 space-y-3 rounded-md border border-[var(--studio-line)] bg-[var(--studio-panel)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold text-[var(--studio-muted)]">
                    {translate("appShell.customAPIConfiguration")}
                    {label}）
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {!isVideo ? (
                        <Segmented
                            size="small"
                            value={current.asyncQuery === true ? "async" : "sync"}
                            aria-label={translate("appShell.callMode")}
                            options={[
                                { value: "sync", label: translate("appShell.syncMode") },
                                { value: "async", label: translate("appShell.asyncMode") },
                            ]}
                            // 同步态写 undefined：服务端不落该键，写 false 会让草稿与基线永久判定为有改动
                            onChange={(value) => update({ asyncQuery: value === "async" ? true : undefined })}
                        />
                    ) : null}
                    {onAutoFill ? <AutoFillButton onClick={onAutoFill} /> : null}
                </div>
            </div>
            {imageAsync ? <p className="text-xs leading-5 text-[var(--studio-muted)]">{translate("appShell.asyncImageQueryHint")}</p> : null}
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
                    <div className="mb-1 text-xs text-[var(--studio-muted)]">{translate(imageAsync ? "appShell.resultPathTaskId" : "appShell.resultPath")}</div>
                    <Input value={current.resultPath} placeholder={translate(imageAsync ? "appShell.eGDataTaskId" : "appShell.eGDataImageUrl")} onChange={(event) => update({ resultPath: event.target.value })} />
                </div>
            </div>
            {requestIsPost ? (
                <div className="space-y-2">
                    <div className="rounded-md border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-2.5">
                        <div className="mb-1 text-xs text-[var(--studio-muted)]">{translate("appShell.aIRequestPromptOptionalGeneratesRequestBody")}</div>
                        <ModelConfigTextArea
                            title={fieldTitle(translate("appShell.aiRequestPrompt"))}
                            value={current.aiRequestPrompt}
                            minRows={2}
                            maxRows={5}
                            placeholder={translate("appShell.eGBuildAComfyUIWorkflowBodyWithPrompt")}
                            onChange={(value) => update({ aiRequestPrompt: value })}
                        />
                        <p className="mt-1 text-xs text-[var(--studio-muted)]">{translate("appShell.aIGeneratesRequestBodiesFromThePromptAndActual")}</p>
                    </div>
                    <div>
                        <div className="mb-1 text-xs text-[var(--studio-muted)]">{translate("appShell.requestExampleJSONTemplateRequiredWithoutAIPrompt")}</div>
                        <p className="mb-1 text-xs text-[var(--studio-muted)]">
                            {translate("appShell.referenceActualParametersWithPlaceholdersEG")}
                            {"{{prompt}}"}
                            {translate("appShell.fieldsWithoutPlaceholdersAreSentAsEnteredAndMay")}
                        </p>
                        <ModelConfigTextArea
                            title={fieldTitle(translate("appShell.requestExample"))}
                            value={current.requestTemplate}
                            minRows={3}
                            maxRows={8}
                            mono
                            placeholders={customTemplatePlaceholderOptions}
                            placeholder='{"model":"{{model}}","prompt":"{{prompt}}","image":{{references}}}'
                            onChange={(value) => update({ requestTemplate: value })}
                        />
                    </div>
                </div>
            ) : null}
            <div>
                <div className="mb-1 text-xs text-[var(--studio-muted)]">{translate("appShell.responseExampleJSONStructure")}</div>
                <ModelConfigTextArea
                    title={fieldTitle(translate("appShell.responseExample"))}
                    value={current.responseExample}
                    minRows={2}
                    maxRows={6}
                    mono
                    placeholder='{"data":{"image":{"url":"https://..."}}}'
                    onChange={(value) => update({ responseExample: value })}
                />
            </div>
            {isVideo || imageAsync ? (
                <>
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_112px]">
                        <div>
                            <div className="mb-1 text-xs text-[var(--studio-muted)]">
                                {translate("appShell.queryPathAsyncPollingSupports")}
                                {"{{taskId}}"}
                                {translate("appShell.placeholders")}
                            </div>
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
                                <ModelConfigTextArea
                                    title={fieldTitle(translate("appShell.aiQueryPrompt"))}
                                    value={current.aiQueryPrompt}
                                    minRows={2}
                                    maxRows={4}
                                    placeholder={translate("appShell.eGBuildQueryBodyFromTaskIDIncluding")}
                                    onChange={(value) => update({ aiQueryPrompt: value })}
                                />
                                <p className="mt-1 text-xs text-[var(--studio-muted)]">{translate("appShell.aIGeneratesQueryBodyUsingThisPromptAndTask")}</p>
                            </div>
                            <div>
                                <div className="mb-1 text-xs text-[var(--studio-muted)]">{translate("appShell.queryExampleJSONTemplateRequiredWithoutAIPrompt")}</div>
                                <p className="mb-1 text-xs text-[var(--studio-muted)]">
                                    {translate("appShell.use")}
                                    {"{{taskId}}"}
                                    {translate("appShell.referenceThePollingTaskIDFieldsWithoutPlaceholdersAre")}
                                </p>
                                <ModelConfigTextArea
                                    title={fieldTitle(translate("appShell.queryRequestExample"))}
                                    value={current.queryRequestTemplate}
                                    minRows={2}
                                    maxRows={6}
                                    mono
                                    placeholders={customTemplatePlaceholderOptions}
                                    placeholder='{"task_id":"{{taskId}}"}'
                                    onChange={(value) => update({ queryRequestTemplate: value })}
                                />
                            </div>
                        </div>
                    ) : null}
                    <div>
                        <div className="mb-1 text-xs text-[var(--studio-muted)]">{translate("appShell.queryResponseExampleJSON")}</div>
                        <ModelConfigTextArea
                            title={fieldTitle(translate("appShell.queryResponseExample"))}
                            value={current.queryResponseExample}
                            minRows={2}
                            maxRows={6}
                            mono
                            onChange={(value) => update({ queryResponseExample: value })}
                        />
                    </div>
                    <div>
                        <div className="mb-1 text-xs text-[var(--studio-muted)]">{translate("appShell.queryResultPathRequiredWithQueryPath")}</div>
                        <Input value={current.queryResultPath} placeholder={translate(isVideo ? "appShell.eGDataVideoUrl" : "appShell.eGDataImageUrl")} onChange={(event) => update({ queryResultPath: event.target.value })} />
                    </div>
                </>
            ) : null}
        </div>
    );
}

function apiFormatLabel(apiFormat: ApiCallFormat) {
    if (apiFormat === "nana") return "NANA-API";
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

/** 调用格式显示名；NANA-API 额外带「官方」标记，区分官方中转站与其他兼容渠道。 */
function apiFormatLabelNode(apiFormat: ApiCallFormat): ReactNode {
    const label = apiFormatLabel(apiFormat);
    if (apiFormat !== "nana") return label;
    return (
        <span className="inline-flex items-center gap-1.5">
            {label}
            <span className="inline-flex items-center gap-0.5 rounded-full border border-[var(--studio-primary-line)] bg-[var(--studio-primary-soft)] px-1.5 py-px text-[10px] font-medium leading-4 text-[var(--studio-primary)]">
                <CheckCircle2 className="size-2.5" />
                {translate("appShell.official")}
            </span>
        </span>
    );
}

function formatTimestamp(value: string) {
    return new Date(value).toLocaleString(currentLanguageTag(), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function isDefaultObjectStoragePlaceholder(storage: ObjectStorageConfig | undefined) {
    return storage?.id === "default" && storage.name === "默认对象存储" && storage.directory === "novanova-studio" && !storage.accessKey && !storage.secretKey && !storage.bucket && !storage.region && !storage.endpoint && !storage.publicBaseUrl;
}
