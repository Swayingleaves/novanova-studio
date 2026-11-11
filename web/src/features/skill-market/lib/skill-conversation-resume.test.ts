import assert from "node:assert/strict";
import test from "node:test";

const { parseResumedSkillConversation } = await import(new URL("./skill-conversation-resume.ts", import.meta.url).href);

test("resume record keeps the video skill session", () => {
    const skill = { id: 8, name: "武打专业分镜", description: "", targetType: "video", coverUrl: "" };
    assert.deepEqual(parseResumedSkillConversation({ sessionId: "session-1", skill }, "video"), { sessionId: "session-1", skill });
    assert.equal(parseResumedSkillConversation({ sessionId: "session-1", skill }, "image"), null);
    assert.equal(parseResumedSkillConversation({ sessionId: "", skill }, "video"), null);
});
