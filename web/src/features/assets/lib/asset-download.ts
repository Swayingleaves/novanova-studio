import { saveAs } from "file-saver";

import type { Asset } from "../stores/use-asset-store";

export function downloadAsset(asset: Asset) {
    if (asset.kind === "text") return;
    const source = asset.kind === "video" ? asset.data.url : asset.data.dataUrl;
    const extension = asset.data.mimeType.split("/")[1] || (asset.kind === "video" ? "mp4" : "png");
    saveAs(source, `${asset.title || "资产"}.${extension}`);
}
