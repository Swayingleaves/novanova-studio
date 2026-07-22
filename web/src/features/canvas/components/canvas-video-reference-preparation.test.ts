import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const nodeGenerationSource = readFileSync(new URL("./canvas-node-generation.ts", import.meta.url), "utf8");
const referenceObjectStorageSource = readFileSync(new URL("../../storage/services/reference-object-storage.ts", import.meta.url), "utf8");
const canvasPageSource = readFileSync(new URL("../pages/canvas-client-page.tsx", import.meta.url), "utf8");

test("视频生成上下文在转换引用图为 Data URL 前直接返回", () => {
    const videoGuardIndex = nodeGenerationSource.indexOf('if (mode === "video") return context;');
    const imageConversionIndex = nodeGenerationSource.indexOf("imageToDataUrl");

    assert.notEqual(videoGuardIndex, -1, "视频模式缺少跳过引用图 Data URL 转换的判断");
    assert.ok(videoGuardIndex < imageConversionIndex, "视频模式判断必须早于引用图 Data URL 转换");
});

test("远程引用图通过服务端转存到云储存", () => {
    const remoteTransferIndex = referenceObjectStorageSource.indexOf("await uploadRemoteObjectToStorage");
    const browserBlobReadIndex = referenceObjectStorageSource.indexOf("await readReferenceImageBlob");

    assert.notEqual(remoteTransferIndex, -1, "远程引用图缺少服务端转存逻辑");
    assert.ok(remoteTransferIndex < browserBlobReadIndex, "远程引用图必须在浏览器读取 Blob 前完成服务端转存");
});

test("节点生成状态不引用已删除的 statusPrompt 变量", () => {
    assert.equal(canvasPageSource.includes("statusPrompt"), false, "画布生成流程仍残留已删除的 statusPrompt 变量");
});
