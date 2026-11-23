import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { captureCanvasVideoFrame } from "./canvas-video-frame";

class TestVideo extends EventTarget {
    seeking = false;
    readyState = 2;
    videoWidth = 320;
    videoHeight = 180;
    currentTime = 2;
    error = null;
    paused = false;

    pause() { this.paused = true; }
}

function withCanvas(t: TestContext) {
    const raw = new Blob(["frame"], { type: "image/png" });
    const drawn: number[] = [];
    const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: (video: TestVideo) => drawn.push(video.currentTime) }),
        toBlob: (callback: (blob: Blob) => void, type: string) => {
            assert.equal(type, "image/png");
            callback(raw);
        },
    };
    const old = Object.getOwnPropertyDescriptors(globalThis);
    Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => canvas } });
    Object.defineProperty(globalThis, "HTMLMediaElement", { configurable: true, value: { HAVE_CURRENT_DATA: 2 } });
    t.after(() => {
        for (const name of ["document", "HTMLMediaElement"] as const) {
            if (old[name]) Object.defineProperty(globalThis, name, old[name]);
            else Reflect.deleteProperty(globalThis, name);
        }
    });
    return { raw, canvas, drawn };
}

test("视频仍在跳转时，截帧等待目标画面并保留原始尺寸", async (t) => {
    const { raw, canvas, drawn } = withCanvas(t);
    const video = new TestVideo();
    video.seeking = true;
    const result = captureCanvasVideoFrame(video as unknown as HTMLVideoElement, async () => assert.fail("不应下载可直接截取的视频"), new AbortController().signal);
    assert.equal(video.paused, true);
    assert.deepEqual(drawn, []);
    video.currentTime = 3.5;
    video.seeking = false;
    video.dispatchEvent(new Event("seeked"));
    assert.equal(await result, raw);
    assert.deepEqual(drawn, [3.5]);
    assert.deepEqual([canvas.width, canvas.height], [320, 180]);
});

test("切换画布时取消等待中的截帧，随后到达的事件不会绘制", async (t) => {
    const { drawn } = withCanvas(t);
    const video = new TestVideo();
    video.seeking = true;
    const controller = new AbortController();
    const result = captureCanvasVideoFrame(video as unknown as HTMLVideoElement, async () => assert.fail("不应下载已取消的视频"), controller.signal);
    controller.abort();
    await assert.rejects(result, { name: "AbortError" });
    video.dispatchEvent(new Event("seeked"));
    assert.deepEqual(drawn, []);
});
