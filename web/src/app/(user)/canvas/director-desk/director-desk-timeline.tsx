"use client";
import { useTranslation } from "@/features/locale/use-translation";


import { Button, InputNumber, Tooltip } from "antd";
import type { ReactNode } from "react";
import { Pause, Play, Repeat2, RotateCcw, StepBack, StepForward } from "lucide-react";
import type { CanvasDirectorDeskProject } from "@/features/canvas/types";
import { useCanvasTheme } from "@/features/canvas/components/canvas-theme-provider";
import { CHARACTER_ACTIONS } from "./director-desk-pose";
import { createPathLabels } from "./director-desk-inspector";
import { DirectorDeskTimelineSegment } from "./director-desk-timeline-segment";
import type { DirectorDeskTimelineSegmentReference, TimelineInterval } from "./director-desk-timeline-segments";

/** 轨道展示工程数据，播放头和跳转只影响预览时间。 */
export function DirectorDeskTimeline({ project, timeMilliseconds, playing, loop, disabled, selectedId, selectedPathId, onSeek, onPlayingChange, onLoopChange, onDurationChange, onSelect, onEditingStart, onSegmentChange }: {
    project: CanvasDirectorDeskProject; timeMilliseconds: number; playing: boolean; loop: boolean; disabled: boolean; selectedId: string | null; selectedPathId?: string;
    onSeek: (time: number) => void; onPlayingChange: (playing: boolean) => void; onLoopChange: (loop: boolean) => void; onDurationChange: (seconds: number) => void; onSelect: (id: string, camera: boolean, pathId?: string) => void;
    onEditingStart: () => void; onSegmentChange: (reference: DirectorDeskTimelineSegmentReference, interval: TimelineInterval | null) => void;
}) {
    const translate = useTranslation();
    const theme = useCanvasTheme();
    const duration = project.timeline.durationMilliseconds;
    const frame = Math.round(timeMilliseconds * 30 / 1000);
    const rows = [
        ...project.objects.filter((object) => object.kind !== "ground").map((object) => ({ id: object.id, name: object.name, camera: false, locked: object.locked, paths: object.track?.motionPaths || [], positions: object.track?.position || [], rotations: object.track?.rotation || [], poses: object.track?.pose || [], clips: object.track?.actionClips || [] })),
        ...project.cameras.map((camera) => ({ id: camera.id, name: camera.name, camera: true, locked: false, paths: camera.motionPaths || [], positions: camera.keyframes, rotations: [], poses: [], clips: [] })),
    ];
    const button = (label: string, icon: ReactNode, action: () => void, active = false) => <Tooltip title={label}><Button size="small" type={active ? "primary" : "text"} disabled={disabled} icon={icon} aria-label={label} onClick={action} /></Tooltip>;
    const marker = (id: string, time: number, title: string, top: number, shape: "circle" | "diamond") => <Tooltip key={id} title={translate("directorDesk.s_31a6df", { value0: title, value1: (time / 1000).toFixed(2) })}><button type="button" disabled={disabled} aria-label={translate("directorDesk.jumpToS", { value0: title, value1: (time / 1000).toFixed(2) })} className={`absolute z-10 size-2 -translate-x-1/2 border ${shape === "circle" ? "rounded-full" : "rotate-45"}`} style={{ left: `${time / duration * 100}%`, top, background: theme.node.activeStroke, borderColor: theme.node.panel }} onClick={() => onSeek(time)} /></Tooltip>;
    return <footer className="shrink-0 border-t px-4 py-2" style={{ borderColor: theme.node.stroke }}>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            {button(playing ? translate("directorDesk.pausePreviewSpace") : translate("directorDesk.playPreviewSpace"), playing ? <Pause className="size-4" /> : <Play className="size-4" />, () => onPlayingChange(!playing))}
            {button(translate("directorDesk.previousFrame"), <StepBack className="size-4" />, () => { onPlayingChange(false); onSeek(Math.max(0, (frame - 1) * 1000 / 30)); })}
            {button(translate("directorDesk.nextFrame"), <StepForward className="size-4" />, () => { onPlayingChange(false); onSeek(Math.min(duration, (frame + 1) * 1000 / 30)); })}
            {button(translate("directorDesk.backToStart"), <RotateCcw className="size-4" />, () => { onPlayingChange(false); onSeek(0); })}
            {button(translate("directorDesk.loop"), <Repeat2 className="size-4" />, () => onLoopChange(!loop), loop)}
            <span className="tabular-nums text-[var(--studio-muted)]">{(timeMilliseconds / 1000).toFixed(2)} / {(duration / 1000).toFixed(1)} {translate("directorDesk.s_b6beae")}{frame} {translate("directorDesk.frames")}</span>
            <label className="ml-auto flex items-center gap-2"><span>{translate("directorDesk.durationS")}</span><InputNumber className="w-16!" size="small" min={2} max={15} precision={0} disabled={disabled} value={duration / 1000} onChange={(value) => { if (typeof value === "number") onDurationChange(value); }} /></label>
            <span className="text-[var(--studio-muted)]">{translate("directorDesk.30Fps")}</span>
            <span className="text-[var(--studio-muted)]">{translate("directorDesk.dragClipEdgesToAdjustTimeRightClickTo")}</span>
        </div>
        <div className="max-h-[210px] overflow-y-auto overflow-x-hidden">
            <div className="grid grid-cols-[112px_minmax(0,1fr)] items-center">
                <span className="text-xs text-[var(--studio-muted)]">{translate("directorDesk.timelineTracks")}</span>
                <div className="min-w-0 px-2"><input className="block w-full accent-[var(--studio-action)]" type="range" min={0} max={Math.round(duration * 30 / 1000)} step={1} value={frame} aria-label={translate("directorDesk.directorTimelinePlayhead")} disabled={disabled} onChange={(event) => { onPlayingChange(false); onSeek(Number(event.target.value) * 1000 / 30); }} />
                    <div className="relative h-5 text-[10px] text-[var(--studio-muted)]">{Array.from({ length: duration / 1000 + 1 }, (_, second) => <button key={second} type="button" disabled={disabled} className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${second * 1000 / duration * 100}%` }} onClick={() => { onPlayingChange(false); onSeek(second * 1000); }}>{second}s</button>)}</div>
                </div>
            </div>
            {rows.map((row) => <div key={row.id} className="grid grid-cols-[112px_minmax(0,1fr)] border-t" style={{ borderColor: theme.node.stroke, background: row.id === selectedId ? `${theme.node.activeStroke}10` : undefined }}>
                <button type="button" disabled={disabled} className="truncate px-2 py-2 text-left text-xs" onClick={() => onSelect(row.id, row.camera)}>{row.name}</button>
                <div className="relative mx-2 min-h-[86px] border-l border-r" style={{ borderColor: theme.node.stroke }}>
                    <div className="pointer-events-none absolute inset-y-0 z-20 w-px" style={{ background: theme.node.text, left: `${timeMilliseconds / duration * 100}%` }} />
                    {row.paths.map((path) => <DirectorDeskTimelineSegment key={path.id} segment={path} siblings={row.paths} label={`${row.name} · ${createPathLabels(translate)[path.kind]}`} durationMilliseconds={duration} disabled={disabled || row.locked} selected={row.id === selectedId && path.id === selectedPathId}
                        style={{ top: 4, background: `${theme.node.activeStroke}${row.id === selectedId && path.id === selectedPathId ? "50" : "20"}`, borderColor: theme.node.activeStroke }} onSelect={() => { onSeek(path.startTimeMilliseconds); onSelect(row.id, row.camera, path.id); }} onEditingStart={onEditingStart}
                        onChange={(interval) => onSegmentChange({ ownerId: row.id, segmentId: path.id, kind: row.camera ? "cameraPath" : "objectPath" }, interval)} />)}
                    {row.positions.map((keyframe) => marker(keyframe.id, keyframe.timeMilliseconds, row.camera ? translate("directorDesk.cameraKeyframes") : translate("directorDesk.positionKeyframes"), 12, "circle"))}
                    {row.rotations.map((keyframe) => marker(keyframe.id, keyframe.timeMilliseconds, translate("directorDesk.rotationKeyframes"), 62, "diamond"))}
                    {row.poses.map((keyframe) => marker(keyframe.id, keyframe.timeMilliseconds, translate("directorDesk.poseKeyframes"), 75, "diamond"))}
                    {row.clips.map((clip) => <DirectorDeskTimelineSegment key={clip.id} segment={clip} siblings={row.clips} label={`${row.name} · ${CHARACTER_ACTIONS[clip.preset].label}`} durationMilliseconds={duration} disabled={disabled || row.locked}
                        style={{ top: 32, background: theme.node.stroke, borderColor: theme.node.stroke }} onSelect={() => { onSeek(clip.startTimeMilliseconds); onSelect(row.id, false); }} onEditingStart={onEditingStart}
                        onChange={(interval) => onSegmentChange({ ownerId: row.id, segmentId: clip.id, kind: "action" }, interval)} />)}
                </div>
            </div>)}
        </div>
    </footer>;
}
