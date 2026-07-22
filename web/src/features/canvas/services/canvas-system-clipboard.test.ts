import assert from "node:assert/strict";
import test from "node:test";

import { readCanvasSystemClipboard } from "./canvas-system-clipboard.ts";

test("系统剪切板优先返回图片文件", async () => {
    const blob = new Blob(["image"], { type: "image/png" });
    const result = await readCanvasSystemClipboard({
        read: async () => [{ types: ["image/png"], getType: async () => blob }],
        readText: async () => "备用文本",
    });

    assert.equal(result?.kind, "image");
    assert.equal(result?.kind === "image" ? result.file.type : "", "image/png");
});

test("没有图片时返回剪切板文本", async () => {
    const result = await readCanvasSystemClipboard({ read: async () => [], readText: async () => "画布文本" });
    assert.deepEqual(result, { kind: "text", text: "画布文本" });
});
