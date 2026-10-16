"use client";

import { translateMessage } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";

import { useEffect, useMemo, useState } from "react";
import { App, Button, Card, Checkbox, Drawer, Empty, Form, Image, Input, Modal, Radio, Select, Skeleton, Space, Tabs, Tag } from "antd";
import { Bot, Check, Copy, ExternalLink, ImagePlus, Layers, Plus, RefreshCw, Sparkles, Trash2, User, Video } from "lucide-react";

import { ModelPicker } from "@/features/settings/components/model-picker";
import { useEffectiveConfig } from "@/features/settings/stores/use-config-store";
import { estimateComicDramaGeneration, listComicDramaAssetVersions, readComicDramaMediaUrl } from "@/services/api/comic-drama";
import { useMediaAutoRefresh } from "../hooks/use-media-auto-refresh";
import { usePendingImpactTargets } from "../hooks/use-pending-impact-targets";
import { useComicDramaStore } from "../stores/use-comic-drama-store";
import type {
    ComicDramaAsset,
    ComicDramaAssetInput,
    ComicDramaAssetType,
    ComicDramaAssetVersion,
    ComicDramaAssetVersionInput,
    ComicDramaMediaResult,
} from "../types";

const getAssetTypeConfig = (translate = translateMessage): Record<ComicDramaAssetType, { label: string; color: string }> => ({
    character: { label: translate("comicDrama.character"), color: "blue" },
    scene: { label: translate("comicDrama.scene"), color: "green" },
    prop: { label: translate("comicDrama.prop"), color: "purple" },
});

/** 资产版本变体类型文案。 */
const getVariantTypeLabels = (translate = translateMessage): Record<string, string> => ({
    default: translate("comicDrama.defaultBaseline"),
    costume: translate("comicDrama.costumeChange"),
    age: translate("comicDrama.agePeriod"),
    weather: translate("comicDrama.lightingWeather"),
    status: translate("comicDrama.damageTransformation"),
});

/** 版本表单只维护可编辑字段，其余字段在提交时补齐。 */
type AssetVersionFormValues = Pick<ComicDramaAssetVersionInput, "id" | "versionName" | "variantType" | "appearanceDescription">;

/** 生成一个不会与历史版本冲突的版本标识。 */
function newVersionId(): string {
    return `ver_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 人物与道具输出多视角设定图，需要横构图容纳并排视角；场景为单幅环境设定。 */
function isMultiViewAssetType(assetType: ComicDramaAssetType): boolean {
    return assetType === "character" || assetType === "prop";
}

/** 按所选资产类型给出默认画面比例：人物/道具用 3:2 横构图容纳并排视角，场景用 16:9 全景，混合类型沿用项目画幅。 */
function defaultAssetGenSize(assetTypes: ComicDramaAssetType[], projectAspectRatio: string): string {
    if (assetTypes.length === 0) return projectAspectRatio || "1:1";
    if (assetTypes.every(isMultiViewAssetType)) return "3:2";
    if (assetTypes.every((assetType) => assetType === "scene")) return "16:9";
    return projectAspectRatio || "1:1";
}

/** 资产图画面比例选项，单张与批量共用。 */
const getAssetGenSizeOptions = (translate = translateMessage) => ([
    { value: "1:1", label: translate("comicDrama.message11SquareReference") },
    { value: "3:2", label: translate("comicDrama.message32LandscapeMultipleViews") },
    { value: "16:9", label: translate("comicDrama.message169PanoramicScene") },
    { value: "9:16", label: translate("comicDrama.message916FullBodyCharacter") },
    { value: "3:4", label: translate("comicDrama.message34StandardCharacter") },
]);

/** 资产图固定形态说明，仅在整批类型一致时给出。 */
function assetImageShapeHint(assetTypes: ComicDramaAssetType[], translate = translateMessage): string {
    const [shared] = assetTypes;
    if (!shared || assetTypes.some((assetType) => assetType !== shared)) return "";
    if (shared === "character") return translate("comicDrama.charactersUseAThreeViewReferenceSheetOnAWhite");
    if (shared === "prop") return translate("comicDrama.propsUseAMultiViewReferenceSheetOnAWhite");
    if (shared === "scene") return translate("comicDrama.scenesUseAnEmptyEnvironmentReferenceWithNoCharactersOr");
    return "";
}

/** 资产缩略图骨架屏：SkeletonNode 的 style 落在内层、styles.root 落在外层，两层都要给尺寸才能铺满父容器。 */
function ThumbSkeleton() {
    const translate = useTranslation();
    const fill = { width: "100%", height: "100%" };
    return <Skeleton.Image active styles={{ root: fill, content: fill }} />;
}

/** 读取某个资产版本最新一张已完成生成的图片地址。 */
/** 读取某个资产版本已生成图片的地址；需要更新只代表上游有变更，历史结果仍要展示给用户。 */
function resolveVersionImageUrl(versionId: string, media: ComicDramaMediaResult[]): string {
    const matched = media.find((item) => item.targetType === "assetVersion" && item.targetId === versionId
        && (item.status === "completed" || item.status === "needsUpdate"));
    return matched ? readComicDramaMediaUrl(matched.resultData) : "";
}

/** 读取某个资产名下最新一张已完成生成的图片地址。 */
function resolveAssetImageUrl(versions: ComicDramaAssetVersion[], media: ComicDramaMediaResult[]): string {
    for (const version of versions) {
        const url = resolveVersionImageUrl(version.id, media);
        if (url) return url;
    }
    return "";
}

/** 视觉资产与多版本管理阶段视图。 */
export function StageAssets() {
    const translate = useTranslation();
    const { message, modal } = App.useApp();
    const config = useEffectiveConfig();
    const pendingImpactTargets = usePendingImpactTargets();
    const workspace = useComicDramaStore((state) => state.workspace);
    const saveAsset = useComicDramaStore((state) => state.saveAsset);
    const saveAssetVersion = useComicDramaStore((state) => state.saveAssetVersion);
    const createGenerationTask = useComicDramaStore((state) => state.createGenerationTask);

    const [typeFilter, setTypeFilter] = useState<string>("all");
    const [searchKeyword, setSearchKeyword] = useState<string>("");

    // Asset editing drawer
    const [assetDrawerOpen, setAssetDrawerOpen] = useState(false);
    const [editingAsset, setEditingAsset] = useState<ComicDramaAsset | null>(null);
    const [assetForm] = Form.useForm<ComicDramaAssetInput>();

    // Version management drawer
    const [versionDrawerOpen, setVersionDrawerOpen] = useState(false);
    const [activeAssetForVersions, setActiveAssetForVersions] = useState<ComicDramaAsset | null>(null);
    const [editingVersion, setEditingVersion] = useState<ComicDramaAssetVersion | null>(null);
    const [versionForm] = Form.useForm<AssetVersionFormValues>();

    // AI asset image generation modal
    const [genModalOpen, setGenModalOpen] = useState(false);
    const [targetVersion, setTargetVersion] = useState<ComicDramaAssetVersion | null>(null);
    const [targetAsset, setTargetAsset] = useState<ComicDramaAsset | null>(null);
    const [genModel, setGenModel] = useState<string>("");
    const [genQuality, setGenQuality] = useState<string>("medium");
    const [genResolution, setGenResolution] = useState<string>("2K");
    const [genSize, setGenSize] = useState<string>("1:1");
    const [estimating, setEstimating] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [estimatedCredits, setEstimatedCredits] = useState<number | null>(null);

    // 真实资产版本与媒体状态同步
    const [versionsByAsset, setVersionsByAsset] = useState<Record<string, ComicDramaAssetVersion[]>>({});
    const [versionsLoaded, setVersionsLoaded] = useState(false);
    const [syncing, setSyncing] = useState(false);

    // 批量生成资产图
    const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
    const [batchModalOpen, setBatchModalOpen] = useState(false);
    const [batchModel, setBatchModel] = useState<string>("");
    const [batchQuality, setBatchQuality] = useState<string>("medium");
    const [batchResolution, setBatchResolution] = useState<string>("2K");
    const [batchSize, setBatchSize] = useState<string>("1:1");
    const [batchEstimating, setBatchEstimating] = useState(false);
    const [batchGenerating, setBatchGenerating] = useState(false);
    const [batchCredits, setBatchCredits] = useState<number | null>(null);

    const assets = useMemo(() => workspace?.assets || [], [workspace]);
    const mediaList = useMemo(() => workspace?.media || [], [workspace]);
    const scriptProject = workspace?.scriptProject;
    const workspaceId = workspace?.projectId;

    // 只关心资产图的生成进度：镜头等其他媒体在跑时不必在资产库轮询
    const assetMedia = useMemo(() => mediaList.filter((item) => item.targetType === "assetVersion"), [mediaList]);
    const { autoRefreshing, runningCount, lastSyncedAt, syncNow } = useMediaAutoRefresh(assetMedia);

    // 载入全部资产的真实版本，卡片缩略图与版本抽屉共用同一份数据
    useEffect(() => {
        if (!workspaceId) return;
        let cancelled = false;
        Promise.all(assets.map(async (asset) => [asset.id, await listComicDramaAssetVersions(workspaceId, asset.id)] as const))
            .then((entries) => {
                if (!cancelled) setVersionsByAsset(Object.fromEntries(entries));
            })
            .catch(() => {
                if (!cancelled) message.error(translate("comicDrama.couldNotLoadAssetVersions"));
            })
            .finally(() => {
                if (!cancelled) setVersionsLoaded(true);
            });
        return () => {
            cancelled = true;
        };
    }, [workspaceId, assets, message]);

    const filteredAssets = useMemo(() => {
        return assets.filter((asset) => {
            const matchesType = typeFilter === "all" || asset.assetType === typeFilter;
            const matchesSearch = !searchKeyword.trim() || asset.name.toLowerCase().includes(searchKeyword.toLowerCase()) || asset.description.toLowerCase().includes(searchKeyword.toLowerCase());
            return matchesType && matchesSearch;
        });
    }, [assets, typeFilter, searchKeyword]);

    if (!workspace) return null;

    // Open asset creation
    const openCreateAsset = (assetType: ComicDramaAssetType = "character") => {
        setEditingAsset(null);
        assetForm.resetFields();
        assetForm.setFieldsValue({
            id: `asset_${Date.now()}`,
            assetType,
            name: "",
            description: "",
            usageStatus: "active",
            voicePreference: {},
            revision: 0,
        });
        setAssetDrawerOpen(true);
    };

    // Open asset edit
    const openEditAsset = (asset: ComicDramaAsset) => {
        setEditingAsset(asset);
        assetForm.setFieldsValue({
            id: asset.id,
            assetType: asset.assetType,
            sourceEntityId: asset.sourceEntityId,
            name: asset.name,
            description: asset.description,
            usageStatus: asset.usageStatus,
            voicePreference: asset.voicePreference,
            revision: asset.revision,
        });
        setAssetDrawerOpen(true);
    };

    // Submit asset save
    const handleSaveAsset = async () => {
        try {
            const values = await assetForm.validateFields();
            // sourceEntityId 与 voicePreference 没有对应表单项，必须从原资产回填，否则后端会把它们清空
            await saveAsset({
                ...values,
                sourceEntityId: editingAsset?.sourceEntityId ?? null,
                voicePreference: editingAsset?.voicePreference ?? {},
            });
            message.success(editingAsset ? translate("comicDrama.assetUpdated") : translate("comicDrama.assetCreated"));
            setAssetDrawerOpen(false);
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        }
    };

    // 为新建版本准备一个全新的版本标识，避免重复保存时覆盖同一版本
    const resetVersionForm = () => {
        versionForm.setFieldsValue({
            id: newVersionId(),
            versionName: "",
            variantType: "costume",
            appearanceDescription: "",
        });
    };

    // Open version management for asset
    const openVersions = (asset: ComicDramaAsset) => {
        setActiveAssetForVersions(asset);
        setEditingVersion(null);
        versionForm.resetFields();
        resetVersionForm();
        setVersionDrawerOpen(true);
    };

    // Save version
    const handleSaveVersion = async () => {
        if (!activeAssetForVersions) return;
        try {
            const values = await versionForm.validateFields();
            await saveAssetVersion({
                ...values,
                assetId: activeAssetForVersions.id,
                // 表单未维护的字段必须补全，后端 AssetVersion 的 status 为必填
                referenceMedia: [],
                attributes: {},
                status: "active",
                revision: 0,
            });
            message.success(editingVersion ? translate("comicDrama.assetVersionUpdated") : translate("comicDrama.newVersionAdded"));
            setEditingVersion(null);
            versionForm.resetFields();
            resetVersionForm();
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        }
    };

    // Open AI image generation for an asset version
    const openAssetImageGen = (asset: ComicDramaAsset, version: ComicDramaAssetVersion) => {
        setTargetAsset(asset);
        setTargetVersion(version);
        setGenModel(config.imageModel || "");
        setGenQuality(config.quality || "medium");
        setGenResolution(config.imageResolution || "2K");
        setGenSize(defaultAssetGenSize([asset.assetType], workspace.settings.aspectRatio));
        setEstimatedCredits(null);
        setGenModalOpen(true);
    };

    // Estimate credits for asset generation
    const handleEstimateAssetGen = async () => {
        if (!targetVersion) return;
        if (!genModel) {
            message.warning(translate("comicDrama.selectAGenerationModelFirst"));
            return;
        }
        setEstimating(true);
        try {
            const res = await estimateComicDramaGeneration({
                projectId: workspace.projectId,
                targetType: "assetVersion",
                targetIds: [targetVersion.id],
                model: genModel,
                settings: {
                    mediaType: "image",
                    quality: genQuality,
                    resolution: genResolution,
                    size: genSize,
                },
            });
            setEstimatedCredits(res.estimatedCredits);
            message.info(translate("comicDrama.estimatedCostCountCredits", { value0: res.estimatedCredits }));
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        } finally {
            setEstimating(false);
        }
    };

    // Trigger asset image generation
    const handleGenerateAssetImage = async () => {
        if (!targetVersion) return;
        if (!genModel) {
            message.warning(translate("comicDrama.selectAGenerationModelFirst"));
            return;
        }
        setGenerating(true);
        try {
            await createGenerationTask({
                targetType: "assetVersion",
                targetIds: [targetVersion.id],
                model: genModel,
                settings: {
                    mediaType: "image",
                    quality: genQuality,
                    resolution: genResolution,
                    size: genSize,
                },
            });
            message.success(translate("comicDrama.assetImageTaskCreatedCheckProgressOnTheRightOr"));
            setGenModalOpen(false);
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        } finally {
            setGenerating(false);
        }
    };

    const activeVersions = activeAssetForVersions ? versionsByAsset[activeAssetForVersions.id] || [] : [];

    // 从资产卡片直接为该资产最新版本生成资产图
    const handleCardImageGen = (asset: ComicDramaAsset) => {
        const latestVersion = versionsByAsset[asset.id]?.[0];
        if (!latestVersion) {
            message.warning(translate("comicDrama.thisAssetHasNoVersionsSaveOneFirst"));
            openVersions(asset);
            return;
        }
        openAssetImageGen(asset, latestVersion);
    };

    // 同步底层生成任务状态，让缩略图及时反映最新结果
    const handleSync = async () => {
        setSyncing(true);
        try {
            await syncNow();
            message.success(translate("comicDrama.latestGenerationStatusSynced"));
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        } finally {
            setSyncing(false);
        }
    };

    const selectedAssets = assets.filter((asset) => selectedAssetIds.includes(asset.id));
    // 批量生成统一以各资产的最新版本为目标；没有版本的资产会被跳过
    const batchTargetVersionIds = selectedAssets
        .map((asset) => versionsByAsset[asset.id]?.[0]?.id)
        .filter((versionId): versionId is string => Boolean(versionId));
    const skippedAssetCount = selectedAssets.length - batchTargetVersionIds.length;

    const toggleAssetSelection = (assetId: string, checked: boolean) => {
        setSelectedAssetIds((current) => (checked ? [...current, assetId] : current.filter((id) => id !== assetId)));
    };

    const selectedInFilteredCount = filteredAssets.filter((asset) => selectedAssetIds.includes(asset.id)).length;

    // 全选/取消只作用于当前筛选结果，跨筛选已选的资产保留
    const toggleAllFiltered = (checked: boolean) => {
        const filteredIds = filteredAssets.map((asset) => asset.id);
        setSelectedAssetIds((current) => (checked
            ? Array.from(new Set([...current, ...filteredIds]))
            : current.filter((id) => !filteredIds.includes(id))));
    };

    // 一键选中当前筛选结果里还没有资产图的资产
    const selectAssetsMissingImage = () => {
        const missing = filteredAssets.filter((asset) => !resolveAssetImageUrl(versionsByAsset[asset.id] || [], mediaList));
        if (missing.length === 0) {
            message.info(filteredAssets.length === 0 ? translate("comicDrama.noResultsMatchTheCurrentFilters") : translate("comicDrama.allFilteredAssetsAlreadyHaveImages"));
            return;
        }
        setSelectedAssetIds(missing.map((asset) => asset.id));
    };

    const openBatchGen = () => {
        setBatchModel(config.imageModel || "");
        setBatchQuality(config.quality || "medium");
        setBatchResolution(config.imageResolution || "2K");
        // 整批都是多视角类型时用横构图容纳并排视角，否则沿用项目比例
        setBatchSize(defaultAssetGenSize(selectedAssets.map((asset) => asset.assetType), workspace.settings.aspectRatio));
        setBatchCredits(null);
        setBatchModalOpen(true);
    };

    // Estimate credits for batch asset generation
    const handleBatchEstimate = async () => {
        if (!batchModel) {
            message.warning(translate("comicDrama.selectAGenerationModelFirst"));
            return;
        }
        if (batchTargetVersionIds.length === 0) {
            message.warning(translate("comicDrama.noneOfTheSelectedAssetsHaveVersions"));
            return;
        }
        setBatchEstimating(true);
        try {
            const res = await estimateComicDramaGeneration({
                projectId: workspace.projectId,
                targetType: "assetVersion",
                targetIds: batchTargetVersionIds,
                model: batchModel,
                settings: {
                    mediaType: "image",
                    quality: batchQuality,
                    resolution: batchResolution,
                    size: batchSize,
                },
            });
            setBatchCredits(res.estimatedCredits);
            message.info(translate("comicDrama.estimatedCostCountCredits", { value0: res.estimatedCredits }));
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        } finally {
            setBatchEstimating(false);
        }
    };

    // Trigger batch asset image generation
    const handleBatchGenerate = async () => {
        if (!batchModel) {
            message.warning(translate("comicDrama.selectAGenerationModelFirst"));
            return;
        }
        if (batchTargetVersionIds.length === 0) {
            message.warning(translate("comicDrama.noneOfTheSelectedAssetsHaveVersions"));
            return;
        }
        setBatchGenerating(true);
        try {
            const result = await createGenerationTask({
                targetType: "assetVersion",
                targetIds: batchTargetVersionIds,
                model: batchModel,
                settings: {
                    mediaType: "image",
                    quality: batchQuality,
                    resolution: batchResolution,
                    size: batchSize,
                },
            });
            message.success(translate("comicDrama.createdCountAssetImageTasksCheckProgressInTheMedia", { value0: result.taskCount }));
            setBatchModalOpen(false);
            setSelectedAssetIds([]);
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        } finally {
            setBatchGenerating(false);
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <header className="flex flex-col gap-2 border-b border-[var(--studio-line)] pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-[var(--studio-ink)]">{translate("comicDrama.visualAssetLibrary")}</h2>
                    <p className="mt-1 text-sm text-[var(--studio-muted)]">
                        {translate("comicDrama.manageVisualBaselinesForCharactersScenesAndPropsCreateVersions")}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    {autoRefreshing && (
                        <span className="flex items-center gap-1.5 text-xs text-[var(--studio-muted)]">
                            <RefreshCw className="size-3.5 animate-spin" />
                            {translate("comicDrama.autoRefreshing")}{runningCount} {translate("comicDrama.running")}{lastSyncedAt && translate("comicDrama.lastCount", { value0: lastSyncedAt })}
                        </span>
                    )}
                    <Button icon={<RefreshCw className="size-4" />} loading={syncing} onClick={handleSync}>
                        {translate("comicDrama.syncStatus")}</Button>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={() => openCreateAsset("character")}>
                        {translate("comicDrama.newAsset")}</Button>
                </div>
            </header>

            {/* Filter & Search Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <Radio.Group value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} buttonStyle="solid">
                    <Radio.Button value="all">{translate("comicDrama.allCount_e721fa", { value0: assets.length })}</Radio.Button>
                    <Radio.Button value="character">{translate("comicDrama.charactersCount_c4808b", { value0: assets.filter((a) => a.assetType === "character").length })}</Radio.Button>
                    <Radio.Button value="scene">{translate("comicDrama.scenesCount_b80c83", { value0: assets.filter((a) => a.assetType === "scene").length })}</Radio.Button>
                    <Radio.Button value="prop">{translate("comicDrama.propsCount_08e0b3", { value0: assets.filter((a) => a.assetType === "prop").length })}</Radio.Button>
                </Radio.Group>
                <div className="w-64">
                    <Input.Search
                        placeholder={translate("comicDrama.searchAssetNamesOrDescriptions")}
                        allowClear
                        value={searchKeyword}
                        onChange={(e) => setSearchKeyword(e.target.value)}
                    />
                </div>
            </div>

            {/* Selection & Batch Bar */}
            {assets.length > 0 && (
                <div className="flex flex-wrap items-center gap-3">
                    <Checkbox
                        indeterminate={selectedInFilteredCount > 0 && selectedInFilteredCount < filteredAssets.length}
                        checked={filteredAssets.length > 0 && selectedInFilteredCount === filteredAssets.length}
                        onChange={(e) => toggleAllFiltered(e.target.checked)}
                    >{translate("comicDrama.selectCurrentCount_8b9873", { value0: filteredAssets.length })}</Checkbox>
                    <Button type="text" size="small" onClick={selectAssetsMissingImage}>
                        {translate("comicDrama.selectWithoutImages")}</Button>
                    <span className="text-xs text-[var(--studio-muted)]">{translate("comicDrama.countItemsSelected_380fef", { value0: selectedAssetIds.length })}</span>
                    <div className="ml-auto">
                        <Button
                            type="primary"
                            disabled={selectedAssetIds.length === 0}
                            icon={<Sparkles className="size-4" />}
                            onClick={openBatchGen}
                        >
                            {translate("comicDrama.generateAssetImagesInBatch")}</Button>
                    </div>
                </div>
            )}

            {/* Assets Grid */}
            {filteredAssets.length === 0 ? (
                <Empty description={translate("comicDrama.noMatchingVisualAssets")}>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={() => openCreateAsset("character")}>
                        {translate("comicDrama.createFirstVisualAsset")}</Button>
                </Empty>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {filteredAssets.map((asset) => {
                        const typeInfo = getAssetTypeConfig(translate)[asset.assetType] || getAssetTypeConfig(translate).character;
                        const versions = versionsByAsset[asset.id] || [];
                        const assetImageUrl = resolveAssetImageUrl(versions, mediaList);
                        // Find how many shots reference this asset's versions
                        const shotCount = workspace.shots.filter((shot) =>
                            shot.assetVersionIds.some((vId) => versions.some((version) => version.id === vId))
                        ).length;

                        return (
                            <div
                                key={asset.id}
                                className="flex flex-col justify-between rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-4 shadow-sm transition-all hover:border-[var(--studio-line-strong)]"
                            >
                                <div className="flex flex-col gap-3">
                                    <div className="aspect-[4/3] w-full overflow-hidden rounded-lg">
                                        {!versionsLoaded ? (
                                            <ThumbSkeleton />
                                        ) : assetImageUrl ? (
                                            <Image
                                                src={assetImageUrl}
                                                alt={asset.name}
                                                className="size-full object-cover"
                                                classNames={{ root: "size-full" }}
                                                placeholder={<ThumbSkeleton />}
                                            />
                                        ) : (
                                            <div className="flex size-full items-center justify-center rounded-lg border border-dashed border-[var(--studio-line)] text-[var(--studio-faint)]">
                                                <ImagePlus className="size-6" />
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                            <Checkbox
                                                checked={selectedAssetIds.includes(asset.id)}
                                                onChange={(e) => toggleAssetSelection(asset.id, e.target.checked)}
                                            />
                                            <span className="font-semibold text-[var(--studio-ink)]">{asset.name}</span>
                                            <Tag color={typeInfo.color}>{typeInfo.label}</Tag>
                                            {asset.usageStatus === "needsUpdate" || pendingImpactTargets.has(`asset:${asset.id}`) ? (
                                                <Tag color="warning">{translate("comicDrama.needsUpdate")}</Tag>
                                            ) : null}
                                        </div>
                                        <span className="text-xs text-[var(--studio-muted)]">{translate("comicDrama.referencesCountShots_b98767", { value0: shotCount })}</span>
                                    </div>

                                    <p className="line-clamp-2 text-xs leading-5 text-[var(--studio-muted)]">
                                        {asset.description || translate("comicDrama.noVisualDescriptionYet")}
                                    </p>

                                    {asset.sourceEntityId && (
                                        <div className="text-xs text-[var(--studio-faint)]">{translate("comicDrama.scriptSourceCount_46a2f3", { value0: asset.sourceEntityId })}</div>
                                    )}
                                </div>

                                <div className="mt-4 flex items-center justify-between border-t border-[var(--studio-line)] pt-3">
                                    <Button
                                        size="small"
                                        icon={<Layers className="size-3.5" />}
                                        onClick={() => openVersions(asset)}
                                    >{translate("comicDrama.versionsCount_f46fd3", { value0: versions.length > 0 ? `(${versions.length})` : "" })}</Button>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            size="small"
                                            type="primary"
                                            ghost
                                            icon={<Sparkles className="size-3.5" />}
                                            onClick={() => handleCardImageGen(asset)}
                                        >
                                            {translate("comicDrama.generateAssetImage")}</Button>
                                        <Button size="small" onClick={() => openEditAsset(asset)}>
                                            {translate("comicDrama.edit")}</Button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Asset Create/Edit Drawer */}
            <Drawer
                title={editingAsset ? translate("comicDrama.editVisualAsset") : translate("comicDrama.newVisualAsset")}
                open={assetDrawerOpen}
                onClose={() => setAssetDrawerOpen(false)}
                size="large"
                extra={
                    <Button type="primary" onClick={handleSaveAsset}>
                        {translate("comicDrama.save")}</Button>
                }
            >
                <Form form={assetForm} layout="vertical">
                    <Form.Item name="id" hidden>
                        <Input />
                    </Form.Item>
                    <Form.Item name="revision" hidden>
                        <Input />
                    </Form.Item>

                    <Form.Item
                        name="assetType"
                        label={translate("comicDrama.assetType")}
                        rules={[{ required: true, message: translate("comicDrama.selectAnAssetType") }]}
                    >
                        <Select
                            options={[
                                { value: "character", label: translate("comicDrama.character_41f8f3") },
                                { value: "scene", label: translate("comicDrama.scene_5b0cfe") },
                                { value: "prop", label: translate("comicDrama.prop_2ca2eb") },
                            ]}
                        />
                    </Form.Item>

                    <Form.Item
                        name="name"
                        label={translate("comicDrama.assetName")}
                        rules={[{ required: true, message: translate("comicDrama.enterAnAssetName") }]}
                    >
                        <Input placeholder={translate("comicDrama.forExampleAWanderingSwordsmanAnInnLobbyAWooden")} />
                    </Form.Item>

                    <Form.Item
                        name="description"
                        label={translate("comicDrama.appearanceAndVisualFeatures")}
                        tooltip={translate("comicDrama.describeAppearanceClothingLightingTexturesAndDistinctiveFeatures")}
                    >
                        <Input.TextArea rows={4} placeholder={translate("comicDrama.describeTheAssetSVisualBaseline")} />
                    </Form.Item>

                    <Form.Item name="usageStatus" label={translate("comicDrama.usageStatus")}>
                        <Select
                            options={[
                                { value: "active", label: translate("comicDrama.active") },
                                { value: "needsUpdate", label: translate("comicDrama.needsUpdate_66840b") },
                                { value: "archived", label: translate("comicDrama.archived") },
                            ]}
                        />
                    </Form.Item>
                </Form>
            </Drawer>

            {/* Version Management Drawer */}
            <Drawer
                title={
                    activeAssetForVersions
                        ? translate("comicDrama.manageVersionsCount", { value0: activeAssetForVersions.name })
                        : translate("comicDrama.visualAssetVersions")
                }
                open={versionDrawerOpen}
                onClose={() => setVersionDrawerOpen(false)}
                size="large"
            >
                {activeAssetForVersions && (
                    <div className="flex flex-col gap-6">
                        <div className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-4">
                            <h4 className="text-sm font-semibold text-[var(--studio-ink)]">
                                {translate("comicDrama.addAppearanceStateVersion")}</h4>
                            <p className="mt-1 text-xs text-[var(--studio-muted)]">
                                {translate("comicDrama.addVersionsSuchAsEverydayClothesOrBattleDamageFor")}</p>
                            <Form form={versionForm} layout="vertical" className="mt-4">
                                <Form.Item name="id" hidden>
                                    <Input />
                                </Form.Item>
                                <Form.Item
                                    name="versionName"
                                    label={translate("comicDrama.versionName")}
                                    rules={[{ required: true, message: translate("comicDrama.enterAVersionName") }]}
                                >
                                    <Input placeholder={translate("comicDrama.forExampleFirstAppearanceRainDamagedOutfit")} />
                                </Form.Item>
                                <Form.Item
                                    name="variantType"
                                    label={translate("comicDrama.variantType")}
                                >
                                    <Select
                                        options={Object.entries(getVariantTypeLabels(translate)).map(([value, label]) => ({ value, label }))}
                                    />
                                </Form.Item>
                                <Form.Item
                                    name="appearanceDescription"
                                    label={translate("comicDrama.versionSpecificAppearance")}
                                >
                                    <Input.TextArea
                                        rows={3}
                                        placeholder={translate("comicDrama.describeHowThisVersionDiffersFromTheDefaultBaseline")}
                                    />
                                </Form.Item>
                                <Button type="primary" onClick={handleSaveVersion}>
                                    {translate("comicDrama.saveVersion")}</Button>
                            </Form>
                        </div>

                        {/* Existing Version List */}
                        <div className="flex flex-col gap-3">
                            <h4 className="text-sm font-semibold text-[var(--studio-ink)]">{translate("comicDrama.existingVersionsCount_7853c4", { value0: activeVersions.length })}</h4>
                            {activeVersions.length === 0 ? (
                                <Empty
                                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                                    description={translate("comicDrama.thisAssetHasNoVersionsSaveOneAboveFirst")}
                                />
                            ) : (
                                activeVersions.map((version) => {
                                    const versionImageUrl = resolveVersionImageUrl(version.id, mediaList);

                                    return (
                                        <div
                                            key={version.id}
                                            className="flex items-start justify-between gap-3 rounded-lg border border-[var(--studio-line)] p-3"
                                        >
                                            <div className="flex min-w-0 gap-3">
                                                {versionImageUrl ? (
                                                    <Image
                                                        src={versionImageUrl}
                                                        alt={version.versionName}
                                                        className="size-16 rounded-md object-cover"
                                                        classNames={{ root: "shrink-0" }}
                                                        placeholder={<ThumbSkeleton />}
                                                    />
                                                ) : (
                                                    <div className="flex size-16 shrink-0 items-center justify-center rounded-md border border-dashed border-[var(--studio-line)] text-[var(--studio-faint)]">
                                                        <ImagePlus className="size-5" />
                                                    </div>
                                                )}
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium text-[var(--studio-ink)]">
                                                            {version.versionName}
                                                        </span>
                                                        <Tag>
                                                            {getVariantTypeLabels(translate)[version.variantType] || version.variantType}
                                                        </Tag>
                                                    </div>
                                                    <p className="mt-1 line-clamp-2 text-xs text-[var(--studio-muted)]">
                                                        {version.appearanceDescription || translate("comicDrama.noVersionAppearanceDescription")}
                                                    </p>
                                                </div>
                                            </div>
                                            <Button
                                                size="small"
                                                type="primary"
                                                icon={<Sparkles className="size-3.5" />}
                                                onClick={() => openAssetImageGen(activeAssetForVersions, version)}
                                            >
                                                {translate("comicDrama.generateAssetImageWithAi")}</Button>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                )}
            </Drawer>

            {/* AI Image Generation Modal */}
            <Modal
                title={translate("comicDrama.aiAssetImageGeneration")}
                open={genModalOpen}
                onCancel={() => setGenModalOpen(false)}
                footer={null}
                width={600}
            >
                {targetAsset && targetVersion && (
                    <div className="flex flex-col gap-4 py-2">
                        <div className="rounded-lg bg-[var(--studio-panel-solid)] p-3 text-xs text-[var(--studio-muted)]">
                            {translate("comicDrama.assets")}<span className="font-semibold text-[var(--studio-ink)]">{targetAsset.name}</span> {translate("comicDrama.version")}<span className="font-semibold text-[var(--studio-ink)]">{targetVersion.versionName}</span>
                        </div>

                        <div>
                            <label className="text-xs font-medium text-[var(--studio-muted)]">{translate("comicDrama.generationModel")}</label>
                            <div className="mt-1">
                                <ModelPicker
                                    config={config}
                                    capability="image"
                                    value={genModel}
                                    onChange={setGenModel}
                                    fullWidth
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-3">
                            <div>
                                <label className="text-xs font-medium text-[var(--studio-muted)]">{translate("comicDrama.imageQuality")}</label>
                                <Select
                                    className="mt-1 w-full"
                                    value={genQuality}
                                    onChange={setGenQuality}
                                    options={[
                                        { value: "low", label: translate("comicDrama.lowQuality") },
                                        { value: "medium", label: translate("comicDrama.standardQuality") },
                                        { value: "high", label: translate("comicDrama.highQuality") },
                                    ]}
                                />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-[var(--studio-muted)]">{translate("comicDrama.resolution")}</label>
                                <Select
                                    className="mt-1 w-full"
                                    value={genResolution}
                                    onChange={setGenResolution}
                                    options={[
                                        { value: "1K", label: "1K" },
                                        { value: "2K", label: "2K" },
                                        { value: "4K", label: "4K" },
                                    ]}
                                />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-[var(--studio-muted)]">{translate("comicDrama.aspectRatio")}</label>
                                <Select
                                    className="mt-1 w-full"
                                    value={genSize}
                                    onChange={setGenSize}
                                    options={getAssetGenSizeOptions(translate)}
                                />
                            </div>
                        </div>

                        <div className="rounded-lg bg-[var(--studio-panel-solid)] p-3 text-xs leading-5 text-[var(--studio-muted)]">{translate("comicDrama.theServerBuildsPromptsFromAssetAndVersionNames_bcf6cd", { value0: workspace.settings.visualStyle || translate("comicDrama.notSet_55a04b"), value1: assetImageShapeHint([targetAsset.assetType], translate) })}</div>

                        <div className="mt-2 flex items-center justify-between border-t border-[var(--studio-line)] pt-3">
                            <div className="text-xs text-[var(--studio-muted)]">
                                {estimatedCredits !== null ? (
                                    <span>{translate("comicDrama.estimatedCost_4225d2")}<strong className="text-amber-500">{estimatedCredits}</strong> {translate("comicDrama.credits")}</span>
                                ) : (
                                    <Button size="small" loading={estimating} onClick={handleEstimateAssetGen}>
                                        {translate("comicDrama.estimatedCredits")}</Button>
                                )}
                            </div>
                            <Space>
                                <Button onClick={() => setGenModalOpen(false)}>{translate("comicDrama.cancel")}</Button>
                                <Button
                                    type="primary"
                                    loading={generating}
                                    icon={<Sparkles className="size-4" />}
                                    onClick={handleGenerateAssetImage}
                                >
                                    {translate("comicDrama.confirmGeneration")}</Button>
                            </Space>
                        </div>
                    </div>
                )}
            </Modal>

            {/* Batch Asset Image Generation Modal */}
            <Modal
                title={translate("comicDrama.generateAssetImagesInBatch")}
                open={batchModalOpen}
                onCancel={() => setBatchModalOpen(false)}
                footer={null}
                width={600}
            >
                <div className="flex flex-col gap-4 py-2">
                    <div className="rounded-lg bg-[var(--studio-panel-solid)] p-3 text-xs leading-5 text-[var(--studio-muted)]">
                        {translate("comicDrama.batchAssetTargets", { value0: batchTargetVersionIds.length })}
                        {skippedAssetCount > 0 ? <span className="text-amber-500">{translate("comicDrama.batchAssetsSkipped", { value0: skippedAssetCount })}</span> : null}
                    </div>
                    <div>
                        <label className="text-xs font-medium text-[var(--studio-muted)]">{translate("comicDrama.generationModel")}</label>
                        <div className="mt-1">
                            <ModelPicker
                                config={config}
                                capability="image"
                                value={batchModel}
                                onChange={setBatchModel}
                                fullWidth
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="text-xs font-medium text-[var(--studio-muted)]">{translate("comicDrama.imageQuality")}</label>
                            <Select
                                className="mt-1 w-full"
                                value={batchQuality}
                                onChange={setBatchQuality}
                                options={[
                                    { value: "low", label: translate("comicDrama.lowQuality") },
                                    { value: "medium", label: translate("comicDrama.standardQuality") },
                                    { value: "high", label: translate("comicDrama.highQuality") },
                                ]}
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-[var(--studio-muted)]">{translate("comicDrama.resolution")}</label>
                            <Select
                                className="mt-1 w-full"
                                value={batchResolution}
                                onChange={setBatchResolution}
                                options={[
                                    { value: "1K", label: "1K" },
                                    { value: "2K", label: "2K" },
                                    { value: "4K", label: "4K" },
                                ]}
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-[var(--studio-muted)]">{translate("comicDrama.aspectRatio")}</label>
                            <Select
                                className="mt-1 w-full"
                                value={batchSize}
                                onChange={setBatchSize}
                                options={getAssetGenSizeOptions(translate)}
                            />
                        </div>
                    </div>

                    <div className="rounded-lg bg-[var(--studio-panel-solid)] p-3 text-xs leading-5 text-[var(--studio-muted)]">{translate("comicDrama.theServerBuildsPromptsFromAssetAndVersionNames_bcf6cd", { value0: workspace.settings.visualStyle || translate("comicDrama.notSet_55a04b"), value1: assetImageShapeHint(selectedAssets.map((asset) => asset.assetType), translate) })}</div>

                    <div className="mt-2 flex items-center justify-between border-t border-[var(--studio-line)] pt-3">
                        <div className="text-xs text-[var(--studio-muted)]">
                            {batchCredits !== null ? (
                                <span>{translate("comicDrama.estimatedCost_4225d2")}<strong className="text-amber-500">{batchCredits}</strong> {translate("comicDrama.credits")}</span>
                            ) : (
                                <Button size="small" loading={batchEstimating} onClick={handleBatchEstimate}>
                                    {translate("comicDrama.estimatedCredits")}</Button>
                            )}
                        </div>
                        <Space>
                            <Button onClick={() => setBatchModalOpen(false)}>{translate("comicDrama.cancel")}</Button>
                            <Button
                                type="primary"
                                loading={batchGenerating}
                                disabled={batchTargetVersionIds.length === 0}
                                icon={<Sparkles className="size-4" />}
                                onClick={handleBatchGenerate}
                            >{translate("comicDrama.generateCountImages_4f0a0a", { value0: batchTargetVersionIds.length })}</Button>
                        </Space>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
