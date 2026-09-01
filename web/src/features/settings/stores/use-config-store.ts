"use client";

import { nanoid } from "nanoid";
import { useMemo } from "react";
import { create } from "zustand";

import { listChannels, listModelConfigs, listObjectStorages, listServerAiModels, type ServerAiModelList, type ServerModelConfig } from "@/services/api/server";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import type { ObjectStorageConfig } from "@/shared/types/object-storage";

import { normalizeChannelName } from "../lib/channel-name";
import { refreshModelConfigurationSnapshot } from "../lib/model-configuration-refresh";

export type ApiCallFormat = "openai" | "newapi" | "evolink" | "gemini" | "agnes" | "anthropic" | "seedance" | "minimax" | "custom";
export type ModelCapability = "image" | "video" | "text";
export type ModelCreditUnit = "generation" | "second";
export type VideoGenerationMode = "text-to-video" | "image-to-video" | "reference-to-video" | "first-last-frame-to-video";
export type VideoResolution = "auto" | "480p" | "720p" | "768p" | "1080p" | "2k" | "4k";
export type VideoBillingConfiguration = {
    billingUnit: ModelCreditUnit;
    minimumDurationSeconds: number;
    modePrices: Partial<Record<VideoGenerationMode, Partial<Record<VideoResolution, number>>>>;
};
/** 自定义模型单能力/模式分组配置。 */
export type CustomModelGroupConfig = {
    requestPath: string;
    requestMethod: "GET" | "POST";
    requestModelName: string;
    requestTemplate: string;
    aiRequestPrompt: string;
    responseExample: string;
    resultPath: string;
    queryPath: string;
    queryMethod: "GET" | "POST";
    queryRequestTemplate: string;
    aiQueryPrompt: string;
    queryResponseExample: string;
    queryResultPath: string;
};
export type VideoModelBillingConfiguration = {
    model: string;
    capabilities: string[];
    videoBillingConfiguration: VideoBillingConfiguration | null;
};
export type ModelCapabilityConfig = { model: string; capabilities: string[] };

export const MODEL_CAPABILITY_OPTIONS: Record<ModelCapability, Array<{ value: string; label: string }>> = {
    text: [
        { value: "chat", label: "常规聊天" },
        { value: "vision", label: "图像理解" },
    ],
    image: [
        { value: "text-to-image", label: "文生图" },
        { value: "image-to-image", label: "图生图" },
    ],
    video: [
        { value: "text-to-video", label: "文生视频" },
        { value: "image-to-video", label: "图生视频" },
        { value: "reference-to-video", label: "全能参考" },
        { value: "first-last-frame-to-video", label: "首尾帧原生生成" },
    ],
};

export type ConfigDialogTabKey = "channels" | "models" | "credits" | "objectStorage";

export type ModelChannel = {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    models: string[];
};

export type AiConfig = {
    channelMode: "remote" | "local";
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    channels: ModelChannel[];
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    agentModel: string;
    videoSeconds: string;
    vquality: string;
    videoWatermark: string;
    videoGenerationMode: VideoGenerationMode;
    systemPrompt: string;
    models: string[];
    modelCosts: Array<{ model: string; taskType: ModelCapability; credits: number; unit: ModelCreditUnit }>;
    imageModels: string[];
    videoModels: string[];
    textModels: string[];
    modelCapabilities: ModelCapabilityConfig[];
    videoModelBillingConfigurations: VideoModelBillingConfiguration[];
    modelDisplayNames: Record<string, string>;
    modelIcons: Record<string, string>;
    quality: string;
    imageResolution: string;
    size: string;
    count: string;
    canvasImageCount: string;
    canvasVideoCount: string;
};

type ConfigStore = {
    hydrated: boolean;
    hydratedUserId: string;
    config: AiConfig;
    objectStorage: ObjectStorageConfig;
    objectStorages: ObjectStorageConfig[];
    activeObjectStorageId: string;
    modelConfigs: ServerModelConfig[];
    isConfigOpen: boolean;
    configDialogTab: ConfigDialogTabKey;
    shouldPromptContinue: boolean;
    hydrateConfig: () => Promise<void>;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    setChannels: (channels: ModelChannel[]) => void;
    updateObjectStorageConfig: <K extends keyof ObjectStorageConfig>(key: K, value: ObjectStorageConfig[K]) => void;
    selectObjectStorage: (id: string) => void;
    replaceObjectStorage: (sourceStorageId: string, storage: ObjectStorageConfig) => void;
    addObjectStorage: () => void;
    deleteObjectStorage: (id: string) => void;
    setDefaultObjectStorage: (id: string) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean, tabKey?: ConfigDialogTabKey) => void;
    setConfigDialogTab: (tabKey: ConfigDialogTabKey) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
    refreshChannels: () => Promise<void>;
    refreshModelConfiguration: () => Promise<void>;
    refreshObjectStorages: () => Promise<void>;
};

const CHANNEL_MODEL_SEPARATOR = "::";
const LEGACY_SERVER_CHANNEL_ID = "server";

export const AGNES_IMAGE_MODEL = "agnes-image-2.1-flash";
export const AGNES_VIDEO_MODEL = "agnes-video-v2.0";

const defaultChannels: ModelChannel[] = [];

export const defaultConfig: AiConfig = {
    channelMode: "remote",
    baseUrl: "",
    apiKey: "",
    apiFormat: "openai",
    channels: defaultChannels,
    model: "",
    imageModel: "",
    videoModel: "",
    textModel: "",
    agentModel: "",
    videoSeconds: "5",
    vquality: "720p",
    videoWatermark: "false",
    videoGenerationMode: "text-to-video",
    systemPrompt: "",
    models: [],
    modelCosts: [],
    imageModels: [],
    videoModels: [],
    textModels: [],
    modelCapabilities: [],
    videoModelBillingConfigurations: [],
    modelDisplayNames: {},
    modelIcons: {},
    quality: "medium",
    imageResolution: "2K",
    size: "1:1",
    count: "1",
    canvasImageCount: "1",
    canvasVideoCount: "1",
};

const defaultObjectStorage: ObjectStorageConfig = createObjectStorageConfig({
    id: "default",
    name: "默认对象存储",
    defaultStorage: true,
});

/** 配置初始化连续失败的自动重试次数与间隔（服务刚启动时首次请求易瞬时失败）。 */
const MAX_HYDRATE_CONFIG_RETRY_ATTEMPTS = 5;
const HYDRATE_CONFIG_RETRY_DELAY_MS = 2000;
let hydrateConfigRetryAttempts = 0;

export const useConfigStore = create<ConfigStore>()((set, get) => ({
    hydrated: false,
    hydratedUserId: "",
    config: normalizeConfig(defaultConfig),
    objectStorage: defaultObjectStorage,
    objectStorages: [defaultObjectStorage],
    activeObjectStorageId: defaultObjectStorage.id,
    modelConfigs: [],
    isConfigOpen: false,
    configDialogTab: "channels",
    shouldPromptContinue: false,
    hydrateConfig: async () => {
        const user = useUserStore.getState().user;
        if (!user || (get().hydrated && get().hydratedUserId === user.id)) return;
        if (user?.role !== "admin") {
            const modelResult = await listServerAiModels().catch(() => null);
            // 服务刚启动等瞬时故障时不能提交空配置，否则整个会话都会处于“无模型可生成”状态；
            // 保持未就绪并稍后自动重试，成功后前端能力自动恢复（刷新页面也能立即恢复）。
            if (modelResult === null && hydrateConfigRetryAttempts < MAX_HYDRATE_CONFIG_RETRY_ATTEMPTS) {
                hydrateConfigRetryAttempts += 1;
                setTimeout(() => void useConfigStore.getState().hydrateConfig(), HYDRATE_CONFIG_RETRY_DELAY_MS);
                return;
            }
            hydrateConfigRetryAttempts = 0;
            set({
                hydrated: true,
                hydratedUserId: user.id,
                config: configFromServerModels(modelResult),
                modelConfigs: [],
                objectStorages: [defaultObjectStorage],
                activeObjectStorageId: defaultObjectStorage.id,
                objectStorage: defaultObjectStorage,
            });
            return;
        }
        const [channelResult, modelResult, storageResult] = await Promise.all([listChannels().catch(() => null), listModelConfigs().catch(() => null), listObjectStorages().catch(() => null)]);
        if ((channelResult === null || modelResult === null) && hydrateConfigRetryAttempts < MAX_HYDRATE_CONFIG_RETRY_ATTEMPTS) {
            hydrateConfigRetryAttempts += 1;
            setTimeout(() => void useConfigStore.getState().hydrateConfig(), HYDRATE_CONFIG_RETRY_DELAY_MS);
            return;
        }
        hydrateConfigRetryAttempts = 0;
        const channels = normalizeChannels(channelResult?.channels || defaultChannels);
        const modelConfigs = (modelResult?.modelConfigs || []).map(normalizeServerModelConfig);
        const objectStorages = normalizeObjectStorages(storageResult?.objectStorages || [defaultObjectStorage]);
        const activeObjectStorageId = resolveActiveObjectStorageId(objectStorages);
        set({
            hydrated: true,
            hydratedUserId: user.id,
            config: configFromModelConfigs(channels, modelConfigs),
            modelConfigs,
            objectStorages,
            activeObjectStorageId,
            objectStorage: objectStorages.find((item) => item.id === activeObjectStorageId) || objectStorages[0],
        });
    },
    updateConfig: (key, value) => {
        set((state) => {
            const config = normalizeConfig({ ...state.config, [key]: value });
            return { config };
        });
    },
    setChannels: (channels) => {
        set((state) => {
            const config = normalizeConfig({ ...state.config, channels: normalizeChannels(channels) });
            return { config };
        });
    },
    updateObjectStorageConfig: (key, value) => {
        set((state) => {
            const objectStorages = state.objectStorages.map((item) => (item.id === state.activeObjectStorageId ? { ...item, [key]: value } : item));
            const objectStorage = objectStorages.find((item) => item.id === state.activeObjectStorageId) || objectStorages[0];
            return { objectStorage, objectStorages };
        });
    },
    selectObjectStorage: (id) => {
        set((state) => {
            const objectStorage = state.objectStorages.find((item) => item.id === id) || state.objectStorage;
            return { activeObjectStorageId: objectStorage.id, objectStorage };
        });
    },
    replaceObjectStorage: (sourceStorageId, storage) => {
        set((state) => {
            const persistedStorage = createObjectStorageConfig(storage);
            // 保存和刷新并发时，以刚保存的服务端结果覆盖旧快照，避免刷新把表单字段重置为空。
            const objectStorages = state.objectStorages.map((item) => (item.id === sourceStorageId ? persistedStorage : item));
            const activeObjectStorageId = state.activeObjectStorageId === sourceStorageId ? persistedStorage.id : state.activeObjectStorageId;
            const objectStorage = objectStorages.find((item) => item.id === activeObjectStorageId) || objectStorages[0];
            return { objectStorage, objectStorages, activeObjectStorageId };
        });
    },
    addObjectStorage: () => {
        const storage = createObjectStorageConfig({ name: `对象存储 ${get().objectStorages.length + 1}` });
        set((state) => {
            const objectStorages = [...state.objectStorages, storage];
            return { objectStorage: storage, objectStorages, activeObjectStorageId: storage.id };
        });
    },
    deleteObjectStorage: (id) => {
        set((state) => {
            const kept = state.objectStorages.filter((item) => item.id !== id);
            const objectStorages = normalizeObjectStorages(kept.length ? kept : [defaultObjectStorage]);
            const activeObjectStorageId = resolveActiveObjectStorageId(objectStorages, state.activeObjectStorageId === id ? undefined : state.activeObjectStorageId);
            const objectStorage = objectStorages.find((item) => item.id === activeObjectStorageId) || objectStorages[0];
            return { objectStorage, objectStorages, activeObjectStorageId };
        });
    },
    setDefaultObjectStorage: (id) => {
        set((state) => {
            const objectStorages = normalizeObjectStorages(state.objectStorages.map((item) => ({ ...item, defaultStorage: item.id === id })));
            const objectStorage = objectStorages.find((item) => item.id === id) || objectStorages[0];
            return { objectStorage, objectStorages, activeObjectStorageId: objectStorage.id };
        });
    },
    isAiConfigReady: (config, model) => {
        const selectedModel = model || config.model || config.imageModel || config.textModel;
        return Boolean(selectedModel && config.models.includes(normalizeModelOptionValue(selectedModel, config.channels)));
    },
    openConfigDialog: (shouldPromptContinue = false, tabKey = "channels") => set({ isConfigOpen: true, shouldPromptContinue, configDialogTab: tabKey }),
    setConfigDialogTab: (configDialogTab) => set({ configDialogTab }),
    setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
    clearPromptContinue: () => set({ shouldPromptContinue: false }),
    refreshChannels: async () => {
        const data = await listChannels();
        set((state) => {
            const config = normalizeConfig({ ...state.config, channels: normalizeChannels(data.channels) });
            return { config };
        });
    },
    refreshModelConfiguration: () =>
        refreshModelConfigurationSnapshot(listChannels, listModelConfigs, (channels, modelConfigurations) => {
            set((state) => {
                const normalizedChannels = normalizeChannels(channels);
                return {
                    modelConfigs: modelConfigurations.map(normalizeServerModelConfig),
                    config: configFromModelConfigs(normalizedChannels, modelConfigurations, state.config),
                };
            });
        }),
    refreshObjectStorages: async () => {
        const data = await listObjectStorages();
        const objectStorages = normalizeObjectStorages(data.objectStorages);
        set((state) => {
            const activeObjectStorageId = resolveActiveObjectStorageId(objectStorages, state.activeObjectStorageId);
            return {
                objectStorages,
                activeObjectStorageId,
                objectStorage: objectStorages.find((item) => item.id === activeObjectStorageId) || objectStorages[0],
            };
        });
    },
}));

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    return useMemo(() => normalizeConfig(config), [config]);
}

export function buildApiUrl(baseUrl: string, path: string) {
    const base = normalizeApiBaseUrl(baseUrl);
    const suffix = path.startsWith("/") ? path : `/${path}`;
    return `${base}${suffix}`;
}

export function defaultBaseUrlForApiFormat(apiFormat: ApiCallFormat) {
    if (apiFormat === "newapi") return "";
    if (apiFormat === "evolink") return "https://api.evolink.ai/v1";
    if (apiFormat === "gemini") return "https://generativelanguage.googleapis.com/v1beta";
    if (apiFormat === "anthropic") return "https://api.anthropic.com/v1";
    if (apiFormat === "seedance") return "https://ark.cn-beijing.volces.com/api/v3";
    if (apiFormat === "minimax") return "https://api.minimaxi.com";
    if (apiFormat === "agnes") return "";
    if (apiFormat === "custom") return "";
    return "https://api.openai.com/v1";
}

export function createModelChannel(input: Partial<ModelChannel> = {}): ModelChannel {
    const apiFormat = normalizeApiFormat(input.apiFormat);
    return {
        id: input.id?.trim() || nanoid(),
        name: normalizeChannelName(input.name),
        baseUrl: input.baseUrl ?? defaultBaseUrlForApiFormat(apiFormat),
        apiKey: input.apiKey ?? "",
        apiFormat,
        models: uniqueText(input.models || []),
    };
}

export function normalizeModelOptionValue(model: string, channels: ModelChannel[]) {
    const trimmed = model.trim();
    if (!trimmed) return "";
    const parsed = parseModelOption(trimmed);
    if (parsed?.channelId === LEGACY_SERVER_CHANNEL_ID) return "";
    if (parsed) return `${parsed.channelId}${CHANNEL_MODEL_SEPARATOR}${parsed.model}`;
    const owner = channels.find((channel) => channel.models.includes(trimmed));
    return owner ? `${owner.id}${CHANNEL_MODEL_SEPARATOR}${trimmed}` : trimmed;
}

export function modelOptionName(model: string) {
    return parseModelOption(model)?.model || model.trim();
}

export function modelOptionLabel(config: AiConfig, model: string) {
    const value = model.trim();
    const parsed = parseModelOption(value);
    if (!parsed) return value;
    const displayName = config.modelDisplayNames?.[value] || parsed.model;
    const channel = config.channels.find((item) => item.id === parsed.channelId);
    return channel?.name ? `${displayName}（${channel.name}）` : displayName;
}

/** 管理端「我的模型」页签专用：同时展示展示名与真实模型名，如「（dsf-v4）deepseek-v4-flash（渠道名）」。 */
export function modelOptionLabelWithRealName(config: AiConfig, model: string) {
    const value = model.trim();
    const parsed = parseModelOption(value);
    if (!parsed) return value;
    const realName = parsed.model;
    const displayName = config.modelDisplayNames?.[value];
    const channel = config.channels.find((item) => item.id === parsed.channelId);
    const channelName = channel?.name;
    const displayPrefix = displayName ? `（${displayName}）` : "";
    const channelSuffix = channelName ? `（${channelName}）` : "";
    return `${displayPrefix}${realName}${channelSuffix}`;
}

export function modelOptionsFromChannels(channels: ModelChannel[]) {
    return uniqueText(channels.flatMap((channel) => channel.models.map((model) => `${channel.id}${CHANNEL_MODEL_SEPARATOR}${model}`)));
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    return uniqueText(capability ? capabilityModels(config, capability) : config.models);
}

export function resolveModelRequestConfig(config: AiConfig, model: string): AiConfig {
    const normalized = normalizeConfig(config);
    const selectedModel = model || normalized.model || normalized.imageModel;
    const parsed = parseModelOption(selectedModel);
    if (!parsed) return { ...normalized, model: selectedModel };
    const channel = normalized.channels.find((item) => item.id === parsed.channelId);
    if (!channel) return { ...normalized, model: selectedModel };
    return {
        ...normalized,
        model: parsed.model,
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        apiFormat: channel.apiFormat,
    };
}

function normalizeConfig(config: Partial<AiConfig> = {}): AiConfig {
    const channels = normalizeChannels(config.channels || defaultChannels);
    const models = modelOptionsFromChannels(channels);
    const next: AiConfig = {
        ...defaultConfig,
        ...config,
        channels,
        models,
    };
    next.imageModels = normalizeCapabilityList(next.imageModels, models, channels);
    next.videoModels = normalizeCapabilityList(next.videoModels, models, channels);
    next.textModels = normalizeCapabilityList(next.textModels, models, channels);
    next.imageModel = normalizeSelectedModel(next.imageModel, next.imageModels, channels);
    next.videoModel = normalizeSelectedModel(next.videoModel, next.videoModels, channels);
    next.textModel = normalizeSelectedModel(next.textModel, next.textModels, channels);
    next.model = normalizeSelectedModel(next.model, models, channels) || next.imageModel || next.textModel || next.videoModel;
    next.agentModel = normalizeSelectedModel(next.agentModel, next.textModels, channels) || next.textModel;
    next.baseUrl = next.baseUrl || channels[0]?.baseUrl || "";
    next.apiKey = next.apiKey || channels[0]?.apiKey || "";
    next.apiFormat = normalizeApiFormat(next.apiFormat || channels[0]?.apiFormat);
    next.channelMode = next.channelMode === "local" ? "local" : "remote";
    next.videoGenerationMode = ["text-to-video", "image-to-video", "reference-to-video", "first-last-frame-to-video"].includes(next.videoGenerationMode)
        ? next.videoGenerationMode : "text-to-video";
    return next;
}

export function configFromModelConfigs(channels: ModelChannel[], modelConfigs: ServerModelConfig[], current: Partial<AiConfig> = {}) {
    const valuesByType = (type: ModelCapability) => modelConfigs.filter((item) => item.modelType === type).map((item) => `${item.channelId}${CHANNEL_MODEL_SEPARATOR}${item.modelName}`);
    const defaultByType = (type: ModelCapability) => {
        const item = modelConfigs.find((config) => config.modelType === type && config.defaultModel);
        return item ? `${item.channelId}${CHANNEL_MODEL_SEPARATOR}${item.modelName}` : "";
    };
    return normalizeConfig({
        ...current,
        channels,
        imageModels: valuesByType("image"),
        videoModels: valuesByType("video"),
        textModels: valuesByType("text"),
        imageModel: defaultByType("image"),
        videoModel: defaultByType("video"),
        textModel: defaultByType("text"),
        modelCapabilities: modelConfigs.map((item) => ({
            model: `${item.channelId}${CHANNEL_MODEL_SEPARATOR}${item.modelName}`,
            capabilities: item.capabilities,
        })),
        videoModelBillingConfigurations: modelConfigs
            .filter((item) => item.modelType === "video")
            .map((item) => ({
                model: `${item.channelId}${CHANNEL_MODEL_SEPARATOR}${item.modelName}`,
                capabilities: item.capabilities,
                videoBillingConfiguration: item.videoBillingConfiguration || null,
            })),
        modelDisplayNames: Object.fromEntries(
            modelConfigs
                .filter((item) => item.displayName && item.displayName !== item.modelName)
                .map((item) => [`${item.channelId}${CHANNEL_MODEL_SEPARATOR}${item.modelName}`, item.displayName!]),
        ),
        modelIcons: Object.fromEntries(
            modelConfigs
                .filter((item) => item.modelIcon)
                .map((item) => [`${item.channelId}${CHANNEL_MODEL_SEPARATOR}${item.modelName}`, item.modelIcon!]),
        ),
        modelCosts: modelConfigs.map((item) => ({
            model: `${item.channelId}${CHANNEL_MODEL_SEPARATOR}${item.modelName}`,
            taskType: item.modelType,
            credits: item.creditCost,
            unit: normalizeModelCreditUnit(item.creditUnit, item.modelType),
        })),
    });
}

function configFromServerModels(modelList: ServerAiModelList | null) {
    const models = modelList?.models || [];
    const channels = new Map<string, ModelChannel>();
    for (const model of models) {
        const parsed = parseModelOption(model.value);
        if (!parsed) continue;
        const channel =
            channels.get(parsed.channelId) ||
            createModelChannel({
                id: parsed.channelId,
                name: model.provider,
                apiFormat: model.apiFormat,
                baseUrl: "",
                apiKey: "",
                models: [],
            });
        if (!channel.models.includes(parsed.model)) channel.models.push(parsed.model);
        channels.set(parsed.channelId, channel);
    }
    const defaultByType = (capability: ModelCapability) => models.find((model) => model.capability === capability && model.defaultModel)?.value || "";
    return normalizeConfig({
        channels: [...channels.values()],
        imageModels: modelList?.imageModels || [],
        videoModels: modelList?.videoModels || [],
        textModels: modelList?.textModels || [],
        imageModel: defaultByType("image"),
        videoModel: defaultByType("video"),
        textModel: defaultByType("text"),
        modelCosts: models.map((model) => ({
            model: model.value,
            taskType: model.capability as ModelCapability,
            credits: model.creditCost,
            unit: normalizeModelCreditUnit(model.creditUnit, model.capability as ModelCapability),
        })),
        modelCapabilities: models.map((model) => ({ model: model.value, capabilities: model.capabilities || [] })),
        videoModelBillingConfigurations: models
            .filter((model) => model.capability === "video")
            .map((model) => ({
                model: model.value,
                capabilities: model.capabilities || [],
                videoBillingConfiguration: model.videoBillingConfiguration || null,
            })),
        modelDisplayNames: Object.fromEntries(
            models
                .filter((model) => model.label && model.label !== modelOptionName(model.value))
                .map((model) => [model.value, model.label]),
        ),
        modelIcons: Object.fromEntries(
            models
                .filter((model) => model.icon)
                .map((model) => [model.value, model.icon!]),
        ),
    });
}

function normalizeCapabilityList(models: string[] | undefined, allModels: string[], channels: ModelChannel[]) {
    const normalized = uniqueText((models || []).map((model) => normalizeModelOptionValue(model, channels)));
    return normalized.filter((model) => allModels.includes(model));
}

function normalizeSelectedModel(model: string | undefined, options: string[], channels: ModelChannel[]) {
    const value = normalizeModelOptionValue(model || "", channels);
    if (!options.length || !value) return "";
    if (options.includes(value)) return value;
    const byName = options.find((item) => modelOptionName(item) === value || modelOptionName(item) === modelOptionName(value));
    return byName || "";
}

function normalizeChannels(channels: Array<Partial<ModelChannel>>): ModelChannel[] {
    const normalized = channels.map((channel) => createModelChannel(channel)).filter((channel) => channel.id);
    return normalized.filter((channel) => channel.id !== LEGACY_SERVER_CHANNEL_ID);
}

function normalizeObjectStorages(storages: Array<Partial<ObjectStorageConfig>>): ObjectStorageConfig[] {
    const normalized = storages.map((storage) => createObjectStorageConfig(storage));
    const list = normalized.length ? normalized : [defaultObjectStorage];
    const hasDefault = list.some((storage) => storage.defaultStorage);
    return list.map((storage, index) => ({ ...storage, defaultStorage: hasDefault ? storage.defaultStorage : index === 0 }));
}

export function createObjectStorageConfig(input: Partial<ObjectStorageConfig> = {}): ObjectStorageConfig {
    return {
        id: input.id?.trim() || nanoid(),
        name: input.name?.trim() || "未命名对象存储",
        provider: input.provider || "tencentCos",
        accessKey: input.accessKey || "",
        secretKey: input.secretKey || "",
        bucket: input.bucket || "",
        region: input.region || "",
        endpoint: input.endpoint || "",
        directory: input.directory || "novanova-studio",
        publicBaseUrl: input.publicBaseUrl || "",
        lastTestedAt: input.lastTestedAt || "",
        defaultStorage: Boolean(input.defaultStorage),
    };
}

function resolveActiveObjectStorageId(storages: ObjectStorageConfig[], preferredId?: string) {
    if (preferredId && storages.some((storage) => storage.id === preferredId)) return preferredId;
    return storages.find((storage) => storage.defaultStorage)?.id || storages[0].id;
}

function capabilityModels(config: AiConfig, capability: ModelCapability) {
    if (capability === "image") return config.imageModels;
    if (capability === "video") return config.videoModels;
    return config.textModels;
}

function parseModelOption(value: string) {
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    if (index <= 0 || index >= value.length - CHANNEL_MODEL_SEPARATOR.length) return null;
    return {
        channelId: value.slice(0, index),
        model: value.slice(index + CHANNEL_MODEL_SEPARATOR.length),
    };
}

function normalizeApiFormat(value: unknown): ApiCallFormat {
    if (value === "newapi" || value === "evolink" || value === "gemini" || value === "agnes" || value === "anthropic" || value === "seedance" || value === "minimax" || value === "custom") return value;
    return "openai";
}

/** 归一化模型计费单位，历史配置和非视频模型统一按次计费。 */
export function normalizeModelCreditUnit(value: unknown, modelType: ModelCapability): ModelCreditUnit {
    return modelType === "video" && value === "second" ? "second" : "generation";
}

/** 归一化服务端模型配置，兼容未返回计费单位的历史接口。 */
export function normalizeServerModelConfig(config: ServerModelConfig): ServerModelConfig {
    return {
        ...config,
        displayName: config.displayName || null,
        modelIcon: config.modelIcon || null,
        customBodyParameters: isJsonObject(config.customBodyParameters) ? { ...config.customBodyParameters } : {},
        isCustomModel: Boolean(config.isCustomModel),
        customModelConfig: config.customModelConfig || {},
        creditUnit: normalizeModelCreditUnit(config.creditUnit, config.modelType),
        requestConcurrency: normalizeModelRequestConcurrency(config.requestConcurrency),
    };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 归一化模型同时并发数，缺省时使用默认值1。 */
export function normalizeModelRequestConcurrency(value: unknown) {
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 1;
}

function normalizeApiBaseUrl(baseUrl: string) {
    return baseUrl.trim().replace(/\/+$/, "");
}

function uniqueText(items: string[]) {
    return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}
