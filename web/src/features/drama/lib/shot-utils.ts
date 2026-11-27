import type { DramaMedia, DramaShotItem } from "@/services/api/drama";

/** 带累积时间轴信息的分镜项。 */
export type TimedDramaShot = DramaShotItem & {
    index: number;
    startSec: number;
    endSec: number;
};

type RawRecord = Record<string, unknown>;

function readText(value: unknown): string {
    return typeof value === "string" ? value : value == null ? "" : String(value);
}

/** 从分镜版本 content 中解析标准化的分镜列表。 */
export function parseShotList(content: Record<string, unknown> | undefined): DramaShotItem[] {
    const raw = content?.shots;
    if (!Array.isArray(raw)) return [];
    const list: DramaShotItem[] = [];
    for (let index = 0; index < raw.length; index += 1) {
        const entry = raw[index];
        if (!entry || typeof entry !== "object") continue;
        const row = entry as RawRecord;
        const ref = readText(row.ref).trim();
        if (!ref) continue;
        const durationRaw = Number(row.durationSeconds);
        const durationSeconds = Number.isFinite(durationRaw) && durationRaw >= 1 ? Math.min(60, Math.round(durationRaw)) : 5;
        const orderRaw = Number(row.order);
        list.push({
            id: readText(row.id).trim(),
            ref,
            order: Number.isFinite(orderRaw) && orderRaw >= 1 ? Math.round(orderRaw) : index + 1,
            durationSeconds,
            title: readText(row.title).trim(),
            size: readText(row.size).trim(),
            camera: readText(row.camera).trim(),
            picture: readText(row.picture),
            dialogue: readText(row.dialogue),
            videoPrompt: readText(row.videoPrompt),
            screenText: readText(row.screenText),
            rhythm: readText(row.rhythm).trim(),
            characterRef: readText(row.characterRef).trim(),
            locationRef: readText(row.locationRef).trim(),
        });
    }
    return list;
}

/** 计算每个镜头的累积起止时间及整集总时长。 */
export function computeShotTimeline(shots: DramaShotItem[]): { items: TimedDramaShot[]; totalSeconds: number } {
    let cursor = 0;
    const items: TimedDramaShot[] = shots.map((shot, index) => {
        const startSec = cursor;
        const endSec = cursor + Math.max(1, shot.durationSeconds);
        cursor = endSec;
        return { ...shot, index, startSec, endSec };
    });
    return { items, totalSeconds: cursor };
}

/** 格式化时间码为 M:SS.0（例如 0:06.0、1:22.0）。 */
export function formatTimecode(seconds: number): string {
    const safe = Math.max(0, seconds);
    const minutes = Math.floor(safe / 60);
    const remain = safe - minutes * 60;
    const whole = Math.floor(remain);
    const tenths = Math.floor((remain - whole) * 10 + 1e-6);
    return `${minutes}:${String(whole).padStart(2, "0")}.${tenths}`;
}

/** 两位镜头编号（01, 02...）。 */
export function formatShotNumber(index: number): string {
    return String(index + 1).padStart(2, "0");
}

/** 镜头显示标题：优先自定义标题，其次景别，再次截取画面前段。 */
export function shotDisplayTitle(shot: DramaShotItem, index: number): string {
    if (shot.title.trim()) return shot.title.trim();
    const pictureSummary = shot.picture.trim().replace(/\s+/g, " ");
    if (pictureSummary) {
        const clipped = pictureSummary.length > 14 ? `${pictureSummary.slice(0, 14)}…` : pictureSummary;
        return clipped;
    }
    if (shot.size.trim()) return shot.size.trim();
    return `镜头 ${formatShotNumber(index)}`;
}

/** 统计全部镜头的有效旁白/对白字数（忽略空白与标点）。 */
export function countDialogueChars(shots: DramaShotItem[]): number {
    return shots.reduce((sum, shot) => sum + shot.dialogue.replace(/[\s，。！？、；：""''（）()【】\[\],.!?;:\-—…]/g, "").length, 0);
}

/** 估算对白/旁白所需朗读时长（按中文 ~4.5 字/秒），判断是否超出当前镜头时长。 */
export function estimateSpeechOverflow(dialogue: string, durationSeconds: number): { estimatedSeconds: number; overflowSeconds: number } | null {
    const clean = dialogue.replace(/[\s，。！？、；：""''（）()【】\[\],.!?;:\-—…]/g, "");
    if (!clean.length) return null;
    const estimatedSeconds = Number((clean.length / 4.5).toFixed(1));
    const overflowSeconds = Number((estimatedSeconds - durationSeconds).toFixed(1));
    if (overflowSeconds <= 0.5) return null;
    return { estimatedSeconds, overflowSeconds };
}

/** 获取镜头的最佳缩略图（优先首帧，其次尾帧，再看是否有视频）。 */
export function resolveShotThumbnail(ref: string, mediaByKey: Record<string, DramaMedia | undefined>): { kind: "image" | "video" | "none"; url: string } {
    const first = mediaByKey[`shot-first:${ref}`];
    if (first?.status === "success" && first.url) return { kind: "image", url: first.url };
    const last = mediaByKey[`shot-last:${ref}`];
    if (last?.status === "success" && last.url) return { kind: "image", url: last.url };
    const video = mediaByKey[`shot-video:${ref}`];
    if (video?.status === "success" && video.url) return { kind: "video", url: video.url };
    return { kind: "none", url: "" };
}
