/** 按时间窗口提取所有声道的峰值，静音保持为零，返回固定的128段波形。 */
export function extractWaveformPeaks(channels: Float32Array[]): number[] {
    const length = channels[0]?.length || 0;
    return Array.from({ length: 128 }, (_, index) => {
        const start = Math.floor(index * length / 128);
        const end = Math.floor((index + 1) * length / 128);
        let peak = 0;
        for (const channel of channels) {
            for (let sample = start; sample < end; sample++) peak = Math.max(peak, Math.abs(channel[sample]));
        }
        return Math.round(Math.min(1, peak) * 1000) / 1000;
    });
}

/** 将秒数显示为分钟和秒，未知时长显示为零。 */
export function formatAudioTime(seconds: number): string {
    const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
    return `${Math.floor(value / 60).toString().padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`;
}
