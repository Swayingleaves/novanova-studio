import assert from "node:assert/strict";
import test from "node:test";

import { hasNewConversationDraftContent, sanitizeDraftReferences } from "./new-conversation-draft";

test("草稿素材过滤会剔除上传中及未落库的临时 blob 占位，保留已上传素材", () => {
    const items = [
        { id: "uploading", url: "https://cdn.example.com/a.png", storageKey: "k1" },
        { id: "temp-blob", url: "blob:http://localhost/123" },
        { id: "saved-blob", url: "blob:http://localhost/456", storageKey: "k2" },
        { id: "remote", url: "https://cdn.example.com/b.mp4", storageKey: "k3" },
    ];
    const sanitized = sanitizeDraftReferences(items, ["uploading"]);
    assert.deepEqual(sanitized.map((item) => item.id), ["saved-blob", "remote"]);
});

test("空草稿与有提示词或素材的草稿判定正确", () => {
    assert.equal(hasNewConversationDraftContent(null), false);
    assert.equal(hasNewConversationDraftContent({ prompt: "   ", references: [], videoReferences: [] }), false);
    assert.equal(hasNewConversationDraftContent({ prompt: "一只白鹭", references: [], videoReferences: [] }), true);
    assert.equal(hasNewConversationDraftContent({ prompt: "", references: [{ id: "1", type: "image", url: "https://a.com/1.png", dataUrl: "https://a.com/1.png", name: "1.png" }], videoReferences: [] }), true);
});
