export function hasPlayableVideoUrl(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

export function findLatestPlayableVideo<T extends { url?: unknown }>(results: readonly ({ video?: T | null } | null | undefined)[]): T | undefined {
    for (let index = results.length - 1; index >= 0; index -= 1) {
        const video = results[index]?.video;
        if (video && hasPlayableVideoUrl(video.url)) return video;
    }
    return undefined;
}
