"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Progress, Segmented, Slider, Tag } from "antd";
import { CloudUpload, Columns2, Download, Pause, Play, RotateCcw, Video } from "lucide-react";
import { saveAs } from "file-saver";
import type { UploadedFile } from "@/features/storage/services/file-storage";
import { extractPoseClipFromVideo, type CapturedPoseClip } from "./pose-extractor";
import {
    createPoseMannequinRuntime,
    exportAndUploadPoseWhitemodel,
    exportPoseWhitemodelBlob,
    type MannequinStyle,
    type PoseMannequinRuntime,
} from "./pose-mannequin";

type PoseWhitemodelCardProps = {
    source: File | string;
    videoName: string;
    previewVideoUrl: string;
    onUploaded?: (file: UploadedFile) => void;
};

/**
 * 基于浏览器端 MediaPipe 3D 骨骼捕捉的「白膜制作」工作台卡片：
 * 自动逐帧提取上传视频中的人体 3D 姿态，驱动 Three.js 关节白模人偶 1:1 还原动作，
 * 支持原片并排同步对比、风格切换，以及一键导出下载/保存 30fps 白膜 MP4。
 */
export function PoseWhitemodelCard({ source, videoName, previewVideoUrl, onUploaded }: PoseWhitemodelCardProps) {
    const { message } = App.useApp();
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const compareVideoRef = useRef<HTMLVideoElement | null>(null);
    const runtimeRef = useRef<PoseMannequinRuntime | null>(null);
    const rafRef = useRef<number | null>(null);
    const lastTickRef = useRef<number>(0);
    const currentTimeRef = useRef<number>(0);

    const [captureState, setCaptureState] = useState<{ stage: "loading_model" | "capturing"; progress: number } | null>({
        stage: "loading_model",
        progress: 5,
    });
    const [captureError, setCaptureError] = useState<string | null>(null);
    const [clip, setClip] = useState<CapturedPoseClip | null>(null);

    const [playing, setPlaying] = useState(true);
    const [currentTime, setCurrentTime] = useState(0);
    const [style, setStyle] = useState<MannequinStyle>("clay");
    const [compareMode, setCompareMode] = useState<"whitemodel" | "split">("split");
    const [exportStatus, setExportStatus] = useState<{ stage: "encoding" | "uploading"; progress: number } | null>(null);
    const [savedFile, setSavedFile] = useState<UploadedFile | null>(null);

    // 1. 自动执行逐帧 3D 骨骼动作捕捉
    useEffect(() => {
        const controller = new AbortController();
        setClip(null);
        setCaptureError(null);
        setCaptureState({ stage: "loading_model", progress: 5 });

        void extractPoseClipFromVideo(
            source,
            (stage, progress) => {
                if (!controller.signal.aborted) {
                    setCaptureState({ stage, progress });
                }
            },
            controller.signal,
        )
            .then((captured) => {
                if (controller.signal.aborted) return;
                setClip(captured);
                setCaptureState(null);
                setPlaying(true);
            })
            .catch((error) => {
                if (controller.signal.aborted) return;
                setCaptureState(null);
                setCaptureError(error instanceof Error ? error.message : "3D 动作捕捉失败，请重试");
            });

        return () => controller.abort();
    }, [source]);

    // 2. 初始化 Three.js 3D 关节白模人偶运行时
    useEffect(() => {
        if (!clip || !canvasRef.current) return;
        const aspect = clip.width / clip.height;
        const width = aspect >= 1 ? 640 : Math.round(420 * aspect);
        const height = aspect >= 1 ? Math.round(640 / aspect) : 420;
        const canvas = canvasRef.current;
        canvas.width = width;
        canvas.height = height;

        const runtime = createPoseMannequinRuntime(canvas, clip, width, height, style);
        runtimeRef.current = runtime;
        currentTimeRef.current = 0;
        setCurrentTime(0);
        runtime.renderAt(0);

        return () => {
            runtime.dispose();
            runtimeRef.current = null;
        };
    }, [clip]);

    // 同步切换白模配色风格
    useEffect(() => {
        runtimeRef.current?.setStyle(style);
    }, [style]);

    // 3. 实时播放与原视频并排同步循环
    useEffect(() => {
        if (!clip) return;
        const videoEl = compareVideoRef.current;
        if (!playing) {
            if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
            videoEl?.pause();
            return;
        }
        if (videoEl && compareMode === "split") {
            videoEl.currentTime = currentTimeRef.current;
            void videoEl.play().catch(() => undefined);
        }
        lastTickRef.current = performance.now();
        const step = (now: number) => {
            const dt = Math.min(0.1, (now - lastTickRef.current) / 1000);
            lastTickRef.current = now;
            let next = (currentTimeRef.current + dt) % clip.durationSeconds;
            if (videoEl && compareMode === "split" && !videoEl.paused && Number.isFinite(videoEl.currentTime)) {
                next = Math.min(clip.durationSeconds, videoEl.currentTime);
            }
            currentTimeRef.current = next;
            setCurrentTime(next);
            runtimeRef.current?.renderAt(next);
            rafRef.current = requestAnimationFrame(step);
        };
        rafRef.current = requestAnimationFrame(step);
        return () => {
            if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        };
    }, [clip, playing, compareMode]);

    const handleSeek = (value: number) => {
        setPlaying(false);
        currentTimeRef.current = value;
        setCurrentTime(value);
        runtimeRef.current?.renderAt(value);
        if (compareVideoRef.current) {
            compareVideoRef.current.pause();
            compareVideoRef.current.currentTime = value;
        }
    };

    const handleRestart = () => {
        currentTimeRef.current = 0;
        setCurrentTime(0);
        runtimeRef.current?.renderAt(0);
        if (compareVideoRef.current) {
            compareVideoRef.current.currentTime = 0;
        }
        setPlaying(true);
    };

    const handleDownloadMp4 = async () => {
        if (!clip || exportStatus) return;
        try {
            setExportStatus({ stage: "encoding", progress: 0 });
            const blob = await exportPoseWhitemodelBlob(clip, style, (progress) =>
                setExportStatus({ stage: "encoding", progress }),
            );
            const base = videoName.replace(/\.[^.]+$/, "") || "whitemodel";
            saveAs(blob, `${base}-whitemodel.mp4`);
            message.success("3D 白膜 MP4 已导出并开始下载");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "白膜 MP4 导出失败，请使用支持 WebCodecs 的现代浏览器");
        } finally {
            setExportStatus(null);
        }
    };

    const handleSaveToCloud = async () => {
        if (!clip || exportStatus) return;
        try {
            setExportStatus({ stage: "encoding", progress: 0 });
            const uploaded = await exportAndUploadPoseWhitemodel(clip, style, (stage, progress) =>
                setExportStatus({ stage, progress }),
            );
            setSavedFile(uploaded);
            onUploaded?.(uploaded);
            message.success("3D 白膜 MP4 已保存到云端");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "白膜 MP4 保存失败");
        } finally {
            setExportStatus(null);
        }
    };

    const aspectRatio = clip ? clip.width / clip.height : 16 / 9;

    return (
        <div className="max-w-3xl overflow-hidden rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--studio-line)] px-3.5 py-2.5">
                <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-[var(--studio-ink)]">
                    <Video className="size-3.5" />
                    <span>3D 骨骼动作白膜</span>
                    {clip ? (
                        <>
                            <Tag className="m-0!">{clip.aspect}</Tag>
                            <Tag className="m-0!">{clip.durationSeconds.toFixed(1)}s</Tag>
                            <Tag color="blue" className="m-0!">
                                {clip.maxPoses > 0 ? `已捕捉 ${clip.maxPoses} 人动作` : "未检测到人体"}
                            </Tag>
                        </>
                    ) : null}
                </div>
                {clip ? (
                    <div className="flex items-center gap-2">
                        <Segmented
                            size="small"
                            value={style}
                            onChange={(v) => setStyle(v as MannequinStyle)}
                            options={[
                                { label: "纯白粘土", value: "clay" },
                                { label: "红蓝语义", value: "semantic" },
                            ]}
                        />
                        <Button
                            size="small"
                            type={compareMode === "split" ? "primary" : "default"}
                            icon={<Columns2 className="size-3.5" />}
                            onClick={() => setCompareMode((prev) => (prev === "split" ? "whitemodel" : "split"))}
                        >
                            原片对比
                        </Button>
                    </div>
                ) : null}
            </div>

            {captureState ? (
                <div className="space-y-2 px-4 py-6">
                    <div className="flex items-center justify-between text-xs text-[var(--studio-muted)]">
                        <span>
                            {captureState.stage === "loading_model"
                                ? "正在加载本地 3D 人体姿态捕捉模型..."
                                : `正在逐帧捕捉「${videoName}」的 3D 人体动作与位置...`}
                        </span>
                        <span className="font-mono">{captureState.progress}%</span>
                    </div>
                    <Progress percent={captureState.progress} status="active" showInfo={false} />
                </div>
            ) : null}

            {captureError ? (
                <div className="p-3.5">
                    <Alert type="error" showIcon message={captureError} />
                </div>
            ) : null}

            {clip ? (
                <>
                    <div className="flex items-center justify-center gap-2 bg-[#0f1014] p-2.5">
                        {compareMode === "split" ? (
                            <video
                                ref={compareVideoRef}
                                src={previewVideoUrl}
                                muted
                                loop
                                playsInline
                                className="max-h-[360px] w-auto max-w-[48%] rounded-lg object-contain"
                                style={{ aspectRatio: String(aspectRatio) }}
                            />
                        ) : null}
                        <canvas
                            ref={canvasRef}
                            className={`max-h-[360px] w-auto rounded-lg ${compareMode === "split" ? "max-w-[48%]" : "max-w-full"}`}
                            style={{ aspectRatio: String(aspectRatio) }}
                        />
                    </div>

                    <div className="flex items-center gap-2 px-3.5 py-2">
                        <Button
                            size="small"
                            type="text"
                            icon={playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                            onClick={() => setPlaying((prev) => !prev)}
                            aria-label={playing ? "暂停预览" : "播放预览"}
                        />
                        <Button
                            size="small"
                            type="text"
                            icon={<RotateCcw className="size-3.5" />}
                            onClick={handleRestart}
                            aria-label="重新播放"
                        />
                        <div className="min-w-0 flex-1 px-1">
                            <Slider
                                min={0}
                                max={clip.durationSeconds}
                                step={0.03}
                                value={currentTime}
                                tooltip={{ formatter: (v) => `${(v ?? 0).toFixed(2)}s` }}
                                onChange={handleSeek}
                                className="my-0!"
                            />
                        </div>
                        <span className="shrink-0 font-mono text-xs text-[var(--studio-muted)]">
                            {currentTime.toFixed(1)}s / {clip.durationSeconds.toFixed(1)}s
                        </span>
                    </div>

                    {clip.maxPoses === 0 ? (
                        <div className="px-3.5 pb-2.5">
                            <Alert
                                type="warning"
                                showIcon
                                message="未在视频中检测到清晰的人体骨架，请确认画面中包含人物主体。"
                            />
                        </div>
                    ) : null}

                    {exportStatus ? (
                        <div className="border-t border-[var(--studio-line)] px-3.5 py-2">
                            <div className="mb-1 flex items-center justify-between text-xs text-[var(--studio-muted)]">
                                <span>
                                    {exportStatus.stage === "uploading"
                                        ? "正在上传 3D 白膜 MP4 到云端..."
                                        : "正在浏览器本地编码 30fps 3D 白膜 MP4..."}
                                </span>
                                <span>{exportStatus.progress}%</span>
                            </div>
                            <Progress percent={exportStatus.progress} size="small" showInfo={false} />
                        </div>
                    ) : null}

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--studio-line)] px-3.5 py-2.5">
                        <span className="text-xs text-[var(--studio-muted)]">
                            {savedFile ? "已保存到云端并添加到最近上传，可直接用于参考视频生成" : "与原视频画幅、时长、动作 1:1 逐帧对齐"}
                        </span>
                        <div className="flex items-center gap-2">
                            <Button
                                size="small"
                                type="primary"
                                icon={<Download className="size-3.5" />}
                                loading={exportStatus?.stage === "encoding"}
                                disabled={Boolean(exportStatus)}
                                onClick={() => void handleDownloadMp4()}
                            >
                                下载白膜 MP4
                            </Button>
                            <Button
                                size="small"
                                icon={<CloudUpload className="size-3.5" />}
                                loading={exportStatus?.stage === "uploading"}
                                disabled={Boolean(exportStatus)}
                                onClick={() => void handleSaveToCloud()}
                            >
                                保存到云端
                            </Button>
                        </div>
                    </div>
                </>
            ) : null}
        </div>
    );
}
