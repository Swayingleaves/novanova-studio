import type { ReferenceImage } from "@/features/generation/types/image";

/** 字节单位阶梯，1024 进制。 */
const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;
/** data URL 解析失败时的兜底宽高。 */
const FALLBACK_DIMENSION = 1024;
/** 图片元信息读取的超时（毫秒），超时后回退兜底值。 */
const META_TIMEOUT_MS = 3000;

/**
 * 把字节数格式化为人类可读的体积串。
 * <p>
 * 整数部分小于 10 且非 B 级时保留一位小数，否则取整。
 *
 * @param bytes 字节数
 * @return 如 "12 KB"、"1.5 MB"；非正或非有限数返回空串
 */
export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return "";
    }
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    const showDecimal = value < 10 && unitIndex > 0;
    return `${showDecimal ? value.toFixed(1) : value.toFixed(0)} ${BYTE_UNITS[unitIndex]}`;
}

/**
 * 把毫秒时长格式化为中文时长串。
 *
 * @param ms 毫秒数，负数会被截到 0
 * @return 不足 1 分时如 "3秒"；满 1 分时如 "1分05秒"
 */
export function formatDuration(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes === 0) {
        return `${seconds}秒`;
    }
    return `${minutes}分${String(seconds).padStart(2, "0")}秒`;
}

/**
 * 估算 data URL 解码后的字节数。
 * <p>
 * 按 base64 每 4 字符约 3 字节计算，再扣除尾部填充符。
 *
 * @param dataUrl data URL 字符串
 * @return 解码字节数；无 base64 段时返回 0
 */
export function getDataUrlByteSize(dataUrl: string): number {
    const base64 = dataUrl.split(",", 2)[1];
    if (!base64) {
        return 0;
    }
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

/**
 * 通过 FileReader 把文件读成 data URL。
 *
 * @param file 浏览器文件对象
 * @return data URL 字符串
 * @throws Error 读取失败
 */
export function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(file);
    });
}

/** 图片元信息读取结果。 */
export interface ImageMeta {
    width: number;
    height: number;
    mimeType: string;
}

/**
 * 读取 data URL 图片的宽高与 MIME 类型。
 * <p>
 * 以 Image.onload 为准；onerror 或超时（3s）时回退到 1024×1024 与从 data URL 头解析的 MIME。
 *
 * @param dataUrl data URL 字符串
 * @return 图片元信息
 */
export function readImageMeta(dataUrl: string): Promise<ImageMeta> {
    return new Promise((resolve) => {
        const image = new Image();
        let settled = false;
        const finalize = () => {
            if (settled) return;
            settled = true;
            resolve({
                width: image.naturalWidth || FALLBACK_DIMENSION,
                height: image.naturalHeight || FALLBACK_DIMENSION,
                mimeType: dataUrl.match(/^data:([^;]+)/)?.[1] || "image/png",
            });
        };
        image.onload = finalize;
        image.onerror = finalize;
        setTimeout(finalize, META_TIMEOUT_MS);
        image.src = dataUrl;
    });
}

/**
 * 把 ReferenceImage 的 data URL 还原为 File 对象。
 * <p>
 * MIME 取 data URL 头中的声明，回退到 image.type，再回退到 image/png。
 *
 * @param image 参考图对象
 * @return 重建的 File 对象
 */
export function dataUrlToFile(image: ReferenceImage): File {
    const [header, content = ""] = image.dataUrl.split(",", 2);
    const mimeType = header.match(/data:(.*?);base64/)?.[1] || image.type || "image/png";
    const binary = atob(content);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new File([bytes], image.name || "reference.png", { type: mimeType });
}
