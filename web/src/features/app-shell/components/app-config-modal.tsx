"use client";

import { App, Button, Checkbox, Form, Input, InputNumber, Modal, Select, Space, Switch, Tabs } from "antd";
import { nanoid } from "nanoid";
import { Braces, CheckCircle2, ChevronDown, ChevronUp, CloudUpload, Image, Info, Monitor, Pencil, Plus, RefreshCw, Sparkles, TextCursorInput, Trash2, Video, Wifi } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useUserStore } from "@/features/auth/stores/use-user-store";
import { ModelPicker } from "@/features/settings/components/model-picker";
import {
    configFromModelConfigs,
    createModelChannel,
    createObjectStorageConfig,
    defaultBaseUrlForApiFormat,
    MODEL_CAPABILITY_OPTIONS,
    modelOptionLabelWithRealName,
    normalizeModelOptionValue,
    useConfigStore,
    type ApiCallFormat,
    type ConfigDialogTabKey,
    type ModelCapability,
    type ModelChannel,
    type VideoBillingConfiguration,
    type VideoGenerationMode,
    type VideoResolution,
} from "@/features/settings/stores/use-config-store";
import { VIDEO_GENERATION_MODE_OPTIONS, VIDEO_RESOLUTION_OPTIONS, createVideoBillingConfiguration } from "@/features/generation/lib/video-billing";
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
    refreshChannelModels as refreshServerChannelModels,
    setDefaultModel,
    setDefaultObjectStorage as setServerDefaultObjectStorage,
    updateChannel as updateServerChannel,
    updateCreditSettings,
    updateModelConfig,
    updateObjectStorage as updateServerObjectStorage,
    type ServerModelConfig,
} from "@/services/api/server";
import type { ObjectStorageConfig, ObjectStorageProvider } from "@/shared/types/object-storage";

type ModelGroup = {
    capability: ModelCapability;
    modelKey: "imageModel" | "videoModel" | "textModel";
    modelsKey: "imageModels" | "videoModels" | "textModels";
    defaultLabel: string;
    optionsLabel: string;
};

const modelGroups: ModelGroup[] = [
    { capability: "image", modelKey: "imageModel", modelsKey: "imageModels", defaultLabel: "默认生图模型", optionsLabel: "生图模型可选项" },
    { capability: "video", modelKey: "videoModel", modelsKey: "videoModels", defaultLabel: "默认视频模型", optionsLabel: "视频模型可选项" },
    { capability: "text", modelKey: "textModel", modelsKey: "textModels", defaultLabel: "默认文本模型", optionsLabel: "文本模型可选项" },
];

const capabilityGroups: Array<{ capability: ModelCapability; modelsKey: "textModels" | "imageModels" | "videoModels"; label: string }> = [
    { capability: "text", modelsKey: "textModels", label: "文本模型" },
    { capability: "image", modelsKey: "imageModels", label: "图像模型" },
    { capability: "video", modelsKey: "videoModels", label: "视频模型" },
];

const apiFormatOptions: Array<{ label: string; value: ApiCallFormat }> = [
    { label: "OpenAI", value: "openai" },
    { label: "New API", value: "newapi" },
    { label: "Evolink", value: "evolink" },
    { label: "Gemini", value: "gemini" },
    { label: "Agnes", value: "agnes" },
    { label: "Anthropic", value: "anthropic" },
    { label: "Seedance", value: "seedance" },
    { label: "MiniMax", value: "minimax" },
];

const objectStorageProviderOptions: Array<{ label: string; value: ObjectStorageProvider }> = [
    { label: "腾讯云COS", value: "tencentCos" },
    { label: "阿里云OSS", value: "aliyunOss" },
    { label: "七牛云Kodo", value: "qiniuKodo" },
];

const qiniuRegionOptions = [
    { label: "华东-浙江（z0）", value: "z0" },
    { label: "华东-浙江2（cn-east-2）", value: "cn-east-2" },
    { label: "华北-河北（z1）", value: "z1" },
    { label: "华南-广东（z2）", value: "z2" },
    { label: "北美-洛杉矶（na0）", value: "na0" },
    { label: "亚太-新加坡（as0）", value: "as0" },
];

const objectStorageProviderFields: Record<ObjectStorageProvider, { accessKeyLabel: string; secretKeyLabel: string; bucketPlaceholder: string; regionLabel: string; regionPlaceholder: string; publicBaseUrlExtra: string }> = {
    tencentCos: {
        accessKeyLabel: "SecretId",
        secretKeyLabel: "SecretKey",
        bucketPlaceholder: "example-1250000000",
        regionLabel: "Region",
        regionPlaceholder: "ap-guangzhou",
        publicBaseUrlExtra: "留空时自动使用 https://{bucket}.cos.{region}.myqcloud.com/{key}",
    },
    aliyunOss: {
        accessKeyLabel: "AccessKey ID",
        secretKeyLabel: "AccessKey Secret",
        bucketPlaceholder: "example-bucket",
        regionLabel: "地域ID",
        regionPlaceholder: "cn-hangzhou",
        publicBaseUrlExtra: "留空时按 Bucket 和公开 Endpoint 自动生成访问地址。",
    },
    qiniuKodo: {
        accessKeyLabel: "AccessKey",
        secretKeyLabel: "SecretKey",
        bucketPlaceholder: "example-bucket",
        regionLabel: "区域",
        regionPlaceholder: "请选择区域",
        publicBaseUrlExtra: "必须填写已绑定当前 Bucket 的 CDN 或自定义域名。",
    },
};

export function AppConfigModal() {
    const { message, modal } = App.useApp();
    const user = useUserStore((state) => state.user);
    const config = useConfigStore((state) => state.config);
    const modelConfigs = useConfigStore((state) => state.modelConfigs);
    const objectStorages = useConfigStore((state) => state.objectStorages);
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const configDialogTab = useConfigStore((state) => state.configDialogTab);
    const setConfigDialogTab = useConfigStore((state) => state.setConfigDialogTab);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const refreshChannels = useConfigStore((state) => state.refreshChannels);
    const refreshModelConfiguration = useConfigStore((state) => state.refreshModelConfiguration);
    const refreshObjectStorages = useConfigStore((state) => state.refreshObjectStorages);
    const [activeTab, setActiveTab] = useState<ConfigDialogTabKey>("channels");
    const [draftsReady, setDraftsReady] = useState(false);
    const [savingTab, setSavingTab] = useState<ConfigDialogTabKey | "">("");
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
    const [editingModelConfig, setEditingModelConfig] = useState<ServerModelConfig | null>(null);
    const [editingCustomBodyParameters, setEditingCustomBodyParameters] = useState("{}");
    const initializedRef = useRef(false);
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
        setCollapsedModelCapabilityTypes(capabilityGroups.map((group) => group.capability));
    }, []);

    const resetObjectStorageDraft = useCallback(() => {
        const storages = cloneObjectStorages(useConfigStore.getState().objectStorages);
        setObjectStorageBaseline(storages);
        setDraftObjectStorages(cloneObjectStorages(storages));
        setCollapsedObjectStorageIds(storages.map((storage) => storage.id));
    }, []);

    const resetAllDrafts = useCallback(() => {
        resetChannelDraft(true);
        resetModelConfigDraft();
        resetObjectStorageDraft();
        setTestedObjectStorageId("");
        setObjectStorageTestUrl("");
    }, [resetChannelDraft, resetModelConfigDraft, resetObjectStorageDraft]);

    useEffect(() => {
        if (isConfigOpen) setActiveTab(configDialogTab);
    }, [configDialogTab, isConfigOpen]);

    useEffect(() => {
        if (!isConfigOpen) {
            initializedRef.current = false;
            setDraftsReady(false);
            return;
        }
        if (initializedRef.current) return;
        initializedRef.current = true;
        setDraftsReady(false);
        let active = true;
        void Promise.all([refreshModelConfiguration(), refreshObjectStorages(), getCreditSettings()])
            .then(([, , creditSettings]) => {
                if (!active) return;
                resetAllDrafts();
                setCreditBaseline(creditSettings.initialCredits);
                setDraftInitialCredits(creditSettings.initialCredits);
                setDraftsReady(true);
            })
            .catch(() => {
                if (!active) return;
                message.error("加载配置失败");
                setDraftsReady(true);
            });
        return () => {
            active = false;
        };
    }, [isConfigOpen, message, refreshModelConfiguration, refreshObjectStorages, resetAllDrafts]);

    useEffect(() => {
        if (user?.role !== "admin" && isConfigOpen) setConfigDialogOpen(false);
    }, [isConfigOpen, setConfigDialogOpen, user?.role]);

    const draftConfig = useMemo(() => configFromModelConfigs(draftChannels, draftModelConfigs, config), [config, draftChannels, draftModelConfigs]);
    const modelOptions = useMemo(() => draftConfig.models.map((model) => ({ label: modelOptionLabelWithRealName(draftConfig, model), value: model })), [draftConfig]);
    const channelsDirty = !sameValue(draftChannels, channelBaseline);
    const modelConfigsDirty = !sameValue(draftModelConfigs, modelConfigBaseline);
    const objectStoragesDirty = !sameValue(draftObjectStorages, objectStorageBaseline);
    const creditsDirty = draftInitialCredits !== creditBaseline;
    const hasUnsavedChanges = channelsDirty || modelConfigsDirty || objectStoragesDirty || creditsDirty;
    const isSaving = Boolean(savingTab);

    const updateDraftChannel = (id: string, patch: Partial<ModelChannel>) => {
        setDraftChannels((channels) => channels.map((channel) => (channel.id === id ? { ...channel, ...patch, models: patch.models ? uniqueModels(patch.models) : channel.models } : channel)));
    };

    const updateChannelApiFormat = (channel: ModelChannel, apiFormat: ApiCallFormat) => {
        const baseUrl = !channel.baseUrl.trim() || channel.baseUrl.trim() === defaultBaseUrlForApiFormat(channel.apiFormat) ? defaultBaseUrlForApiFormat(apiFormat) : channel.baseUrl;
        updateDraftChannel(channel.id, { apiFormat, baseUrl });
    };

    const addChannel = () => {
        const channel = createModelChannel({ name: `渠道 ${draftChannels.length + 1}` });
        setDraftChannels((channels) => [channel, ...channels]);
        setCollapsedChannelIds((ids) => ids.filter((id) => id !== channel.id));
    };

    const removeChannel = (id: string) => {
        modal.confirm({
            title: "确认删除",
            content: "该渠道会在点击保存后从服务端删除。",
            okText: "删除",
            okType: "danger",
            cancelText: "取消",
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
            message.error("请先填写该渠道的 Base URL 和 API Key");
            return;
        }
        setLoadingChannelId(channel.id);
        try {
            const result = await refreshServerChannelModels(channel);
            updateDraftChannel(channel.id, { models: result.models });
            message.success(`${channel.name} 模型列表已更新，请点击保存`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取模型失败");
        } finally {
            setLoadingChannelId("");
        }
    };

    const saveChannels = async () => {
        const baselineById = new Map(channelBaseline.map((channel) => [channel.id, channel]));
        const draftIds = new Set(draftChannels.map((channel) => channel.id));
        const deletedChannels = channelBaseline.filter((channel) => !draftIds.has(channel.id));
        if (deletedChannels.some((channel) => modelConfigBaseline.some((model) => model.channelId === channel.id))) {
            message.error("请先在“我的模型”中删除关联模型并保存，再删除渠道");
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
            message.success("渠道配置已保存");
        } catch (error) {
            await refreshChannels().catch(() => undefined);
            setChannelBaseline(cloneChannels(useConfigStore.getState().config.channels));
            message.error(error instanceof Error ? error.message : "保存渠道配置失败");
        } finally {
            setSavingTab("");
        }
    };

    const updateCapabilityModels = (group: ModelGroup, models: string[]) => {
        const values = uniqueModels(models.map((model) => normalizeModelOptionValue(model, draftChannels)).filter(Boolean));
        if (values.some((value) => !value.includes("::"))) {
            message.warning("请先在“我的渠道”中添加模型，再配置可选模型");
            return;
        }
        setDraftModelConfigs((configs) => {
            const existing = new Map(configs.filter((configItem) => configItem.modelType === group.capability).map((configItem) => [modelConfigValue(configItem), configItem]));
            const next = values.map((value) => {
                const [channelId, modelName] = value.split("::");
                return existing.get(value) || createDraftModelConfig(channelId, modelName, group.capability);
            });
            const added = next.filter((configItem) => !existing.has(modelConfigValue(configItem))).reverse();
            const selected = new Set(values);
            const retained = configs.filter((configItem) => configItem.modelType === group.capability && selected.has(modelConfigValue(configItem)));
            return [...configs.filter((configItem) => configItem.modelType !== group.capability), ...added, ...retained];
        });
    };

    const openModelConfigEditor = (configItem: ServerModelConfig) => {
        setEditingModelConfig(cloneModelConfig(configItem));
        setEditingCustomBodyParameters(JSON.stringify(configItem.customBodyParameters || {}, null, 2));
    };

    const updateEditingModelConfig = (patch: Partial<ServerModelConfig>) => {
        setEditingModelConfig((configItem) => (configItem ? { ...configItem, ...patch } : configItem));
    };

    const saveModelConfigEditor = () => {
        if (!editingModelConfig) return;
        let customBodyParameters: Record<string, unknown>;
        try {
            const parsed = JSON.parse(editingCustomBodyParameters.trim() || "{}");
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("模型自定义JSON必须是对象");
            customBodyParameters = parsed as Record<string, unknown>;
        } catch (error) {
            message.error(error instanceof Error ? error.message : "模型自定义JSON格式不正确");
            return;
        }
        const nextConfig = {
            ...editingModelConfig,
            customBodyParameters,
            displayName: editingModelConfig.displayName === editingModelConfig.modelName ? null : editingModelConfig.displayName,
        };
        setDraftModelConfigs((configs) => configs.map((configItem) => (configItem.id === nextConfig.id ? nextConfig : configItem)));
        setEditingModelConfig(null);
    };

    const formatEditingCustomBodyParameters = () => {
        try {
            const parsed = JSON.parse(editingCustomBodyParameters.trim() || "{}");
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("模型自定义JSON必须是对象");
            setEditingCustomBodyParameters(JSON.stringify(parsed, null, 2));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "模型自定义JSON格式不正确");
        }
    };

    const toggleModelCapabilityCollapsed = (modelType: ModelCapability) => {
        setCollapsedModelCapabilityTypes((types) => (types.includes(modelType) ? types.filter((type) => type !== modelType) : [...types, modelType]));
    };

    const setDefaultDraftModel = (modelType: ModelCapability, model: string) => {
        setDraftModelConfigs((configs) => configs.map((configItem) => (configItem.modelType === modelType ? { ...configItem, defaultModel: modelConfigValue(configItem) === model } : configItem)));
    };

    const saveModelConfigs = async () => {
        const persistedChannels = new Map(channelBaseline.map((channel) => [channel.id, channel]));
        const hasUnsavedChannelDependency = draftModelConfigs.some((configItem) => {
            const channel = persistedChannels.get(configItem.channelId);
            return !channel || !channel.models.includes(configItem.modelName);
        });
        if (hasUnsavedChannelDependency) {
            message.error("模型配置引用了未保存的渠道或模型，请先保存“我的渠道”");
            return;
        }
        const baselineById = new Map(modelConfigBaseline.map((configItem) => [configItem.id, configItem]));
        const draftIds = new Set(draftModelConfigs.map((configItem) => configItem.id));
        let nextDrafts = draftModelConfigs;
        setSavingTab("models");
        try {
            const createdConfigIds = new Map<string, string>();
            for (const configItem of draftModelConfigs) {
                if (baselineById.has(configItem.id)) continue;
                const normalizedConfig = normalizeModelConfigForSave(configItem);
                const saved = await createModelConfig({
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
                    customBodyParameters: normalizedConfig.customBodyParameters,
                    videoBillingConfiguration: normalizedConfig.videoBillingConfiguration,
                    displayName: normalizedConfig.displayName,
                });
                createdConfigIds.set(configItem.id, saved.id);
            }
            if (createdConfigIds.size) {
                nextDrafts = draftModelConfigs.map((configItem) => {
                    const id = createdConfigIds.get(configItem.id);
                    return id ? { ...configItem, id } : configItem;
                });
                setDraftModelConfigs(nextDrafts);
            }
            for (const configItem of nextDrafts) {
                const baseline = baselineById.get(configItem.id);
                if (baseline && !sameModelConfigForUpdate(configItem, baseline)) {
                    const normalizedConfig = normalizeModelConfigForSave(configItem);
                    await updateModelConfig({
                        id: normalizedConfig.id,
                        modelType: normalizedConfig.modelType,
                        capabilities: normalizedConfig.capabilities,
                        sortOrder: normalizedConfig.sortOrder,
                        creditCost: normalizedConfig.creditCost,
                        creditUnit: normalizedConfig.creditUnit,
                        thinkingEnabled: normalizedConfig.thinkingEnabled,
                        reasoningEffort: normalizedConfig.reasoningEffort,
                        requestConcurrency: normalizedConfig.requestConcurrency,
                        customBodyParameters: normalizedConfig.customBodyParameters,
                        videoBillingConfiguration: normalizedConfig.videoBillingConfiguration,
                        displayName: normalizedConfig.displayName,
                    });
                }
            }
            for (const group of modelGroups) {
                const nextDefault = nextDrafts.find((configItem) => configItem.modelType === group.capability && configItem.defaultModel);
                const currentDefault = modelConfigBaseline.find((configItem) => configItem.modelType === group.capability && configItem.defaultModel);
                if (nextDefault && nextDefault.id !== currentDefault?.id) await setDefaultModel(nextDefault.id, group.capability);
            }
            for (const configItem of modelConfigBaseline) {
                if (!draftIds.has(configItem.id)) await deleteModelConfig(configItem.id);
            }
            await refreshModelConfiguration();
            resetModelConfigDraft();
            message.success("模型配置已保存");
        } catch (error) {
            await refreshModelConfiguration().catch(() => undefined);
            setModelConfigBaseline(cloneModelConfigs(useConfigStore.getState().modelConfigs));
            setDraftModelConfigs(nextDrafts);
            message.error(error instanceof Error ? error.message : "保存模型配置失败");
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
            message.success("积分设置已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存积分设置失败");
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
            name: `对象存储 ${draftObjectStorages.length + 1}`,
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
            message.warning("至少保留一个对象存储");
            return;
        }
        if (storage.defaultStorage) {
            message.warning("默认对象存储不能删除，请先设置其他默认项");
            return;
        }
        modal.confirm({
            title: "确认删除",
            content: "该对象存储会在点击保存后从服务端删除。",
            okText: "删除",
            okType: "danger",
            cancelText: "取消",
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
            message.success("对象存储配置已刷新");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "刷新对象存储失败");
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
            title: "放弃未保存修改？",
            content: "刷新会丢弃对象存储 Tab 中的未保存修改。",
            okText: "放弃并刷新",
            okType: "danger",
            cancelText: "取消",
            onOk: refreshObjectStorageDrafts,
        });
    };

    const saveObjectStorages = async () => {
        const persistedStorageIds = new Set(objectStorageBaseline.filter((storage) => storage.id !== "default").map((storage) => storage.id));
        const baselineById = new Map(objectStorageBaseline.map((storage) => [storage.id, storage]));
        const draftIds = new Set(draftObjectStorages.map((storage) => storage.id));
        const selectedDefault = draftObjectStorages.find((storage) => storage.defaultStorage);
        if (!selectedDefault) {
            message.error("请设置默认对象存储");
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
            message.success("对象存储配置已保存");
        } catch (error) {
            await refreshObjectStorages().catch(() => undefined);
            setObjectStorageBaseline(cloneObjectStorages(useConfigStore.getState().objectStorages));
            setDraftObjectStorages(nextDrafts);
            message.error(error instanceof Error ? error.message : "保存对象存储失败");
        } finally {
            setSavingTab("");
        }
    };

    const testObjectStorage = async (storageId: string) => {
        if (objectStoragesDirty) {
            message.warning("请先保存对象存储配置，再执行测试上传");
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
            message.success("对象存储测试上传成功，请点击保存记录测试时间");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "对象存储测试上传失败");
        } finally {
            setTestingObjectStorageId("");
        }
    };

    const changeActiveTab = (tabKey: string) => {
        const nextTab = tabKey as ConfigDialogTabKey;
        setActiveTab(nextTab);
        setConfigDialogTab(nextTab);
    };

    const closeConfigDialog = () => {
        if (!hasUnsavedChanges) {
            setConfigDialogOpen(false);
            return;
        }
        modal.confirm({
            title: "放弃未保存修改？",
            content: "关闭后会丢弃所有 Tab 中未保存的修改。",
            okText: "放弃修改",
            okType: "danger",
            cancelText: "继续编辑",
            onOk: () => setConfigDialogOpen(false),
        });
    };

    if (user?.role !== "admin") return null;

    return (
        <Modal title={<div className="text-lg font-semibold">配置与用户偏好</div>} open={isConfigOpen} width={980} centered onCancel={closeConfigDialog} footer={null} styles={{ body: { height: "72vh", overflowY: "auto", paddingRight: 12 } }}>
            {!draftsReady ? (
                <div className="flex h-40 items-center justify-center text-sm text-[var(--studio-muted)]">正在加载配置...</div>
            ) : (
                <Tabs
                    activeKey={activeTab}
                    tabPlacement="start"
                    tabBarStyle={{ width: 112 }}
                    onChange={changeActiveTab}
                    items={[
                        {
                            key: "channels",
                            label: "我的渠道",
                            children: (
                                <Form layout="vertical" requiredMark={false}>
                                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-3">
                                        <div className="min-w-0 flex-1">
                                            <span>在这里配置生成任务使用的渠道 API。</span>
                                        </div>
                                        <div className="flex shrink-0 gap-2">
                                            <Button type="primary" disabled={!channelsDirty || isSaving} loading={savingTab === "channels"} onClick={() => void saveChannels()}>
                                                保存
                                            </Button>
                                            <Button icon={<Plus className="size-4" />} disabled={isSaving} onClick={addChannel}>
                                                新增渠道
                                            </Button>
                                        </div>
                                    </div>
                                    <div className="space-y-3">
                                        {draftChannels.map((channel) => {
                                            const collapsed = collapsedChannelIds.includes(channel.id);
                                            return (
                                                <section key={channel.id} className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-panel)] p-3">
                                                    <div className={collapsed ? "flex items-center justify-between gap-3" : "mb-3 flex items-center justify-between gap-3"}>
                                                        <div className="min-w-0">
                                                            <div className="truncate text-sm font-semibold">{channel.name || "未命名渠道"}</div>
                                                            <div className="mt-1 text-xs text-[var(--studio-muted)]">
                                                                {apiFormatLabel(channel.apiFormat)} · 已配置 {channel.models.length} 个模型
                                                            </div>
                                                        </div>
                                                        <div className="flex shrink-0 gap-2">
                                                            <Button size="small" icon={collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />} onClick={() => toggleChannelCollapsed(channel.id)}>
                                                                {collapsed ? "展开" : "收起"}
                                                            </Button>
                                                            <Button
                                                                size="small"
                                                                disabled={isSaving || channel.apiFormat === "minimax"}
                                                                loading={loadingChannelId === channel.id}
                                                                title={channel.apiFormat === "minimax" ? "MiniMax 请手动配置 MiniMax-H3" : undefined}
                                                                onClick={() => void refreshChannelModels(channel)}
                                                            >
                                                                拉取模型
                                                            </Button>
                                                            <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={isSaving} onClick={() => removeChannel(channel.id)} />
                                                        </div>
                                                    </div>
                                                    {collapsed ? null : (
                                                        <div className="grid gap-4 md:grid-cols-2">
                                                            <Form.Item label="渠道名称" className="mb-0">
                                                                <Input value={channel.name} disabled={isSaving} onChange={(event) => updateDraftChannel(channel.id, { name: event.target.value })} />
                                                            </Form.Item>
                                                            <Form.Item label="调用格式" className="mb-0">
                                                                <Select value={channel.apiFormat} disabled={isSaving} options={apiFormatOptions} onChange={(value: ApiCallFormat) => updateChannelApiFormat(channel, value)} />
                                                            </Form.Item>
                                                            <Form.Item label="Base URL" className="mb-0">
                                                                <Input value={channel.baseUrl} disabled={isSaving} onChange={(event) => updateDraftChannel(channel.id, { baseUrl: event.target.value })} />
                                                            </Form.Item>
                                                            <Form.Item label="API Key" className="mb-0">
                                                                <Input.Password value={channel.apiKey} disabled={isSaving} onChange={(event) => updateDraftChannel(channel.id, { apiKey: event.target.value })} />
                                                            </Form.Item>
                                                            <Form.Item label="模型列表" className="mb-0 md:col-span-2">
                                                                <Select
                                                                    mode="tags"
                                                                    showSearch
                                                                    allowClear
                                                                    maxTagCount="responsive"
                                                                    placeholder={channel.apiFormat === "minimax" ? "请输入 MiniMax-H3" : "输入模型名，或点击拉取模型"}
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
                            label: "我的模型",
                            children: (
                                <Form layout="vertical" requiredMark={false}>
                                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-3">
                                        <div>
                                            <div className="text-sm font-semibold">默认模型和可选项</div>
                                            <div className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">可选项决定各处下拉框展示哪些模型；同名模型会以括号里的展示名或渠道名区分。</div>
                                        </div>
                                        <Button type="primary" disabled={!modelConfigsDirty || isSaving} loading={savingTab === "models"} onClick={() => void saveModelConfigs()}>
                                            保存
                                        </Button>
                                    </div>
                                    <div className="grid gap-4 md:grid-cols-2">
                                        {modelGroups.map((group) => (
                                            <Form.Item key={group.modelsKey} label={group.optionsLabel} className="mb-0">
                                                <Select
                                                    mode="tags"
                                                    showSearch
                                                    allowClear
                                                    maxTagCount="responsive"
                                                    placeholder={draftConfig.models.length ? `请选择或输入${group.optionsLabel}` : "先到渠道里填写或拉取模型"}
                                                    value={draftConfig[group.modelsKey]}
                                                    options={modelOptions}
                                                    disabled={isSaving}
                                                    onChange={(models) => updateCapabilityModels(group, models)}
                                                />
                                            </Form.Item>
                                        ))}
                                    </div>
                                    <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                        {modelGroups.map((group) => (
                                            <Form.Item key={group.modelKey} label={group.defaultLabel} className="mb-0">
                                                <div className={isSaving ? "pointer-events-none opacity-60" : ""}>
                                                    <ModelPicker config={draftConfig} value={draftConfig[group.modelKey]} onChange={(model) => setDefaultDraftModel(group.capability, model)} capability={group.capability} fullWidth showRealName />
                                                </div>
                                            </Form.Item>
                                        ))}
                                    </div>
                                    <div className="mt-6 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-3">
                                        <div className="text-sm font-semibold">模型能力配置</div>
                                        <div className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">点击模型后的编辑按钮配置展示名称、积分、能力与自定义 JSON 参数。</div>
                                        <div className="mt-3 space-y-4">
                                            {capabilityGroups.map((group) => {
                                                const models = draftConfig[group.modelsKey];
                                                if (!models.length) return null;
                                                const collapsed = collapsedModelCapabilityTypes.includes(group.capability);
                                                return (
                                                    <div key={group.capability}>
                                                        <div className="mb-2 flex items-center justify-between gap-3">
                                                            <div className="text-xs font-medium text-[var(--studio-muted)]">{group.label}</div>
                                                            <Button size="small" icon={collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />} onClick={() => toggleModelCapabilityCollapsed(group.capability)}>
                                                                {collapsed ? "展开" : "收起"}
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
                                                                                {modelConfig.defaultModel ? <span className="text-xs text-[var(--studio-muted)]">默认</span> : null}
                                                                                <Button size="small" icon={<Pencil className="size-3.5" />} disabled={isSaving} onClick={() => openModelConfigEditor(modelConfig)}>
                                                                                    编辑
                                                                                </Button>
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
                            label: "积分设置",
                            children: (
                                <Form layout="vertical" requiredMark={false} className="max-w-xl">
                                    <div className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4">
                                        <div className="text-sm font-semibold">新用户初始积分</div>
                                        <div className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">仅影响之后注册、后台创建或首次第三方登录的新用户，已有用户积分不会自动变更。</div>
                                        <div className="mt-5 flex flex-wrap items-end gap-3">
                                            <Form.Item label="初始积分" className="mb-0">
                                                <InputNumber min={0} precision={0} value={draftInitialCredits} disabled={isSaving} className="w-40" onChange={(value) => setDraftInitialCredits(Math.max(0, Number(value) || 0))} />
                                            </Form.Item>
                                            <Button type="primary" disabled={!creditsDirty || isSaving} loading={savingTab === "credits"} onClick={() => void saveCreditSettings()}>
                                                保存
                                            </Button>
                                        </div>
                                    </div>
                                </Form>
                            ),
                        },
                        {
                            key: "objectStorage",
                            label: "对象存储",
                            children: (
                                <Form layout="vertical" requiredMark={false}>
                                    <div className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-3">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 text-sm font-semibold">
                                                <CloudUpload className="size-4" />
                                                云储存
                                            </div>
                                            <div className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">密钥会加密保存到服务端，默认对象存储用于后端上传生成结果和素材文件。</div>
                                        </div>
                                        <div className="flex shrink-0 gap-2">
                                            <Button icon={<RefreshCw className="size-4" />} disabled={isSaving} loading={refreshingObjectStorages} onClick={handleRefreshObjectStorages}>
                                                刷新
                                            </Button>
                                            <Button type="primary" disabled={!objectStoragesDirty || isSaving} loading={savingTab === "objectStorage"} onClick={() => void saveObjectStorages()}>
                                                保存
                                            </Button>
                                            <Button icon={<Plus className="size-4" />} disabled={isSaving} onClick={addObjectStorage}>
                                                新增
                                            </Button>
                                        </div>
                                    </div>
                                    <div className="space-y-3">
                                        {draftObjectStorages.map((storage) => {
                                            const collapsed = collapsedObjectStorageIds.includes(storage.id);
                                            const providerFields = objectStorageProviderFields[storage.provider];
                                            return (
                                                <section key={storage.id} className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-panel)] p-3">
                                                    <div className={collapsed ? "flex items-center justify-between gap-3" : "mb-3 flex items-center justify-between gap-3"}>
                                                        <div className="min-w-0">
                                                            <div className="truncate text-sm font-semibold">{storage.name || "未命名对象存储"}</div>
                                                            <div className="mt-1 text-xs text-[var(--studio-muted)]">
                                                                {storage.defaultStorage ? "默认 · " : ""}
                                                                {storage.lastTestedAt ? `上次测试 ${formatTimestamp(storage.lastTestedAt)}` : "尚未测试"}
                                                            </div>
                                                        </div>
                                                        <div className="flex shrink-0 gap-2">
                                                            <Button size="small" icon={collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />} onClick={() => toggleObjectStorageCollapsed(storage.id)}>
                                                                {collapsed ? "展开" : "收起"}
                                                            </Button>
                                                            <Button size="small" disabled={storage.defaultStorage || isSaving} onClick={() => setDraftDefaultObjectStorage(storage.id)}>
                                                                设为默认
                                                            </Button>
                                                            <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={isSaving} onClick={() => removeObjectStorage(storage.id)} />
                                                        </div>
                                                    </div>
                                                    {collapsed ? null : (
                                                        <div className="grid gap-4 md:grid-cols-2">
                                                            <Form.Item label="配置名称" className="mb-0">
                                                                <Input value={storage.name} disabled={isSaving} onChange={(event) => updateDraftObjectStorage(storage.id, { name: event.target.value })} />
                                                            </Form.Item>
                                                            <Form.Item label="服务商" className="mb-0">
                                                                <Select
                                                                    value={storage.provider}
                                                                    options={objectStorageProviderOptions}
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
                                                            <Form.Item label="存储目录" extra="上传 Key 规则：目录/images 或 videos/日期/文件名。" className="mb-0">
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
                                                                        options={qiniuRegionOptions}
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
                                                                <Form.Item label="Endpoint" extra="必须填写包含 http:// 或 https:// 的 OSS Endpoint。" className="mb-0 md:col-span-2">
                                                                    <Input
                                                                        value={storage.endpoint}
                                                                        placeholder="https://oss-cn-hangzhou.aliyuncs.com"
                                                                        disabled={isSaving}
                                                                        onChange={(event) => updateDraftObjectStorage(storage.id, { endpoint: event.target.value })}
                                                                    />
                                                                </Form.Item>
                                                            ) : null}
                                                            <Form.Item label="公开访问地址" required={storage.provider === "qiniuKodo"} extra={providerFields.publicBaseUrlExtra} className="mb-0 md:col-span-2">
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
                                                            测试上传
                                                        </Button>
                                                        {objectStorageTestUrl && testedObjectStorageId === storage.id ? (
                                                            <Button type="link" className="h-auto p-0 text-xs" href={objectStorageTestUrl} target="_blank" rel="noreferrer">
                                                                打开测试文件
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
                    ]}
                />
            )}
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
                                <div className="text-lg font-semibold">{modelOptionLabelWithRealName(draftConfig, modelConfigValue(editingModelConfig))} 配置</div>
                                {editingModelConfig.modelType === "video" ? <div className="mt-0.5 text-xs font-normal text-[var(--studio-muted)]">配置模型的计费方式、分辨率价格及功能支持</div> : null}
                            </div>
                        </div>
                    ) : (
                        "模型配置"
                    )
                }
                open={Boolean(editingModelConfig)}
                centered
                width={editingModelConfig?.modelType === "video" ? 980 : 760}
                destroyOnHidden
                okText="确认"
                cancelText="取消"
                onCancel={() => setEditingModelConfig(null)}
                onOk={saveModelConfigEditor}
            >
                {editingModelConfig?.modelType === "video" && editingModelIsMedia ? (
                    <div className="space-y-5">
                        <section className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4">
                            <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                                展示名称 <Info className="size-4 text-[var(--studio-muted)]" />
                            </div>
                            <Input
                                maxLength={255}
                                placeholder={editingModelConfig.modelName}
                                value={editingModelConfig.displayName || editingModelConfig.modelName}
                                onChange={(event) => updateEditingModelConfig({ displayName: event.target.value.trim() || null })}
                            />
                            <p className="mt-2 text-xs text-[var(--studio-muted)]">展示给用户看的名称，默认与真实模型名一致，仅影响展示不影响调用。</p>
                        </section>

                        <section className="grid gap-4 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4 md:grid-cols-2">
                            <div>
                                <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                                    计费方式 <Info className="size-4 text-[var(--studio-muted)]" />
                                </div>
                                <Select
                                    value={editingModelConfig.videoBillingConfiguration?.billingUnit || "generation"}
                                    options={[
                                        { value: "generation", label: "按次" },
                                        { value: "second", label: "按秒" },
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
                                    {editingModelConfig.videoBillingConfiguration?.billingUnit === "second" ? "每延生成时长（秒）" : "最短生成时长（秒）"} <Info className="size-4 text-[var(--studio-muted)]" />
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
                                    <Button disabled className="pointer-events-none">秒</Button>
                                </Space.Compact>
                            </div>
                        </section>

                        <section className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4">
                            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <div className="flex items-center gap-1.5 text-base font-semibold">
                                        功能类型与分辨率价格 <Info className="size-4 text-[var(--studio-muted)]" />
                                    </div>
                                    <p className="mt-1 text-xs text-[var(--studio-muted)]">设置模型支持的功能类型及各分辨率的积分消耗价格</p>
                                </div>
                                <span className="rounded-md border border-[var(--studio-line)] px-2.5 py-1 text-xs text-[var(--studio-muted)]">
                                    价格说明：{editingModelConfig.videoBillingConfiguration?.billingUnit === "second" ? "积分/秒" : "积分/次"}
                                </span>
                            </div>
                            <div className="space-y-4">
                                {VIDEO_GENERATION_MODE_OPTIONS.map((mode, index) => {
                                    const prices = editingModelConfig.videoBillingConfiguration?.modePrices?.[mode.value] || {};
                                    const modeEnabled = editingModelConfig.capabilities.includes(mode.value);
                                    const modeIcon = index === 0 ? <TextCursorInput className="size-5" /> : index === 1 ? <Image className="size-5" /> : <Sparkles className="size-5" />;
                                    const modeColor = index === 0 ? "border-violet-500/50 bg-violet-500/5" : index === 1 ? "border-blue-500/50 bg-blue-500/5" : "border-emerald-500/50 bg-emerald-500/5";
                                    const iconColor = index === 0 ? "bg-violet-500/15 text-violet-500" : index === 1 ? "bg-blue-500/15 text-blue-500" : "bg-emerald-500/15 text-emerald-500";
                                    const description = index === 0 ? "根据文本描述生成视频" : index === 1 ? "根据图片生成视频" : "支持文本、图片及多模态参考生成视频";
                                    return (
                                        <div key={mode.value} className={`rounded-lg border p-4 transition-colors ${modeEnabled ? modeColor : "border-[var(--studio-line)] opacity-70"}`}>
                                            <div className="flex items-start justify-between gap-4 border-b border-[var(--studio-line)] pb-3">
                                                <div className="flex min-w-0 items-center gap-3">
                                                    <span className={`flex size-10 shrink-0 items-center justify-center rounded-md ${iconColor}`}>{modeIcon}</span>
                                                    <div>
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <span className="font-semibold">{mode.label}</span>
                                                            {modeEnabled ? (
                                                                <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">已启用</span>
                                                            ) : (
                                                                <span className="rounded bg-[var(--studio-panel)] px-2 py-0.5 text-xs text-[var(--studio-muted)]">未启用</span>
                                                            )}
                                                        </div>
                                                        <p className="mt-1 text-xs text-[var(--studio-muted)]">{description}</p>
                                                    </div>
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
                                                <div className="mb-2 text-xs font-medium text-[var(--studio-muted)]">分辨率价格（{editingModelConfig.videoBillingConfiguration?.billingUnit === "second" ? "积分/秒" : "积分/次"}）</div>
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
                                                                    placeholder="未配置"
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
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>

                        <div className="grid gap-5 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
                            <section>
                                <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                                    同时并发数 <Info className="size-4 text-[var(--studio-muted)]" />
                                </div>
                                <div className="flex items-center gap-2">
                                    <InputNumber min={1} precision={0} value={editingModelConfig.requestConcurrency} className="w-52" onChange={(value) => updateEditingModelConfig({ requestConcurrency: Math.max(1, Math.floor(Number(value) || 1)) })} />
                                    <span className="text-sm text-[var(--studio-muted)]">个任务</span>
                                </div>
                            </section>
                            <section>
                                <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold">模型能力</div>
                                <div className="flex flex-wrap gap-2">
                                    {VIDEO_GENERATION_MODE_OPTIONS.filter((option) => editingModelConfig.capabilities.includes(option.value)).map((option) => (
                                        <span key={option.value} className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-600 dark:text-emerald-400">
                                            <CheckCircle2 className="size-3.5" />
                                            {option.label}
                                        </span>
                                    ))}
                                    {!editingModelConfig.capabilities.length ? <span className="text-xs text-[var(--studio-muted)]">尚未启用视频生成能力</span> : null}
                                </div>
                            </section>
                        </div>

                        <section className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-1.5 text-sm font-semibold">
                                    自定义 JSON（可选） <Info className="size-4 text-[var(--studio-muted)]" />
                                </div>
                                <Button size="small" icon={<Braces className="size-3.5" />} onClick={formatEditingCustomBodyParameters}>
                                    格式化
                                </Button>
                            </div>
                            <Input.TextArea value={editingCustomBodyParameters} autoSize={{ minRows: 5, maxRows: 12 }} spellCheck={false} className="font-mono text-xs" onChange={(event) => setEditingCustomBodyParameters(event.target.value)} />
                            <p className="mt-2 text-xs text-[var(--studio-muted)]">仅在 JSON 格式的 POST 请求中合并；同名字段覆盖系统参数。</p>
                        </section>
                    </div>
                ) : editingModelConfig ? (
                    <Form layout="vertical" requiredMark={false}>
                        <Form.Item label="展示名称" extra="展示给用户看的名称，默认与真实模型名一致，仅影响展示不影响调用。">
                            <Input
                                maxLength={255}
                                placeholder={editingModelConfig.modelName}
                                value={editingModelConfig.displayName || editingModelConfig.modelName}
                                onChange={(event) => updateEditingModelConfig({ displayName: event.target.value.trim() || null })}
                            />
                        </Form.Item>
                        {editingModelConfig.modelType !== "video" ? (
                            <Form.Item label="每次积分">
                                <InputNumber min={0} precision={0} value={editingModelConfig.creditCost} className="w-full" onChange={(value) => updateEditingModelConfig({ creditCost: Math.max(0, Number(value) || 0) })} />
                            </Form.Item>
                        ) : null}
                        {editingModelConfig.modelType === "image" ? (
                            <Form.Item label="同时并发数">
                                <InputNumber min={1} precision={0} value={editingModelConfig.requestConcurrency} className="w-full" onChange={(value) => updateEditingModelConfig({ requestConcurrency: Math.max(1, Math.floor(Number(value) || 1)) })} />
                            </Form.Item>
                        ) : null}
                        <Form.Item label="模型能力">
                            <div className="flex flex-wrap gap-x-4 gap-y-2">
                                {MODEL_CAPABILITY_OPTIONS[editingModelConfig.modelType].map((option) => (
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
                        </Form.Item>
                        {editingModelConfig.modelType === "text" && isOpenAiTextModel(editingModelConfig, draftChannels) ? (
                            <>
                                <Form.Item label="开启思考模式">
                                    <Switch checked={editingModelConfig.thinkingEnabled} onChange={(thinkingEnabled) => updateEditingModelConfig({ thinkingEnabled })} />
                                </Form.Item>
                                <Form.Item label="思考强度">
                                    <Select
                                        value={editingModelConfig.reasoningEffort}
                                        disabled={isReasoningEffortDisabled(false, editingModelConfig.thinkingEnabled)}
                                        options={reasoningEffortOptions}
                                        onChange={(reasoningEffort: "high" | "max") => updateEditingModelConfig({ reasoningEffort })}
                                    />
                                </Form.Item>
                            </>
                        ) : null}
                        <Form.Item label="自定义 JSON" extra="仅在 JSON 格式的 POST 请求中合并；同名字段覆盖系统参数。">
                            <Input.TextArea value={editingCustomBodyParameters} autoSize={{ minRows: 5, maxRows: 12 }} spellCheck={false} onChange={(event) => setEditingCustomBodyParameters(event.target.value)} />
                        </Form.Item>
                    </Form>
                ) : null}
            </Modal>
        </Modal>
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
        videoBillingConfiguration: config.modelType === "video" ? cloneVideoBillingConfiguration(config.videoBillingConfiguration || createVideoBillingConfiguration()) : null,
    };
}

function normalizeModelConfigForSave(config: ServerModelConfig): ServerModelConfig {
    const supportedCapabilities = new Set(MODEL_CAPABILITY_OPTIONS[config.modelType].map((option) => option.value));
    const capabilities = config.capabilities.filter((capability) => supportedCapabilities.has(capability));
    const videoBillingConfiguration = config.modelType === "video" && config.videoBillingConfiguration
        ? {
              ...config.videoBillingConfiguration,
              modePrices: Object.fromEntries(
                  Object.entries(config.videoBillingConfiguration.modePrices || {}).filter(([mode]) => supportedCapabilities.has(mode) && capabilities.includes(mode)),
              ) as VideoBillingConfiguration["modePrices"],
          }
        : config.videoBillingConfiguration;
    return {
        ...config,
        capabilities,
        videoBillingConfiguration,
    };
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
        customBodyParameters: {},
        videoBillingConfiguration: modelType === "video" ? createVideoBillingConfiguration() : null,
        displayName: null,
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
        first.thinkingEnabled === second.thinkingEnabled &&
        first.reasoningEffort === second.reasoningEffort &&
        (first.displayName || null) === (second.displayName || null) &&
        sameValue(first.capabilities, second.capabilities) &&
        sameValue(first.customBodyParameters, second.customBodyParameters) &&
        sameValue(first.videoBillingConfiguration, second.videoBillingConfiguration)
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

function apiFormatLabel(apiFormat: ApiCallFormat) {
    if (apiFormat === "newapi") return "New API";
    if (apiFormat === "evolink") return "Evolink";
    if (apiFormat === "agnes") return "Agnes";
    if (apiFormat === "gemini") return "Gemini";
    if (apiFormat === "anthropic") return "Anthropic";
    if (apiFormat === "seedance") return "Seedance";
    if (apiFormat === "minimax") return "MiniMax";
    return "OpenAI";
}

function formatTimestamp(value: string) {
    return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function isDefaultObjectStoragePlaceholder(storage: ObjectStorageConfig | undefined) {
    return storage?.id === "default" && storage.name === "默认对象存储" && storage.directory === "novanova-studio" && !storage.accessKey && !storage.secretKey && !storage.bucket && !storage.region && !storage.endpoint && !storage.publicBaseUrl;
}
