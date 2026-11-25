import { FilesetResolver, PoseLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";

/** 单个关节点（x/y 为画面归一化坐标 [0,1]，z 为相对深度，visibility 为可见度）。 */
export type PoseLandmark = {
    x: number;
    y: number;
    z: number;
    visibility: number;
};

/** 某一时刻捕捉到的所有人物（每人 33 个 MediaPipe 关节点）。 */
export type PoseFrame = {
    timeSeconds: number;
    poses: PoseLandmark[][];
};

/** 整段视频的 3D 骨骼动作捕捉结果。 */
export type CapturedPoseClip = {
    width: number;
    height: number;
    durationSeconds: number;
    aspect: string;
    sampleFps: number;
    maxPoses: number;
    frames: PoseFrame[];
};

const WASM_PATH = "/mediapipe/wasm";
const MODEL_PATH = "/mediapipe/pose_landmarker_full.task";

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
            reject(new Error("视频加载或解码失败"));
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
    if (Math.abs(video.currentTime - targetTime) < 0.012 && video.readyState >= 2) {
        return;
    }
    const seeked = waitForEvent(video, "seeked");
    video.currentTime = targetTime;
    await seeked;
}

async function createLandmarker(): Promise<PoseLandmarker> {
    const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
    try {
        return await PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" },
            runningMode: "VIDEO",
            numPoses: 3,
            minPoseDetectionConfidence: 0.45,
            minPosePresenceConfidence: 0.45,
            minTrackingConfidence: 0.45,
        });
    } catch {
        // GPU delegate 不可用时自动降级 CPU
        return await PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: MODEL_PATH, delegate: "CPU" },
            runningMode: "VIDEO",
            numPoses: 3,
            minPoseDetectionConfidence: 0.45,
            minPosePresenceConfidence: 0.45,
            minTrackingConfidence: 0.45,
        });
    }
}

function toLandmarks(raw: NormalizedLandmark[]): PoseLandmark[] {
    return raw.map((lm) => ({
        x: lm.x,
        y: lm.y,
        z: lm.z,
        visibility: lm.visibility ?? 1,
    }));
}

/** 计算人物躯干中心（用于跨帧身份对齐，避免多人交叉时角色编号互换）。 */
function poseCenter(pose: PoseLandmark[]): [number, number] {
    const lHip = pose[23];
    const rHip = pose[24];
    const lSh = pose[11];
    const rSh = pose[12];
    if (lHip && rHip && lSh && rSh) {
        return [(lHip.x + rHip.x + lSh.x + rSh.x) / 4, (lHip.y + rHip.y + lSh.y + rSh.y) / 4];
    }
    return [pose[0]?.x ?? 0.5, pose[0]?.y ?? 0.5];
}

/** 对当前帧的多人姿态按与上一帧的最近距离重排并做轻量 EMA 平滑。 */
function matchAndSmoothPoses(prev: PoseLandmark[][], curr: PoseLandmark[][], alpha = 0.62): PoseLandmark[][] {
    if (!curr.length) return [];
    if (!prev.length) {
        // 首次检测按画面中心优先排序，保证主角（居中）固定为 0 号位
        return [...curr].sort((a, b) => Math.abs(poseCenter(a)[0] - 0.5) - Math.abs(poseCenter(b)[0] - 0.5));
    }
    const used = new Set<number>();
    const ordered: PoseLandmark[][] = [];
    for (const prevPose of prev) {
        const [px, py] = poseCenter(prevPose);
        let bestIdx = -1;
        let bestDist = Number.POSITIVE_INFINITY;
        for (let j = 0; j < curr.length; j++) {
            if (used.has(j)) continue;
            const [cx, cy] = poseCenter(curr[j]);
            const d = Math.hypot(cx - px, cy - py);
            if (d < bestDist && d < 0.35) {
                bestDist = d;
                bestIdx = j;
            }
        }
        if (bestIdx >= 0) {
            used.add(bestIdx);
            const matched = curr[bestIdx];
            ordered.push(
                matched.map((lm, k) => {
                    const p = prevPose[k];
                    if (!p) return lm;
                    return {
                        x: p.x + (lm.x - p.x) * alpha,
                        y: p.y + (lm.y - p.y) * alpha,
                        z: p.z + (lm.z - p.z) * alpha,
                        visibility: p.visibility + (lm.visibility - p.visibility) * alpha,
                    };
                }),
            );
        }
    }
    for (let j = 0; j < curr.length; j++) {
        if (!used.has(j)) ordered.push(curr[j]);
    }
    return ordered;
}

/**
 * 逐帧从视频中捕捉 3D 人体骨骼姿态（默认 15fps 采样，播放/导出时 30fps 线性插值）。
 */
export async function extractPoseClipFromVideo(
    source: File | string,
    onProgress: (stage: "loading_model" | "capturing", progress: number) => void,
    signal?: AbortSignal,
): Promise<CapturedPoseClip> {
    onProgress("loading_model", 5);
    const landmarker = await createLandmarker();

    const isLocalFile = typeof source !== "string";
    let objectUrl: string | null = isLocalFile ? URL.createObjectURL(source) : null;
    if (!isLocalFile && source) {
        try {
            const response = await fetch(source, { credentials: "include", signal });
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
        const durationSeconds = Number.isFinite(video.duration) && video.duration > 0 ? Math.min(60, video.duration) : 5;
        const width = video.videoWidth || 720;
        const height = video.videoHeight || 1280;
        const aspect = inferAspect(width, height);
        const sampleFps = 15;
        const totalSamples = Math.max(2, Math.ceil(durationSeconds * sampleFps));

        const frames: PoseFrame[] = [];
        let prevPoses: PoseLandmark[][] = [];
        let maxPoses = 0;
        let lastTimestampMs = -1;

        for (let i = 0; i <= totalSamples; i++) {
            if (signal?.aborted) {
                throw new DOMException("已取消动作捕捉", "AbortError");
            }
            const t = Math.min(durationSeconds, i / sampleFps);
            const seekTime = i === totalSamples ? Math.max(0, durationSeconds - 0.03) : t;
            await seekTo(video, seekTime);

            // MediaPipe VIDEO 模式要求时间戳严格递增
            const tsMs = Math.max(lastTimestampMs + 1, Math.round(t * 1000));
            lastTimestampMs = tsMs;

            const result = landmarker.detectForVideo(video, tsMs);
            const rawPoses = (result.landmarks ?? []).map(toLandmarks);
            const smoothed = matchAndSmoothPoses(prevPoses, rawPoses);
            if (smoothed.length > 0) {
                prevPoses = smoothed;
                if (smoothed.length > maxPoses) maxPoses = smoothed.length;
            }
            frames.push({
                timeSeconds: t,
                poses: smoothed.length > 0 ? smoothed : prevPoses,
            });
            onProgress("capturing", Math.round(((i + 1) / (totalSamples + 1)) * 100));
            if (i % 5 === 0) {
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
            }
        }

        return {
            width,
            height,
            durationSeconds: Number(durationSeconds.toFixed(2)),
            aspect,
            sampleFps,
            maxPoses,
            frames,
        };
    } finally {
        landmarker.close();
        video.pause();
        video.removeAttribute("src");
        video.load();
        if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
        }
    }
}

/** 在任意时刻对捕捉到的 3D 骨骼做线性插值，保证 30fps 播放与导出丝滑流畅。 */
export function samplePoseFrameAt(clip: CapturedPoseClip, timeSeconds: number): PoseLandmark[][] {
    const frames = clip.frames;
    if (!frames.length) return [];
    const clamped = Math.max(0, Math.min(clip.durationSeconds, timeSeconds));
    const idxFloat = clamped * clip.sampleFps;
    const i0 = Math.max(0, Math.min(frames.length - 1, Math.floor(idxFloat)));
    const i1 = Math.max(0, Math.min(frames.length - 1, Math.ceil(idxFloat)));
    const f0 = frames[i0];
    const f1 = frames[i1];
    if (i0 === i1 || !f1) return f0.poses;
    const span = f1.timeSeconds - f0.timeSeconds;
    const alpha = span > 1e-5 ? Math.max(0, Math.min(1, (clamped - f0.timeSeconds) / span)) : 0;

    const count = Math.min(f0.poses.length, f1.poses.length);
    if (count === 0) return f0.poses.length ? f0.poses : f1.poses;
    const out: PoseLandmark[][] = [];
    for (let p = 0; p < count; p++) {
        const a = f0.poses[p];
        const b = f1.poses[p];
        out.push(
            a.map((lm, k) => {
                const target = b[k] ?? lm;
                return {
                    x: lm.x + (target.x - lm.x) * alpha,
                    y: lm.y + (target.y - lm.y) * alpha,
                    z: lm.z + (target.z - lm.z) * alpha,
                    visibility: lm.visibility + (target.visibility - lm.visibility) * alpha,
                };
            }),
        );
    }
    return out;
}
