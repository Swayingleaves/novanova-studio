"use client";
import { translateMessage as translate } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";


import { useEffect, useState } from "react";
import { Button, InputNumber, Segmented, Select, Slider, Switch, Tooltip } from "antd";
import { Circle, Minus, Pencil, PenTool, Square, Trash2 } from "lucide-react";
import type { CanvasDirectorDeskActionClip, CanvasDirectorDeskActionPreset, CanvasDirectorDeskJoint, CanvasDirectorDeskMotionPath, CanvasDirectorDeskObject, CanvasDirectorDeskPathKind, CanvasDirectorDeskPose, CanvasDirectorDeskVector3 } from "@/features/canvas/types";
import { CHARACTER_ACTIONS, degreesToRadians, DIRECTOR_DESK_JOINTS, JOINT_LABELS, jointAxisLabel, radiansToDegrees } from "./director-desk-pose";
import { moveMotionPathAnchor, translateMotionPath } from "./director-desk-motion-path";

/** 按调用方语言生成显示文案，业务值保持不变。 */
export const createPathLabels = (translator: typeof translate = translate): Record<CanvasDirectorDeskPathKind, string> => ({ get circle() { return translator("directorDesk.circlePath"); }, get line() { return translator("directorDesk.straightPath"); }, get rectangle() { return translator("directorDesk.rectanglePath"); }, get pencil() { return translator("directorDesk.pencilPath"); }, get pen() { return translator("directorDesk.penPath"); } });

export const PATH_LABELS = createPathLabels();
const PATH_ICONS = { circle: Circle, line: Minus, rectangle: Square, pencil: Pencil, pen: PenTool };

/** 场景向量数值编辑，支持键盘操作与明确轴标签。 */
export function DirectorDeskVectorInput({ label, value, disabled = false, onChange }: { label: string; value: CanvasDirectorDeskVector3; disabled?: boolean; onChange: (value: CanvasDirectorDeskVector3) => void }) {
    return <div className="space-y-1"><span className="text-xs text-[var(--studio-muted)]">{label}</span><div className="grid grid-cols-3 gap-1">{(["x", "y", "z"] as const).map((axis) => <InputNumber key={axis} className="w-full!" size="small" controls={false} precision={3} disabled={disabled} aria-label={`${label} ${axis.toUpperCase()}`} prefix={axis.toUpperCase()} value={value[axis]} onChange={(next) => { if (typeof next === "number" && Number.isFinite(next)) onChange({ ...value, [axis]: next }); }} />)}</div></div>;
}

/** 轨迹面板保留绘制、完成、取消与数值编辑的同一入口。 */
export function DirectorDeskPathPanel({ paths, path, drawingInterval, onSelectPath, onAppend, tool, height, selectedAnchor, durationMilliseconds, disabled, showDirection, onToolChange, onPathChange, onHeightChange, onSelectAnchor, onFinish, onCancel, onRemove }: {
    paths: CanvasDirectorDeskMotionPath[]; drawingInterval: Pick<CanvasDirectorDeskMotionPath, "startTimeMilliseconds" | "endTimeMilliseconds"> | null; onSelectPath: (pathId: string) => void; onAppend: () => void;
    path?: CanvasDirectorDeskMotionPath; tool: CanvasDirectorDeskPathKind | null; height: number; selectedAnchor: number; durationMilliseconds: number; disabled: boolean; showDirection: boolean;
    onToolChange: (tool: CanvasDirectorDeskPathKind) => void; onPathChange: (path: CanvasDirectorDeskMotionPath) => void; onHeightChange: (height: number) => void; onSelectAnchor: (index: number) => void; onFinish: (closed: boolean) => void; onCancel: () => void; onRemove: () => void;
}) {
    const translate = useTranslation();
    const anchor = path?.anchors[selectedAnchor];
    const pathDisabled = disabled || Boolean(tool);
    return <section className="space-y-3">
        <div className="flex gap-1.5"><Select className="min-w-0 flex-1" size="small" aria-label={translate("directorDesk.motionSegment")} placeholder={translate("directorDesk.emptyInterval")} value={path?.id} disabled={pathDisabled || !paths.length} onChange={onSelectPath} options={[...paths].sort((first, second) => first.startTimeMilliseconds - second.startTimeMilliseconds).map((item) => ({ label: translate("directorDesk.s", { value0: createPathLabels(translate)[item.kind], value1: item.startTimeMilliseconds / 1000, value2: item.endTimeMilliseconds / 1000 }), value: item.id }))} /><Button size="small" disabled={pathDisabled} onClick={onAppend}>{translate("directorDesk.appendClip")}</Button></div>
        <p className="text-xs text-[var(--studio-muted)]">{drawingInterval ? translate("directorDesk.drawingPathFromToS", { value0: drawingInterval.startTimeMilliseconds / 1000, value1: drawingInterval.endTimeMilliseconds / 1000 }) : path ? translate("directorDesk.chooseAToolToRedrawAppendingLocatesTheNext") : translate("directorDesk.chooseAToolToAddMotionFromThePlayhead")}</p>
        <div className="grid grid-cols-2 gap-1.5">{(Object.keys(createPathLabels(translate)) as CanvasDirectorDeskPathKind[]).map((kind) => {
            const Icon = PATH_ICONS[kind];
            return <Tooltip key={kind} title={kind === "pen" ? translate("directorDesk.clickToAddAnchorsDragForTangentsEnterTo") : kind === "pencil" ? translate("directorDesk.holdToDrawReleaseToFinish") : translate("directorDesk.holdAndDragToDraw")}><Button size="small" type={tool === kind ? "primary" : "default"} icon={<Icon className="size-3.5" />} disabled={disabled} onClick={() => onToolChange(kind)}>{createPathLabels(translate)[kind]}</Button></Tooltip>;
        })}</div>
        {tool ? <div className="flex flex-wrap gap-2">{tool === "pen" ? <><Button size="small" onClick={() => onFinish(false)}>{translate("directorDesk.finishPath")}</Button><Button size="small" onClick={() => onFinish(true)}>{translate("directorDesk.closePath")}</Button></> : null}<Button size="small" onClick={onCancel}>{translate("directorDesk.cancelDrawing")}</Button></div> : null}
        <div className="flex items-center justify-between gap-2 text-xs"><span>{translate("directorDesk.pathHeight")}</span><InputNumber size="small" className="w-24!" disabled={disabled} value={height} controls={false} precision={2} onChange={(value) => { if (typeof value === "number") onHeightChange(value); }} /></div>
        {path ? <>
            <div className="flex items-center justify-between text-xs"><span>{createPathLabels(translate)[path.kind]}</span><Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} disabled={pathDisabled} onClick={onRemove}>{translate("directorDesk.remove")}</Button></div>
            <TimeInterval start={path.startTimeMilliseconds} end={path.endTimeMilliseconds} durationMilliseconds={durationMilliseconds} disabled={pathDisabled} onChange={(start, end) => onPathChange({ ...path, startTimeMilliseconds: start, endTimeMilliseconds: end })} />
            {showDirection ? <div className="flex items-center justify-between text-xs"><span>{translate("directorDesk.orientAlongPath")}</span><Switch size="small" checked={path.followDirection} disabled={pathDisabled} onChange={(followDirection) => onPathChange({ ...path, followDirection })} /></div> : null}
            <div className="flex items-center justify-between text-xs"><span>{translate("directorDesk.closePath")}</span><Switch size="small" checked={path.closed} disabled={pathDisabled || path.anchors.length < 3} onChange={(closed) => onPathChange({ ...path, closed })} /></div>
            <Select className="w-full!" size="small" value={Math.min(selectedAnchor, path.anchors.length - 1)} aria-label={translate("directorDesk.pathAnchor")} onChange={onSelectAnchor} options={path.anchors.map((_, index) => ({ label: translate("directorDesk.anchor", { value0: index + 1 }), value: index }))} />
            {anchor ? <>{(["position", "incoming", "outgoing"] as const).map((part) => anchor[part] ? <DirectorDeskVectorInput key={part} label={part === "position" ? translate("directorDesk.anchorPosition") : part === "incoming" ? translate("directorDesk.incomingTangentHandle") : translate("directorDesk.outgoingTangentHandle")} value={anchor[part]!} disabled={pathDisabled} onChange={(position) => onPathChange(moveMotionPathAnchor(path, selectedAnchor, part, position))} /> : null)}</> : null}
        </> : <p className="text-xs text-[var(--studio-muted)]">{translate("directorDesk.chooseAToolAndDrawInTheDirectorView")}</p>}
    </section>;
}

/** 时间区间按帧吸附，复用于轨迹与动作片段。 */
function TimeInterval({ start, end, durationMilliseconds, disabled, onChange }: { start: number; end: number; durationMilliseconds: number; disabled: boolean; onChange: (start: number, end: number) => void }) {
    const translate = useTranslation();
    const snap = (seconds: number) => Number((Math.round(seconds * 30) * 1000 / 30).toFixed(6));
    return <div className="grid grid-cols-2 gap-2">{(["start", "end"] as const).map((field) => <label key={field} className="block space-y-1 text-xs text-[var(--studio-muted)]"><span>{field === "start" ? translate("directorDesk.startS") : translate("directorDesk.endS")}</span><InputNumber className="w-full!" size="small" controls={false} min={0} max={durationMilliseconds / 1000} step={1 / 30} precision={3} disabled={disabled} value={(field === "start" ? start : end) / 1000} onChange={(value) => { if (typeof value === "number") onChange(field === "start" ? snap(value) : start, field === "end" ? snap(value) : end); }} /></label>)}</div>;
}

/** 姿势预设、动作片段和关节微调共享选中角色，不经过全局组件透传。 */
export function DirectorDeskPosePanel({ object, adjustment, selectedJoint, keyframing, durationMilliseconds, disabled, onPreset, onClipsChange, onAdjustmentChange, onPreviewAdjustment, onSelectJoint, onKeyframingChange, onRecord, onRemoveKeyframe }: {
    object: CanvasDirectorDeskObject; adjustment: CanvasDirectorDeskPose; selectedJoint: CanvasDirectorDeskJoint; keyframing: boolean; durationMilliseconds: number; disabled: boolean;
    onPreset: (preset: CanvasDirectorDeskActionPreset) => void; onClipsChange: (clips: CanvasDirectorDeskActionClip[]) => void; onAdjustmentChange: (pose: CanvasDirectorDeskPose) => void; onPreviewAdjustment: (pose: CanvasDirectorDeskPose) => void; onSelectJoint: (joint: CanvasDirectorDeskJoint) => void; onKeyframingChange: (enabled: boolean) => void; onRecord: () => void; onRemoveKeyframe: () => void;
}) {
    const translate = useTranslation();
    const [draft, setDraft] = useState(adjustment);
    useEffect(() => setDraft(adjustment), [adjustment]);
    const clips = object.track?.actionClips || [];
    const updateJoint = (joint: CanvasDirectorDeskJoint, axis: keyof CanvasDirectorDeskVector3, degrees: number) => {
        const next = { ...draft, joints: { ...draft.joints, [joint]: { ...draft.joints[joint], [axis]: degreesToRadians(degrees) } } };
        setDraft(next);
        return next;
    };
    return <section className="space-y-4">
        <div><h3 className="mb-2 text-xs font-medium">{translate("directorDesk.posePresets")}</h3><div className="grid grid-cols-4 gap-1">{(Object.entries(CHARACTER_ACTIONS) as [CanvasDirectorDeskActionPreset, { label: string }][]).map(([preset, action]) => <Button key={preset} className="px-0!" size="small" disabled={disabled} onClick={() => onPreset(preset)}>{action.label}</Button>)}</div></div>
        <div className="space-y-2"><h3 className="text-xs font-medium">{translate("directorDesk.motionClip")}</h3>{clips.map((clip) => <div key={clip.id} className="space-y-2 border-b pb-3 border-[var(--studio-line)]">
            <div className="flex gap-1"><Select className="min-w-0 flex-1" size="small" disabled={disabled} value={clip.preset} options={Object.entries(CHARACTER_ACTIONS).map(([value, action]) => ({ label: action.label, value }))} onChange={(preset) => onClipsChange(clips.map((item) => item.id === clip.id ? { ...item, preset } : item))} /><Button size="small" type="text" disabled={disabled} aria-label={translate("directorDesk.deleteMotionClip")} icon={<Trash2 className="size-3.5" />} onClick={() => onClipsChange(clips.filter((item) => item.id !== clip.id))} /></div>
            <TimeInterval start={clip.startTimeMilliseconds} end={clip.endTimeMilliseconds} durationMilliseconds={durationMilliseconds} disabled={disabled} onChange={(startTimeMilliseconds, endTimeMilliseconds) => onClipsChange(clips.map((item) => item.id === clip.id ? { ...item, startTimeMilliseconds, endTimeMilliseconds } : item))} />
            <label className="flex items-center justify-between text-xs"><span>{translate("directorDesk.playbackSpeed")}</span><InputNumber size="small" min={0.1} max={4} step={0.1} value={clip.speed ?? 1} disabled={disabled} onChange={(speed) => { if (typeof speed === "number") onClipsChange(clips.map((item) => item.id === clip.id ? { ...item, speed } : item)); }} /></label>
        </div>)}</div>
        <div className="space-y-2"><h3 className="text-xs font-medium">{translate("directorDesk.adjustPose")}</h3><Segmented block size="small" value={keyframing ? "frame" : "base"} options={[{ label: translate("directorDesk.baseOffset"), value: "base" }, { label: translate("directorDesk.currentFrameOffset"), value: "frame" }]} onChange={(value) => onKeyframingChange(value === "frame")} />
            <div className="flex gap-2"><Button size="small" disabled={disabled} onClick={onRecord}>{translate("directorDesk.recordPoseKeyframe")}</Button><Button size="small" disabled={disabled} onClick={onRemoveKeyframe}>{translate("directorDesk.deleteCurrentFrame")}</Button></div>
            <Select className="w-full!" size="small" aria-label={translate("directorDesk.selectedJoint")} value={selectedJoint} options={DIRECTOR_DESK_JOINTS.map((joint) => ({ label: JOINT_LABELS[joint], value: joint }))} onChange={onSelectJoint} />
            {DIRECTOR_DESK_JOINTS.map((joint) => <div key={joint} className="space-y-1 border-b py-2 border-[var(--studio-line)]"><button type="button" className="text-xs font-medium" aria-pressed={selectedJoint === joint} onClick={() => onSelectJoint(joint)}>{JOINT_LABELS[joint]}{selectedJoint === joint ? translate("directorDesk.selected") : ""}</button>{(["x", "y", "z"] as const).map((axis) => <div key={axis} className="grid grid-cols-[76px_minmax(0,1fr)_58px] items-center gap-1 text-xs"><span className="text-[var(--studio-muted)]">{jointAxisLabel(joint, axis)}</span><Slider min={-180} max={180} step={1} disabled={disabled} value={radiansToDegrees(draft.joints[joint][axis])} aria-label={`${JOINT_LABELS[joint]}${jointAxisLabel(joint, axis)}`} onChange={(value) => onPreviewAdjustment(updateJoint(joint, axis, value))} onChangeComplete={(value) => onAdjustmentChange(updateJoint(joint, axis, value))} /><InputNumber className="w-full!" size="small" min={-180} max={180} controls={false} precision={1} disabled={disabled} aria-label={translate("directorDesk.angle", { value0: JOINT_LABELS[joint], value1: axis })} value={radiansToDegrees(draft.joints[joint][axis])} onChange={(value) => { if (typeof value === "number") onAdjustmentChange(updateJoint(joint, axis, value)); }} /></div>)}</div>)}
            <DirectorDeskVectorInput label={translate("directorDesk.centerOffset")} value={draft.rootOffset} disabled={disabled} onChange={(rootOffset) => onAdjustmentChange({ ...draft, rootOffset })} />
        </div>
    </section>;
}

/** 修改路径高度时平移全部锚点和切线，保留原有高度差。 */
export function setMotionPathHeight(path: CanvasDirectorDeskMotionPath, height: number): CanvasDirectorDeskMotionPath {
    return translateMotionPath(path, { x: 0, y: height - path.anchors[0].position.y, z: 0 });
}
