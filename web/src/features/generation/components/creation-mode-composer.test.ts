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

test("图片和视频共享输入区不限制字数、回车不直接发送、保留排版及弹窗查看", () => {
    const composer = source("features/generation/components/creation-composer.tsx");

    assert.ok(!composer.includes("maxLength"), "输入区不应再限制最大输入字数");
    assert.ok(!composer.includes("/ 2000") && !composer.includes("/ 5000"), "计数展示不应再显示字数上限");
    assert.ok(composer.includes("共 ${value.length} 字"), "输入区应仅展示当前输入字符数");
    assert.ok(!composer.includes("if (canSubmit && !requestActive) onSubmit()"), "按回车仍会直接触发发送执行");
    assert.ok(composer.includes('title="弹窗查看提示词"'), "缺少放大弹窗查看提示词按钮");
    assert.ok(composer.includes("open={promptModalOpen}"), "缺少提示词放大弹窗");
    assert.ok(composer.includes("mask={{ closable: true }}"), "弹窗未使用新版 mask.closable 属性");
    assert.ok(!composer.includes("A-") && !composer.includes("A+"), "图片和视频弹窗不应包含字体缩放按钮");
});
