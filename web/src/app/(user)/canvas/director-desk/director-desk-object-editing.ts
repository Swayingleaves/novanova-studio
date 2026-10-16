import type { CanvasDirectorDeskProject } from "@/features/canvas/types";
import { evaluateDirectorDeskProject } from "./director-desk-evaluator";

/** 删除指定场景对象及其轨道，将跟随机位固定到删除时的目标点。 */
export function removeDirectorDeskObjects(project: CanvasDirectorDeskProject, objectIds: string[], timeMilliseconds: number): CanvasDirectorDeskProject {
    const identifiers = new Set(objectIds);
    for (const identifier of identifiers) {
        const object = project.objects.find((item) => item.id === identifier);
        if (!object) throw new Error("要删除的场景对象不存在");
        if (object.locked) throw new Error("已锁定对象不能删除");
    }
    const followingCameras = project.cameras.filter((camera) => camera.targetObjectId && identifiers.has(camera.targetObjectId));
    const evaluatedCameras = followingCameras.length ? evaluateDirectorDeskProject(project, timeMilliseconds).cameras : [];
    return {
        ...project,
        objects: project.objects.filter((object) => !identifiers.has(object.id)),
        cameras: project.cameras.map((camera) => {
            if (!camera.targetObjectId || !identifiers.has(camera.targetObjectId)) return camera;
            const target = evaluatedCameras.find((item) => item.id === camera.id)!.target;
            const fixedCamera = { ...camera, target: { ...target }, keyframes: camera.keyframes.map((keyframe) => ({ ...keyframe, value: { ...keyframe.value, target: { ...target } } })) };
            delete fixedCamera.targetObjectId;
            delete fixedCamera.targetOffset;
            return fixedCamera;
        }),
    };
}
