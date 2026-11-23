/** 截取节点正在显示的画面；跨域画面优先通过媒体下载重新读取。 */
export async function captureCanvasVideoFrame(
    video: HTMLVideoElement,
    readVideo: () => Promise<Blob | null>,
    signal: AbortSignal,
): Promise<Blob> {
    signal.throwIfAborted();
    video.pause();
    if (video.seeking) await waitForFrame(video, "seeked", signal);
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) await waitForFrame(video, "loadeddata", signal);
    signal.throwIfAborted();
    const time = video.currentTime;
    try {
        return await encodeFrame(video);
    } catch (error) {
        if (!(error instanceof DOMException) || error.name !== "SecurityError") throw error;
    }

    signal.throwIfAborted();
    const blob = await readVideo();
    signal.throwIfAborted();
    if (!blob) throw new Error("Video is unavailable");
    const source = URL.createObjectURL(blob);
    const copy = document.createElement("video");
    try {
        copy.preload = "auto";
        const loaded = waitForFrame(copy, "loadeddata", signal);
        copy.src = source;
        await loaded;
        // 播放到结尾时取最后可解码的画面，而不是跳到时长界外。
        const position = Number.isFinite(copy.duration) ? Math.min(time, Math.max(0, copy.duration - 0.001)) : time;
        if (position !== copy.currentTime) {
            copy.currentTime = position;
            if (copy.seeking) await waitForFrame(copy, "seeked", signal);
        }
        return await encodeFrame(copy);
    } finally {
        copy.removeAttribute("src");
        copy.load();
        URL.revokeObjectURL(source);
    }
}

function encodeFrame(video: HTMLVideoElement): Promise<Blob> {
    if (!video.videoWidth || !video.videoHeight) throw new Error("Video frame is unavailable");
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable");
    context.drawImage(video, 0, 0);
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not encode the video frame")), "image/png");
    });
}

function waitForFrame(video: HTMLVideoElement, eventName: "loadeddata" | "seeked", signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        signal.throwIfAborted();
        if (video.error) throw new Error("Could not decode the video frame");
        const cleanup = () => {
            clearTimeout(timer);
            video.removeEventListener(eventName, ready);
            video.removeEventListener("error", failed);
            signal.removeEventListener("abort", aborted);
        };
        const ready = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(new Error("Could not decode the video frame")); };
        const aborted = () => { cleanup(); reject(signal.reason); };
        const timer = setTimeout(failed, 15_000);
        video.addEventListener(eventName, ready);
        video.addEventListener("error", failed);
        signal.addEventListener("abort", aborted);
    });
}
