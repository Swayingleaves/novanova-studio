import { saveAs } from "file-saver";

import { createZip, readZip } from "@/shared/lib/zip";
import { getMediaBlob, setMediaBlob } from "@/features/storage/services/file-storage";
import { getImageBlob, setImageBlob } from "@/features/storage/services/image-storage";
import type { Asset } from "@/features/assets/stores/use-asset-store";

/** 素材导出归档的应用标识。 */
const EXPORT_APP_ID = "novanova-studio";
/** 素材导出归档格式版本。 */
const EXPORT_VERSION = 1;
/** 图片存储 key 前缀。 */
const IMAGE_STORAGE_PREFIX = "image:";
/** 默认输出文件名。 */
const DEFAULT_EXPORT_NAME = "我的资产";

/** 素材导出归档根结构。 */
interface AssetExportFile {
    app: typeof EXPORT_APP_ID;
    version: typeof EXPORT_VERSION;
    exportedAt: string;
    assets: Asset[];
    files: AssetExportEntry[];
}

/** 归档中的单个资源文件描述。 */
interface AssetExportEntry {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
}

/**
 * 把素材集合导出为 ZIP 并触发下载。
 * <p>
 * 仅处理 image/video 类型素材，按 storageKey 取回 Blob，连同 assets.json 清单打包。
 *
 * @param assets 待导出素材
 */
export async function exportAssets(assets: Asset[]): Promise<void> {
    const files: AssetExportEntry[] = [];
    const zipFiles: { name: string; data: BlobPart }[] = [];

    await Promise.all(
        assets.map(async (asset) => {
            if (asset.kind !== "image" && asset.kind !== "video") return;
            const storageKey = asset.data.storageKey;
            if (!storageKey) return;
            const blob = asset.kind === "image" ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
            if (!blob) return;
            const path = `files/${sanitizeFileName(storageKey)}.${extensionFromMime(blob.type, asset.kind)}`;
            files.push({ storageKey, path, mimeType: blob.type || asset.data.mimeType, bytes: blob.size });
            zipFiles.push({ name: path, data: blob });
        }),
    );

    const data: AssetExportFile = {
        app: EXPORT_APP_ID,
        version: EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        assets,
        files: files.sort((left, right) => left.path.localeCompare(right.path)),
    };
    const sortedZipFiles = zipFiles.sort((left, right) => left.name.localeCompare(right.name));
    const zip = await createZip([{ name: "assets.json", data: JSON.stringify(data, null, 2) }, ...sortedZipFiles]);
    saveAs(zip, `${DEFAULT_EXPORT_NAME}.zip`);
}

/**
 * 读取素材导出包并还原其中的资源到本地存储。
 * <p>
 * 按 storageKey 前缀分流写回图片或媒体存储；blob 无类型时用清单中的 mimeType 补全。
 *
 * @param file zip 文件
 * @return 还原出的素材数组
 * @throws Error 缺少 assets.json 时抛出
 */
export async function readAssetPackage(file: File): Promise<Asset[]> {
    const zip = await readZip(file);
    const manifestBlob = zip.get("assets.json");
    if (!manifestBlob) throw new Error("missing assets.json");
    const data = JSON.parse(await manifestBlob.text()) as AssetExportFile;
    validateAssetPackage(data);

    await Promise.all(
        data.files.map(async (entry) => {
            const blob = zip.get(entry.path);
            if (!blob) return;
            const typedBlob = blob.type ? blob : blob.slice(0, blob.size, entry.mimeType);
            if (entry.storageKey.startsWith(IMAGE_STORAGE_PREFIX)) {
                await setImageBlob(entry.storageKey, typedBlob);
            } else {
                await setMediaBlob(entry.storageKey, typedBlob);
            }
        }),
    );
    return data.assets;
}

/** 校验素材归档来源与格式版本。 */
function validateAssetPackage(data: AssetExportFile): void {
    if (data.app !== EXPORT_APP_ID || data.version !== EXPORT_VERSION || !Array.isArray(data.assets) || !Array.isArray(data.files)) {
        throw new Error("invalid assets package");
    }
}

/** 把文件名中的非法字符替换为下划线。 */
function sanitizeFileName(value: string): string {
    return value.replace(/[\\/:*?"<>|]/g, "_");
}

/** 由 MIME 推断扩展名，回退按素材类型取 png/bin。 */
function extensionFromMime(mimeType: string, kind: Asset["kind"]): string {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    return kind === "image" ? "png" : "bin";
}
