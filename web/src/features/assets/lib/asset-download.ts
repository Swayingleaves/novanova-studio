import { downloadMedia } from "@/features/storage/services/media-download";
import { createMediaDownloadFileName } from "@/features/storage/services/media-download-name";
import type { Asset } from "../stores/use-asset-store";

export async function downloadAsset(asset: Asset) {
    if (asset.kind === "text") return;
    const extension = asset.data.mimeType.split("/")[1] || (asset.kind === "video" ? "mp4" : "png");
    const fileName = createMediaDownloadFileName(asset.kind === "video" ? "video" : "img", extension);
    // 优先按存储标识换 blob 下载；只有老数据没有存储标识时才退回已保存的地址。
    if (asset.kind === "image") return downloadMedia({ storageKey: asset.data.storageKey, dataUrl: asset.data.dataUrl, url: asset.data.dataUrl }, fileName);
    return downloadMedia({ storageKey: asset.data.storageKey, url: asset.data.url }, fileName);
}
