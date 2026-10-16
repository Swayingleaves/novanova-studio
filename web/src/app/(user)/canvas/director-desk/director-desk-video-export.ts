
import { translateMessage as translate } from "@/features/locale/translate";
type FrameEncodingOptions = {
    frameCount: number;
    frameRate: number;
    renderFrame: (timeMilliseconds: number) => Promise<void>;
    encodeFrame: (timestampSeconds: number, durationSeconds: number) => Promise<void>;
    onProgress: (progress: number) => void;
};

/**
 * 渲染与编码按同一个帧序号推进，并等待编码器背压；计算时间不影响成片时长。
 * 每隔若干帧让出主线程，以便刷新导出进度，不缓存PNG或全部原始帧。
 */
export async function encodeDirectorDeskFrames({ frameCount, frameRate, renderFrame, encodeFrame, onProgress }: FrameEncodingOptions): Promise<void> {
    if (!Number.isInteger(frameCount) || frameCount <= 0 || frameRate !== 30) throw new Error(translate("directorDesk.directorVideoNeedsAValidFrameCountAnd30"));
    for (let index = 0; index < frameCount; index += 1) {
        await renderFrame(Number((index * 1000 / frameRate).toFixed(6)));
        await encodeFrame(index / frameRate, 1 / frameRate);
        onProgress(Math.round((index + 1) / frameCount * 100));
        if ((index + 1) % 10 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
}

/** 使用浏览器WebCodecs编码H.264并封装MP4，完成后返回唯一待上传文件。 */
export async function encodeDirectorDeskVideo({ canvas, durationMilliseconds, renderFrame, onProgress }: {
    canvas: HTMLCanvasElement;
    durationMilliseconds: number;
    renderFrame: (timeMilliseconds: number) => Promise<void>;
    onProgress: (progress: number) => void;
}): Promise<Blob> {
    if (!globalThis.isSecureContext || typeof globalThis.VideoEncoder === "undefined") {
        throw new Error(translate("directorDesk.localVideoEncodingUnavailableUseAWebCodecsBrowserOver"));
    }
    const { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, canEncodeVideo } = await import("mediabunny");
    const quality = new Quality({ bitrate: 6_000_000 });
    if (!await canEncodeVideo("avc", { width: canvas.width, height: canvas.height, frameRate: 30, quality })) {
        throw new Error(translate("directorDesk.thisBrowserCannotEncodeH264AtThisSize"));
    }
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
    try {
        const source = new CanvasSource(canvas, { codec: "avc", quality, keyFrameInterval: 2 });
        output.addVideoTrack(source, { frameRate: 30 });
        await output.start();
        await encodeDirectorDeskFrames({
            frameCount: Math.round(durationMilliseconds * 30 / 1000), frameRate: 30, renderFrame,
            encodeFrame: (timestamp, duration) => source.add(timestamp, duration), onProgress,
        });
        source.close();
        await output.finalize();
        if (!output.target.buffer?.byteLength) throw new Error(translate("directorDesk.browserVideoEncoderReturnedNoData"));
        return new Blob([output.target.buffer], { type: "video/mp4" });
    } catch (error) {
        if (output.state !== "finalized") {
            try { await output.cancel(); }
            catch (cleanupError) { console.error("释放导演台视频编码资源失败", cleanupError); }
        }
        throw error;
    }
}
