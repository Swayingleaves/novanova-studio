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

test("图片和视频页面通过共享 CreationComposer 复用风格库", () => {
    const composer = source("features/generation/components/creation-composer.tsx");
    const imagePage = source("app/(user)/image/page.tsx");
    const videoPage = source("app/(user)/video/page.tsx");

    assert.match(composer, /GenerationStyleMenu/);
    assert.match(composer, /GenerationStyleCover/);
    assert.match(imagePage, /styleOptions,/);
    assert.match(videoPage, /styleOptions,/);
});

test("已选风格标签复用风格封面缩略图", () => {
    const picker = source("features/generation/components/generation-style-picker.tsx");

    assert.match(picker, /<GenerationStyleCover style=\{style\} className="size-5 shrink-0 overflow-hidden rounded-sm"/);
});

test("画布单类型和混合类型入口均复用同一风格库组件", () => {
    const nodePanel = source("features/canvas/components/canvas-node-prompt-panel.tsx");
    const agentComposer = source("features/canvas/components/canvas-agent-composer.tsx");

    assert.match(nodePanel, /GenerationStyleMenu/);
    assert.match(nodePanel, /useGenerationStyles\(mode === "image" \|\| mode === "video"/);
    assert.match(agentComposer, /GenerationStyleMenu/);
    assert.match(agentComposer, /parseGroupedGenerationStyleMessage/);
});

test("图片视频和画布生成入口统一由共享组件执行风格单选上限", () => {
    const composer = source("features/generation/components/creation-composer.tsx");
    const imagePage = source("app/(user)/image/page.tsx");
    const videoPage = source("app/(user)/video/page.tsx");
    const nodePanel = source("features/canvas/components/canvas-node-prompt-panel.tsx");
    const agentComposer = source("features/canvas/components/canvas-agent-composer.tsx");
    const chatPanel = source("features/canvas/components/canvas-chat-panel.tsx");

    // 共享合成器与画布组件直接执行单选上限
    [composer, nodePanel, agentComposer, chatPanel].forEach((content) => {
        assert.match(content, /MAX_GENERATION_STYLE_SELECTION_COUNT/);
    });
    // 图片和视频页面委托共享合成器，不再各自引用上限常量
    assert.match(imagePage, /CreationComposer/);
    assert.match(videoPage, /CreationComposer/);
});
