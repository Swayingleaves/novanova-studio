"use client";

import { translateMessage } from "@/features/locale/translate";
import { uploadImage } from "@/features/storage/services/image-storage";

const STYLE_THUMBNAIL_LONG_EDGE = 360;
const STYLE_THUMBNAIL_QUALITY = 0.78;

/** 按后台封面上传规范保存展示原图，同时生成用于卡片的 WebP 缩略图。 */
export async function uploadGenerationStyleCover(source: Blob) {
    const bitmap = await createImageBitmap(source);
    let thumbnail: Blob;
    try {
        const scale = Math.min(1, STYLE_THUMBNAIL_LONG_EDGE / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error(translateMessage("administration.failedToCompressStyleCover"));
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        thumbnail = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (blob?.type === "image/webp" && blob.size > 0 && blob.size <= 256 * 1024) resolve(blob);
                else reject(new Error(translateMessage("administration.failedToCompressStyleCover")));
            }, "image/webp", STYLE_THUMBNAIL_QUALITY);
        });
    } finally {
        bitmap.close();
    }
    const coverThumbnail = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
        reader.onerror = () => reject(new Error(translateMessage("administration.failedToCompressStyleCover")));
        reader.readAsDataURL(thumbnail);
    });
    const uploaded = await uploadImage(source, { compress: true });
    // 只保存对象地址，预览用的临时签名在查看时重新获取。
    const coverUrl = new URL(uploaded.url);
    coverUrl.search = "";
    coverUrl.hash = "";
    return { coverUrl: coverUrl.toString(), coverThumbnail, previewUrl: uploaded.url };
}

/** 读取外部封面由浏览器执行，并保留外部站点的跨源访问控制。 */
export async function readExternalGenerationStyleCover(coverUrl: string) {
    try {
        const url = new URL(coverUrl);
        if (url.protocol === "https:" || url.protocol === "http:") {
            const response = await fetch(url);
            if (response.ok) return await response.blob();
        }
    } catch (error) {
        console.error("读取外部风格封面失败", error);
    }
    throw new Error(translateMessage("administration.failedToReadStyleCover"));
}
