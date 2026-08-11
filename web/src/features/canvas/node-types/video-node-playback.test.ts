import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const videoNodeSource = readFileSync(new URL("./video-node.tsx", import.meta.url), "utf8");
const actionContextSource = readFileSync(new URL("./node-action-context.ts", import.meta.url), "utf8");
const overlaySource = readFileSync(new URL("../components/canvas-workspace-overlays.tsx", import.meta.url), "utf8");
const canvasPageSource = readFileSync(new URL("../pages/canvas-client-page.tsx", import.meta.url), "utf8");

test("视频节点播放通过放大弹窗进行", () => {
    assert.ok(actionContextSource.includes("onViewVideo"), "节点操作上下文缺少视频预览回调");
    assert.ok(videoNodeSource.includes("actions.onViewVideo(data)"), "视频节点播放按钮未打开预览弹窗");
    assert.ok(!videoNodeSource.includes("videoRef.current?.play()"), "视频节点仍在画布内直接播放");
    assert.ok(canvasPageSource.includes("onViewVideo: (n) => setPreviewNodeId(n.id)"), "画布页面未接收视频预览请求");
    assert.ok(overlaySource.includes("autoPlay controls playsInline"), "视频预览弹窗未自动播放或缺少播放控制");
    assert.ok(overlaySource.includes("destroyOnHidden"), "关闭视频预览后未销毁播放器");
});
