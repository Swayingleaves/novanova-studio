import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const componentDirectory = dirname(fileURLToPath(import.meta.url));
const webSourceDirectory = join(componentDirectory, "..", "..", "..");

function source(path: string) {
    return readFileSync(join(webSourceDirectory, path), "utf8");
}

test("共享输入区在 AI 优化按钮左侧渲染 Agent / Chat 分段开关", () => {
    const composer = source("features/generation/components/creation-composer.tsx");

    assert.match(composer, /<Segmented/);
    assert.match(composer, /className="creation-composer-mode"/);
    assert.match(composer, /value=\{chatMode && !chatModeLocked \? "chat" : "agent"\}/);
    assert.match(composer, /disabled: chatModeLocked/);
    assert.match(composer, /disabled=\{requestActive\}/);
    assert.match(composer, /composer-mode/);
    assert.ok(composer.indexOf("composer-mode") < composer.indexOf("{submitActions.map(renderAction)}"), "模式开关应位于提交簇内、AI 优化按钮之前");
});

test("Chat 模式禁用风格库与技能入口", () => {
    const composer = source("features/generation/components/creation-composer.tsx");
    const picker = source("features/generation/components/generation-style-picker.tsx");

    assert.match(composer, /disabled=\{chatMode\}/);
    assert.match(picker, /disabled\?: boolean/);
    assert.match(picker, /generation\.unavailableInChatMode/);
});

test("图片页和视频页都接入模式并透传给 Agent 请求", () => {
    const imagePage = source("app/(user)/image/page.tsx");
    const videoPage = source("app/(user)/video/page.tsx");

    [imagePage, videoPage].forEach((page) => {
        assert.match(page, /useCreationMode\("(image|video)"\)/);
        assert.match(page, /creationMode,/);
        assert.match(page, /onCreationModeChange: handleCreationModeChange/);
        assert.match(page, /chatModeLocked: currentTaskUsesSkill/);
        assert.match(page, /skillTaskLockedRef.current && nextMode === "chat"/);
        assert.match(page, /mode: creationMode/);
        assert.match(page, /creationMode !== "chat" && !ensureModelConfiguration\("text"\)/);
    });
});
