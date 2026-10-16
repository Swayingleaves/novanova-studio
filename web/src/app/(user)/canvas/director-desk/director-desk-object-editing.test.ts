import assert from "node:assert/strict";
import test from "node:test";
import { createDirectorDeskNode } from "@/features/canvas/constants";
import { evaluateDirectorDeskProject, validateDirectorDeskProject } from "./director-desk-evaluator";
import { createDraggedMotionPath } from "./director-desk-motion-path";
import { removeDirectorDeskObjects } from "./director-desk-object-editing";

/** 创建带独立对象和运动数据的工程，检查按标识删除不会影响当前选中的其他对象。 */
function createObjectProject() {
    const project = createDirectorDeskNode({ id: "delete-test", position: { x: 0, y: 0 } }).director.project;
    const character = project.objects.find((object) => object.kind === "character")!;
    character.track!.motionPaths = [createDraggedMotionPath("line", { x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, 5000, true)];
    character.track!.actionClips = [{ id: "run", preset: "run", startTimeMilliseconds: 0, endTimeMilliseconds: 5000 }];
    project.objects.push({ ...structuredClone(character), id: "other-character", name: "角色 B" });
    return { project, character };
}

test("单对象删除会移除其全部轨道，保留其他对象、机位和素材", () => {
    const { project, character } = createObjectProject();
    const snapshot = structuredClone(project);
    const next = removeDirectorDeskObjects(project, [character.id], 2500);
    assert.equal(next.objects.some((object) => object.id === character.id), false);
    assert.deepEqual(next.objects, project.objects.filter((object) => object.id !== character.id));
    assert.deepEqual(next.cameras, project.cameras);
    assert.deepEqual(next.assets, project.assets);
    assert.deepEqual(project, snapshot);
    assert.deepEqual(validateDirectorDeskProject(next), []);
});

test("删除被跟随的对象后所有相关机位固定当前目标，目标关键帧不会重新改变朝向", () => {
    const { project, character } = createObjectProject();
    const camera = project.cameras[0];
    camera.targetObjectId = character.id;
    camera.targetOffset = { x: 0, y: 1.2, z: 0 };
    camera.keyframes = [
        { id: "camera-start", timeMilliseconds: 0, value: { position: { ...camera.position }, target: { x: 10, y: 0, z: 0 }, fieldOfView: 40 } },
        { id: "camera-end", timeMilliseconds: 5000, value: { position: { ...camera.position, x: 7 }, target: { x: 20, y: 0, z: 0 }, fieldOfView: 60 } },
    ];
    project.cameras.push({ ...structuredClone(camera), id: "second-following" }, { ...structuredClone(camera), id: "other-target", targetObjectId: "other-character" });
    const expected = evaluateDirectorDeskProject(project, 2500);
    const next = removeDirectorDeskObjects(project, [character.id], 2500);
    for (const index of [0, 1]) {
        assert.equal(next.cameras[index].targetObjectId, undefined);
        assert.equal(next.cameras[index].targetOffset, undefined);
        assert.deepEqual(next.cameras[index].target, expected.cameras[index].target);
        assert.deepEqual(next.cameras[index].keyframes.map((keyframe) => keyframe.value.position), project.cameras[index].keyframes.map((keyframe) => keyframe.value.position));
        assert.deepEqual(next.cameras[index].keyframes.map((keyframe) => keyframe.value.fieldOfView), project.cameras[index].keyframes.map((keyframe) => keyframe.value.fieldOfView));
        for (const time of [0, 2500, 5000]) assert.deepEqual(evaluateDirectorDeskProject(next, time).cameras[index].target, expected.cameras[index].target);
    }
    assert.deepEqual(next.cameras[2], project.cameras[2]);
    assert.deepEqual(validateDirectorDeskProject(next), []);
});

test("删除全部可编辑对象时保留地面、机位和素材，保存重开后仍可求值", () => {
    const { project, character } = createObjectProject();
    project.objects.find((object) => object.id === "other-character")!.locked = true;
    project.cameras[0].targetObjectId = character.id;
    const next = removeDirectorDeskObjects(project, project.objects.filter((object) => !object.locked).map((object) => object.id), 2500);
    assert.deepEqual(next.objects, project.objects.filter((object) => object.locked));
    assert.equal(next.cameras.length, project.cameras.length);
    assert.equal(next.selectedCameraId, project.selectedCameraId);
    assert.deepEqual(next.assets, project.assets);
    assert.deepEqual(validateDirectorDeskProject(next), []);
    const restored = JSON.parse(JSON.stringify(next));
    assert.deepEqual(evaluateDirectorDeskProject(restored, 4000), evaluateDirectorDeskProject(next, 4000));
});

test("锁定对象或失效标识拒绝删除，不产生部分删除", () => {
    const { project, character } = createObjectProject();
    const ground = project.objects.find((object) => object.kind === "ground")!;
    const snapshot = structuredClone(project);
    assert.throws(() => removeDirectorDeskObjects(project, [character.id, ground.id], 0), /锁定/);
    assert.throws(() => removeDirectorDeskObjects(project, [character.id, "missing"], 0), /不存在/);
    assert.deepEqual(project, snapshot);
});
