import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";

import { createAudioNode, createImageNode, createVideoNode } from "../constants";
import type { CanvasNode } from "../types";
import { fitNodeSize } from "../utils/canvas-node-size";
import { layoutUploadedCanvasNodes, uploadCanvasFiles } from "./canvas-media-upload";

test("批量上传最多并发三个，乱序完成和单项失败不影响结果顺序", async () => {
    const files = Array.from({ length: 6 }, (_, index) => new File(["素材"], `素材${index}.png`, { type: "image/png" }));
    const pending = files.map(() => Promise.withResolvers<string>());
    const started: string[] = [];
    const progress: number[] = [];
    let active = 0;
    let maximumActive = 0;
    const batch = uploadCanvasFiles(files, async (file) => {
        const index = files.indexOf(file);
        started.push(file.name);
        maximumActive = Math.max(maximumActive, ++active);
        try { return await pending[index].promise; }
        finally { active--; }
    }, new AbortController().signal, (completed) => progress.push(completed));

    assert.deepEqual(started, files.slice(0, 3).map((file) => file.name));
    pending[2].resolve("图片2");
    await setImmediate();
    assert.equal(started.length, 4);
    pending[1].reject(new Error("图片内容无效"));
    await setImmediate();
    assert.equal(started.length, 5);
    pending[4].resolve("图片4");
    await setImmediate();
    assert.equal(started.length, 6);
    pending[5].resolve("图片5");
    pending[3].resolve("图片3");
    pending[0].resolve("图片0");

    const results = await batch;
    assert.equal(maximumActive, 3);
    assert.deepEqual(results.map((result) => result.status === "fulfilled" ? result.value : result.reason.message), ["图片0", "图片内容无效", "图片2", "图片3", "图片4", "图片5"]);
    assert.deepEqual(progress, [1, 2, 3, 4, 5, 6]);
});

test("全部上传失败仍处理整批文件，且不会自动重试", async () => {
    const files = [new File(["文档"], "不支持.txt"), new File(["图片"], "损坏.png")];
    const attempts: File[] = [];
    const progress: number[] = [];
    const results = await uploadCanvasFiles(files, async (file) => {
        attempts.push(file);
        throw new Error(file.name);
    }, new AbortController().signal, (completed) => progress.push(completed));

    assert.deepEqual(attempts, files);
    assert.ok(results.every((result) => result.status === "rejected"));
    assert.deepEqual(progress, [1, 2]);
});

test("切换画布取消批次后不再启动等待项，也不再更新进度或返回旧结果", async () => {
    const controller = new AbortController();
    const files = Array.from({ length: 5 }, (_, index) => new File(["视频"], `${index}.mp4`));
    const pending = files.map(() => Promise.withResolvers<string>());
    const started: File[] = [];
    const progress: number[] = [];
    const batch = uploadCanvasFiles(files, (file) => {
        started.push(file);
        return pending[files.indexOf(file)].promise;
    }, controller.signal, (completed) => {
        progress.push(completed);
        controller.abort();
    });
    pending[0].resolve("已完成");
    await setImmediate();
    pending[1].resolve("旧画布视频");
    pending[2].reject(new Error("旧画布失败"));

    assert.deepEqual(await batch, []);
    assert.equal(started.length, 3);
    assert.deepEqual(progress, [1]);
});

test("取消的批次和空选择均不启动上传", async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    const upload = async () => { called = true; };
    assert.deepEqual(await uploadCanvasFiles([new File(["图片"], "图片.png")], upload, controller.signal, () => { called = true; }), []);
    assert.deepEqual(await uploadCanvasFiles([], upload, new AbortController().signal, () => { called = true; }), []);
    assert.equal(called, false);
});

/** 构造不同比例的媒体节点，沿用图片和视频的尺寸上限。 */
function mediaNodes(): CanvasNode[] {
    const dimensions = [[1920, 1080], [800, 1600], [300, 300], [1080, 1920], [960, 540]];
    return dimensions.map(([width, height], index) => {
        const node = index % 2 ? createVideoNode({ id: `视频${index}`, position: { x: 0, y: 0 } }) : createImageNode({ id: `图片${index}`, position: { x: 0, y: 0 } });
        return { ...node, frame: { ...node.frame, ...fitNodeSize(width, height, index % 2 ? 630 : 640, index % 2 ? 630 : 640), naturalWidth: width, naturalHeight: height } };
    });
}

/** 断言节点之间至少保留原有画布间距。 */
function assertSeparated(first: CanvasNode, second: CanvasNode) {
    const left = first.frame;
    const right = second.frame;
    assert.ok(left.position.x + left.width + 54 <= right.position.x
        || right.position.x + right.width + 54 <= left.position.x
        || left.position.y + left.height + 54 <= right.position.y
        || right.position.y + right.height + 54 <= left.position.y);
}

test("媒体按原序排为三列，保留尺寸比例且相互不重叠", () => {
    const nodes = [...mediaNodes(), createAudioNode({ id: "音频", position: { x: 0, y: 0 } })];
    const placed = layoutUploadedCanvasNodes(nodes, [], { x: 800, y: 600 });

    assert.deepEqual(placed.map((node) => node.id), nodes.map((node) => node.id));
    placed.forEach((node, index) => {
        assert.equal(node.frame.width, nodes[index].frame.width);
        assert.equal(node.frame.height, nodes[index].frame.height);
        assert.equal(node.frame.naturalWidth, nodes[index].frame.naturalWidth);
        assert.equal(node.frame.naturalHeight, nodes[index].frame.naturalHeight);
        assert.equal(node.frame.position.x, placed[index % 3].frame.position.x);
        assert.equal(node.frame.position.y, placed[Math.floor(index / 3) * 3].frame.position.y);
        placed.slice(index + 1).forEach((other) => assertSeparated(node, other));
    });
    assert.ok(placed[0].frame.position.x < placed[1].frame.position.x);
    assert.ok(placed[1].frame.position.x < placed[2].frame.position.x);
    assert.ok(placed[0].frame.position.y < placed[3].frame.position.y);
    assert.ok(nodes.every((node) => node.frame.position.x === 0 && node.frame.position.y === 0));
});

test("整批网格避开已有节点，连续批次也不相互重叠", () => {
    const existing = createImageNode({ id: "已有图片", position: { x: 0, y: 0 } });
    const first = layoutUploadedCanvasNodes(mediaNodes(), [existing], { x: 0, y: 0 });
    const second = layoutUploadedCanvasNodes(mediaNodes(), [existing, ...first], { x: 0, y: 0 });
    first.forEach((node) => assertSeparated(node, existing));
    second.forEach((node) => [existing, ...first].forEach((other) => assertSeparated(node, other)));
    assert.deepEqual(layoutUploadedCanvasNodes([], [existing], { x: 0, y: 0 }), []);
});

test("无碰撞时单节点以锚点为中心，少于三项时只使用所需列数", () => {
    const nodes = mediaNodes().slice(0, 2);
    const [single] = layoutUploadedCanvasNodes(nodes.slice(0, 1), [], { x: 100, y: 200 });
    assert.equal(single.frame.position.x + single.frame.width / 2, 100);
    assert.equal(single.frame.position.y + single.frame.height / 2, 200);
    const [first, second] = layoutUploadedCanvasNodes(nodes, [], { x: 100, y: 200 });
    assert.equal(second.frame.position.x - first.frame.position.x, first.frame.width + 54);
    assert.equal(first.frame.position.y, second.frame.position.y);
});
