"use client";

import { memo, useEffect, useRef, useState } from "react";
import { NodeResizer, type Node, type NodeProps } from "@xyflow/react";
import { AudioLines, Pause, Play, Upload } from "lucide-react";
import { App, theme as antDesignTheme } from "antd";
import type { CanvasAudioNode } from "../types";
import { useCanvasTheme } from "../components/canvas-theme-provider";
import { useNodeActions } from "./node-action-context";
import { CanvasConnectionHandles, CanvasNodeTitle, NodeHoverSurface } from "./shared";
import { formatAudioTime } from "@/features/storage/utils/audio-waveform";

import { activateCanvasAudio, releaseCanvasAudio } from "../services/canvas-audio-playback";

/** 在画布内部播放音频，播放状态不写入文档，卸载时释放媒体资源。 */
export const AudioNode = memo(function AudioNode({ data, selected }: NodeProps<Node<CanvasAudioNode>>) {
    const theme = useCanvasTheme();
    const actions = useNodeActions();
    const { token } = antDesignTheme.useToken();
    const { message } = App.useApp();
    const audioRef = useRef<HTMLAudioElement>(null);
    const [playing, setPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [failed, setFailed] = useState(false);
    const duration = (data.content.durationMilliseconds || 0) / 1000;
    const progress = duration ? currentTime / duration : 0;

    useEffect(() => {
        const audio = audioRef.current;
        if (audio) audio.src = data.content.source;
        setPlaying(false);
        setCurrentTime(0);
        setFailed(false);
        return () => {
            if (!audio) return;
            releaseCanvasAudio(audio);
            audio.removeAttribute("src");
            audio.load();
        };
    }, [data.content.source]);

    /** 点击后才允许播放，播放失败保留替换和重试入口。 */
    const togglePlayback = async () => {
        const audio = audioRef.current;
        if (!audio) return;
        if (!audio.paused) return audio.pause();
        activateCanvasAudio(audio);
        if (failed) audio.load();
        if (audio.ended) audio.currentTime = 0;
        try {
            await audio.play();
            setFailed(false);
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") return;
            setFailed(true);
            message.error("音频播放失败，请重试或替换文件");
        }
    };

    return <>
        <NodeResizer minWidth={280} minHeight={150} isVisible={selected} lineStyle={{ borderColor: theme.node.activeStroke }} handleStyle={{ borderColor: theme.node.activeStroke, backgroundColor: theme.node.panel }} onResizeEnd={(_, frame) => actions.onResize?.(data.id, frame.width, frame.height, { x: frame.x, y: frame.y })} />
        <NodeHoverSurface nodeId={data.id} className="relative flex h-full w-full select-none flex-col rounded-lg border p-3" style={{ background: theme.node.fill, borderColor: selected ? theme.node.activeStroke : theme.node.stroke, color: theme.node.text }}>
            <CanvasNodeTitle nodeId={data.id} title={data.title} defaultTitle="音频" onTitleChange={actions.onTitleChange} />
            {data.content.source ? <div className="nodrag nopan nowheel flex min-h-0 flex-1 flex-col gap-2" data-canvas-no-zoom onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                <audio ref={audioRef} src={data.content.source} preload="metadata" onPlay={(event) => { activateCanvasAudio(event.currentTarget); setPlaying(true); }} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => setFailed(true)} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} />
                <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg focus-within:outline focus-within:outline-2 focus-within:outline-offset-2" style={{ background: theme.node.panel }}>
                    <svg className="absolute inset-0 h-full w-full p-4" viewBox="0 0 512 100" preserveAspectRatio="none" aria-hidden="true">
                        {data.content.waveformPeaks.map((peak, index) => <line key={index} x1={index * 4 + 2} x2={index * 4 + 2} y1={50 - Math.max(1, peak * 44)} y2={50 + Math.max(1, peak * 44)} stroke={index / 128 <= progress ? theme.node.text : theme.node.muted} strokeWidth={2} strokeLinecap="round" />)}
                        <line x1={progress * 512} x2={progress * 512} y1={0} y2={100} stroke={token.colorError} strokeWidth={2} />
                    </svg>
                    <input type="range" min={0} max={duration || 1} step={0.01} value={Math.min(currentTime, duration)} disabled={!duration} aria-label="音频播放进度" aria-valuetext={`${formatAudioTime(currentTime)} / ${formatAudioTime(duration)}`} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" onChange={(event) => { const time = Number(event.target.value); if (audioRef.current) audioRef.current.currentTime = time; setCurrentTime(time); }} />
                </div>
                <div className="relative flex h-8 shrink-0 items-center justify-between text-sm tabular-nums" style={{ color: theme.node.muted }}>
                    <span>{formatAudioTime(currentTime)} / {formatAudioTime(duration)}</span>
                    <button type="button" aria-label={playing ? "暂停音频" : failed ? "重试播放音频" : "播放音频"} title={playing ? "暂停" : "播放"} className="absolute left-1/2 grid size-8 -translate-x-1/2 place-items-center rounded-full border focus-visible:outline-2" style={{ borderColor: theme.node.stroke }} onClick={() => void togglePlayback()}>{playing ? <Pause className="size-4" /> : <Play className="size-4" />}</button>
                    {failed ? <button type="button" className="text-xs" onClick={() => actions.onUpload(data)}>播放失败，替换文件</button> : <AudioLines className="size-4" aria-hidden="true" />}
                </div>
            </div> : <button type="button" className="nodrag nopan flex flex-1 flex-col items-center justify-center gap-2 text-sm" style={{ color: theme.node.muted }} onClick={() => actions.onUpload(data)}><Upload className="size-6" />{data.execution.phase === "failed" ? "上传失败，重新上传" : "上传音频"}</button>}
            <CanvasConnectionHandles />
        </NodeHoverSurface>
    </>;
});
