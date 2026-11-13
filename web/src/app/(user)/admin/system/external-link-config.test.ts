import assert from "node:assert/strict";
import test from "node:test";

import { createExternalLinkDraft, emptyExternalLinkDraft, externalLinkDraftIssue, externalLinkDraftSignature } from "./external-link-config";

test("未配置时转换成空草稿，已配置时保留全部字段", () => {
    assert.deepEqual(createExternalLinkDraft(null), emptyExternalLinkDraft());
    assert.deepEqual(
        createExternalLinkDraft({ title: "加入创作者计划", url: "https://example.com", description: "说明", coverUrl: "https://example.com/cover.png" }),
        { title: "加入创作者计划", url: "https://example.com", description: "说明", coverUrl: "https://example.com/cover.png" },
    );
});

test("草稿比较忽略首尾空白，只感知字段内容", () => {
    const base = { title: "加入", url: "https://example.com", description: "说明", coverUrl: "" };
    assert.equal(externalLinkDraftSignature(base), externalLinkDraftSignature({ ...base, title: " 加入 ", description: " 说明 " }));
    assert.notEqual(externalLinkDraftSignature(base), externalLinkDraftSignature({ ...base, url: "https://example.com/2" }));
});

test("标题和链接同时为空表示移除入口，非法地址会被拦截", () => {
    assert.equal(externalLinkDraftIssue(emptyExternalLinkDraft()), "");
    assert.equal(externalLinkDraftIssue({ title: "加入", url: "https://example.com", description: "", coverUrl: "" }), "");
    assert.equal(externalLinkDraftIssue({ title: "  ", url: "https://example.com", description: "", coverUrl: "" }), "title");
    assert.equal(externalLinkDraftIssue({ title: "加入", url: "", description: "", coverUrl: "" }), "url");
    assert.equal(externalLinkDraftIssue({ title: "加入", url: "ftp://example.com", description: "", coverUrl: "" }), "url");
    assert.equal(externalLinkDraftIssue({ title: "加入", url: "https://example.com", description: "", coverUrl: "javascript:alert(1)" }), "coverUrl");
    assert.equal(
        externalLinkDraftIssue({ title: "加入", url: "https://example.com", description: "", coverUrl: "https://example.com/cover.png" }),
        "",
    );
});
