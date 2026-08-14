import assert from "node:assert/strict";
import test from "node:test";

import { isTerminalAgentRequestStatus, matchesAgentRequest, shouldApplyAgentQueueStatus } from "./agent-event-match";

test("只接受当前会话和请求的Agent事件", () => {
  assert.equal(matchesAgentRequest({ type: "queue-status", sessionId: "session-1", requestId: "request-1" }, "session-1", "request-1"), true);
  assert.equal(matchesAgentRequest({ type: "queue-status", sessionId: "session-2", requestId: "request-1" }, "session-1", "request-1"), false);
  assert.equal(matchesAgentRequest({ type: "queue-status", sessionId: "session-1", requestId: "request-2" }, "session-1", "request-1"), false);
  assert.equal(matchesAgentRequest({ type: "queue-status", sessionId: "session-1" }, "session-1", "request-1"), false);
});

test("主Agent排队状态只能从排队切换为运行", () => {
  assert.equal(shouldApplyAgentQueueStatus(null, "queued"), true);
  assert.equal(shouldApplyAgentQueueStatus("queued", "running"), true);
  assert.equal(shouldApplyAgentQueueStatus("running", "queued"), false);
});

test("主Agent终态请求不应再接受迟到的排队状态", () => {
  assert.equal(isTerminalAgentRequestStatus("success"), true);
  assert.equal(isTerminalAgentRequestStatus("failed"), true);
  assert.equal(isTerminalAgentRequestStatus("canceled"), true);
  assert.equal(isTerminalAgentRequestStatus("interrupted"), true);
  assert.equal(isTerminalAgentRequestStatus("queued"), false);
  assert.equal(isTerminalAgentRequestStatus("running"), false);
});
