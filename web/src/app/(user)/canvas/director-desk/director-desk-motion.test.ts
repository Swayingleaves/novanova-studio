import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { createDirectorDeskNode } from "@/features/canvas/constants";
import type { CanvasDirectorDeskMotionPath } from "@/features/canvas/types";
import { createDraggedMotionPath, evaluateMotionPath, findMotionPathAtTime, moveMotionPathAnchor, simplifyPencilPoints, translateMotionPath, upsertMotionPath } from "./director-desk-motion-path";
import { findActiveTimelineSegment, getEmptyTimelineInterval, setTimelineCharacterAction } from "./director-desk-timeline-segments";
import { CHARACTER_ACTIONS, createNeutralPose, DIRECTOR_DESK_JOINTS, evaluateCharacterAction } from "./director-desk-pose";
import { evaluateDirectorDeskProject, validateDirectorDeskProject } from "./director-desk-evaluator";

/** 创建相互独立的默认工程。 */
function project() { return createDirectorDeskNode({ id: "director-test", position: { x: 0, y: 0 } }).director.project; }

/** 比较采样得到的浮点坐标。 */
function close(actual: number, expected: number, tolerance = 0.015) { assert.ok(Math.abs(actual - expected) < tolerance, `${actual} 与 ${expected} 不接近`); }

test("不等长路径按路程匀速，不按锚点序号分配时间", () => {
    const path: CanvasDirectorDeskMotionPath = { id: "uneven", kind: "line", closed: false, anchors: [0, 1, 4].map((x) => ({ position: { x, y: 2, z: 0 } })), startTimeMilliseconds: 1000, endTimeMilliseconds: 5000, followDirection: true };
    close(evaluateMotionPath(path, 3000).position.x, 2);
    close(evaluateMotionPath(path, 0).position.x, 0);
    close(evaluateMotionPath(path, 6000).position.x, 4);
    assert.equal(evaluateMotionPath(path, 3000).position.y, 2);
});

test("圆形与矩形保持闭合，圆形起终点方向连续", () => {
    const circle = createDraggedMotionPath("circle", { x: 0, y: 1, z: 0 }, { x: 2, y: 1, z: 0 }, 4000, true);
    const start = evaluateMotionPath(circle, 0);
    const end = evaluateMotionPath(circle, 4000);
    close(start.position.x, end.position.x);
    close(start.position.z, end.position.z);
    assert.deepEqual(start.direction, end.direction);
    close(evaluateMotionPath(circle, 1000).position.z, 2);
    const rectangle = createDraggedMotionPath("rectangle", { x: 0, y: 3, z: 0 }, { x: 4, y: 3, z: 2 }, 4000, false);
    close(evaluateMotionPath(rectangle, 1000).position.x, 3);
    close(evaluateMotionPath(rectangle, 2000).position.z, 2);
});

test("钢笔切线改变曲线形状，整体平移和锚点移动保持切线相对位置", () => {
    const path: CanvasDirectorDeskMotionPath = { id: "pen", kind: "pen", closed: false, anchors: [{ position: { x: 0, y: 0, z: 0 }, outgoing: { x: 0, y: 0, z: 2 } }, { position: { x: 2, y: 0, z: 0 }, incoming: { x: 2, y: 0, z: 2 } }], startTimeMilliseconds: 0, endTimeMilliseconds: 4000, followDirection: false };
    assert.ok(evaluateMotionPath(path, 2000).position.z > 1);
    const shifted = translateMotionPath(path, { x: 3, y: 2, z: 1 });
    close(evaluateMotionPath(shifted, 2000).position.x, evaluateMotionPath(path, 2000).position.x + 3);
    const moved = moveMotionPathAnchor(path, 0, "position", { x: 1, y: 1, z: 1 });
    assert.deepEqual(moved.anchors[0].outgoing, { x: 1, y: 1, z: 3 });
    assert.deepEqual(path.anchors[0].position, { x: 0, y: 0, z: 0 });
});

test("铅笔密集采样被简化，仍保留曲线形状及起终点", () => {
    const points = Array.from({ length: 2000 }, (_, index) => ({ x: index / 100, y: 0, z: Math.sin(index / 100) }));
    const anchors = simplifyPencilPoints(points);
    assert.ok(anchors.length <= 128);
    assert.ok(anchors.length > 20);
    close(anchors[0].position.x, points[0].x);
    close(anchors[anchors.length - 1].position.x, points[points.length - 1].x);
});

test("对象沿路径转身，摄像机使用求值后的对象位置跟随", () => {
    const value = project();
    const character = value.objects.find((object) => object.kind === "character")!;
    character.track!.motionPaths = [createDraggedMotionPath("line", { x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, 5000, true)];
    value.cameras[0].motionPaths = [createDraggedMotionPath("line", { x: 0, y: 3, z: 6 }, { x: 4, y: 3, z: 6 }, 5000, false)];
    value.cameras[0].targetObjectId = character.id;
    value.cameras[0].targetOffset = { x: 0, y: 1.2, z: 0 };
    const state = evaluateDirectorDeskProject(value, 2500);
    close(state.objects.find((object) => object.id === character.id)!.transform.rotation.y, Math.PI / 2);
    assert.deepEqual(state.camera.target, { x: 2, y: 1.2, z: 0 });
    assert.deepEqual(state.camera.position, { x: 2, y: 3, z: 6 });
});

test("固定镜头目标不随摄像机路径平移", () => {
    const value = project();
    const target = { ...value.cameras[0].target };
    value.cameras[0].motionPaths = [createDraggedMotionPath("line", { x: 0, y: 3, z: 6 }, { x: 4, y: 3, z: 6 }, 5000, false)];
    assert.deepEqual(evaluateDirectorDeskProject(value, 2500).camera.target, target);
});

test("工程序列化恢复后在相同时间得到相同姿势与机位", () => {
    const value = project();
    const character = value.objects.find((object) => object.kind === "character")!;
    character.track!.motionPaths = [createDraggedMotionPath("circle", { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, 5000, true)];
    character.track!.actionClips = [{ id: "run", preset: "run", startTimeMilliseconds: 0, endTimeMilliseconds: 5000, speed: 1.5 }];
    character.pose = createNeutralPose();
    character.pose.joints.head.y = 0.2;
    value.cameras[0].targetObjectId = character.id;
    const restored = JSON.parse(JSON.stringify(value));
    for (const time of [0, 1000, 2300, 5000]) assert.deepEqual(evaluateDirectorDeskProject(value, time), evaluateDirectorDeskProject(restored, time));
});

test("摄像机路径与位置关键帧冲突及非法工程时长被明确拒绝", () => {
    const value = project();
    const camera = value.cameras[0];
    camera.motionPaths = [createDraggedMotionPath("line", camera.position, { ...camera.position, x: 10 }, 5000, false)];
    camera.keyframes = [{ id: "position-conflict", timeMilliseconds: 0, value: { position: { ...camera.position, x: 9 }, target: camera.target, fieldOfView: camera.fieldOfView } }];
    assert.ok(validateDirectorDeskProject(value).includes("摄像机路径不能与位置关键帧同时变化"));
    assert.ok(validateDirectorDeskProject({ ...value, timeline: { ...value.timeline, durationMilliseconds: 2500 } }).includes("导演台时长必须是 2 到 15 秒的整数秒"));
});

test("姿势关键帧在预设动作上叠加，求值不修改工程", () => {
    const value = project();
    const character = value.objects.find((object) => object.kind === "character")!;
    const first = createNeutralPose();
    const second = createNeutralPose();
    second.joints.head.y = 1;
    character.track!.pose = [{ id: "pose-first", timeMilliseconds: 0, value: first }, { id: "pose-second", timeMilliseconds: 1000, value: second }];
    character.track!.actionClips = [{ id: "walk", preset: "walk", startTimeMilliseconds: 0, endTimeMilliseconds: 5000 }];
    const snapshot = structuredClone(value);
    const state = evaluateDirectorDeskProject(value, 500);
    close(state.objects.find((object) => object.id === character.id)!.pose!.joints.head.y, 0.5);
    assert.deepEqual(value, snapshot);
    assert.deepEqual(state, evaluateDirectorDeskProject(value, 500));
});

test("全部二十项预设包含完整关节，单次动作保持结束姿态", () => {
    assert.equal(Object.keys(CHARACTER_ACTIONS).length, 20);
    for (const preset of Object.keys(CHARACTER_ACTIONS) as Array<keyof typeof CHARACTER_ACTIONS>) {
        const definition = CHARACTER_ACTIONS[preset];
        const pose = evaluateCharacterAction(preset, definition.durationMilliseconds / 2);
        for (const joint of DIRECTOR_DESK_JOINTS) for (const angle of Object.values(pose.joints[joint])) assert.ok(Number.isFinite(angle));
        assert.deepEqual(pose, evaluateCharacterAction(preset, definition.durationMilliseconds / 2));
        if (!definition.loop) assert.deepEqual(evaluateCharacterAction(preset, definition.durationMilliseconds), evaluateCharacterAction(preset, definition.durationMilliseconds * 10));
    }
    assert.notDeepEqual(evaluateCharacterAction("sit", 0), evaluateCharacterAction("sit", 1100));
    assert.notDeepEqual(evaluateCharacterAction("throw", 200), evaluateCharacterAction("throw", 800));
});

test("多个角色的偏移对象独立，行走预设不自动产生空间位移", () => {
    const first = createNeutralPose(); const second = createNeutralPose();
    first.joints.leftElbow.x = 1;
    assert.equal(second.joints.leftElbow.x, 0);
    const value = project();
    const character = value.objects.find((object) => object.kind === "character")!;
    character.track!.actionClips = [{ id: "walk", preset: "walk", startTimeMilliseconds: 0, endTimeMilliseconds: 5000 }];
    assert.deepEqual(evaluateDirectorDeskProject(value, 2500).objects.find((object) => object.id === character.id)!.transform.position, character.transform.position);
});

test("拒绝零长度路径、位置轨道冲突、越界片段和失效跟随对象", () => {
    const value = project();
    const character = value.objects.find((object) => object.kind === "character")!;
    character.track!.motionPaths = [createDraggedMotionPath("line", { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 5000, false)];
    character.track!.position = [{ id: "conflict", timeMilliseconds: 0, value: { x: 0, y: 0, z: 0 } }];
    character.track!.actionClips = [{ id: "first", preset: "walk", startTimeMilliseconds: 0, endTimeMilliseconds: 4000 }, { id: "second", preset: "run", startTimeMilliseconds: 3000, endTimeMilliseconds: 6000 }];
    value.cameras[0].targetObjectId = "missing";
    const errors = validateDirectorDeskProject(value);
    assert.ok(errors.includes("运动路径长度必须大于零"));
    assert.ok(errors.includes("运动路径不能与位置关键帧同时存在"));
    assert.ok(errors.includes("摄像机跟随的对象不存在"));
    assert.ok(errors.some((error) => error.includes("动作片段不能重叠")));
    assert.ok(errors.some((error) => error.includes("动作片段超出时间轴范围")));
});

test("随包人体骨骼与本地缓冲引用完整，不依赖外部贴图", () => {
    const directory = new URL("../../../../../public/models/director-desk/", import.meta.url);
    const model = JSON.parse(readFileSync(new URL("character.gltf", directory), "utf8"));
    const names = new Set(model.nodes.map((node: { name: string }) => node.name));
    for (const bone of ["pelvis", "spine_01", "neck_01", "Head", "upperarm_l", "upperarm_r", "lowerarm_l", "lowerarm_r", "hand_l", "hand_r", "thigh_l", "thigh_r", "calf_l", "calf_r", "foot_l", "foot_r"]) assert.ok(names.has(bone), bone);
    for (const buffer of model.buffers) assert.equal(readFileSync(new URL(buffer.uri, directory)).byteLength, buffer.byteLength);
    assert.equal(model.images, undefined);
    assert.ok(readFileSync(new URL("License_Standard.txt", directory), "utf8").includes("CC0 1.0"));
});

test("追加五秒直线行走后，前五秒矩形跑步的每帧位置与动作均保留", () => {
    const value = project();
    const character = value.objects.find((object) => object.kind === "character")!;
    character.pose = createNeutralPose();
    const rectangle = createDraggedMotionPath("rectangle", { x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 2 }, 5000, true);
    character.track!.motionPaths = [rectangle];
    character.track!.actionClips = setTimelineCharacterAction([], "run", 0, 5000, "run-first");
    const firstFrames = Array.from({ length: 150 }, (_, frame) => evaluateDirectorDeskProject(value, frame * 1000 / 30).objects.find((object) => object.id === character.id)!);
    value.timeline.durationMilliseconds = 10000;
    const interval = getEmptyTimelineInterval(character.track!.motionPaths, 5000, 10000)!;
    assert.deepEqual(interval, { startTimeMilliseconds: 5000, endTimeMilliseconds: 10000 });
    const line = { ...createDraggedMotionPath("line", { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 8 }, 10000, true), ...interval };
    character.track!.motionPaths = upsertMotionPath(character.track!.motionPaths, line);
    character.track!.actionClips = setTimelineCharacterAction(character.track!.actionClips!, "walk", 5000, 10000, "walk-second");
    assert.deepEqual(character.track!.motionPaths[0], rectangle);
    assert.equal(character.track!.actionClips![0].preset, "run");
    assert.equal(character.track!.actionClips![0].endTimeMilliseconds, 5000);
    assert.deepEqual(validateDirectorDeskProject(value), []);
    firstFrames.forEach((original, frame) => {
        const current = evaluateDirectorDeskProject(value, frame * 1000 / 30).objects.find((object) => object.id === character.id)!;
        assert.deepEqual(current.transform, original.transform);
        assert.deepEqual(current.pose, original.pose);
    });
    for (const time of [5000, 6500, 7500, 10000]) {
        const current = evaluateDirectorDeskProject(value, time).objects.find((object) => object.id === character.id)!;
        close(current.transform.position.z, (time - 5000) * 8 / 5000);
        close(current.transform.rotation.y, 0);
        const expectedPose = evaluateCharacterAction("walk", time - 5000);
        for (const joint of DIRECTOR_DESK_JOINTS) for (const axis of ["x", "y", "z"] as const) close(current.pose!.joints[joint][axis], expectedPose.joints[joint][axis], 1e-9);
        assert.deepEqual(current.pose!.rootOffset, expectedPose.rootOffset);
    }
    const restored = JSON.parse(JSON.stringify(value));
    for (const time of [0, 2600, 5000, 8500, 10000]) assert.deepEqual(evaluateDirectorDeskProject(restored, time), evaluateDirectorDeskProject(value, time));
});

test("共用边界切到后一片段，空档保持前一终点，首段开始前保持起点", () => {
    const first = { ...createDraggedMotionPath("line", { x: 1, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, 3000, true), startTimeMilliseconds: 1000 };
    const second = { ...createDraggedMotionPath("line", { x: 3, y: 0, z: 0 }, { x: 3, y: 0, z: 4 }, 8000, true), startTimeMilliseconds: 5000 };
    const paths = [second, first];
    assert.equal(findMotionPathAtTime(paths, 0), first);
    assert.equal(findMotionPathAtTime(paths, 4000), first);
    assert.deepEqual(evaluateMotionPath(findMotionPathAtTime(paths, 4000)!, 4000).position, first.anchors[1].position);
    assert.equal(findActiveTimelineSegment(paths, 4000, 10000), undefined);
    assert.equal(findActiveTimelineSegment(paths, 5000, 10000), second);
    assert.equal(findMotionPathAtTime(paths, 5000), second);
    const adjacent = { ...second, startTimeMilliseconds: 3000 };
    assert.equal(findActiveTimelineSegment([first, adjacent], 3000, 8000), adjacent);
    assert.equal(findActiveTimelineSegment([first, adjacent], 8000, 8000), adjacent);
    assert.equal(findMotionPathAtTime([], 0), undefined);
});

test("在空档新增轨迹只占用到下一段之前，已有片段和工程末端不允许新增", () => {
    const interval = { startTimeMilliseconds: 2000, endTimeMilliseconds: 5000 };
    assert.deepEqual(getEmptyTimelineInterval([interval], 0, 10000), { startTimeMilliseconds: 0, endTimeMilliseconds: 2000 });
    assert.deepEqual(getEmptyTimelineInterval([interval], 5000, 10000), { startTimeMilliseconds: 5000, endTimeMilliseconds: 10000 });
    assert.equal(getEmptyTimelineInterval([interval], 2000, 10000), undefined);
    assert.equal(getEmptyTimelineInterval([interval], 3000, 10000), undefined);
    assert.equal(getEmptyTimelineInterval([interval], 10000, 10000), undefined);
});

test("重绘、移动锚点与删除仅影响选中轨迹片段", () => {
    const first = createDraggedMotionPath("rectangle", { x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 2 }, 5000, true);
    const second = { ...createDraggedMotionPath("line", { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 8 }, 10000, true), startTimeMilliseconds: 5000 };
    const original = structuredClone([first, second]);
    const edited = upsertMotionPath([first, second], moveMotionPathAnchor(second, 1, "position", { x: 2, y: 0, z: 8 }));
    assert.deepEqual(edited[0], original[0]);
    const replacement = { ...createDraggedMotionPath("circle", { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, 10000, true), id: second.id, startTimeMilliseconds: 5000 };
    const redrawn = upsertMotionPath(edited, replacement);
    assert.equal(redrawn.length, 2);
    assert.deepEqual(redrawn[0], original[0]);
    assert.equal(redrawn[1].kind, "circle");
    assert.deepEqual(redrawn.filter((path) => path.id !== second.id), [original[0]]);
    assert.deepEqual([first, second], original);
});

test("拒绝轨迹片段重叠、重复标识和时长裁切，相邻片段合法", () => {
    const value = project();
    value.timeline.durationMilliseconds = 10000;
    const character = value.objects.find((object) => object.kind === "character")!;
    const first = createDraggedMotionPath("line", { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 5000, true);
    const second = { ...createDraggedMotionPath("line", { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, 10000, true), startTimeMilliseconds: 5000 };
    character.track!.motionPaths = [first, second];
    assert.deepEqual(validateDirectorDeskProject(value), []);
    character.track!.motionPaths = [first, { ...second, startTimeMilliseconds: 4000 }];
    assert.ok(validateDirectorDeskProject(value).includes("运动路径片段不能重叠"));
    character.track!.motionPaths = [first, { ...second, id: first.id }];
    assert.ok(validateDirectorDeskProject(value).includes("运动路径片段标识必须唯一"));
    character.track!.motionPaths = [first, second];
    value.timeline.durationMilliseconds = 5000;
    assert.ok(validateDirectorDeskProject(value).includes("运动路径时间范围无效"));
});

test("动作边界选择后段预设，在片段内调整只修改当前动作", () => {
    const first = setTimelineCharacterAction([], "run", 0, 5000, "first");
    const appended = setTimelineCharacterAction(first, "walk", 5000, 10000, "second");
    const changed = setTimelineCharacterAction(appended, "wave", 7500, 10000, "unused");
    assert.deepEqual(changed[0], first[0]);
    assert.equal(changed[1].preset, "wave");
    assert.equal(changed[1].startTimeMilliseconds, 5000);
    assert.equal(changed[1].endTimeMilliseconds, 10000);
    assert.equal(setTimelineCharacterAction(appended, "idle", 10000, 10000, "unused")[1].preset, "idle");
    assert.throws(() => setTimelineCharacterAction(first, "walk", 10000, 10000, "outside"), /空白区间/);
    const inserted = setTimelineCharacterAction([{ ...first[0], startTimeMilliseconds: 2000 }], "idle", 0, 10000, "before");
    assert.equal(inserted[0].endTimeMilliseconds, 2000);
    assert.equal(inserted[1].preset, "run");
});

test("机位多段轨迹在边界正确切换，仍跟随角色求值后的世界位置", () => {
    const value = project();
    value.timeline.durationMilliseconds = 10000;
    const character = value.objects.find((object) => object.kind === "character")!;
    character.track!.motionPaths = [createDraggedMotionPath("line", { x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }, 10000, true)];
    const camera = value.cameras[0];
    const first = createDraggedMotionPath("line", { x: 0, y: 3, z: 6 }, { x: 4, y: 3, z: 6 }, 5000, false);
    const second = { ...createDraggedMotionPath("line", { x: 4, y: 3, z: 6 }, { x: 4, y: 3, z: 2 }, 10000, false), startTimeMilliseconds: 5000 };
    camera.motionPaths = [first, second];
    camera.targetObjectId = character.id;
    camera.targetOffset = { x: 0, y: 1, z: 0 };
    for (const [time, position, target] of [[2500, { x: 2, y: 3, z: 6 }, { x: 2, y: 1, z: 0 }], [5000, { x: 4, y: 3, z: 6 }, { x: 4, y: 1, z: 0 }], [7500, { x: 4, y: 3, z: 4 }, { x: 6, y: 1, z: 0 }]] as const) {
        const state = evaluateDirectorDeskProject(value, time);
        assert.deepEqual(state.camera.position, position);
        assert.deepEqual(state.camera.target, target);
    }
    camera.motionPaths = [first, { ...second, startTimeMilliseconds: 4000 }];
    assert.ok(validateDirectorDeskProject(value).includes("运动路径片段不能重叠"));
});
