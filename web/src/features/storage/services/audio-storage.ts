"use client";

import { uploadMediaFile } from "./file-storage";
import { extractWaveformPeaks } from "../utils/audio-waveform";

/** 判断文件是否属于首期支持的音频格式；实际内容仍须通过解码验证。 */
export function isAudioFile(file: File): boolean {
    return /\.(mp3|wav)$/i.test(file.name) || ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave"].includes(file.type);
}

/** 解码上传文件，保存真实时长与固定长度波形，不保留解码缓冲区。 */
export async function uploadAudioFile(file: File) {
    if (!isAudioFile(file)) throw new Error("音频仅支持 MP3、WAV 格式");
    if (!file.size || file.size > 15 * 1024 * 1024) throw new Error("音频不能为空，且单文件不能超过 15 MB");
    const { durationMs, waveformPeaks } = await readAudioMetadata(file);
    const mimeType = /\.wav$/i.test(file.name) || file.type.includes("wav") ? "audio/wav" : "audio/mpeg";
    const uploaded = await uploadMediaFile(file, "audio", { mimeType, durationMs });
    return { ...uploaded, durationMs, waveformPeaks };
}

/** 使用浏览器解码器读取上传和归档恢复的音频元数据。 */
export async function readAudioMetadata(file: Blob) {
    if (!file.size || file.size > 15 * 1024 * 1024) throw new Error("音频不能为空，且单文件不能超过 15 MB");
    const context = new AudioContext();
    let durationMs: number;
    let waveformPeaks: number[];
    try {
        const buffer = await context.decodeAudioData(await file.arrayBuffer());
        if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) throw new Error("音频时长无效");
        durationMs = Math.round(buffer.duration * 1000);
        waveformPeaks = extractWaveformPeaks(Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index)));
    } catch {
        throw new Error("音频解析失败，请选择有效的 MP3 或 WAV 文件");
    } finally {
        await context.close();
    }
    return { durationMs, waveformPeaks };
}
