"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Modal } from "antd";
import { Pause, Play, Scissors } from "lucide-react";
import type { CanvasAudioNode } from "../types";
import { useCanvasTheme } from "./canvas-theme-provider";
import { formatAudioTime } from "@/features/storage/utils/audio-waveform";
import { audioNodeTrimRange } from "../utils/audio-trim";
import { activateCanvasAudio, releaseCanvasAudio } from "../services/canvas-audio-playback";

type CanvasNodeAudioTrimDialogProps = {
    node: CanvasAudioNode | null;
    open: boolean;
    onClose: () => void;
    onConfirm: (startMs: number, endMs: number) => void;
};

const MINIMUM_CLIP_MILLISECONDS = 100;
type TrimDragTarget = "start" | "end" | "range";

/** 音频节点裁剪对话框，裁剪结果以新节点保存。 */
export function CanvasNodeAudioTrimDialog({ node, open, onClose, onConfirm }: CanvasNodeAudioTrimDialogProps) {
    const theme = useCanvasTheme();
    const range = useMemo(() => (node ? audioNodeTrimRange(node.content) : { startMs: 0, endMs: 0, durationMs: 0, originalDurationMs: 0 }), [node]);
    const [startMs, setStartMs] = useState(0);
    const [endMs, setEndMs] = useState(0);
    const [previewTimeMs, setPreviewTimeMs] = useState(0);
    const [previewPlaying, setPreviewPlaying] = useState(false);
    const audioRef = useRef<HTMLAudioElement>(null);
    const timelineRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open || !node) return;
        setStartMs(range.startMs);
        setEndMs(range.endMs);
        setPreviewTimeMs(range.startMs);
        setPreviewPlaying(false);
    }, [node, open, range.endMs, range.startMs]);

    useEffect(() => {
        const audio = audioRef.current;
        if (!open || !node || !audio) return;
        audio.pause();
        audio.currentTime = range.startMs / 1000;
        setPreviewTimeMs(range.startMs);
        setPreviewPlaying(false);
        return () => releaseCanvasAudio(audio);
    }, [node?.id, node?.content.source, open]);

    const duration = Math.max(0, range.originalDurationMs);
    const selectedDuration = Math.max(0, endMs - startMs);
    const startPercent = duration ? (startMs / duration) * 100 : 0;
    const endPercent = duration ? (endMs / duration) * 100 : 0;
    const previewPercent = duration ? (previewTimeMs / duration) * 100 : 0;
    const peaks = node?.content.waveformPeaks || [];

    const updateStart = (value: number) => setStartMs(Math.max(0, Math.min(value, Math.max(0, endMs - MINIMUM_CLIP_MILLISECONDS))));
    const updateEnd = (value: number) => setEndMs(Math.min(duration, Math.max(value, Math.min(duration, startMs + MINIMUM_CLIP_MILLISECONDS))));
    const reset = () => {
        setStartMs(0);
        setEndMs(duration);
    };

    // 范围变化后，保证播放器不会继续播放范围外的音频。
    useEffect(() => {
        const audio = audioRef.current;
        if (!open || !audio || !duration) return;
        const start = startMs / 1000;
        const end = endMs / 1000;
        if (audio.currentTime < start || audio.currentTime > end) {
            audio.pause();
            audio.currentTime = audio.currentTime < start ? start : end;
            setPreviewTimeMs(audio.currentTime * 1000);
            setPreviewPlaying(false);
        }
    }, [duration, endMs, open, startMs]);

    /** 播放或暂停当前裁剪范围的音频预览。 */
    const togglePreview = async () => {
        const audio = audioRef.current;
        if (!audio || !node?.content.source || endMs <= startMs) return;
        if (!audio.paused) {
            audio.pause();
            return;
        }
        const start = startMs / 1000;
        const end = endMs / 1000;
        if (audio.currentTime < start || audio.currentTime >= end - 0.01) audio.currentTime = start;
        activateCanvasAudio(audio);
        try {
            await audio.play();
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") return;
            setPreviewPlaying(false);
        }
    };

    // 统一处理波形区域、起止手柄和选区的指针拖动，避免依赖透明滑块的命中区域。
    const beginDrag = (target: TrimDragTarget, event: ReactPointerEvent) => {
        if (!duration) return;
        const timeline = timelineRef.current?.getBoundingClientRect();
        if (!timeline || timeline.width <= 0) return;
        event.preventDefault();
        event.stopPropagation();
        const originStart = startMs;
        const originEnd = endMs;
        const originDuration = originEnd - originStart;
        const onMove = (moveEvent: PointerEvent) => {
            const deltaMs = ((moveEvent.clientX - event.clientX) / timeline.width) * duration;
            if (target === "start") {
                setStartMs(Math.min(Math.max(0, originStart + deltaMs), originEnd - MINIMUM_CLIP_MILLISECONDS));
            } else if (target === "end") {
                const minimumEnd = Math.min(duration, originStart + MINIMUM_CLIP_MILLISECONDS);
                setEndMs(Math.min(duration, Math.max(Math.min(duration, originEnd + deltaMs), minimumEnd)));
            } else {
                const nextStart = Math.min(Math.max(0, originStart + deltaMs), duration - originDuration);
                setStartMs(nextStart);
                setEndMs(nextStart + originDuration);
            }
        };
        const onRelease = () => {
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onRelease);
            document.removeEventListener("pointercancel", onRelease);
        };
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onRelease);
        document.addEventListener("pointercancel", onRelease);
    };

    const adjustByKeyboard = (target: "start" | "end", event: ReactKeyboardEvent) => {
        const step = event.shiftKey ? 1000 : 100;
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        const delta = event.key === "ArrowLeft" ? -step : step;
        if (target === "start") updateStart(startMs + delta);
        else updateEnd(endMs + delta);
    };

    return (
        <Modal
            title={
                <span className="flex items-center gap-2">
                    <Scissors className="size-4" />
                    裁剪为新音频节点
                </span>
            }
            open={open && Boolean(node)}
            centered
            destroyOnHidden
            onCancel={onClose}
            footer={[
                <Button key="reset" onClick={reset}>
                    重置范围
                </Button>,
                <Button key="cancel" onClick={onClose}>
                    取消
                </Button>,
                <Button key="confirm" type="primary" disabled={!node?.content.source || selectedDuration < MINIMUM_CLIP_MILLISECONDS} onClick={() => onConfirm(startMs, endMs)}>
                    创建音频节点
                </Button>,
            ]}
            width={680}
        >
            {node ? (
                <div className="space-y-4">
                    <div className="text-sm" style={{ color: theme.node.text }}>
                        {node.title}
                    </div>
                    <audio
                        ref={audioRef}
                        src={node.content.source}
                        preload="metadata"
                        aria-label="裁剪范围音频预览"
                        onLoadedMetadata={(event) => {
                            event.currentTarget.currentTime = startMs / 1000;
                            setPreviewTimeMs(startMs);
                        }}
                        onPlay={(event) => {
                            activateCanvasAudio(event.currentTarget);
                            setPreviewPlaying(true);
                        }}
                        onPause={() => setPreviewPlaying(false)}
                        onEnded={() => {
                            setPreviewPlaying(false);
                            setPreviewTimeMs(endMs);
                        }}
                        onTimeUpdate={(event) => {
                            const time = event.currentTarget.currentTime;
                            const end = endMs / 1000;
                            if (time >= end) {
                                event.currentTarget.pause();
                                event.currentTarget.currentTime = end;
                                setPreviewTimeMs(endMs);
                                return;
                            }
                            setPreviewTimeMs(Math.max(startMs, time * 1000));
                        }}
                        className="sr-only"
                    />
                    <div className="relative h-32 overflow-hidden rounded-lg border" style={{ background: theme.node.panel, borderColor: theme.node.stroke }}>
                        <div ref={timelineRef} className="absolute inset-4">
                            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 512 100" preserveAspectRatio="none" aria-hidden="true">
                                {peaks.map((peak, index) => (
                                    <line key={index} x1={index * 4 + 2} x2={index * 4 + 2} y1={50 - Math.max(1, peak * 40)} y2={50 + Math.max(1, peak * 40)} stroke={theme.node.muted} strokeWidth={2} strokeLinecap="round" />
                                ))}
                                <line x1={(previewPercent / 100) * 512} x2={(previewPercent / 100) * 512} y1={0} y2={100} stroke={theme.node.activeStroke} strokeWidth={2} />
                            </svg>
                            <div
                                className="absolute inset-y-0 touch-none cursor-grab border-l-2 border-r-2 active:cursor-grabbing"
                                style={{ left: `${startPercent}%`, right: `${100 - endPercent}%`, background: `${theme.node.activeStroke}22`, borderColor: theme.node.activeStroke }}
                                onPointerDown={(event) => beginDrag("range", event)}
                            />
                            <button
                                type="button"
                                role="slider"
                                aria-label="调整裁剪开始时间"
                                aria-valuemin={0}
                                aria-valuemax={duration}
                                aria-valuenow={Math.round(startMs)}
                                aria-valuetext={formatAudioTime(startMs / 1000)}
                                className="nodrag nopan absolute top-1/2 z-20 h-11 w-6 -translate-x-1/2 -translate-y-1/2 touch-none cursor-ew-resize rounded-full border-2 shadow"
                                style={{ left: `${startPercent}%`, borderColor: theme.node.activeStroke, background: theme.node.panel }}
                                onPointerDown={(event) => beginDrag("start", event)}
                                onKeyDown={(event) => adjustByKeyboard("start", event)}
                            />
                            <button
                                type="button"
                                role="slider"
                                aria-label="调整裁剪结束时间"
                                aria-valuemin={0}
                                aria-valuemax={duration}
                                aria-valuenow={Math.round(endMs)}
                                aria-valuetext={formatAudioTime(endMs / 1000)}
                                className="nodrag nopan absolute top-1/2 z-20 h-11 w-6 -translate-x-1/2 -translate-y-1/2 touch-none cursor-ew-resize rounded-full border-2 shadow"
                                style={{ left: `${endPercent}%`, borderColor: theme.node.activeStroke, background: theme.node.panel }}
                                onPointerDown={(event) => beginDrag("end", event)}
                                onKeyDown={(event) => adjustByKeyboard("end", event)}
                            />
                            <input type="range" min={0} max={duration || 1} step={10} value={startMs} aria-label="裁剪开始时间键盘输入" className="sr-only" onChange={(event) => updateStart(Number(event.target.value))} />
                            <input type="range" min={0} max={duration || 1} step={10} value={endMs} aria-label="裁剪结束时间键盘输入" className="sr-only" onChange={(event) => updateEnd(Number(event.target.value))} />
                        </div>
                    </div>
                    <div className="flex items-center justify-center gap-3 text-xs tabular-nums" style={{ color: theme.node.muted }}>
                        <button
                            type="button"
                            aria-label={previewPlaying ? "暂停裁剪预览" : "播放裁剪预览"}
                            title={previewPlaying ? "暂停预览" : "播放预览"}
                            disabled={!node.content.source || selectedDuration < MINIMUM_CLIP_MILLISECONDS}
                            className="grid size-11 shrink-0 place-items-center rounded-full border transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                            style={{ borderColor: theme.node.activeStroke, color: theme.node.activeStroke }}
                            onClick={() => void togglePreview()}
                        >
                            {previewPlaying ? <Pause className="size-4" aria-hidden="true" /> : <Play className="ml-0.5 size-4" aria-hidden="true" />}
                        </button>
                        <span>
                            {formatAudioTime(Math.max(0, previewTimeMs - startMs) / 1000)} / {formatAudioTime(selectedDuration / 1000)}
                        </span>
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-center text-xs tabular-nums" style={{ color: theme.node.muted }}>
                        <div>
                            <div className="mb-1 opacity-60">开始</div>
                            <strong style={{ color: theme.node.text }}>{formatAudioTime(startMs / 1000)}</strong>
                        </div>
                        <div>
                            <div className="mb-1 opacity-60">片段时长</div>
                            <strong style={{ color: theme.node.activeStroke }}>{formatAudioTime(selectedDuration / 1000)}</strong>
                        </div>
                        <div>
                            <div className="mb-1 opacity-60">结束</div>
                            <strong style={{ color: theme.node.text }}>{formatAudioTime(endMs / 1000)}</strong>
                        </div>
                    </div>
                    <p className="text-xs" style={{ color: theme.node.muted }}>
                        原节点保持完整音频，新节点将引用当前选中的片段。
                    </p>
                </div>
            ) : null}
        </Modal>
    );
}
