import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { activateCanvasAudio, releaseCanvasAudio, stopCanvasAudio } from "../services/canvas-audio-playback";

const nodeSource = readFileSync(new URL("./video-node.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../pages/canvas-client-page.tsx", import.meta.url), "utf8");
const overlaySource = readFileSync(new URL("../components/canvas-workspace-overlays.tsx", import.meta.url), "utf8");

test("视频节点可在画布内播放和截帧，仍保留放大预览", () => {
    assert.ok(nodeSource.includes("video.play()"));
    assert.ok(nodeSource.includes("await onCapture(video)"));
    assert.ok(nodeSource.includes("onPreview={() => actions.onViewVideo(data)}"));
    assert.match(pageSource, /onCaptureVideoFrame: captureVideoFrame/);
    assert.match(overlaySource, /autoPlay controls playsInline/);
    assert.match(overlaySource, /destroyOnHidden/);
});

test("画布同时只播放一个媒体，释放旧节点不影响新节点", () => {
    const pauses: string[] = [];
    const first = { pause: () => { pauses.push("first"); } } as HTMLMediaElement;
    const second = { pause: () => { pauses.push("second"); } } as HTMLMediaElement;
    activateCanvasAudio(first);
    activateCanvasAudio(second);
    assert.deepEqual(pauses, ["first"]);
    releaseCanvasAudio(first);
    stopCanvasAudio();
    stopCanvasAudio();
    assert.deepEqual(pauses, ["first", "first", "second"]);
});
