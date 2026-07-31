import assert from "node:assert/strict";
import test from "node:test";

import { agentThinkingReducer, initialAgentThinkingState } from "./use-agent-thinking.ts";

test("agentThinkingReducer 拼接同一思考块的多个原始增量", () => {
  const started = agentThinkingReducer(initialAgentThinkingState, { type: "delta", thoughtId: "reply-1:block-1", delta: "先分析" });
  const updated = agentThinkingReducer(started, { type: "delta", thoughtId: "reply-1:block-1", delta: "用户意图" });

  assert.equal(updated.activeThinking?.text, "先分析用户意图");
  assert.equal(updated.activeThinking?.collapsed, false);
});

test("agentThinkingReducer 只完成编号匹配的思考块", () => {
  const started = agentThinkingReducer(initialAgentThinkingState, { type: "delta", thoughtId: "reply-1:block-1", delta: "推理内容" });
  const mismatched = agentThinkingReducer(started, { type: "complete", thoughtId: "reply-2:block-1", durationMs: 10 });
  const completed = agentThinkingReducer(mismatched, { type: "complete", thoughtId: "reply-1:block-1", durationMs: 25 });

  assert.strictEqual(mismatched, started);
  assert.equal(completed.activeThinking, null);
  assert.equal(completed.completedThinkings[0]?.durationMs, 25);
  assert.equal(completed.completedThinkings[0]?.collapsed, true);
});

test("agentThinkingReducer 在任务终态或新一轮发送时清空全部思考状态", () => {
  const started = agentThinkingReducer(initialAgentThinkingState, { type: "delta", thoughtId: "reply-1:block-1", delta: "推理内容" });
  const completed = agentThinkingReducer(started, { type: "complete", thoughtId: "reply-1:block-1", durationMs: 25 });

  assert.deepEqual(agentThinkingReducer(completed, { type: "reset" }), initialAgentThinkingState);
});
