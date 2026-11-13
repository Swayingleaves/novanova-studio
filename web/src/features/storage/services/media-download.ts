"use client";
import { translateMessage as translate } from "@/features/locale/translate";


import { saveAs } from "file-saver";
import { downloadServerMedia } from "@/services/api/server";

/**
 * 下载已登记的媒体文件。
 *
 * @param media 媒体存储信息
 * @param fileName 下载文件名
 */
export async function downloadMedia(media: { storageKey?: string; dataUrl?: string; url?: string }, fileName: string) {
    if (media.storageKey) {
        const blob = await downloadServerMedia(media.storageKey);
        if (!blob?.size) {
            throw new Error(translate("storage.downloadedFileIsEmpty"));
        }
        saveAs(blob, fileName);
        return;
    }
    if (media.dataUrl?.startsWith("data:")) {
        const blob = await (await fetch(media.dataUrl)).blob();
        if (!blob.size) {
            throw new Error(translate("storage.downloadedFileIsEmpty"));
        }
        saveAs(blob, fileName);
        return;
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
        saveAs(blob, fileName);
        return;
    }
    throw new Error(translate("storage.mediaHasNoStorageIDOrAccessibleURL"));
}
