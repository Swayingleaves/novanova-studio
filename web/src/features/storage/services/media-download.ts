"use client";
import { translateMessage as translate } from "@/features/locale/translate";


import { saveAs } from "file-saver";
import { downloadServerMedia } from "@/services/api/server";
import { applyAiWatermark } from "@/features/watermark/lib/apply-watermark";
import { useWatermarkStore } from "@/features/watermark/stores/use-watermark-store";

/**
 * 下载已登记的媒体文件。
 * <p>
 * 先按文件名判断是不是图片：点下按钮就弹水印设置，确认后才开始取文件，避免先下载再提示。
 *
 * @param media 媒体存储信息
 * @param fileName 下载文件名
 */
export async function downloadMedia(media: { storageKey?: string; dataUrl?: string; url?: string }, fileName: string) {
    const image = looksLikeImage(media, fileName);
    const settings = image ? await useWatermarkStore.getState().requestChoice() : null;
    const blob = await resolveMediaBlob(media);
    saveAs(settings && !settings.removeWatermark ? await applyAiWatermark(blob) : blob, fileName);
}

const IMAGE_FILE_NAME = /\.(png|jpe?g|webp|gif|bmp|avif|heic|tiff?)$/i;

/** 文件名、内嵌地址或直链任一指向图片即视为图片，真实类型仍由 Blob 再确认一次。 */
function looksLikeImage(media: { dataUrl?: string; url?: string }, fileName: string) {
    if (IMAGE_FILE_NAME.test(fileName)) return true;
    if (/^data:image\//i.test(media.dataUrl || "")) return true;
    return IMAGE_FILE_NAME.test((media.url || "").split("?")[0]);
}

/** 按存储键、内嵌地址或直链取回 Blob，保留原有失败提示。 */
async function resolveMediaBlob(media: { storageKey?: string; dataUrl?: string; url?: string }) {
    if (media.storageKey) {
        const blob = await downloadServerMedia(media.storageKey);
        if (!blob?.size) {
            throw new Error(translate("storage.downloadedFileIsEmpty"));
        }
        return blob;
    }
    if (media.dataUrl?.startsWith("data:")) {
        const blob = await (await fetch(media.dataUrl)).blob();
        if (!blob.size) {
            throw new Error(translate("storage.downloadedFileIsEmpty"));
        }
        return blob;
    }
    const sourceUrl = media.url?.trim() || "";
    if (/^https?:\/\//i.test(sourceUrl)) {
        // 只有地址时也先取回 Blob 再保存，避免把已过期的临时地址直接交给浏览器下载。
        const blob = await fetch(sourceUrl)
            .then((response) => (response.ok ? response.blob() : null))
            .catch(() => null);
        if (!blob?.size) {
            throw new Error(translate("storage.fileAccessFailed"));
        }
        return blob;
    }
    throw new Error(translate("storage.mediaHasNoStorageIDOrAccessibleURL"));
}
