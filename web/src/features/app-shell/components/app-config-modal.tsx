"use client";

import { App, Button, Checkbox, Form, Input, InputNumber, Modal, Select, Switch, Tabs } from "antd";
import { nanoid } from "nanoid";
import { ChevronDown, ChevronUp, CloudUpload, Plus, RefreshCw, Trash2, Wifi } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useUserStore } from "@/features/auth/stores/use-user-store";
import { ModelPicker } from "@/features/settings/components/model-picker";
import {
    configFromModelConfigs,
    createModelChannel,
    createObjectStorageConfig,
    defaultBaseUrlForApiFormat,
    MODEL_CAPABILITY_OPTIONS,
    modelOptionLabel,
    normalizeModelOptionValue,
    useConfigStore,
    type ApiCallFormat,
    type ConfigDialogTabKey,
    type ModelCapability,
    type ModelChannel,
} from "@/features/settings/stores/use-config-store";
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
    const [collapsedObjectStorageIds, setCollapsedObjectStorageIds] = useState<string[]>([]);
    const [channelBaseline, setChannelBaseline] = useState<ModelChannel[]>([]);
    const [draftChannels, setDraftChannels] = useState<ModelChannel[]>([]);
    const [modelConfigBaseline, setModelConfigBaseline] = useState<ServerModelConfig[]>([]);
    const [draftModelConfigs, setDraftModelConfigs] = useState<ServerModelConfig[]>([]);
    const [objectStorageBaseline, setObjectStorageBaseline] = useState<ObjectStorageConfig[]>([]);
    const [draftObjectStorages, setDraftObjectStorages] = useState<ObjectStorageConfig[]>([]);
    const [creditBaseline, setCreditBaseline] = useState(100);
    const [draftInitialCredits, setDraftInitialCredits] = useState(100);
    const initializedRef = useRef(false);

    const resetChannelDraft = useCallback((resetCollapsed = false) => {
        const channels = cloneChannels(useConfigStore.getState().config.channels);
        setChannelBaseline(channels);
        setDraftChannels(cloneChannels(channels));
        if (resetCollapsed) setCollapsedChannelIds(channels.slice(1).map((channel) => channel.id));
    }, []);

    const resetModelConfigDraft = useCallback(() => {
        const configs = cloneModelConfigs(useConfigStore.getState().modelConfigs);
        setModelConfigBaseline(configs);
        setDraftModelConfigs(cloneModelConfigs(configs));
    }, []);

    const resetObjectStorageDraft = useCallback((resetCollapsed = false) => {
        const storages = cloneObjectStorages(useConfigStore.getState().objectStorages);
        setObjectStorageBaseline(storages);
        setDraftObjectStorages(cloneObjectStorages(storages));
        if (resetCollapsed) setCollapsedObjectStorageIds(storages.slice(1).map((storage) => storage.id));
    }, []);

    const resetAllDrafts = useCallback(() => {
        resetChannelDraft(true);
        resetModelConfigDraft();
        resetObjectStorageDraft(true);
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
    const modelOptions = useMemo(() => draftConfig.models.map((model) => ({ label: modelOptionLabel(draftConfig, model), value: model })), [draftConfig]);
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
        setDraftChannels((channels) => [...channels, channel]);
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
            for (const channel of draftChannels) {
                const baseline = baselineById.get(channel.id);
                if (!baseline) {
                    await createChannel(channel);
                } else if (!sameValue(channel, baseline)) {
                    await updateServerChannel(channel);
                }
            }
            for (const channel of deletedChannels) await deleteServerChannel(channel.id);
            await refreshChannels();
            resetChannelDraft();
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
            return [...configs.filter((configItem) => configItem.modelType !== group.capability), ...next];
        });
    };

    const updateModelCapabilities = (modelType: ModelCapability, model: string, capability: string, checked: boolean) => {
        setDraftModelConfigs((configs) =>
            configs.map((configItem) => {
                if (configItem.modelType !== modelType || modelConfigValue(configItem) !== model) return configItem;
                return {
                    ...configItem,
                    capabilities: checked ? uniqueModels([...configItem.capabilities, capability]) : configItem.capabilities.filter((value) => value !== capability),
                };
            }),
        );
    };

    const updateModelCreditCost = (modelType: ModelCapability, model: string, creditCost: number) => {
        setDraftModelConfigs((configs) => configs.map((configItem) => (configItem.modelType === modelType && modelConfigValue(configItem) === model ? { ...configItem, creditCost } : configItem)));
    };

    const updateModelCreditUnit = (modelType: ModelCapability, model: string, creditUnit: ServerModelConfig["creditUnit"]) => {
        setDraftModelConfigs((configs) => configs.map((configItem) => (configItem.modelType === modelType && modelConfigValue(configItem) === model
            ? { ...configItem, creditUnit: modelType === "video" && creditUnit === "second" ? "second" : "generation" }
            : configItem)));
    };

    const updateModelThinkingConfiguration = (model: string, patch: Pick<ServerModelConfig, "thinkingEnabled"> | Pick<ServerModelConfig, "reasoningEffort">) => {
        setDraftModelConfigs((configs) => configs.map((configItem) => (configItem.modelType === "text" && modelConfigValue(configItem) === model ? { ...configItem, ...patch } : configItem)));
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
                const saved = await createModelConfig({
                    channelId: configItem.channelId,
                    modelName: configItem.modelName,
                    modelType: configItem.modelType,
                    capabilities: configItem.capabilities,
                    sortOrder: configItem.sortOrder,
                    creditCost: configItem.creditCost,
                    creditUnit: configItem.creditUnit,
                    thinkingEnabled: configItem.thinkingEnabled,
                    reasoningEffort: configItem.reasoningEffort,
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
                    await updateModelConfig({
                        id: configItem.id,
                        modelType: configItem.modelType,
                        capabilities: configItem.capabilities,
                        sortOrder: configItem.sortOrder,
                        creditCost: configItem.creditCost,
                        creditUnit: configItem.creditUnit,
                        thinkingEnabled: configItem.thinkingEnabled,
                        reasoningEffort: configItem.reasoningEffort,
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
        setDraftObjectStorages((storages) => (isDefaultObjectStoragePlaceholder(storages[0]) ? [storage] : [...storages, storage]));
        setCollapsedObjectStorageIds((ids) => ids.filter((id) => id !== storage.id));
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
            resetObjectStorageDraft(true);
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
                                            <div className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">可选项决定各处下拉框展示哪些模型；同名模型会以括号里的渠道名区分。</div>
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
                                                    <ModelPicker config={draftConfig} value={draftConfig[group.modelKey]} onChange={(model) => setDefaultDraftModel(group.capability, model)} capability={group.capability} fullWidth />
                                                </div>
                                            </Form.Item>
                                        ))}
                                    </div>
                                    <div className="mt-6 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-3">
                                        <div className="text-sm font-semibold">模型能力配置</div>
                                        <div className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">为每个模型勾选支持的细能力，用于判断工具调用（如视频编辑降级）。</div>
                                        <div className="mt-3 space-y-4">
                                            {capabilityGroups.map((group) => {
                                                const models = draftConfig[group.modelsKey];
                                                if (!models.length) return null;
                                                return (
                                                    <div key={group.capability}>
                                                        <div className="mb-2 text-xs font-medium text-[var(--studio-muted)]">{group.label}</div>
                                                        <div className="space-y-2">
                                                            {models.map((model) => {
                                                                const capabilities = draftConfig.modelCapabilities.find((item) => item.model === model)?.capabilities || [];
                                                                return (
                                                            <div key={model} className="flex flex-wrap items-center gap-3 rounded border border-[var(--studio-line)] bg-[var(--studio-panel)] px-3 py-2">
                                                                {(() => {
                                                                    const modelConfig = draftModelConfigs.find((item) => item.modelType === group.capability && modelConfigValue(item) === model);
                                                                    const showThinkingConfiguration = modelConfig && isOpenAiTextModel(modelConfig, draftChannels);
                                                                    return (
                                                                        <>
                                                                        <span className="min-w-40 text-sm">{modelOptionLabel(draftConfig, model)}</span>
                                                                        <span className="flex items-center gap-2 text-xs text-[var(--studio-muted)]">
                                                                            {group.capability === "video" && modelConfig?.creditUnit === "second" ? "每秒积分" : "每次积分"}
                                                                            <InputNumber
                                                                                min={0}
                                                                                precision={0}
                                                                                value={modelConfig?.creditCost ?? 0}
                                                                                disabled={isSaving}
                                                                                className="w-24"
                                                                                onChange={(value) => updateModelCreditCost(group.capability, model, Number(value) || 0)}
                                                                            />
                                                                        </span>
                                                                        {group.capability === "video" && modelConfig ? (
                                                                            <Select
                                                                                size="small"
                                                                                value={modelConfig.creditUnit === "second" ? "second" : "generation"}
                                                                                disabled={isSaving}
                                                                                className="w-24"
                                                                                options={[{ value: "generation", label: "按次" }, { value: "second", label: "按秒" }]}
                                                                                onChange={(creditUnit: ServerModelConfig["creditUnit"]) => updateModelCreditUnit(group.capability, model, creditUnit)}
                                                                            />
                                                                        ) : null}
                                                                        {MODEL_CAPABILITY_OPTIONS[group.capability].map((option) => (
                                                                            <Checkbox
                                                                                key={option.value}
                                                                                checked={capabilities.includes(option.value)}
                                                                                disabled={isSaving}
                                                                                onChange={(event) => updateModelCapabilities(group.capability, model, option.value, event.target.checked)}
                                                                            >
                                                                                {option.label}
                                                                            </Checkbox>
                                                                        ))}
                                                                        {showThinkingConfiguration && modelConfig ? (
                                                                            <>
                                                                                <span className="flex items-center gap-2 text-xs text-[var(--studio-muted)]">
                                                                                    开启思考模式
                                                                                    <Switch
                                                                                        size="small"
                                                                                        checked={modelConfig.thinkingEnabled}
                                                                                        disabled={isSaving}
                                                                                        onChange={(thinkingEnabled) => updateModelThinkingConfiguration(model, { thinkingEnabled })}
                                                                                    />
                                                                                </span>
                                                                                <span className="flex items-center gap-2 text-xs text-[var(--studio-muted)]">
                                                                                    思考强度
                                                                                    <Select
                                                                                        size="small"
                                                                                        value={modelConfig.reasoningEffort}
                                                                                        disabled={isReasoningEffortDisabled(isSaving, modelConfig.thinkingEnabled)}
                                                                                        className="w-20"
                                                                                        options={reasoningEffortOptions}
                                                                                        onChange={(reasoningEffort: "high" | "max") => updateModelThinkingConfiguration(model, { reasoningEffort })}
                                                                                    />
                                                                                </span>
                                                                            </>
                                                                        ) : null}
                                                                        </>
                                                                    );
                                                                })()}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
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
                                                                    <Select value={storage.region || undefined} options={qiniuRegionOptions} placeholder={providerFields.regionPlaceholder} disabled={isSaving} onChange={(region) => updateDraftObjectStorage(storage.id, { region })} />
                                                                ) : (
                                                                    <Input value={storage.region} placeholder={providerFields.regionPlaceholder} disabled={isSaving} onChange={(event) => updateDraftObjectStorage(storage.id, { region: event.target.value })} />
                                                                )}
                                                            </Form.Item>
                                                            {storage.provider === "aliyunOss" ? (
                                                                <Form.Item label="Endpoint" extra="必须填写包含 http:// 或 https:// 的 OSS Endpoint。" className="mb-0 md:col-span-2">
                                                                    <Input value={storage.endpoint} placeholder="https://oss-cn-hangzhou.aliyuncs.com" disabled={isSaving} onChange={(event) => updateDraftObjectStorage(storage.id, { endpoint: event.target.value })} />
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
        </Modal>
    );
}

function cloneChannels(channels: ModelChannel[]) {
    return channels.map((channel) => ({ ...channel, models: [...channel.models] }));
}

function cloneModelConfigs(configs: ServerModelConfig[]) {
    return configs.map((config) => ({ ...config, capabilities: [...config.capabilities] }));
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
    };
}

function sameValue(first: unknown, second: unknown) {
    return JSON.stringify(first) === JSON.stringify(second);
}

function sameModelConfigForUpdate(first: ServerModelConfig, second: ServerModelConfig) {
    return first.modelType === second.modelType && first.sortOrder === second.sortOrder && first.creditCost === second.creditCost && first.creditUnit === second.creditUnit
        && first.thinkingEnabled === second.thinkingEnabled && first.reasoningEffort === second.reasoningEffort && sameValue(first.capabilities, second.capabilities);
}


function modelConfigValue(config: Pick<ServerModelConfig, "channelId" | "modelName">) {
    return `${config.channelId}::${config.modelName}`;
}

function uniqueModels(models: string[]) {
    return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));
}

function apiFormatLabel(apiFormat: ApiCallFormat) {
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
