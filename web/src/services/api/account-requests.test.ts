import assert from "node:assert/strict";
import test from "node:test";
import { adminCreateUser, loginByAccount, resetServerUserPassword } from "./server";
import { resetMemberPassword, resendInvitation, updateMemberRole } from "./team";
import { useTeamStore } from "@/features/team/stores/use-team-store";

test("账号接口使用account字段并保留当前团队上下文", async () => {
    const requests: Array<{ path: string; body: unknown; teamId: string | null }> = [];
    const previousFetch = globalThis.fetch;
    const previousTeam = useTeamStore.getState().team;
    globalThis.fetch = async (input, init) => {
        requests.push({ path: new URL(String(input)).pathname, body: JSON.parse(String(init?.body)), teamId: new Headers(init?.headers).get("X-Team-Id") });
        return new Response(JSON.stringify({ code: 0, data: "ok", msg: "success" }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    try {
        await loginByAccount({ account: "Creator", password: "password123" });
        await loginByAccount({ account: "member@example.com", password: "password123" });
        await adminCreateUser({ account: "Creator", password: "password123" });
        await resetServerUserPassword({ userId: 8, newPassword: "new-password" });
        useTeamStore.setState({ team: { id: 101, teamSlug: "team-a", name: "团队甲", enabled: true, logoUrl: "" } });
        await resetMemberPassword({ userId: 8, newPassword: "new-password" });
        await resendInvitation("invitation-1");
        await updateMemberRole({ userId: 8, memberRole: "administrator" });
        assert.deepEqual(requests.map(({ path }) => path), ["/api/v1/auth/login", "/api/v1/auth/login", "/api/v1/admin/user/createUser", "/api/v1/admin/user/resetUserPassword", "/api/v1/team/resetMemberPassword", "/api/v1/team/resendInvitation", "/api/v1/team/updateMemberRole"]);
        assert.deepEqual(requests[0].body, { account: "Creator", password: "password123" });
        assert.deepEqual(requests[1].body, { account: "member@example.com", password: "password123" });
        assert.deepEqual(requests[5].body, { invitationId: "invitation-1" });
        assert.equal(requests[4].teamId, "101");
        assert.deepEqual(requests[6].body, { userId: 8, memberRole: "administrator" });
        assert.equal(requests[6].teamId, "101");
    } finally {
        globalThis.fetch = previousFetch;
        useTeamStore.setState({ team: previousTeam });
    }
});
