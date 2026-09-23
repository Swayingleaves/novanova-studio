import type { ComicDramaShot, ComicDramaTimelineText, ComicDramaVoiceTrack } from "../types";

/** 项目绝对时间轴上的镜头区间。 */
export type ShotInterval = { shot: ComicDramaShot; startMs: number; endMs: number };

/** 按镜头排序和实际时长建立统一的项目时间坐标。 */
export function buildShotIntervals(shots: ComicDramaShot[], durationOf: (shot: ComicDramaShot) => number): ShotInterval[] {
    let cursorMs = 0;
    return [...shots].sort((first, second) => first.sortOrder - second.sortOrder).map((shot) => {
        const startMs = cursorMs;
        cursorMs += Math.round(durationOf(shot) * 1000);
        return { shot, startMs, endMs: cursorMs };
    });
}

/** 读取当前时刻可见的文字片段。 */
export function visibleTimelineTexts(texts: ComicDramaTimelineText[], timeMs: number): ComicDramaTimelineText[] {
    return texts.filter((item) => item.startMs <= timeMs && timeMs < item.endMs);
}

/** 判断两段项目时间是否重叠。 */
export function timelineTextOverlaps(first: Pick<ComicDramaTimelineText, "startMs" | "endMs">, second: Pick<ComicDramaTimelineText, "startMs" | "endMs">): boolean {
    return first.startMs < second.endMs && second.startMs < first.endMs;
}

/** 拖动片段前缘或后缘越过同轨片段中心时重排，保持各片段时长与原有间隙。 */
export function reorderTimelineTexts(texts: ComicDramaTimelineText[], draggedId: string, draggedStartMs: number): ComicDramaTimelineText[] {
    const dragged = texts.find((item) => item.id === draggedId);
    if (!dragged) return [];
    const ordered = texts.filter((item) => item.trackNumber === dragged.trackNumber)
        .sort((first, second) => first.startMs - second.startMs);
    const fromIndex = ordered.findIndex((item) => item.id === draggedId);
    const movingLeft = draggedStartMs < dragged.startMs;
    const draggedEdgeMs = movingLeft ? draggedStartMs : draggedStartMs + dragged.endMs - dragged.startMs;
    const toIndex = ordered.filter((item) => item.id !== draggedId && (movingLeft
        ? (item.startMs + item.endMs) / 2 <= draggedEdgeMs
        : (item.startMs + item.endMs) / 2 < draggedEdgeMs)).length;
    if (fromIndex === toIndex) return [];

    const reordered = [...ordered];
    reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, dragged);
    const firstIndex = Math.min(fromIndex, toIndex);
    const lastIndex = Math.max(fromIndex, toIndex);
    let startMs = ordered[firstIndex].startMs;
    return reordered.slice(firstIndex, lastIndex + 1).map((item, index) => {
        const slotIndex = firstIndex + index;
        const endMs = startMs + item.endMs - item.startMs;
        const updated = { ...item, startMs, endMs };
        startMs = endMs + (slotIndex < ordered.length - 1 ? ordered[slotIndex + 1].startMs - ordered[slotIndex].endMs : 0);
        return updated;
    });
}

/** 在播放头位置选取可容纳新片段的轨道，并在下一片段之前截断默认时长。 */
export function availableTextTrackPlacement(texts: ComicDramaTimelineText[], startMs: number, projectEndMs: number): { trackNumber: number; endMs: number } | null {
    for (let trackNumber = 0; trackNumber < 3; trackNumber += 1) {
        const trackTexts = texts.filter((item) => item.trackNumber === trackNumber);
        if (trackTexts.some((item) => item.startMs <= startMs && startMs < item.endMs)) continue;
        const nextStartMs = Math.min(projectEndMs, ...trackTexts.filter((item) => item.startMs > startMs).map((item) => item.startMs));
        const endMs = Math.min(startMs + 3000, nextStartMs);
        if (endMs - startMs >= 100) return { trackNumber, endMs };
    }
    return null;
}

/** 读取声音条目在时间轴上的播放终点。 */
export function voiceTrackEndMs(track: ComicDramaVoiceTrack): number | null {
    if (track.timelineStartMs == null || track.trimStartMs == null || track.trimEndMs == null) return null;
    return track.timelineStartMs + track.trimEndMs - track.trimStartMs;
}

/** 将项目时间映射为源音频时间；不在播放区间时返回空值。 */
export function voiceTrackSourceTimeMs(track: ComicDramaVoiceTrack, projectTimeMs: number): number | null {
    const endMs = voiceTrackEndMs(track);
    if (endMs == null || track.timelineStartMs == null || track.trimStartMs == null || projectTimeMs < track.timelineStartMs || projectTimeMs >= endMs) return null;
    return track.trimStartMs + projectTimeMs - track.timelineStartMs;
}

/** 将片段起点限制在项目范围内，并保持片段长度不变。 */
export function clampTimelineStart(startMs: number, durationMs: number, projectDurationMs: number): number {
    return Math.max(0, Math.min(Math.round(startMs), Math.max(0, projectDurationMs - durationMs)));
}

/** 将叠字中心限制在画面范围内，兼顾文字本身的宽高。 */
export function clampPreviewPosition(position: number, elementSize: number, frameSize: number): number {
    if (frameSize <= 0) return 0.5;
    const half = Math.min(0.5, elementSize / (2 * frameSize));
    return Math.max(half, Math.min(1 - half, position));
}
