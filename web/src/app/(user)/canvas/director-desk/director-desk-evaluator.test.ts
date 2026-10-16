import assert from "node:assert/strict";
import test from "node:test";

import { createDirectorDeskNode } from "../../../../features/canvas/constants";
import { evaluateDirectorDeskProject, validateDirectorDeskProject } from "./director-desk-evaluator";

test("导演台按绝对时间求值，不依赖此前播放帧数", () => {
    const node = createDirectorDeskNode({ id: "director-1", position: { x: 0, y: 0 } });
    const project = {
        ...node.director.project,
        objects: node.director.project.objects.map((object) =>
            object.id === "character-main"
                ? {
                      ...object,
                      track: {
                          position: [
                              { id: "position-0", timeMilliseconds: 0, value: { x: 0, y: 0, z: 0 } },
                              { id: "position-1", timeMilliseconds: 1000, value: { x: 2, y: 0, z: 0 } },
                          ],
                          rotation: [],
                      },
                  }
                : object,
        ),
    };

    const jumped = evaluateDirectorDeskProject(project, 500);
    const replayed = evaluateDirectorDeskProject(project, 500);
    const jumpedCharacter = jumped.objects.find((object) => object.id === "character-main");
    const replayedCharacter = replayed.objects.find((object) => object.id === "character-main");

    assert.deepEqual(jumpedCharacter?.transform.position, { x: 1, y: 0, z: 0 });
    assert.deepEqual(jumpedCharacter?.transform.position, replayedCharacter?.transform.position);
});

test("导演台拒绝重复时间关键帧和失效机位", () => {
    const node = createDirectorDeskNode({ id: "director-1", position: { x: 0, y: 0 } });
    const project = {
        ...node.director.project,
        selectedCameraId: "missing-camera",
        cameras: node.director.project.cameras.map((camera) => ({
            ...camera,
            keyframes: [
                { id: "camera-0", timeMilliseconds: 0, value: { position: camera.position, target: camera.target, fieldOfView: camera.fieldOfView } },
                { id: "camera-1", timeMilliseconds: 0, value: { position: camera.position, target: camera.target, fieldOfView: camera.fieldOfView } },
            ],
        })),
    };

    const errors = validateDirectorDeskProject(project);
    assert.ok(errors.includes("导演台选中的机位不存在"));
    assert.ok(errors.includes("机位“主机位”存在重复时间关键帧"));
});

test("导演台拒绝不支持的帧率和非法变换", () => {
    const node = createDirectorDeskNode({ id: "director-1", position: { x: 0, y: 0 } });
    const project = {
        ...node.director.project,
        timeline: { ...node.director.project.timeline, frameRate: 24 as 30 },
        objects: node.director.project.objects.map((object) => (object.id === "character-main" ? { ...object, transform: { ...object.transform, scale: { x: Number.NaN, y: 1, z: 1 } } } : object)),
    };

    const errors = validateDirectorDeskProject(project);

    assert.ok(errors.includes("导演台时间轴帧率必须固定为 30 帧/秒"));
    assert.ok(errors.includes("导演台对象变换缩放必须包含有效的三维数值"));
});

test("导演台按帧边界求值机位关键帧并插值", () => {
    const node = createDirectorDeskNode({ id: "director-1", position: { x: 0, y: 0 } });
    const camera = node.director.project.cameras[0];
    if (!camera) throw new Error("默认导演台应包含主机位");
    const project = {
        ...node.director.project,
        cameras: [
            {
                ...camera,
                keyframes: [
                    { id: "camera-0", timeMilliseconds: 0, value: { position: camera.position, target: camera.target, fieldOfView: 42 } },
                    { id: "camera-1", timeMilliseconds: 1000, value: { position: { ...camera.position, x: 8 }, target: camera.target, fieldOfView: 60 } },
                ],
            },
        ],
    };

    const evaluated = evaluateDirectorDeskProject(project, 500);
    assert.equal(evaluated.timeMilliseconds, 500);
    assert.equal(evaluated.camera.position.x, 6);
    assert.equal(evaluated.camera.fieldOfView, 51);
    assert.deepEqual(
        validateDirectorDeskProject({ ...project, cameras: [{ ...project.cameras[0], keyframes: [{ ...project.cameras[0].keyframes[0], timeMilliseconds: 34 }] }] }).filter((error) => error.includes("固定帧边界")),
        ["机位“主机位”关键帧时间必须落在固定帧边界"],
    );
});

test("导演台按绝对时间求值人物动作预设", () => {
    const node = createDirectorDeskNode({ id: "director-1", position: { x: 0, y: 0 } });
    const project = {
        ...node.director.project,
        objects: node.director.project.objects.map((object) =>
            object.kind === "character"
                ? {
                      ...object,
                      track: { position: object.track?.position || [], rotation: object.track?.rotation || [], actionClips: [{ id: "walk", preset: "walk" as const, startTimeMilliseconds: 0, endTimeMilliseconds: 5000 }] },
                  }
                : object,
        ),
    };
    const first = evaluateDirectorDeskProject(project, 250);
    const second = evaluateDirectorDeskProject(project, 250);
    const pose = first.objects.find((object) => object.kind === "character")?.pose;
    assert.ok(pose);
    assert.deepEqual(pose, second.objects.find((object) => object.kind === "character")?.pose);
    assert.notEqual(pose?.joints.leftHip.x, 0);
    // 动作按固定步周期循环：相隔一个完整步周期（900 毫秒）的时间点姿态一致
    assert.deepEqual(evaluateDirectorDeskProject(project, 1200).objects.find((object) => object.kind === "character")?.pose, evaluateDirectorDeskProject(project, 300).objects.find((object) => object.kind === "character")?.pose);
});

test("导演台拒绝缺失的GLB资产引用", () => {
    const node = createDirectorDeskNode({ id: "director-1", position: { x: 0, y: 0 } });
    const project = {
        ...node.director.project,
        objects: [...node.director.project.objects, { ...node.director.project.objects[0], id: "glb-1", name: "缺失道具", kind: "glb" as const, assetId: "missing" }],
    };
    assert.ok(validateDirectorDeskProject(project).includes("导演台对象“缺失道具”缺少 GLB 资源"));
});
