import assert from "node:assert/strict";
import test from "node:test";

import { imageMentionPattern, normalizeOptimizedImageMentions, readImageMentionCommand, reconcileImageMentions } from "./image-reference-mentions";

test("中文后输入 @ 或筛选词时只替换光标前的命令", () => {
    const value = "画面转为水墨风，参考@图片的风格";
    const cursor = value.indexOf("的风格");
    assert.deepEqual(readImageMentionCommand(value, cursor), { start: value.indexOf("@"), end: cursor, query: "图片" });
    assert.deepEqual(readImageMentionCommand("参考@", 3), { start: 2, end: 3, query: "" });
    assert.equal(readImageMentionCommand("参考@图片1 的风格", 10), null);
});

test("引用完整编号，多次引用和连续中文不影响匹配", () => {
    const pattern = imageMentionPattern(["图片1", "图片10"]);
    assert.ok(pattern);
    assert.deepEqual(
        Array.from("@图片10与@图片1的风格，再用@图片10；@图片11".matchAll(pattern), (match) => match[0]),
        ["@图片10", "@图片1", "@图片10"],
    );
    assert.equal(imageMentionPattern([]), null);
});

test("在完整引用后继续输入中文不会重新打开菜单，图片10不会误判为图片1", () => {
    const value = "参考@图片1的风格";
    assert.equal(readImageMentionCommand(value, value.length, ["图片1"]), null);
    assert.deepEqual(readImageMentionCommand("@图片10", 5, ["图片1"]), { start: 0, end: 5, query: "图片10" });
    assert.equal(readImageMentionCommand("@图片10", 5, ["图片1", "图片10"]), null);
});

test("移除前面的图片后按素材标识重新编号，保留重复引用和换行", () => {
    const previous = [
        { id: "first", label: "图片1" },
        { id: "second", label: "图片2" },
        { id: "third", label: "图片3" },
    ];
    const current = [
        { id: "second", label: "图片1" },
        { id: "third", label: "图片2" },
    ];
    assert.equal(reconcileImageMentions("参考@图片2的风格\n让@图片3靠近@图片2，移除@图片1", previous, current), "参考@图片1的风格\n让@图片2靠近@图片1，移除");
    assert.equal(reconcileImageMentions("参考@图片1", previous, []), "参考");
});

test("图片1与图片10的编号调整不会重复替换，同步支持语言切换", () => {
    const previous = [
        { id: "first", label: "图片1" },
        { id: "tenth", label: "图片10" },
    ];
    const current = [
        { id: "tenth", label: "Image1" },
        { id: "first", label: "Image2" },
    ];
    assert.equal(reconcileImageMentions("@图片10与@图片1", previous, current), "@Image1与@Image2");
});

test("引用标签的正则特殊字符按原文匹配", () => {
    const pattern = imageMentionPattern(["Image(1)"]);
    assert.ok(pattern);
    assert.deepEqual(
        Array.from("@Image(1)".matchAll(pattern), (match) => match[0]),
        ["@Image(1)"],
    );
});

test("优化结果中的普通图片编号恢复为引用，已有 @ 和重复引用保持一致", () => {
    const images = [{ label: "图片1" }, { label: "图片2" }];
    assert.equal(
        normalizeOptimizedImageMentions("以图片1为主角，参考@图片2的水墨风格。\n镜头推近图片1。", "以@图片1为主角，参考@图片2的风格", images),
        "以@图片1为主角，参考@图片2的水墨风格。\n镜头推近@图片1。",
    );
});

test("优化回填按完整编号处理，不把图片10或未上传的图片当成图片1", () => {
    const images = [{ label: "图片1" }, { label: "图片10" }];
    assert.equal(normalizeOptimizedImageMentions("图片10看向图片1，远处有图片11", "@图片10与@图片1", images), "@图片10看向@图片1，远处有图片11");
    assert.equal(normalizeOptimizedImageMentions("只有图片10", "@图片1与@图片10", images), null);
    assert.equal(normalizeOptimizedImageMentions("只有图片11", "@图片1", [{ label: "图片1" }]), null);
});

test("优化结果丢失原有图片引用时拒绝回填，无图片时保留普通文本", () => {
    assert.equal(normalizeOptimizedImageMentions("镜头缓缓推近主角", "参考@图片1的风格", [{ label: "图片1" }]), null);
    assert.equal(normalizeOptimizedImageMentions("镜头缓缓推近主角", "主角特写", [{ label: "图片1" }]), "镜头缓缓推近主角");
    assert.equal(normalizeOptimizedImageMentions("保留图片1的原文", "图片1", []), "保留图片1的原文");
});

test("优化期间删除图片或切换语言时，回填引用仍然按原素材标识映射", () => {
    const previous = [{ id: "first", label: "图片1" }, { id: "second", label: "图片2" }];
    const current = [{ id: "second", label: "Image1" }];
    const normalized = normalizeOptimizedImageMentions("图片2保持图片1的动作", "@图片2参考@图片1", previous);
    assert.equal(normalized, "@图片2保持@图片1的动作");
    assert.equal(reconcileImageMentions(normalized!, previous, current), "@Image1保持的动作");
    assert.equal(normalizeOptimizedImageMentions("Use Image1 as the subject", "@Image1", current), "Use @Image1 as the subject");
});
