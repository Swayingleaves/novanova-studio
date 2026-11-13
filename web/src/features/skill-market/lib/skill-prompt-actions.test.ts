import assert from "node:assert/strict";
import test from "node:test";

import { choicesFromAgentActionTokens, filterSkillPromptActions, mentionQuery, readSkillPromptMention, stripAgentActionTokens } from "./skill-prompt-actions.ts";

test("mention query starts at the current @", () => {
    assert.deepEqual(mentionQuery("先收集主题，再 @询问"), { query: "询问", start: 8 });
    assert.equal(mentionQuery("已经写完 @ask_user_model_config 。"), null);
    assert.equal(mentionQuery("没有标记"), null);
});

test("completed action mention stays closed", () => {
    const tokens = ["ask_user_model_config", "ask_user_confirm", "ask_user_upload_image", "ask_user_upload_video"];
    const completed = "已经写完 @ask_user_model_config";
    assert.equal(readSkillPromptMention(completed, completed.length, tokens), null);
    const followed = "用 @ask_user_confirm。";
    assert.equal(readSkillPromptMention(followed, followed.length, tokens), null);
    const partial = "用 @ask";
    assert.deepEqual(readSkillPromptMention(partial, partial.length, tokens), { query: "ask", start: 2, end: partial.length });
    assert.equal(readSkillPromptMention("没有标记", 4, tokens), null);
});

test("mention list filters by label or token", () => {
    const actions = [
        { label: "询问用户模型配置", token: "ask_user_model_config" },
        { label: "询问用户是否确认", token: "ask_user_confirm" },
    ];
    assert.deepEqual(filterSkillPromptActions(actions, "模型").map((item) => item.token), ["ask_user_model_config"]);
    assert.deepEqual(filterSkillPromptActions(actions, "confirm").map((item) => item.token), ["ask_user_confirm"]);
    assert.equal(filterSkillPromptActions(actions, "").length, 2);
});

test("assistant text exposes an action without showing the token", () => {
    assert.equal(stripAgentActionTokens("请先 @ask_user_model_config 。"), "请先 。");
    assert.deepEqual(choicesFromAgentActionTokens("请 @ask_user_confirm 后继续。").map((item) => item.action), ["ask_user_confirm"]);
    assert.deepEqual(choicesFromAgentActionTokens("请 @ask_user_upload_image 或 @ask_user_upload_video").map((item) => item.label), ["上传图片", "上传视频"]);
    assert.equal(choicesFromAgentActionTokens("没有动作").length, 0);
});
