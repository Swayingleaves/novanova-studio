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

test("画布 Agent 输入框接入 @ 引用组件并随消息发送节点引用", () => {
    const composer = source("features/canvas/components/canvas-agent-composer.tsx");
    const mentionInput = source("features/canvas/components/canvas-agent-mention-input.tsx");
    const chatPanel = source("features/canvas/components/canvas-chat-panel.tsx");
    const canvasPage = source("features/canvas/pages/canvas-client-page.tsx");

    assert.match(composer, /CanvasAgentMentionInput/);
    assert.match(composer, /buildCanvasAgentMentionCandidates/);
    assert.match(composer, /nodes\?: CanvasNode\[\]/);
    assert.match(mentionInput, /readCanvasAgentMentionCommand/);
    assert.match(mentionInput, /dataset\.mentionNodeId/);
    assert.match(chatPanel, /buildCanvasAgentMentionMessage/);
    assert.match(chatPanel, /readCanvasAgentMentionNodeIds/);
    assert.match(chatPanel, /nodes=\{nodes\}/);
    assert.match(canvasPage, /agentText = text/);
    assert.match(canvasPage, /sendAgentMessage\(\s*agentText,/);
});
