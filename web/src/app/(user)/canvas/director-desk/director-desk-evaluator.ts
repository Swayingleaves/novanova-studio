
import { translateMessage as translate } from "@/features/locale/translate";
import type { CanvasDirectorDeskActionClip, CanvasDirectorDeskCamera, CanvasDirectorDeskObject, CanvasDirectorDeskPose, CanvasDirectorDeskProject, CanvasDirectorDeskTransform, CanvasDirectorDeskVector3 } from "../../../../features/canvas/types";
import type { CanvasDirectorDeskMotionPath } from "@/features/canvas/types";
import { evaluateMotionPath, findMotionPathAtTime, getMotionPathCurve } from "./director-desk-motion-path";
import { addPoseOffsets, CHARACTER_ACTIONS, createNeutralPose, DIRECTOR_DESK_JOINTS, evaluateCharacterAction } from "./director-desk-pose";

export interface EvaluatedDirectorDeskState {
    timeMilliseconds: number;
    objects: CanvasDirectorDeskObject[];
    camera: CanvasDirectorDeskCamera;
    cameras: CanvasDirectorDeskCamera[];
}

/**
 * 按绝对时间求值导演台工程。
 * <p>
 * 预览、截图和视频逐帧导出都必须调用同一个求值函数，避免播放速度影响最终结果。
 *
 * @param project 导演台工程
 * @param timeMilliseconds 目标时间，单位为毫秒
 * @return EvaluatedDirectorDeskState 目标时间对应的场景状态
 * @throws Error 工程缺少选中机位或关键帧时间冲突时抛出异常
 */
export function evaluateDirectorDeskProject(project: CanvasDirectorDeskProject, timeMilliseconds: number): EvaluatedDirectorDeskState {
    const validationErrors = validateDirectorDeskProject(project);
    if (validationErrors.length) throw new Error(validationErrors[0]);
    const frameDuration = 1000 / project.timeline.frameRate;
    const frameIndex = Math.round(clamp(timeMilliseconds, 0, project.timeline.durationMilliseconds) / frameDuration);
    const time = Math.min(project.timeline.durationMilliseconds, Number((frameIndex * frameDuration).toFixed(6)));
    const camera = project.cameras.find((item) => item.id === project.selectedCameraId);
    if (!camera) throw new Error(translate("directorDesk.selectedDirectorCameraNotFound"));

    const objects = project.objects.map((object) => evaluateObject(object, time));
    const cameras = project.cameras.map((item) => evaluateCamera(item, time, objects));
    return {
        timeMilliseconds: time,
        objects,
        camera: cameras.find((item) => item.id === camera.id)!,
        cameras,
    };
}

/** 校验导演台工程的时间轴与机位引用。 */
export function validateDirectorDeskProject(project: CanvasDirectorDeskProject): string[] {
    const errors: string[] = [];
    if (!project || typeof project !== "object") return [translate("directorDesk.invalidDirectorProject")];

    const timeline = project.timeline;
    if (!timeline || typeof timeline !== "object") {
        errors.push(translate("directorDesk.invalidDirectorTimeline"));
    } else if (!Number.isInteger(timeline.durationMilliseconds) || timeline.durationMilliseconds <= 0) {
        errors.push(translate("directorDesk.directorDurationMustBePositiveIntegerMilliseconds"));
    } else if (timeline.durationMilliseconds < 2000 || timeline.durationMilliseconds > 15000 || timeline.durationMilliseconds % 1000 !== 0) {
        errors.push(translate("directorDesk.directorDurationMustBeAnIntegerFrom2To"));
    }
    if (timeline && timeline.frameRate !== 30) errors.push(translate("directorDesk.directorFrameRateMustBe30Fps"));

    if (!Array.isArray(project.objects)) errors.push(translate("directorDesk.invalidDirectorSceneObject"));
    if (!Array.isArray(project.cameras)) errors.push(translate("directorDesk.invalidDirectorCamera"));
    if (project.assets !== undefined && !Array.isArray(project.assets)) errors.push(translate("directorDesk.invalidDirectorSceneAsset"));
    if (!Array.isArray(project.objects) || !Array.isArray(project.cameras)) return [...new Set(errors)];

    if (!project.cameras.length) errors.push(translate("directorDesk.atLeastOneDirectorCameraIsRequired"));
    if (!project.cameras.some((camera) => camera.id === project.selectedCameraId)) errors.push(translate("directorDesk.selectedDirectorCameraNotFound"));
    const assets = Array.isArray(project.assets) ? project.assets : [];
    const assetIds = new Set<string>();
    for (const asset of assets) {
        if (!asset.id.trim() || assetIds.has(asset.id)) errors.push(translate("directorDesk.directorSceneAssetIDsMustBeUnique"));
        assetIds.add(asset.id);
        if (!asset.storageKey?.trim()) errors.push(translate("directorDesk.directorAssetHasNoStableStorageReference", { value0: asset.name || asset.id }));
    }
    if (project.background && (!assetIds.has(project.background.assetId) || assets.find((asset) => asset.id === project.background?.assetId)?.kind !== "image")) errors.push(translate("directorDesk.directorBackgroundImageNotFound"));
    const objectIds = new Set<string>();
    for (const object of project.objects) {
        if (!object.id.trim() || objectIds.has(object.id)) errors.push(translate("directorDesk.directorSceneObjectIDsMustBeUnique"));
        objectIds.add(object.id);
        errors.push(...validateTransform(object.transform, translate("directorDesk.objectTransform")));
        errors.push(...validateKeyframeTimes(object.track?.position || [], translate("directorDesk.objectPosition"), timeline?.durationMilliseconds || 0, timeline?.frameRate || 30));
        errors.push(...validateKeyframeTimes(object.track?.rotation || [], translate("directorDesk.objectRotation"), timeline?.durationMilliseconds || 0, timeline?.frameRate || 30));
        errors.push(...validateVectorKeyframes(object.track?.position || [], translate("directorDesk.objectPosition")));
        errors.push(...validateVectorKeyframes(object.track?.rotation || [], translate("directorDesk.objectRotation")));
        errors.push(...validateActionClips(object.track?.actionClips || [], object.name || object.id, timeline?.durationMilliseconds || 0, timeline?.frameRate || 30));
        errors.push(...validateMotionPaths(object.track?.motionPaths || [], timeline?.durationMilliseconds || 0));
        if (object.track?.motionPaths?.length && object.track.position.length) errors.push(translate("directorDesk.motionPathsCannotCoexistWithPositionKeyframes"));
        if (object.pose) errors.push(...validatePose(object.pose));
        errors.push(...validateKeyframeTimes(object.track?.pose || [], translate("directorDesk.pose"), timeline?.durationMilliseconds || 0, timeline?.frameRate || 30));
        for (const keyframe of object.track?.pose || []) errors.push(...validatePose(keyframe.value));
        if (object.kind === "glb" && (!object.assetId || assets.find((asset) => asset.id === object.assetId)?.kind !== "glb")) errors.push(translate("directorDesk.directorObjectHasNoGLBResource", { value0: object.name || object.id }));
    }
    const cameraIds = new Set<string>();
    for (const camera of project.cameras) {
        if (!camera.id.trim() || cameraIds.has(camera.id)) errors.push(translate("directorDesk.directorCameraIDsMustBeUnique"));
        cameraIds.add(camera.id);
        errors.push(...validateMotionPaths(camera.motionPaths || [], timeline?.durationMilliseconds || 0));
        if (camera.motionPaths?.length && camera.keyframes.some((keyframe) => isVector3(keyframe.value?.position) && isVector3(camera.position) && (["x", "y", "z"] as const).some((axis) => keyframe.value.position[axis] !== camera.position[axis]))) errors.push(translate("directorDesk.cameraPathCannotCoexistWithPositionAnimation"));
        if (camera.targetObjectId && !project.objects.some((object) => object.id === camera.targetObjectId)) errors.push(translate("directorDesk.cameraFollowTargetNotFound"));
        if (camera.targetOffset) errors.push(...validateVector3(camera.targetOffset, translate("directorDesk.cameraTargetOffset")));
        errors.push(...validateVector3(camera.position, translate("directorDesk.cameraPosition", { value0: camera.name || camera.id })));
        errors.push(...validateVector3(camera.target, translate("directorDesk.cameraTarget", { value0: camera.name || camera.id })));
        if (!Number.isFinite(camera.fieldOfView) || camera.fieldOfView <= 0 || camera.fieldOfView >= 180) errors.push(translate("directorDesk.cameraFieldOfViewMustBeBetween0And", { value0: camera.name || camera.id }));
        errors.push(...validateKeyframeTimes(camera.keyframes || [], translate("directorDesk.camera", { value0: camera.name || camera.id }), timeline?.durationMilliseconds || 0, timeline?.frameRate || 30));
        for (const keyframe of camera.keyframes || []) {
            if (!keyframe.value || typeof keyframe.value !== "object") {
                errors.push(translate("directorDesk.invalidCameraKeyframes", { value0: camera.name || camera.id }));
                continue;
            }
            errors.push(...validateVector3(keyframe.value.position, translate("directorDesk.cameraKeyframePosition", { value0: camera.name || camera.id })));
            errors.push(...validateVector3(keyframe.value.target, translate("directorDesk.cameraKeyframeTarget", { value0: camera.name || camera.id })));
            if (!Number.isFinite(keyframe.value.fieldOfView) || keyframe.value.fieldOfView <= 0 || keyframe.value.fieldOfView >= 180) errors.push(translate("directorDesk.invalidCameraKeyframeFieldOfView", { value0: camera.name || camera.id }));
        }
    }
    return [...new Set(errors)];
}

function validateTransform(transform: CanvasDirectorDeskTransform | undefined, label: string): string[] {
    if (!transform || typeof transform !== "object") return [translate("directorDesk.invalidDirectorData", { value0: label })];
    return [...validateVector3(transform.position, translate("directorDesk.position", { value0: label })), ...validateVector3(transform.rotation, translate("directorDesk.rotation", { value0: label })), ...validateVector3(transform.scale, translate("directorDesk.scale", { value0: label }))];
}

function validateVector3(value: CanvasDirectorDeskVector3 | undefined, label: string): string[] {
    return isVector3(value) ? [] : [translate("directorDesk.directorMustContainValid3DValues", { value0: label })];
}

function validateVectorKeyframes(keyframes: Array<{ value: CanvasDirectorDeskVector3 }>, label: string): string[] {
    return keyframes.flatMap((keyframe) => validateVector3(keyframe.value, translate("directorDesk.keyframe", { value0: label })));
}

function evaluateObject(object: CanvasDirectorDeskObject, timeMilliseconds: number): CanvasDirectorDeskObject {
    const track = object.track;
    const transform: CanvasDirectorDeskTransform = {
        ...object.transform,
        position: readKeyframedValue(object.transform.position, track?.position || [], timeMilliseconds),
        rotation: readKeyframedValue(object.transform.rotation, track?.rotation || [], timeMilliseconds),
    };
    const path = findMotionPathAtTime(track?.motionPaths || [], timeMilliseconds);
    if (path) {
        const pathState = evaluateMotionPath(path, timeMilliseconds);
        transform.position = pathState.position;
        if (path.followDirection) transform.rotation = { ...transform.rotation, y: Math.atan2(pathState.direction.x, pathState.direction.z) };
    }
    return { ...object, transform, ...(object.kind === "character" ? { pose: evaluatePose(object, timeMilliseconds) } : {}) };
}

function evaluatePose(object: CanvasDirectorDeskObject, timeMilliseconds: number): CanvasDirectorDeskPose {
    const clips = [...(object.track?.actionClips || [])].sort((first, second) => first.startTimeMilliseconds - second.startTimeMilliseconds);
    const clip = clips.findLast((item) => timeMilliseconds >= item.startTimeMilliseconds);
    const base = readDirectorDeskPoseAdjustment(object, timeMilliseconds);
    const elapsed = clip ? Math.min(timeMilliseconds, clip.endTimeMilliseconds) - clip.startTimeMilliseconds : timeMilliseconds;
    return addPoseOffsets(evaluateCharacterAction(clip?.preset || "idle", elapsed * (clip?.speed ?? 1)), base);
}

/** 返回当前帧手动偏移，避免把预设动画写回基础姿势。 */
export function readDirectorDeskPoseAdjustment(object: CanvasDirectorDeskObject, timeMilliseconds: number): CanvasDirectorDeskPose {
    return readKeyframedValue(object.pose || createNeutralPose(), object.track?.pose || [], timeMilliseconds);
}

function evaluateCamera(camera: CanvasDirectorDeskCamera, timeMilliseconds: number, objects: CanvasDirectorDeskObject[]): CanvasDirectorDeskCamera {
    const value = readKeyframedValue({ position: camera.position, target: camera.target, fieldOfView: camera.fieldOfView }, camera.keyframes, timeMilliseconds);
    const path = findMotionPathAtTime(camera.motionPaths || [], timeMilliseconds);
    if (path) value.position = evaluateMotionPath(path, timeMilliseconds).position;
    if (camera.targetObjectId) {
        const target = objects.find((object) => object.id === camera.targetObjectId);
        if (!target) throw new Error(translate("directorDesk.cameraFollowTargetNotFound"));
        const offset = camera.targetOffset || { x: 0, y: target.kind === "character" ? 1 : 0, z: 0 };
        value.target = { x: target.transform.position.x + offset.x, y: target.transform.position.y + offset.y, z: target.transform.position.z + offset.z };
    }
    return { ...camera, position: value.position, target: value.target, fieldOfView: value.fieldOfView };
}

function readKeyframedValue<Value>(initial: Value, keyframes: Array<{ timeMilliseconds: number; value: Value }>, timeMilliseconds: number): Value {
    if (!keyframes.length) return cloneValue(initial);
    const sorted = [...keyframes].sort((first, second) => first.timeMilliseconds - second.timeMilliseconds);
    const previous = [...sorted].reverse().find((keyframe) => keyframe.timeMilliseconds <= timeMilliseconds);
    const next = sorted.find((keyframe) => keyframe.timeMilliseconds >= timeMilliseconds);
    if (!previous) return cloneValue(initial);
    if (!next || previous.timeMilliseconds === next.timeMilliseconds) return cloneValue(previous.value);
    const ratio = (timeMilliseconds - previous.timeMilliseconds) / (next.timeMilliseconds - previous.timeMilliseconds);
    return interpolateValue(previous.value, next.value, ratio);
}

function interpolateValue<Value>(first: Value, second: Value, ratio: number): Value {
    if (isVector3(first) && isVector3(second)) return interpolateVector3(first, second, ratio) as Value;
    if (typeof first === "number" && typeof second === "number") return (first + (second - first) * ratio) as Value;
    if (isRecord(first) && isRecord(second)) {
        const result: Record<string, unknown> = {};
        for (const key of Object.keys(first)) {
            result[key] = interpolateValue(first[key], second[key], ratio);
        }
        return result as Value;
    }
    return cloneValue(first);
}

function interpolateVector3(first: CanvasDirectorDeskVector3, second: CanvasDirectorDeskVector3, ratio: number): CanvasDirectorDeskVector3 {
    return {
        x: first.x + (second.x - first.x) * ratio,
        y: first.y + (second.y - first.y) * ratio,
        z: first.z + (second.z - first.z) * ratio,
    };
}

function validateKeyframeTimes(keyframes: Array<{ timeMilliseconds: number }>, label: string, durationMilliseconds: number, frameRate: number): string[] {
    const seen = new Set<number>();
    const frameDuration = 1000 / frameRate;
    const errors: string[] = [];
    for (const keyframe of keyframes) {
        const frameIndex = keyframe.timeMilliseconds / frameDuration;
        const normalizedFrameIndex = Math.round(frameIndex);
        if (!Number.isFinite(keyframe.timeMilliseconds) || keyframe.timeMilliseconds < 0 || Math.abs(frameIndex - normalizedFrameIndex) > 1e-6) {
            errors.push(translate("directorDesk.keyframeTimesMustAlignWithFrames", { value0: label }));
        } else if (keyframe.timeMilliseconds > durationMilliseconds) {
            errors.push(translate("directorDesk.keyframesExceedTimelineDuration", { value0: label }));
        } else if (seen.has(normalizedFrameIndex)) {
            errors.push(translate("directorDesk.hasDuplicateKeyframeTimes", { value0: label }));
        }
        seen.add(normalizedFrameIndex);
    }
    return errors;
}

function validateActionClips(clips: CanvasDirectorDeskActionClip[], label: string, durationMilliseconds: number, frameRate: number): string[] {
    const errors: string[] = [];
    const sorted = [...clips].sort((first, second) => first.startTimeMilliseconds - second.startTimeMilliseconds);
    let previousEnd = -1;
    const frameDuration = 1000 / frameRate;
    for (const clip of sorted) {
        if (!CHARACTER_ACTIONS[clip.preset]) errors.push(translate("directorDesk.invalidMotionPresetFor", { value0: label }));
        if (clip.speed !== undefined && (!Number.isFinite(clip.speed) || clip.speed <= 0)) errors.push(translate("directorDesk.motionPlaybackSpeedMustBePositive"));
        if (!Number.isFinite(clip.startTimeMilliseconds) || !Number.isFinite(clip.endTimeMilliseconds)) errors.push(translate("directorDesk.motionTimeMustBeAValidNumber"));
        if (clip.endTimeMilliseconds <= clip.startTimeMilliseconds) errors.push(translate("directorDesk.motionClipDurationForMustBePositive", { value0: label }));
        if (clip.startTimeMilliseconds < 0 || clip.endTimeMilliseconds > durationMilliseconds) errors.push(translate("directorDesk.motionClipForExceedsTimeline", { value0: label }));
        if (Math.abs(clip.startTimeMilliseconds / frameDuration - Math.round(clip.startTimeMilliseconds / frameDuration)) > 1e-6 || Math.abs(clip.endTimeMilliseconds / frameDuration - Math.round(clip.endTimeMilliseconds / frameDuration)) > 1e-6)
            errors.push(translate("directorDesk.motionClipsForMustAlignWithFrameBoundaries", { value0: label }));
        if (clip.startTimeMilliseconds < previousEnd) errors.push(translate("directorDesk.motionClipsForCannotOverlap", { value0: label }));
        previousEnd = Math.max(previousEnd, clip.endTimeMilliseconds);
    }
    return errors;
}

/** 验证每段路径及区间冲突，允许前后片段共用时间边界。 */
function validateMotionPaths(paths: CanvasDirectorDeskMotionPath[], durationMilliseconds: number): string[] {
    if (!Array.isArray(paths)) return [translate("directorDesk.invalidMotionSegment")];
    const errors: string[] = [];
    const identifiers = new Set<string>();
    let previousEnd = -1;
    for (const path of [...paths].sort((first, second) => first.startTimeMilliseconds - second.startTimeMilliseconds)) {
        if (!path.id?.trim() || identifiers.has(path.id)) errors.push(translate("directorDesk.motionSegmentIDsMustBeUnique"));
        identifiers.add(path.id);
        errors.push(...validateMotionPath(path, durationMilliseconds));
        if (path.startTimeMilliseconds < previousEnd) errors.push(translate("directorDesk.motionSegmentsCannotOverlap"));
        previousEnd = Math.max(previousEnd, path.endTimeMilliseconds);
    }
    return errors;
}

/** 验证曲线数据和时间范围，不为损坏路径生成替代运动。 */
function validateMotionPath(path: CanvasDirectorDeskMotionPath, durationMilliseconds: number): string[] {
    const errors: string[] = [];
    if (!["circle", "line", "rectangle", "pencil", "pen"].includes(path.kind)) errors.push(translate("directorDesk.invalidMotionPathType"));
    if (!Array.isArray(path.anchors) || path.anchors.length < 2 || path.anchors.length > 128) return [translate("directorDesk.motionPathsRequire2To128Anchors")];
    for (const anchor of path.anchors) {
        errors.push(...validateVector3(anchor.position, translate("directorDesk.pathAnchor")));
        if (anchor.incoming) errors.push(...validateVector3(anchor.incoming, translate("directorDesk.pathTangent")));
        if (anchor.outgoing) errors.push(...validateVector3(anchor.outgoing, translate("directorDesk.pathTangent")));
    }
    if (!Number.isFinite(path.startTimeMilliseconds) || !Number.isFinite(path.endTimeMilliseconds) || path.startTimeMilliseconds < 0 || path.endTimeMilliseconds > durationMilliseconds || path.endTimeMilliseconds <= path.startTimeMilliseconds) errors.push(translate("directorDesk.invalidMotionTimeRange"));
    if ([path.startTimeMilliseconds, path.endTimeMilliseconds].some((time) => Math.abs(time * 30 / 1000 - Math.round(time * 30 / 1000)) > 1e-6)) errors.push(translate("directorDesk.motionTimesMustAlignWithFrameBoundaries"));
    if (!errors.length && getMotionPathCurve(path).getLength() < 0.001) errors.push(translate("directorDesk.motionPathLengthMustBePositive"));
    return errors;
}

/** 验证完整关节姿势，拒绝缺失关节和非有限角度。 */
function validatePose(pose: CanvasDirectorDeskPose): string[] {
    if (!pose?.joints) return [translate("directorDesk.invalidJointPose")];
    return [...validateVector3(pose.rootOffset, translate("directorDesk.centerOfGravity")), ...DIRECTOR_DESK_JOINTS.flatMap((joint) => validateVector3(pose.joints[joint], translate("directorDesk.joints")))];
}

function isVector3(value: unknown): value is CanvasDirectorDeskVector3 {
    return Boolean(value && typeof value === "object" && Number.isFinite((value as CanvasDirectorDeskVector3).x) && Number.isFinite((value as CanvasDirectorDeskVector3).y) && Number.isFinite((value as CanvasDirectorDeskVector3).z));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cloneValue<Value>(value: Value): Value {
    if (value && typeof value === "object") return structuredClone(value);
    return value;
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}
