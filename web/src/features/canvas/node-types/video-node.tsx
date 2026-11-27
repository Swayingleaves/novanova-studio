"use client";
import { useTranslation } from "@/features/locale/use-translation";


import { memo, useEffect, useRef, useState, type CSSProperties, type SyntheticEvent } from "react";
import { NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import { Camera, Maximize2, Pause, Play, Video, Volume2, VolumeX } from "lucide-react";
import { formatAudioTime } from "@/features/storage/utils/audio-waveform";
import { activateCanvasAudio, releaseCanvasAudio } from "../services/canvas-audio-playback";
import type { CanvasVideoNode } from "../types";
import { useNodeActions } from "./node-action-context";
import { CanvasConnectionHandles, CanvasNodeGenerationMeta, CanvasNodeTitle, NodeError, NodeHoverSurface, NodeMediaLoading, NodeMediaUnavailable } from "./shared";
import { useCanvasTheme } from "../components/canvas-theme-provider";
import { useMediaUrl } from "@/shared/hooks/use-media-url";

export const VideoNode = memo(function VideoNode({ data, selected }: NodeProps<Node<CanvasVideoNode>>) {
    const translate = useTranslation();
    const actions = useNodeActions();
    const { onCaptureVideoFrame } = actions;
    const theme = useCanvasTheme();
    const hasContent = Boolean(data.content.source);
    const isLoading = data.execution.phase === "running";
    const isError = data.execution.phase === "failed";
    // 记录加载失败的媒体地址，地址变化（重新生成/替换）后自动恢复显示。
    const [failedSource, setFailedSource] = useState<string | null>(null);
    // 有存储键时通过接口换取当前临时地址，地址过期后由渲染错误触发续签。
    const media = useMediaUrl({ storageKey: data.content.storageKey, url: data.content.source, objectStorage: data.content.objectStorage, kind: "media" });
    const displaySource = media.url || data.content.source;
    const isMediaUnavailable = hasContent && (failedSource === data.content.source || (Boolean(data.content.storageKey) && media.failed));
    const borderColor = selected ? theme.node.activeStroke : isError ? "#ef4444" : theme.node.stroke;

    return (
        <>
            <NodeResizer
                minWidth={220}
                minHeight={160}
                keepAspectRatio
                isVisible={selected}
                lineStyle={{ borderColor: theme.node.activeStroke }}
                handleStyle={{ borderColor: theme.node.activeStroke, backgroundColor: theme.node.panel }}
                onResizeEnd={(_, params) => {
                    actions.onResize?.(data.id, params.width, params.height, { x: params.x, y: params.y });
                }}
            />
            <NodeHoverSurface
                nodeId={data.id}
                className="relative flex select-none flex-col rounded-3xl border-2"
                style={{
                    width: "100%",
                    height: "100%",
                    background: hasContent && !isMediaUnavailable ? theme.canvas.background : theme.node.fill,
                    borderColor,
                    boxShadow: selected ? `0 0 0 1px ${theme.node.activeStroke}55` : undefined,
                }}
            >
                <CanvasNodeTitle nodeId={data.id} title={data.title} defaultTitle={translate("canvas.video")} onTitleChange={actions.onTitleChange} />
                <CanvasNodeGenerationMeta
                    selected={selected}
                    model={data.generation.model}
                    resolution={data.generation.quality}
                    size={data.generation.size}
                />
                {isLoading ? (
                    <NodeMediaLoading progress={data.execution.progress} />
                ) : isError ? (
                    <NodeError node={data} />
                ) : isMediaUnavailable ? (
                    <NodeMediaUnavailable kind="video" />
                ) : hasContent ? (
                    <CanvasVideoPlayer
                        key={displaySource}
                        source={displaySource}
                        onDimensions={(video) => actions.onMediaDimensions?.(data.id, data.content.source, video.videoWidth, video.videoHeight)}
                        onMediaError={() => { if (data.content.storageKey) media.onError(); else setFailedSource(data.content.source); }}
                        onPreview={() => actions.onViewVideo(data)}
                        onCapture={onCaptureVideoFrame ? (video) => onCaptureVideoFrame(data, video) : undefined}
                    />
                ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-sm" style={{ color: theme.node.placeholder }}>
                        <Video className="size-7 opacity-35" />
                        <span>{translate("canvas.emptyVideoNode")}</span>
                    </div>
                )}
                <CanvasConnectionHandles />
            </NodeHoverSurface>
        </>
    );
});

type CanvasVideoPlayerProps = {
    source: string;
    onDimensions: (video: HTMLVideoElement) => void;
    onMediaError: () => void;
    onPreview: () => void;
    onCapture?: (video: HTMLVideoElement) => Promise<void>;
};

const CONTROL_BUTTON = "grid size-7 shrink-0 place-items-center rounded-md hover:bg-[var(--canvas-video-control-hover)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] disabled:opacity-40";

function CanvasVideoPlayer({ source, onDimensions, onMediaError, onPreview, onCapture }: CanvasVideoPlayerProps) {
    const translate = useTranslation();
    const theme = useCanvasTheme();
    const videoRef = useRef<HTMLVideoElement>(null);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [muted, setMuted] = useState(true);
    const [frameReady, setFrameReady] = useState(false);
    const [capturing, setCapturing] = useState(false);

    useEffect(() => {
        const video = videoRef.current;
        return () => { if (video) releaseCanvasAudio(video); };
    }, []);

    const syncFrame = ({ currentTarget: video }: SyntheticEvent<HTMLVideoElement>) => {
        setCurrentTime(video.currentTime);
        setFrameReady(!video.seeking && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0);
    };
    const syncDuration = ({ currentTarget: video }: SyntheticEvent<HTMLVideoElement>) => {
        setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    };
    const togglePlayback = () => {
        const video = videoRef.current;
        if (!video || capturing) return;
        if (video.paused) void video.play().catch(() => undefined);
        else video.pause();
    };
    const captureFrame = async () => {
        const video = videoRef.current;
        if (!video || !onCapture || capturing) return;
        setCapturing(true);
        try {
            await onCapture(video);
        } finally {
            setCapturing(false);
        }
    };
    const timeLabel = `${formatAudioTime(currentTime)} / ${formatAudioTime(duration)}`;

    return (
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[inherit]">
            <video
                ref={videoRef}
                src={source}
                className="pointer-events-none block min-h-0 w-full flex-1 object-contain"
                data-canvas-no-zoom
                muted={muted}
                playsInline
                preload="metadata"
                onLoadedMetadata={({ currentTarget }) => onDimensions(currentTarget)}
                onDurationChange={syncDuration}
                onLoadedData={syncFrame}
                onTimeUpdate={syncFrame}
                onSeeking={() => setFrameReady(false)}
                onSeeked={syncFrame}
                onPlay={({ currentTarget }) => {
                    if (currentTarget.paused) return;
                    activateCanvasAudio(currentTarget);
                    setPlaying(true);
                }}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                onError={() => {
                    setFrameReady(false);
                    onMediaError();
                }}
            />
            <div
                data-canvas-video-controls
                data-canvas-no-zoom
                className="nodrag nopan nowheel absolute inset-x-0 bottom-0 flex h-8 shrink-0 items-center gap-1 px-1.5"
                style={{ background: theme.node.panel, color: theme.node.text, "--canvas-video-control-hover": `color-mix(in srgb, ${theme.node.text} 10%, transparent)` } as CSSProperties}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
            >
                <button type="button" className={CONTROL_BUTTON} aria-label={translate(playing ? "canvas.pause" : "canvas.play_c33961")} disabled={capturing} onClick={togglePlayback}>
                    {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
                </button>
                <input
                    type="range"
                    className="min-w-0 flex-1 cursor-pointer focus-visible:outline-2 disabled:cursor-default"
                    aria-label={translate("canvas.videoNodeProgress")}
                    aria-valuetext={timeLabel}
                    title={timeLabel}
                    style={{ accentColor: theme.node.activeStroke }}
                    min={0}
                    max={duration || 1}
                    step={0.05}
                    value={Math.min(currentTime, duration)}
                    disabled={!duration || capturing}
                    onChange={(event) => {
                        const video = videoRef.current;
                        if (!video) return;
                        const time = event.currentTarget.valueAsNumber;
                        if (time !== video.currentTime) {
                            video.currentTime = time;
                            setFrameReady(false);
                        }
                        setCurrentTime(time);
                    }}
                />
                <button type="button" className={CONTROL_BUTTON} aria-label={translate(muted ? "canvas.videoNodeUnmute" : "canvas.videoNodeMute")} onClick={() => setMuted((value) => !value)}>
                    {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                </button>
                {onCapture ? (
                    <button type="button" className={CONTROL_BUTTON} aria-label={translate("canvas.captureVideoFrame")} title={translate("canvas.captureVideoFrame")} disabled={!frameReady || capturing} aria-busy={capturing} onClick={() => void captureFrame()}>
                        <Camera className="size-4" />
                    </button>
                ) : null}
                <button type="button" className={CONTROL_BUTTON} aria-label={translate("canvas.playEnlargedVideo")} title={translate("canvas.playEnlargedVideo")} onClick={onPreview}>
                    <Maximize2 className="size-4" />
                </button>
            </div>
        </div>
    );
}
