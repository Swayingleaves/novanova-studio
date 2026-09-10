import type { ReferenceAudio } from "@/features/generation/types/media";

/** 按媒体标识去重，保留首次出现的音频与顺序。 */
export function mergeAudioReferences(...groups: ReferenceAudio[][]): ReferenceAudio[] {
    const seen = new Set<string>();
    return groups.flat().filter((audio) => {
        const keys = [audio.storageKey, audio.objectStorage?.url, audio.url].filter((key): key is string => Boolean(key));
        const duplicate = keys.some((key) => seen.has(key));
        keys.forEach((key) => seen.add(key));
        return !duplicate;
    });
}
