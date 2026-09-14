/** 规范化音频裁剪区间，返回毫秒精度的有效范围。 */
export function normalizeAudioTrimRange(durationMs: number | undefined, startMs?: number, endMs?: number) {
    const originalDurationMs = Number.isFinite(durationMs) && (durationMs || 0) > 0 ? Math.round(durationMs as number) : 0;
    const start = clamp(Number.isFinite(startMs) ? Math.round(startMs as number) : 0, 0, originalDurationMs);
    const end = clamp(Number.isFinite(endMs) ? Math.round(endMs as number) : originalDurationMs, start, originalDurationMs);
    return { startMs: start, endMs: end, durationMs: Math.max(0, end - start), originalDurationMs };
}

/** 读取画布音频节点的有效播放时长。 */
export function audioNodeTrimRange(content: { durationMilliseconds?: number; trimStartMilliseconds?: number; trimEndMilliseconds?: number }) {
    return normalizeAudioTrimRange(content.durationMilliseconds, content.trimStartMilliseconds, content.trimEndMilliseconds);
}

function clamp(value: number, minimum: number, maximum: number) {
    return Math.min(maximum, Math.max(minimum, value));
}
