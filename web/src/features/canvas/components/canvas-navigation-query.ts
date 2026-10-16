
import { translateMessage as translate } from "@/features/locale/translate";
import { createAssetSearchText } from "@/features/assets/lib/asset-query";
import type { Asset } from "@/features/assets/stores/use-asset-store";
import type { CanvasBackgroundNode, CanvasNode, CanvasStoryboardAsset, CanvasStoryboardAssetKind } from "../types";

export type CanvasNavigationAsset =
    | { id: string; source: "library"; asset: Asset }
    | { id: string; source: "storyboard"; asset: CanvasStoryboardAsset; storyboardNodeTitle: string };
export type CanvasNavigationStoryboardAsset = Extract<CanvasNavigationAsset, { source: "storyboard" }>;
export type CanvasNavigationNodeCategory = CanvasNode["kind"] | "all";
export type CanvasNavigationAssetCategory = Asset["kind"] | CanvasStoryboardAssetKind | "all";
export type CanvasNavigationCategoryOption<Category extends string> = { value: Category; label: string };
export type CanvasNavigationNodeResult =
    | { type: "node"; node: CanvasNode }
    | { type: "background"; board: CanvasBackgroundNode; members: CanvasNode[] };

/** 按调用方语言生成显示文案，业务值保持不变。 */
export const createCanvasNavigationNodeCategoryOptions = (translator: typeof translate = translate): ReadonlyArray<CanvasNavigationCategoryOption<CanvasNavigationNodeCategory>> => ([
    { value: "all", get label() { return translator("canvas.all"); } },
    { value: "text", get label() { return translator("canvas.text_dd8186"); } },
    { value: "image", get label() { return translator("canvas.image"); } },
    { value: "video", get label() { return translator("canvas.video"); } },
    { value: "audio", get label() { return translator("canvas.audio"); } },
    { value: "storyboard", get label() { return translator("canvas.storyboard"); } },
    { value: "videoComposition", get label() { return translator("canvas.videoComposition"); } },
    { value: "directorDesk", get label() { return translator("canvas.3DDirectorDesk"); } },
    { value: "background", get label() { return translator("canvas.background"); } },
]);

export const CANVAS_NAVIGATION_NODE_CATEGORY_OPTIONS = createCanvasNavigationNodeCategoryOptions();

/** 按调用方语言生成显示文案，业务值保持不变。 */
export const createCanvasNavigationAssetCategoryOptions = (translator: typeof translate = translate): ReadonlyArray<CanvasNavigationCategoryOption<CanvasNavigationAssetCategory>> => ([
    { value: "all", get label() { return translator("canvas.all"); } },
    { value: "text", get label() { return translator("canvas.text_dd8186"); } },
    { value: "image", get label() { return translator("canvas.image"); } },
    { value: "video", get label() { return translator("canvas.video"); } },
    { value: "character", get label() { return translator("canvas.character"); } },
    { value: "scene", get label() { return translator("canvas.scene"); } },
    { value: "prop", get label() { return translator("canvas.prop"); } },
]);

export const CANVAS_NAVIGATION_ASSET_CATEGORY_OPTIONS = createCanvasNavigationAssetCategoryOptions();

const CANVAS_NODE_KIND_LABELS: Record<CanvasNode["kind"], string> = {
    get audio() { return translate("canvas.audio"); },
    get image() { return translate("canvas.image"); },
    get text() { return translate("canvas.text_dd8186"); },
    get video() { return translate("canvas.video"); },
    get storyboard() { return translate("canvas.storyboard"); },
    get videoComposition() { return translate("canvas.videoComposition"); },
    get directorDesk() { return translate("canvas.3DDirectorDesk"); },
    get background() { return translate("canvas.background"); },
};

const STORYBOARD_ASSET_KIND_LABELS: Record<CanvasStoryboardAssetKind, string> = {
    get character() { return translate("canvas.character"); },
    get scene() { return translate("canvas.scene"); },
    get prop() { return translate("canvas.prop"); },
};

/**
 * 查询画布导航节点，并保留命中成员所属的背景板层级。
 *
 * @param nodes 画布节点列表
 * @param keyword 搜索关键词
 * @param category 节点分类
 * @return CanvasNavigationNodeResult[] 匹配后的导航节点结构
 */
export function queryCanvasNavigationNodes(nodes: readonly CanvasNode[], keyword: string, category: CanvasNavigationNodeCategory): CanvasNavigationNodeResult[] {
    const normalizedKeyword = normalizeKeyword(keyword);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const memberNodeIds = new Set(nodes.filter((node): node is CanvasBackgroundNode => node.kind === "background").flatMap((node) => node.memberNodeIds));
    const matches = (node: CanvasNode) => matchesCanvasNavigationNode(node, normalizedKeyword, category);

    return nodes.flatMap((node): CanvasNavigationNodeResult[] => {
        if (node.kind === "background") {
            const members = node.memberNodeIds
                .map((id) => nodeById.get(id))
                .filter((member): member is CanvasNode => Boolean(member))
                .filter(matches);
            return matches(node) || members.length ? [{ type: "background", board: node, members }] : [];
        }
        if (memberNodeIds.has(node.id) || !matches(node)) return [];
        return [{ type: "node", node }];
    });
}

/**
 * 查询画布导航资产。
 *
 * @param assets 画布导航资产列表
 * @param keyword 搜索关键词
 * @param category 资产分类
 * @return CanvasNavigationAsset[] 匹配后的资产列表
 */
export function queryCanvasNavigationAssets(assets: readonly CanvasNavigationAsset[], keyword: string, category: CanvasNavigationAssetCategory): CanvasNavigationAsset[] {
    const normalizedKeyword = normalizeKeyword(keyword);
    return assets.filter((asset) => {
        if (category !== "all" && asset.asset.kind !== category) return false;
        return !normalizedKeyword || createCanvasNavigationAssetSearchText(asset).includes(normalizedKeyword);
    });
}

/**
 * 读取画布节点类型文案。
 *
 * @param kind 画布节点类型
 * @return string 节点类型中文文案
 */
export function canvasNavigationNodeKindLabel(kind: CanvasNode["kind"]): string {
    return CANVAS_NODE_KIND_LABELS[kind];
}

/**
 * 读取画布导航资产标题。
 *
 * @param asset 画布导航资产
 * @return string 资产标题
 */
export function canvasNavigationAssetTitle(asset: CanvasNavigationAsset): string {
    return asset.source === "library" ? asset.asset.title || translate("canvas.untitledAsset") : asset.asset.name || translate("canvas.untitledStoryboardAsset");
}

/**
 * 读取画布导航资产类型文案。
 *
 * @param asset 画布导航资产
 * @return string 资产类型中文文案
 */
export function canvasNavigationAssetKindLabel(asset: CanvasNavigationAsset): string {
    if (asset.source === "library") return CANVAS_NODE_KIND_LABELS[asset.asset.kind];
    return `${STORYBOARD_ASSET_KIND_LABELS[asset.asset.kind]} · ${asset.storyboardNodeTitle || translate("canvas.storyboardScript")}`;
}

/**
 * 读取分类选项当前文案。
 *
 * @param options 分类选项
 * @param category 当前分类
 * @return string 当前分类文案
 */
export function canvasNavigationCategoryLabel<Category extends string>(options: ReadonlyArray<CanvasNavigationCategoryOption<Category>>, category: Category): string {
    const option = options.find((item) => item.value === category);
    if (!option) throw new Error(translate("canvas.canvasNavigationCategoryNotConfigured", { value0: category }));
    return option.label;
}

function matchesCanvasNavigationNode(node: CanvasNode, normalizedKeyword: string, category: CanvasNavigationNodeCategory): boolean {
    if (category !== "all" && node.kind !== category) return false;
    return !normalizedKeyword || createCanvasNavigationNodeSearchText(node).includes(normalizedKeyword);
}

function createCanvasNavigationNodeSearchText(node: CanvasNode): string {
    const commonValues = [node.title, CANVAS_NODE_KIND_LABELS[node.kind]];
    if (node.kind === "text") return normalizeSearchValues([...commonValues, node.content.text]);
    if (node.kind === "image" || node.kind === "video") return normalizeSearchValues([...commonValues, node.generation.prompt]);
    if (node.kind !== "storyboard") return normalizeSearchValues(commonValues);
    const shotValues = node.storyboard.shots.flatMap((shot) => [
        shot.visualDescription,
        shot.dialogueVoiceover,
        shot.soundEffect,
        shot.cameraMovement,
        shot.finalPrompt,
    ]);
    const assetValues = node.storyboard.assets.flatMap((asset) => [asset.name, asset.description, STORYBOARD_ASSET_KIND_LABELS[asset.kind]]);
    return normalizeSearchValues([...commonValues, node.content.instruction, node.content.visualStyle, ...shotValues, ...assetValues]);
}

function createCanvasNavigationAssetSearchText(asset: CanvasNavigationAsset): string {
    if (asset.source === "library") return createAssetSearchText(asset.asset);
    return normalizeSearchValues([
        asset.asset.name,
        asset.asset.description,
        STORYBOARD_ASSET_KIND_LABELS[asset.asset.kind],
        asset.storyboardNodeTitle,
    ]);
}

function normalizeKeyword(keyword: string): string {
    return keyword.trim().toLocaleLowerCase("zh-CN");
}

function normalizeSearchValues(values: string[]): string {
    return values.filter(Boolean).join(" ").toLocaleLowerCase("zh-CN");
}
