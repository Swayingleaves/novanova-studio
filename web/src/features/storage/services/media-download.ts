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
        downloadRemoteMedia(sourceUrl, fileName);
        return;
    }
    throw new Error(translate("storage.mediaHasNoStorageIDOrAccessibleURL"));
}

function downloadRemoteMedia(sourceUrl: string, fileName: string) {
    const link = document.createElement("a");
    link.href = sourceUrl;
    link.download = fileName;
    link.target = "_blank";
    link.rel = "noreferrer";
    document.body.append(link);
    link.click();
    link.remove();
}
