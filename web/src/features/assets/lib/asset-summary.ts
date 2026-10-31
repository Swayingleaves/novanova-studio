import { formatBytes } from "@/features/generation/lib/image-utils";
import { translateMessage } from "@/features/locale/translate";
import type { Asset } from "../stores/use-asset-store";

/** 格式化资产摘要，只展示实际存在的有效尺寸。 */
export function formatAssetSummary(asset: Asset, separator = "，"): string {
    if (asset.kind === "text") return asset.data.content;
    const { width, height, bytes, mimeType } = asset.data;
    const dimensions = Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
        ? `${width} × ${height}` : "";
    return [dimensions, formatBytes(bytes) || translateMessage("assets.unknownSize"), mimeType]
        .filter(Boolean).join(separator);
}
