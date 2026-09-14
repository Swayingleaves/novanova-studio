import type { ReferenceAudio } from "@/features/generation/types/media";

export type AudioReferenceIdentitySource = {
    id?: string;
    storageKey?: string;
    objectStorage?: { key?: string; url?: string };
    url?: string;
    previewUrl?: string;
    trimStartMs?: number;
    trimEndMs?: number;
    durationMs?: number;
};

/** 返回音频引用的全部稳定身份键，覆盖存储键刷新地址和裁剪区间。 */
export function audioReferenceIdentityKeys(audio: AudioReferenceIdentitySource): string[] {
    const trimKey = audio.trimStartMs === undefined && audio.trimEndMs === undefined
        ? "full"
        : `${audio.trimStartMs ?? 0}:${audio.trimEndMs ?? audio.durationMs ?? 0}`;
    const locations = [audio.storageKey, audio.objectStorage?.key, audio.objectStorage?.url, audio.url, audio.previewUrl]
        .filter((key): key is string => Boolean(key));
    const candidates = locations.length ? locations : [audio.id];
    return [...new Set(candidates
        .filter((key): key is string => Boolean(key))
        .map((key) => `${key}:${trimKey}`))];
}

/** 按媒体标识去重，保留首次出现的音频与顺序。 */
export function mergeAudioReferences(...groups: ReferenceAudio[][]): ReferenceAudio[] {
    const seen = new Set<string>();
    return groups.flat().filter((audio) => {
        const keys = audioReferenceIdentityKeys(audio);
        const duplicate = keys.some((key) => seen.has(key));
        keys.forEach((key) => seen.add(key));
        return !duplicate;
    });
}
