import { translateMessage } from "@/features/locale/translate";

import type { ComicDramaAssetType } from "../types";

/** 人物与道具输出多视角设定图，需要横构图容纳并排视角；场景为单幅环境设定。 */
export function isMultiViewAssetType(assetType: ComicDramaAssetType): boolean {
    return assetType === "character" || assetType === "prop";
}

/** 按所选资产类型给出默认画面比例：人物/道具用 3:2 横构图容纳并排视角，场景用 16:9 全景，混合类型沿用项目画幅。 */
export function defaultAssetGenSize(assetTypes: ComicDramaAssetType[], projectAspectRatio: string): string {
    if (assetTypes.length === 0) return projectAspectRatio || "1:1";
    if (assetTypes.every(isMultiViewAssetType)) return "3:2";
    if (assetTypes.every((assetType) => assetType === "scene")) return "16:9";
    return projectAspectRatio || "1:1";
}

/** 资产图画面比例选项，单张与批量共用。 */
export const getAssetGenSizeOptions = (translate = translateMessage) => ([
    { value: "1:1", label: translate("comicDrama.message11SquareReference") },
    { value: "3:2", label: translate("comicDrama.message32LandscapeMultipleViews") },
    { value: "16:9", label: translate("comicDrama.message169PanoramicScene") },
    { value: "9:16", label: translate("comicDrama.message916FullBodyCharacter") },
    { value: "3:4", label: translate("comicDrama.message34StandardCharacter") },
]);

/** 资产图固定形态说明，仅在整批类型一致时给出。 */
export function assetImageShapeHint(assetTypes: ComicDramaAssetType[], translate = translateMessage): string {
    const [shared] = assetTypes;
    if (!shared || assetTypes.some((assetType) => assetType !== shared)) return "";
    if (shared === "character") return translate("comicDrama.charactersUseAThreeViewReferenceSheetOnAWhite");
    if (shared === "prop") return translate("comicDrama.propsUseAMultiViewReferenceSheetOnAWhite");
    if (shared === "scene") return translate("comicDrama.scenesUseAnEmptyEnvironmentReferenceWithNoCharactersOr");
    return "";
}
