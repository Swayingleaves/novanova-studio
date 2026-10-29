import assert from "node:assert/strict";
import test from "node:test";

import { communityDraftIssue, communityDraftSignature, createCommunityDrafts } from "./community-config";

/** 构造社群草稿，默认字段合法，按需覆盖单个字段。 */
function draft(id: string, patch: Partial<{ name: string; imageUrl: string }> = {}) {
    return { id, name: "官方群", imageUrl: "https://cdn.example.com/community.png", ...patch };
}

test("服务端配置转换成带本地标识的草稿并保留顺序", () => {
    const drafts = createCommunityDrafts([
        { name: "官方群", imageUrl: "https://cdn.example.com/a.png", sortOrder: 0 },
        { name: "创作者群", imageUrl: "https://cdn.example.com/b.png", sortOrder: 1 },
    ]);
    assert.deepEqual(drafts.map((item) => [item.name, item.imageUrl]), [
        ["官方群", "https://cdn.example.com/a.png"],
        ["创作者群", "https://cdn.example.com/b.png"],
    ]);
    assert.notEqual(drafts[0].id, drafts[1].id);
});

test("草稿比较忽略本地标识与首尾空白，只感知内容和顺序", () => {
    assert.equal(communityDraftSignature([draft("a")]), communityDraftSignature([draft("b")]));
    assert.equal(communityDraftSignature([draft("a")]), communityDraftSignature([draft("a", { name: " 官方群 " })]));
    assert.notEqual(
        communityDraftSignature([draft("a", { name: "甲" }), draft("b", { name: "乙" })]),
        communityDraftSignature([draft("a", { name: "乙" }), draft("b", { name: "甲" })]),
    );
});

test("空名称、非法图片地址和重复配置都会被拦截", () => {
    assert.equal(communityDraftIssue([]), "");
    assert.equal(communityDraftIssue([draft("a")]), "");
    assert.equal(communityDraftIssue([draft("a", { name: "  " })]), "name");
    assert.equal(communityDraftIssue([draft("a", { imageUrl: "" })]), "url");
    assert.equal(communityDraftIssue([draft("a", { imageUrl: "ftp://cdn.example.com/a.png" })]), "url");
    assert.equal(communityDraftIssue([draft("a", { imageUrl: "https://" })]), "url");
    assert.equal(communityDraftIssue([draft("a"), draft("b")]), "duplicate");
    assert.equal(communityDraftIssue([draft("a"), draft("b", { name: " 官方群 " })]), "duplicate");
    assert.equal(communityDraftIssue([draft("a"), draft("b", { name: "创作者群" })]), "duplicate");
    assert.equal(communityDraftIssue([draft("a"), draft("b", { name: "创作者群", imageUrl: "https://cdn.example.com/b.png" })]), "");
});
