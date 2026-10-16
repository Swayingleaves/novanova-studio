import type { CanvasDirectorDeskActionClip, CanvasDirectorDeskActionPreset, CanvasDirectorDeskProject } from "@/features/canvas/types";

export interface TimelineInterval {
    startTimeMilliseconds: number;
    endTimeMilliseconds: number;
}

/** 轨道编辑必须携带所属对象和片段标识，避免操作未选中轨道时误改当前对象。 */
export interface DirectorDeskTimelineSegmentReference {
    ownerId: string;
    segmentId: string;
    kind: "objectPath" | "cameraPath" | "action";
}

/** 拖拽边缘按固定帧吸附，限制在相邻片段之间，并至少保留一帧。 */
export function resizeTimelineSegment(segments: Array<TimelineInterval & { id: string }>, segmentId: string, edge: "start" | "end", timeMilliseconds: number, durationMilliseconds: number): TimelineInterval {
    const sorted = [...segments].sort((first, second) => first.startTimeMilliseconds - second.startTimeMilliseconds);
    const index = sorted.findIndex((segment) => segment.id === segmentId);
    if (index < 0) throw new Error("要调整的时间轨道片段不存在");
    const segment = sorted[index];
    const frame = (time: number) => Math.round(time * 30 / 1000);
    const minimumFrame = edge === "start" ? frame(sorted[index - 1]?.endTimeMilliseconds || 0) : frame(segment.startTimeMilliseconds) + 1;
    const maximumFrame = edge === "start" ? frame(segment.endTimeMilliseconds) - 1 : frame(sorted[index + 1]?.startTimeMilliseconds ?? durationMilliseconds);
    const time = Number((Math.max(minimumFrame, Math.min(maximumFrame, frame(timeMilliseconds))) * 1000 / 30).toFixed(6));
    return { startTimeMilliseconds: edge === "start" ? time : segment.startTimeMilliseconds, endTimeMilliseconds: edge === "end" ? time : segment.endTimeMilliseconds };
}

/** 删除或调整指定轨道片段，保留其他轨道和场景数据，具体时间合法性由统一工程校验处理。 */
export function editDirectorDeskTimelineSegment(project: CanvasDirectorDeskProject, reference: DirectorDeskTimelineSegmentReference, interval: TimelineInterval | null): CanvasDirectorDeskProject {
    const editSegments = <Segment extends TimelineInterval & { id: string }>(segments: Segment[]): Segment[] => {
        if (!segments.some((segment) => segment.id === reference.segmentId)) throw new Error("要编辑的时间轨道片段不存在");
        return (interval ? segments.map((segment) => segment.id === reference.segmentId ? { ...segment, ...interval } : segment) : segments.filter((segment) => segment.id !== reference.segmentId))
            .sort((first, second) => first.startTimeMilliseconds - second.startTimeMilliseconds);
    };
    if (reference.kind === "cameraPath") {
        if (!project.cameras.some((camera) => camera.id === reference.ownerId)) throw new Error("要编辑的时间轨道机位不存在");
        return { ...project, cameras: project.cameras.map((camera) => camera.id === reference.ownerId ? { ...camera, motionPaths: editSegments(camera.motionPaths || []) } : camera) };
    }
    const owner = project.objects.find((object) => object.id === reference.ownerId);
    if (!owner) throw new Error("要编辑的时间轨道对象不存在");
    if (owner.locked) throw new Error("已锁定对象不能编辑时间轨道");
    return { ...project, objects: project.objects.map((object) => object.id === reference.ownerId ? {
        ...object, track: { position: [], rotation: [], ...object.track, ...(reference.kind === "action" ? { actionClips: editSegments(object.track?.actionClips || []) } : { motionPaths: editSegments(object.track?.motionPaths || []) }) },
    } : object) };
}

/** 相邻片段交界处选择后一段，工程末端仍可编辑最后一段。 */
export function findActiveTimelineSegment<Segment extends TimelineInterval>(segments: Segment[], timeMilliseconds: number, durationMilliseconds: number): Segment | undefined {
    return segments.find((segment) => timeMilliseconds >= segment.startTimeMilliseconds && (timeMilliseconds < segment.endTimeMilliseconds || timeMilliseconds === durationMilliseconds && timeMilliseconds === segment.endTimeMilliseconds));
}

/** 新片段从播放头开始，到下一段起点或工程末尾结束，禁止覆盖现有区间。 */
export function getEmptyTimelineInterval(segments: TimelineInterval[], timeMilliseconds: number, durationMilliseconds: number): TimelineInterval | undefined {
    if (timeMilliseconds >= durationMilliseconds || findActiveTimelineSegment(segments, timeMilliseconds, durationMilliseconds)) return;
    const nextStart = Math.min(durationMilliseconds, ...segments.filter((segment) => segment.startTimeMilliseconds > timeMilliseconds).map((segment) => segment.startTimeMilliseconds));
    return { startTimeMilliseconds: timeMilliseconds, endTimeMilliseconds: nextStart };
}

/** 修改当前动作或在空白区间追加动作，不改变其他时间段的预设和时长。 */
export function setTimelineCharacterAction(clips: CanvasDirectorDeskActionClip[], preset: CanvasDirectorDeskActionPreset, timeMilliseconds: number, durationMilliseconds: number, newClipId: string): CanvasDirectorDeskActionClip[] {
    const active = findActiveTimelineSegment(clips, timeMilliseconds, durationMilliseconds);
    if (active) return clips.map((clip) => clip.id === active.id ? { ...clip, preset } : clip);
    const interval = getEmptyTimelineInterval(clips, timeMilliseconds, durationMilliseconds);
    if (!interval) throw new Error("请将播放头移到时间轴内的空白区间，再添加动作");
    return [...clips, { id: newClipId, preset, ...interval, speed: 1 }].sort((first, second) => first.startTimeMilliseconds - second.startTimeMilliseconds);
}
