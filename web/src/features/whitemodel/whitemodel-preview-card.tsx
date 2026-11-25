"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, App, Button, Progress, Slider, Tag } from "antd";
import { CloudUpload, Download, Pause, Play, RotateCcw, Video } from "lucide-react";
import { saveAs } from "file-saver";
import type { UploadedFile } from "@/features/storage/services/file-storage";
import { createWhitemodelRuntime, exportAndUploadWhitemodelVideo, exportWhitemodelBlob, type WhitemodelRuntime } from "./scene-builder";
import { probeWhitemodelScene, type SolvedCamera, type WhitemodelScene } from "./solver";

type WhitemodelPreviewCardProps = {
    scene: WhitemodelScene;
    aspectOverride?: string;
    onUploaded?: (file: UploadedFile) => void;
};

/**
 * 3D 白膜实时预览与导出卡片：内嵌在「白膜制作」对话轮次中，支持实时播放、拖动时间轴、
 * 几何体检，以及浏览器本地一键导出下载 MP4 或保存到云端。
 */
export function WhitemodelPreviewCard({ scene, aspectOverride, onUploaded }: WhitemodelPreviewCardProps) {
    const { message } = App.useApp();
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const runtimeRef = useRef<WhitemodelRuntime | null>(null);
    const rafRef = useRef<number | null>(null);
    const lastTickRef = useRef<number>(0);

    const duration = Math.max(1, scene.meta?.duration ?? 5);
    const aspect = aspectOverride || scene.meta?.aspect || "16:9";
    const [aw, ah] = aspect.split(":").map(Number);
    const aspectRatio = aw > 0 && ah > 0 ? aw / ah : 16 / 9;

    const [playing, setPlaying] = useState(true);
    const [currentTime, setCurrentTime] = useState(0);
    const [cameraInfo, setCameraInfo] = useState<SolvedCamera | null>(null);
    const [exportStatus, setExportStatus] = useState<{ stage: "encoding" | "uploading"; progress: number } | null>(null);
    const [savedFile, setSavedFile] = useState<UploadedFile | null>(null);
    const currentTimeRef = useRef(0);

    const issues = useMemo(() => probeWhitemodelScene(scene), [scene]);
    const errorCount = issues.filter((item) => item.level === "error").length;

    // 初始化 Three.js 白模运行时
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const width = aspectRatio >= 1 ? 640 : Math.round(360 * aspectRatio);
        const height = aspectRatio >= 1 ? Math.round(640 / aspectRatio) : 360;
        canvas.width = width;
        canvas.height = height;
        const runtime = createWhitemodelRuntime(canvas, scene, width, height);
        runtimeRef.current = runtime;
        currentTimeRef.current = 0;
        setCurrentTime(0);
        setCameraInfo(runtime.renderAt(0));
        return () => {
            runtime.dispose();
            runtimeRef.current = null;
        };
    }, [scene, aspectRatio]);

    // 预览播放循环（导出走独立离屏 canvas，不受此 RAF 影响）
    useEffect(() => {
        if (!playing) {
            if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
            return;
        }
        lastTickRef.current = performance.now();
        const step = (now: number) => {
            const dt = Math.min(0.1, (now - lastTickRef.current) / 1000);
            lastTickRef.current = now;
            const next = (currentTimeRef.current + dt) % duration;
            currentTimeRef.current = next;
            setCurrentTime(next);
            const cam = runtimeRef.current?.renderAt(next);
            if (cam) setCameraInfo(cam);
            rafRef.current = requestAnimationFrame(step);
        };
        rafRef.current = requestAnimationFrame(step);
        return () => {
            if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        };
    }, [playing, duration]);

    const handleSeek = (value: number) => {
        setPlaying(false);
        currentTimeRef.current = value;
        setCurrentTime(value);
        const cam = runtimeRef.current?.renderAt(value);
        if (cam) setCameraInfo(cam);
    };

    const handleRestart = () => {
        currentTimeRef.current = 0;
        setCurrentTime(0);
        const cam = runtimeRef.current?.renderAt(0);
        if (cam) setCameraInfo(cam);
        setPlaying(true);
    };

    const handleDownloadMp4 = async () => {
        if (exportStatus) return;
        try {
            setExportStatus({ stage: "encoding", progress: 0 });
            const blob = await exportWhitemodelBlob(
                scene,
                (progress) => setExportStatus({ stage: "encoding", progress }),
                aspect,
            );
            saveAs(blob, `whitemodel-${Date.now()}.mp4`);
            message.success("白膜 MP4 已导出并开始下载");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "白膜 MP4 导出失败，请使用支持 WebCodecs 的现代浏览器");
        } finally {
            setExportStatus(null);
        }
    };

    const handleSaveToCloud = async () => {
        if (exportStatus) return;
        try {
            setExportStatus({ stage: "encoding", progress: 0 });
            const uploaded = await exportAndUploadWhitemodelVideo(
                scene,
                (stage, progress) => setExportStatus({ stage, progress }),
                aspect,
            );
            setSavedFile(uploaded);
            onUploaded?.(uploaded);
            message.success("白膜 MP4 已保存到云端，已添加为参考视频");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "白膜 MP4 保存失败");
        } finally {
            setExportStatus(null);
        }
    };

    return (
        <div className="mb-3 overflow-hidden rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--studio-line)] px-3.5 py-2">
                <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-[var(--studio-ink)]">
                    <Video className="size-3.5" />
                    <span>3D 白膜预览</span>
                    <Tag className="m-0!">{aspect}</Tag>
                    <Tag className="m-0!">{duration.toFixed(1)}s</Tag>
                    {cameraInfo ? (
                        <Tag color="blue" className="m-0!">
                            镜头 {cameraInfo.shotIndex + 1}/{scene.shots.length} · {cameraInfo.shot.rig || "static"} · {Math.round(cameraInfo.mm)}mm
                        </Tag>
                    ) : null}
                </div>
                <Tag color={errorCount > 0 ? "error" : issues.length > 0 ? "warning" : "success"} className="m-0!">
                    {errorCount > 0 ? `体检异常 (${errorCount})` : issues.length > 0 ? `体检提示 (${issues.length})` : "几何体检通过"}
                </Tag>
            </div>

            <div className="flex justify-center bg-[#0f1014] p-2">
                <canvas
                    ref={canvasRef}
                    className="max-h-[320px] w-auto max-w-full rounded-lg"
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
                        max={duration}
                        step={0.05}
                        value={currentTime}
                        tooltip={{ formatter: (v) => `${(v ?? 0).toFixed(2)}s` }}
                        onChange={handleSeek}
                        className="my-0!"
                    />
                </div>
                <span className="shrink-0 font-mono text-xs text-[var(--studio-muted)]">
                    {currentTime.toFixed(1)}s / {duration.toFixed(1)}s
                </span>
            </div>

            {issues.length > 0 ? (
                <div className="px-3.5 pb-2.5">
                    <Alert
                        type={errorCount > 0 ? "error" : "warning"}
                        showIcon
                        message={issues.map((item) => item.message).join("；")}
                    />
                </div>
            ) : null}

            {exportStatus ? (
                <div className="border-t border-[var(--studio-line)] px-3.5 py-2">
                    <div className="mb-1 flex items-center justify-between text-xs text-[var(--studio-muted)]">
                        <span>{exportStatus.stage === "uploading" ? "正在上传白膜 MP4 到云端..." : "正在浏览器本地编码白膜 MP4..."}</span>
                        <span>{exportStatus.progress}%</span>
                    </div>
                    <Progress percent={exportStatus.progress} size="small" showInfo={false} />
                </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--studio-line)] px-3.5 py-2.5">
                <span className="text-xs text-[var(--studio-muted)]">
                    {savedFile ? "已保存到云端，可直接用于参考视频生成" : "如需调整运镜、主体数量或轨迹，直接在下方对话告诉我"}
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
        </div>
    );
}
