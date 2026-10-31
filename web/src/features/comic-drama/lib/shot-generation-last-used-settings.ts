import { teamStorageKey } from "@/features/team/stores/use-team-store";
import localforage from "localforage";

/** 视觉分镜板镜头生成的上次选择，切换镜头时沿用。 */
export type ShotGenerationLastUsedSettings = {
    /** 生成模型 */
    model: string;
    /** 画面比例对应的当前模型 size 取值 */
    size: string;
    /** 清晰度 */
    vquality: string;
};

const storage = localforage.createInstance({
    name: "novanova-studio",
    storeName: "comic_drama_shot_generation_settings",
});

let cached: ShotGenerationLastUsedSettings | null = null;
let cachedKey = "";
let writeQueue = Promise.resolve();

/** 同步读取已加载的上次配置；未加载完成或切换团队后返回空对象，由调用方回落到全局默认。 */
export function readShotGenerationLastUsedSettingsCache(): Partial<ShotGenerationLastUsedSettings> {
    return cached && cachedKey === teamStorageKey("shotGeneration") ? cached : {};
}

/** 读取上次使用的镜头生成配置，结果同时写入内存缓存供下次同步读取。 */
export async function loadShotGenerationLastUsedSettings(): Promise<Partial<ShotGenerationLastUsedSettings>> {
    const key = teamStorageKey("shotGeneration");
    if (cached && cachedKey === key) return cached;
    const saved = await storage.getItem<Partial<ShotGenerationLastUsedSettings>>(key);
    cachedKey = key;
    cached = { model: saved?.model || "", size: saved?.size || "", vquality: saved?.vquality || "" };
    return cached;
}

/** 保存镜头生成配置，按顺序写入避免并发覆盖，并同步更新内存缓存。 */
export function saveShotGenerationLastUsedSettings(settings: ShotGenerationLastUsedSettings): Promise<void> {
    const key = teamStorageKey("shotGeneration");
    cached = settings;
    cachedKey = key;
    writeQueue = writeQueue.catch(() => undefined).then(async () => {
        await storage.setItem(key, settings);
    });
    return writeQueue;
}
