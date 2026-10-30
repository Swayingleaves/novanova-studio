import assert from "node:assert/strict";
import test from "node:test";

import { diffScriptVersion } from "./script-version-diff.ts";

test("结构对比只报告实际修改的业务区块", () => {
    const snapshot = { project: { overview: { title: "旧标题" }, characters: [{ id: "person" }], episodes: [] } };
    const current = { overview: { title: "新标题" }, characters: [{ id: "person" }], episodes: [] };
    const differences = diffScriptVersion(snapshot, current);
    assert.deepEqual(differences.map((item) => item.key), ["overview"]);
    assert.deepEqual(differences[0].before, { title: "旧标题" });
    assert.deepEqual(differences[0].after, { title: "新标题" });
});

test("单集正文未按需加载时不把缺失数据误报为差异", () => {
    const snapshot = { project: { overview: {} }, episodeDetails: [{ episode: { id: "first" } }] };
    const current = { overview: {} };
    assert.equal(diffScriptVersion(snapshot, current).some((item) => item.key === "episodeDetails"), false);
    assert.equal(diffScriptVersion(snapshot, current, []).some((item) => item.key === "episodeDetails"), true);
});

test("JSONB只调整对象键顺序时不报告虚假差异", () => {
    const snapshot = { project: { overview: { synopsis: "简介", title: "标题" } } };
    const current = { overview: { title: "标题", synopsis: "简介" } };

    assert.deepEqual(diffScriptVersion(snapshot, current), []);
});
