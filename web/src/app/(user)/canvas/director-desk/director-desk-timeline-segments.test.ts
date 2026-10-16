import assert from "node:assert/strict";
import test from "node:test";
import { createDirectorDeskNode } from "@/features/canvas/constants";
import { evaluateDirectorDeskProject, validateDirectorDeskProject } from "./director-desk-evaluator";
import { createDraggedMotionPath } from "./director-desk-motion-path";
import { editDirectorDeskTimelineSegment, resizeTimelineSegment, type DirectorDeskTimelineSegmentReference } from "./director-desk-timeline-segments";

/** 构造包含多个对象、机位、路径和姿势片段的工程，用于检查跨轨道编辑隔离。 */
function createTimelineProject() {
    const project = createDirectorDeskNode({ id: "timeline-edit", position: { x: 0, y: 0 } }).director.project;
    project.timeline.durationMilliseconds = 10000;
    const character = project.objects.find((object) => object.kind === "character")!;
    const first = { ...createDraggedMotionPath("rectangle", { x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 2 }, 5000, true), id: "first" };
    const second = { ...createDraggedMotionPath("line", { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 8 }, 10000, true), id: "second", startTimeMilliseconds: 5000 };
    character.track = {
        position: [], rotation: [], motionPaths: [first, second],
        actionClips: [{ id: "first", preset: "run", startTimeMilliseconds: 0, endTimeMilliseconds: 5000 }, { id: "second", preset: "walk", startTimeMilliseconds: 5000, endTimeMilliseconds: 10000 }],
    };
    project.objects.push({ ...structuredClone(character), id: "other-character" });
    project.cameras[0].motionPaths = [{ ...structuredClone(first), followDirection: false }, { ...structuredClone(second), followDirection: false }];
    project.cameras.push({ ...structuredClone(project.cameras[0]), id: "other-camera" });
    return { project, character };
}

test("片段左右边缘按三十帧吸附，保持未拖动的边缘不变", () => {
    const segments = [{ id: "segment", startTimeMilliseconds: 0, endTimeMilliseconds: 5000 }];
    assert.deepEqual(resizeTimelineSegment(segments, "segment", "end", 2478, 10000), { startTimeMilliseconds: 0, endTimeMilliseconds: 2466.666667 });
    assert.deepEqual(resizeTimelineSegment(segments, "segment", "start", 1249, 10000), { startTimeMilliseconds: 1233.333333, endTimeMilliseconds: 5000 });
    assert.deepEqual(segments[0], { id: "segment", startTimeMilliseconds: 0, endTimeMilliseconds: 5000 });
});

test("拖过另一边缘时至少保留一帧，禁止片段变成零时长", () => {
    const segments = [{ id: "segment", startTimeMilliseconds: 1000, endTimeMilliseconds: 2000 }];
    const end = resizeTimelineSegment(segments, "segment", "end", -10000, 5000);
    const start = resizeTimelineSegment(segments, "segment", "start", 10000, 5000);
    assert.equal(end.endTimeMilliseconds, 1033.333333);
    assert.equal(start.startTimeMilliseconds, 1966.666667);
    assert.equal(end.startTimeMilliseconds, 1000);
    assert.equal(start.endTimeMilliseconds, 2000);
});

test("拖拽被相邻片段和工程边界阻挡，不重叠也不越界", () => {
    const segments = [{ id: "last", startTimeMilliseconds: 7000, endTimeMilliseconds: 10000 }, { id: "first", startTimeMilliseconds: 0, endTimeMilliseconds: 3000 }, { id: "middle", startTimeMilliseconds: 4000, endTimeMilliseconds: 6000 }];
    assert.equal(resizeTimelineSegment(segments, "middle", "start", 0, 10000).startTimeMilliseconds, 3000);
    assert.equal(resizeTimelineSegment(segments, "middle", "end", 15000, 10000).endTimeMilliseconds, 7000);
    assert.equal(resizeTimelineSegment(segments, "first", "start", -5000, 10000).startTimeMilliseconds, 0);
    assert.equal(resizeTimelineSegment(segments, "last", "end", 20000, 10000).endTimeMilliseconds, 10000);
    assert.throws(() => resizeTimelineSegment(segments, "missing", "end", 5000, 10000), /不存在/);
});

test("删除轨迹、姿势或机位片段只影响指定轨道，重复片段标识不会串改", () => {
    const { project, character } = createTimelineProject();
    const snapshot = structuredClone(project);
    const references: DirectorDeskTimelineSegmentReference[] = [
        { ownerId: character.id, segmentId: "first", kind: "objectPath" },
        { ownerId: character.id, segmentId: "first", kind: "action" },
        { ownerId: project.cameras[0].id, segmentId: "first", kind: "cameraPath" },
    ];
    for (const reference of references) {
        const next = editDirectorDeskTimelineSegment(project, reference, null);
        const object = next.objects.find((item) => item.id === character.id)!;
        if (reference.kind === "objectPath") {
            assert.deepEqual(object.track!.motionPaths!.map((segment) => segment.id), ["second"]);
            assert.deepEqual(object.track!.actionClips, character.track!.actionClips);
            assert.deepEqual(next.cameras, project.cameras);
        } else if (reference.kind === "action") {
            assert.deepEqual(object.track!.actionClips!.map((segment) => segment.id), ["second"]);
            assert.deepEqual(object.track!.motionPaths, character.track!.motionPaths);
            assert.deepEqual(next.cameras, project.cameras);
        } else {
            assert.deepEqual(next.cameras[0].motionPaths!.map((segment) => segment.id), ["second"]);
            assert.deepEqual(next.objects, project.objects);
        }
        assert.deepEqual(next.objects.find((item) => item.id === "other-character"), project.objects.find((item) => item.id === "other-character"));
        assert.deepEqual(next.cameras[1], project.cameras[1]);
        assert.deepEqual(validateDirectorDeskProject(next), []);
    }
    assert.deepEqual(project, snapshot);
});

test("缩短路径和姿势后立即参与统一求值，保存重开仍得到相同结果", () => {
    const { project, character } = createTimelineProject();
    const interval = resizeTimelineSegment(character.track!.motionPaths!, "second", "end", 7500, 10000);
    let next = editDirectorDeskTimelineSegment(project, { ownerId: character.id, segmentId: "second", kind: "objectPath" }, interval);
    next = editDirectorDeskTimelineSegment(next, { ownerId: character.id, segmentId: "second", kind: "action" }, interval);
    assert.deepEqual(validateDirectorDeskProject(next), []);
    const edited = next.objects.find((object) => object.id === character.id)!;
    assert.deepEqual(edited.track!.motionPaths![0], character.track!.motionPaths![0]);
    assert.deepEqual(edited.track!.actionClips![0], character.track!.actionClips![0]);
    const halfway = evaluateDirectorDeskProject(next, 6250).objects.find((object) => object.id === character.id)!;
    assert.ok(Math.abs(halfway.transform.position.z - 4) < 0.06);
    const finished = evaluateDirectorDeskProject(next, 7500).objects.find((object) => object.id === character.id)!;
    const held = evaluateDirectorDeskProject(next, 9000).objects.find((object) => object.id === character.id)!;
    assert.equal(finished.transform.position.z, 8);
    assert.deepEqual(held.transform, finished.transform);
    assert.deepEqual(held.pose, finished.pose);
    const restored = JSON.parse(JSON.stringify(next));
    for (const time of [0, 2500, 5000, 6250, 7500, 9000]) assert.deepEqual(evaluateDirectorDeskProject(restored, time), evaluateDirectorDeskProject(next, time));
});

test("机位片段可独立缩短，路径形状和其他机位保持原值", () => {
    const { project } = createTimelineProject();
    const camera = project.cameras[0];
    const interval = resizeTimelineSegment(camera.motionPaths!, "second", "start", 6000, 10000);
    const next = editDirectorDeskTimelineSegment(project, { ownerId: camera.id, segmentId: "second", kind: "cameraPath" }, interval);
    assert.equal(next.cameras[0].motionPaths![1].startTimeMilliseconds, 6000);
    assert.deepEqual(next.cameras[0].motionPaths![1].anchors, camera.motionPaths![1].anchors);
    assert.deepEqual(next.cameras[0].motionPaths![0], camera.motionPaths![0]);
    assert.deepEqual(next.cameras[1], project.cameras[1]);
    assert.deepEqual(next.objects, project.objects);
    assert.deepEqual(validateDirectorDeskProject(next), []);
});

test("无效对象、无效片段和锁定对象均拒绝编辑，保留工程原值", () => {
    const { project, character } = createTimelineProject();
    character.locked = true;
    const snapshot = structuredClone(project);
    for (const kind of ["objectPath", "action"] as const) assert.throws(() => editDirectorDeskTimelineSegment(project, { ownerId: character.id, segmentId: "first", kind }, null), /锁定/);
    assert.throws(() => editDirectorDeskTimelineSegment(project, { ownerId: "missing", segmentId: "first", kind: "objectPath" }, null), /对象不存在/);
    assert.throws(() => editDirectorDeskTimelineSegment(project, { ownerId: "missing", segmentId: "first", kind: "cameraPath" }, null), /机位不存在/);
    assert.throws(() => editDirectorDeskTimelineSegment(project, { ownerId: project.cameras[0].id, segmentId: "missing", kind: "cameraPath" }, null), /片段不存在/);
    assert.deepEqual(project, snapshot);
});
