import assert from "node:assert/strict";
import test from "node:test";

import { encodeDirectorDeskFrames, encodeDirectorDeskVideo } from "./director-desk-video-export";
import { createDirectorDeskNode } from "@/features/canvas/constants";
import { evaluateDirectorDeskProject } from "./director-desk-evaluator";
import { createDraggedMotionPath } from "./director-desk-motion-path";
import { setTimelineCharacterAction } from "./director-desk-timeline-segments";

test("浏览器导出严格按30帧提供时间戳，最后一帧结束时间等于视频时长", async () => {
    const renderedTimes: number[] = [];
    const samples: Array<{ timestamp: number; duration: number }> = [];
    const progress: number[] = [];
    await encodeDirectorDeskFrames({
        frameCount: 60, frameRate: 30,
        renderFrame: async (time) => { renderedTimes.push(time); },
        encodeFrame: async (timestamp, duration) => { samples.push({ timestamp, duration }); },
        onProgress: (value) => progress.push(value),
    });
    assert.equal(renderedTimes.length, 60);
    assert.equal(renderedTimes[0], 0);
    assert.equal(renderedTimes[59], Number((59 * 1000 / 30).toFixed(6)));
    assert.equal(samples[59].timestamp + samples[59].duration, 2);
    assert.equal(progress[progress.length - 1], 100);
    assert.ok(progress.every((value, index) => index === 0 || value >= progress[index - 1]));
});

test("等待编码器释放背压后才渲染下一帧，避免画面被下一帧覆盖", async () => {
    const events: string[] = [];
    let releaseFirstFrame!: () => void;
    const firstFrame = new Promise<void>((resolve) => { releaseFirstFrame = resolve; });
    let firstFrameQueued!: () => void;
    const queued = new Promise<void>((resolve) => { firstFrameQueued = resolve; });
    const exporting = encodeDirectorDeskFrames({
        frameCount: 2, frameRate: 30,
        renderFrame: async (time) => { events.push("渲染:" + time); },
        encodeFrame: async (timestamp) => {
            events.push("编码:" + timestamp);
            if (timestamp === 0) { firstFrameQueued(); await firstFrame; }
        },
        onProgress: () => undefined,
    });
    await queued;
    assert.deepEqual(events, ["渲染:0", "编码:0"]);
    releaseFirstFrame();
    await exporting;
    assert.equal(events.length, 4);
    assert.ok(events[2].startsWith("渲染:"));
    assert.ok(events[3].startsWith("编码:"));
});

test("编码或渲染失败后立即停止后续帧，保留原始错误", async () => {
    for (const failingStage of ["render", "encode"]) {
        const failure = new Error("本地编码测试失败");
        let rendered = 0;
        let encoded = 0;
        await assert.rejects(encodeDirectorDeskFrames({
            frameCount: 60, frameRate: 30,
            renderFrame: async () => { rendered += 1; if (failingStage === "render" && rendered === 3) throw failure; },
            encodeFrame: async () => { encoded += 1; if (failingStage === "encode" && encoded === 3) throw failure; },
            onProgress: () => undefined,
        }), (error) => error === failure);
        assert.equal(rendered, 3);
        assert.equal(encoded, failingStage === "render" ? 2 : 3);
    }
});

test("非法帧数或帧率在开始渲染前被拒绝", async () => {
    let rendered = false;
    for (const [frameCount, frameRate] of [[0, 30], [1.5, 30], [60, 24]]) {
        await assert.rejects(encodeDirectorDeskFrames({
            frameCount, frameRate, renderFrame: async () => { rendered = true; },
            encodeFrame: async () => undefined, onProgress: () => undefined,
        }), /30 帧/);
    }
    assert.equal(rendered, false);
});

test("不支持WebCodecs时明确报错，不进行渲染或回退到服务端传帧", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "isSecureContext");
    Object.defineProperty(globalThis, "isSecureContext", { configurable: true, value: false });
    let rendered = false;
    try {
        await assert.rejects(encodeDirectorDeskVideo({
            canvas: {} as HTMLCanvasElement, durationMilliseconds: 2000,
            renderFrame: async () => { rendered = true; }, onProgress: () => undefined,
        }), /当前浏览器不支持本地视频编码/);
        assert.equal(rendered, false);
    } finally {
        if (original) Object.defineProperty(globalThis, "isSecureContext", original);
        else Reflect.deleteProperty(globalThis, "isSecureContext");
    }
});

test("多段轨迹与动作的本地导出逐帧结果和任意时间跳转一致", async () => {
    const project = createDirectorDeskNode({ id: "export-segments", position: { x: 0, y: 0 } }).director.project;
    project.timeline.durationMilliseconds = 10000;
    const character = project.objects.find((object) => object.kind === "character")!;
    character.track!.motionPaths = [
        createDraggedMotionPath("rectangle", { x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 2 }, 5000, true),
        { ...createDraggedMotionPath("line", { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 6 }, 10000, true), startTimeMilliseconds: 5000 },
    ];
    character.track!.actionClips = setTimelineCharacterAction(setTimelineCharacterAction([], "run", 0, 5000, "run"), "walk", 5000, 10000, "walk");
    project.cameras[0].targetObjectId = character.id;
    const restored = JSON.parse(JSON.stringify(project));
    const original = structuredClone(project);
    let renderedFrames = 0;
    await encodeDirectorDeskFrames({
        frameCount: 300, frameRate: 30,
        renderFrame: async (time) => {
            const state = evaluateDirectorDeskProject(project, time);
            assert.deepEqual(state, evaluateDirectorDeskProject(restored, time));
            if (time === 5000) assert.equal(state.objects.find((object) => object.id === character.id)!.transform.position.z, 0);
            renderedFrames += 1;
        },
        encodeFrame: async () => undefined, onProgress: () => undefined,
    });
    assert.equal(renderedFrames, 300);
    assert.deepEqual(project, original);
});
