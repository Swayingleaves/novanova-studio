import assert from "node:assert/strict";
import test from "node:test";
import { createEmailCampaign, listEmailDomains, listEmailRecipientUsers } from "./email-campaigns";

test("搜索支持多后缀，手动勾选不提交筛选条件，全选提交完整筛选而无需逐页传用户", async () => {
    const requests: Array<{ url: URL; body: unknown }> = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        requests.push({ url: new URL(String(input)), body: init?.body ? JSON.parse(String(init.body)) : undefined });
        return new Response(JSON.stringify({ code: 0, data: {}, msg: "成功" }), { headers: { "Content-Type": "application/json" } });
    };
    try {
        await listEmailDomains();
        await listEmailRecipientUsers(2, "用户+名称", ["qq.com", "gmail.com"]);
        await listEmailRecipientUsers(1, "");
        const payload = { requestId: "test-request", subject: "通知", bodyHtml: "<p>正文</p>", recipientMode: "selected" as const,
            userIds: [1, 2], intervalSeconds: 3 };
        await createEmailCampaign(payload);
        assert.equal(requests[0].url.pathname, "/api/v1/admin/email/listEmailDomains");
        assert.equal(requests[1].url.searchParams.get("page"), "2");
        assert.equal(requests[1].url.searchParams.get("keyword"), "用户+名称");
        assert.deepEqual(requests[1].url.searchParams.getAll("emailDomains"), ["qq.com", "gmail.com"]);
        assert.equal(requests[2].url.searchParams.has("emailDomains"), false);
        assert.equal(requests[3].url.pathname, "/api/v1/admin/email/createCampaign");
        assert.deepEqual(requests[3].body, payload);
        assert.equal(Object.hasOwn(requests[3].body as object, "emailDomains"), false);
        const selectAllPayload = { ...payload, userIds: [], recipientFilter: { keyword: "用户+名称", emailDomains: ["qq.com", "gmail.com"] } };
        await createEmailCampaign(selectAllPayload);
        assert.deepEqual(requests[4].body, selectAllPayload);
        assert.equal(requests[4].url.pathname, "/api/v1/admin/email/createCampaign");
    } finally {
        globalThis.fetch = previousFetch;
    }
});
