/**
 * 浏览器端参考视频关键帧抽取工具：
 * 优先使用本地 File（ObjectURL，避免远程 OSS CORS 报错），读取视频精确时长与画幅比例，
 * 沿时间轴均匀抽取关键帧并拼成一张带时间戳的网格图（兼顾体积与多模态全局理解）。
 */

export type ExtractedVideoKeyframes = {
    durationSeconds: number;
    width: number;
    height: number;
    aspect: string;
    frameCount: number;
    contactSheetDataUrl: string;
};

function inferAspect(width: number, height: number): string {
    if (!width || !height) return "16:9";
    const ratio = width / height;
    const candidates: [string, number][] = [
        ["16:9", 16 / 9],
        ["9:16", 9 / 16],
        ["1:1", 1],
        ["4:3", 4 / 3],
        ["3:4", 3 / 4],
        ["21:9", 21 / 9],
    ];
    let best = "16:9";
    let minDiff = Number.POSITIVE_INFINITY;
    for (const [label, target] of candidates) {
        const diff = Math.abs(ratio - target);
        if (diff < minDiff) {
            minDiff = diff;
            best = label;
        }
    }
    return best;
}

function waitForEvent(target: EventTarget, eventName: string, timeoutMs = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
            cleanup();
            reject(new Error(`等待视频事件 ${eventName} 超时`));
        }, timeoutMs);
        const onSuccess = () => {
            cleanup();
            resolve();
        };
        const onError = () => {
            cleanup();
            reject(new Error("视频解码失败"));
        };
        const cleanup = () => {
            window.clearTimeout(timer);
            target.removeEventListener(eventName, onSuccess);
            target.removeEventListener("error", onError);
        };
        target.addEventListener(eventName, onSuccess, { once: true });
        target.addEventListener("error", onError, { once: true });
    });
}

async function seekTo(video: HTMLVideoElement, targetTime: number): Promise<void> {
    // 浏览器中将 currentTime 设为与当前值相同（例如初始即为 0 时设 0）不会触发 seeked 事件，必须跳过等待
    if (Math.abs(video.currentTime - targetTime) < 0.015 && video.readyState >= 2) {
        return;
    }
    const seeked = waitForEvent(video, "seeked");
    video.currentTime = targetTime;
    await seeked;
}

/**
 * 从本地 File 或视频 URL 中抽取 6~9 张均匀分布的关键帧，拼成带时间戳的网格图。
 */
export async function extractVideoKeyframes(source: File | string): Promise<ExtractedVideoKeyframes> {
    const isLocalFile = typeof source !== "string";
    let objectUrl: string | null = isLocalFile ? URL.createObjectURL(source) : null;
    if (!isLocalFile && source) {
        // 优先通过 fetch 拉取为同源 Blob，避免远程/对象存储 URL 触发 Canvas 跨域污染
        try {
            const response = await fetch(source, { credentials: "include" });
            if (response.ok) {
                const blob = await response.blob();
                objectUrl = URL.createObjectURL(blob);
            }
        } catch {
            // 回退直接加载 URL
        }
    }
    const video = document.createElement("video");
    if (!objectUrl) {
        video.crossOrigin = "anonymous";
    }
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = objectUrl ?? (typeof source === "string" ? source : "");

    try {
        if (video.readyState < 2) {
            await waitForEvent(video, "loadeddata");
        }
        const duration = Number.isFinite(video.duration) && video.duration > 0 ? Math.min(60, video.duration) : 5;
        const width = video.videoWidth || 1280;
        const height = video.videoHeight || 720;
        const aspect = inferAspect(width, height);

        const cols = 3;
        const rows = duration > 10 ? 3 : 2;
        const count = cols * rows;
        const cellMaxSide = 320;
        const scale = Math.min(1, cellMaxSide / Math.max(width, height));
        const cw = Math.max(64, Math.round(width * scale));
        const ch = Math.max(64, Math.round(height * scale));

        const sheet = document.createElement("canvas");
        sheet.width = cw * cols;
        sheet.height = ch * rows;
        const ctx = sheet.getContext("2d");
        if (!ctx) throw new Error("无法创建画布上下文");
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, sheet.width, sheet.height);

        for (let i = 0; i < count; i++) {
            const targetTime = Math.min(Math.max(0.05, duration - 0.05), i === 0 ? 0.05 : (duration * i) / (count - 1));
            await seekTo(video, targetTime);
            const col = i % cols;
            const row = Math.floor(i / cols);
            const dx = col * cw;
            const dy = row * ch;
            ctx.drawImage(video, dx, dy, cw, ch);
            ctx.fillStyle = "rgba(0,0,0,0.68)";
            ctx.fillRect(dx + 6, dy + 6, 86, 22);
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 12px monospace";
            ctx.fillText(`#${i + 1} t=${targetTime.toFixed(1)}s`, dx + 10, dy + 21);
        }

        return {
            durationSeconds: Number(duration.toFixed(1)),
            width,
            height,
            aspect,
            frameCount: count,
            contactSheetDataUrl: sheet.toDataURL("image/jpeg", 0.82),
        };
    } finally {
        video.pause();
        video.removeAttribute("src");
        video.load();
        if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
        }
    }
}
