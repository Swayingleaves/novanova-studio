import { translateMessage as translate } from "@/features/locale/translate";

export const IMAGE_RESOLUTIONS = ["1K", "2K", "4K"] as const;
export type ImageResolution = (typeof IMAGE_RESOLUTIONS)[number];
export type ImageSizeMappings = Record<string, Partial<Record<ImageResolution, string>>>;

/** 默认尺寸按约定表精确取值，比例顺序与图片设置面板一致。 */
const DEFAULT_IMAGE_SIZE_MAPPINGS: ImageSizeMappings = {
    "1:1": { "1K": "1024x1024", "2K": "2048x2048", "4K": "2880x2880" },
    "1:2": { "1K": "512x1024", "2K": "1024x2048", "4K": "1648x3296" },
    "2:1": { "1K": "1024x512", "2K": "2048x1024", "4K": "3296x1648" },
    "9:16": { "1K": "720x1280", "2K": "1152x2048", "4K": "2160x3840" },
    "16:9": { "1K": "1280x720", "2K": "2048x1152", "4K": "3840x2160" },
    "3:4": { "1K": "864x1152", "2K": "1536x2048", "4K": "2448x3264" },
    "4:3": { "1K": "1152x864", "2K": "2048x1536", "4K": "3264x2448" },
    "3:2": { "1K": "1536x1024", "2K": "2400x1600", "4K": "3456x2304" },
    "2:3": { "1K": "1024x1536", "2K": "1600x2400", "4K": "2304x3456" },
    "5:4": { "1K": "1120x896", "2K": "2240x1792", "4K": "3200x2560" },
    "4:5": { "1K": "896x1120", "2K": "1792x2240", "4K": "2560x3200" },
    "21:9": { "1K": "1344x576", "2K": "2016x864", "4K": "3808x1632" },
    "9:21": { "1K": "576x1344", "2K": "864x2016", "4K": "1632x3808" },
};

export const IMAGE_ASPECT_RATIOS = Object.keys(DEFAULT_IMAGE_SIZE_MAPPINGS);

/** 深拷贝模型尺寸表，避免编辑一个模型时影响默认表或其他模型。 */
export function cloneImageSizeMappings(mappings: ImageSizeMappings | null | undefined = null): ImageSizeMappings {
    return Object.fromEntries(Object.entries(mappings ?? DEFAULT_IMAGE_SIZE_MAPPINGS).map(([ratio, sizes]) => [ratio, { ...sizes }]));
}

/** 检查像素输入，空白表示该比例与档位未配置。 */
export function isValidImagePixelSize(value: string): boolean {
    return !value.trim() || /^[1-9]\d*\s*[xX×]\s*[1-9]\d*$/.test(value.trim());
}

/** 保存前校验并规范化尺寸，未填档位不使用其他尺寸替代。 */
export function normalizeImageSizeMappings(mappings: ImageSizeMappings | null | undefined): ImageSizeMappings {
    return Object.fromEntries(Object.entries(cloneImageSizeMappings(mappings)).map(([ratio, sizes]) => {
        if (!/^[1-9]\d*:[1-9]\d*$/.test(ratio)) throw new Error(translate("appShell.invalidImageSizeMappings"));
        const normalized = Object.entries(sizes).filter(([, value]) => value?.trim()).map(([resolution, value]) => {
            if (!IMAGE_RESOLUTIONS.includes(resolution as ImageResolution) || !value || !isValidImagePixelSize(value)) {
                throw new Error(translate("appShell.invalidImageSizeMappings"));
            }
            return [resolution, value.trim().replace(/\s*[xX×]\s*/, "x")];
        });
        return [ratio, Object.fromEntries(normalized)];
    }));
}
