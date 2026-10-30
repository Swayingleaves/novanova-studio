import assert from "node:assert/strict";
import { test } from "node:test";
import { useUserStore } from "../auth/stores/use-user-store.ts";
import { useTeamStore } from "./stores/use-team-store.ts";
import { canInitializeSpaceBusiness, loadTeamEntry } from "./team-entry.ts";

const team = { id: 101, teamSlug: "team1", name: "团队一", introduction: "团队介绍", logoUrl: "https://example.com/logo.png", enabled: true };

test("团队入口先加载品牌，仅业务访问校验成员，失败不启动任何业务", async (context) => {
    const previousFetch = globalThis.fetch;
    const previousUser = useUserStore.getState();
    const previousTeam = useTeamStore.getState();
    const requests = [];
    let publicTeam = team;
    let memberships = [{ ...team, memberRole: "member", memberStatus: "active" }];
    let missing = false;
    globalThis.fetch = async (input, options) => {
        options?.signal?.throwIfAborted();
        const url = new URL(String(input));
        requests.push(url.pathname);
        const isPublicTeam = url.pathname.endsWith("/getPublicTeam");
        return new Response(JSON.stringify({ code: isPublicTeam && missing ? 404 : 0, data: isPublicTeam ? publicTeam : memberships, msg: "团队不存在" }), { status: isPublicTeam && missing ? 404 : 200, headers: { "Content-Type": "application/json" } });
    };
    useUserStore.setState({ token: "current-token", expiresAt: "2099-01-01T00:00:00.000Z" });
    useTeamStore.getState().setTeam(null);
    try {
        await context.test("未登录访客和已有账号访问认证页只查询公开品牌", async () => {
            for (const token of ["", "current-token"]) {
                requests.length = 0;
                const entry = await loadTeamEntry("team1", true, token, new AbortController().signal);
                assert.equal(entry.logoUrl, team.logoUrl);
                assert.equal(entry.memberRole, undefined);
                assert.deepEqual(requests, ["/api/v1/team/getPublicTeam"]);
                assert.equal(canInitializeSpaceBusiness("/team/team1/auth", entry), false);
                assert.equal(canInitializeSpaceBusiness("/team/team1/auth/forgotPassword", entry), false);
            }
        });
        await context.test("未登录首页可展示品牌，但不能加载团队业务", async () => {
            requests.length = 0;
            const entry = await loadTeamEntry("team1", false, "", new AbortController().signal);
            assert.deepEqual(requests, ["/api/v1/team/getPublicTeam"]);
            assert.equal(canInitializeSpaceBusiness("/team/team1", entry), false);
        });
        await context.test("有效成员验证通过才允许加载自身团队业务", async () => {
            requests.length = 0;
            const entry = await loadTeamEntry("team1", false, "current-token", new AbortController().signal);
            assert.deepEqual(requests, ["/api/v1/team/getPublicTeam", "/api/v1/team/listMyTeams"]);
            assert.equal(canInitializeSpaceBusiness("/team/team1", entry), true);
            assert.equal(canInitializeSpaceBusiness("/team/team1/image", entry), true);
            assert.equal(canInitializeSpaceBusiness("/team/team2/image", entry), false);
            assert.equal(canInitializeSpaceBusiness("/auth", entry), false);
            assert.equal(canInitializeSpaceBusiness("/", entry), false);
        });
        await context.test("非成员、禁用和移除成员均拒绝访问，不自动加入", async () => {
            for (const status of [null, "disabled", "removed"]) {
                memberships = status ? [{ ...team, memberRole: "member", memberStatus: status }] : [];
                await assert.rejects(() => loadTeamEntry("team1", false, "current-token", new AbortController().signal), /尚未加入|禁用或移除/);
            }
        });
        await context.test("禁用和无效团队在认证页也明确报错，不降级为平台", async () => {
            memberships = [{ ...team, enabled: false, memberStatus: "active", memberRole: "member" }];
            await assert.rejects(() => loadTeamEntry("team1", false, "current-token", new AbortController().signal), /团队已被禁用/);
            publicTeam = { ...team, enabled: false };
            await assert.rejects(() => loadTeamEntry("team1", true, "", new AbortController().signal), /团队已被禁用/);
            missing = true;
            await assert.rejects(() => loadTeamEntry("missing", true, "", new AbortController().signal), /团队不存在/);
        });
        await context.test("空间变化中止旧团队请求，平台认证页不启动业务", async () => {
            const controller = new AbortController();
            controller.abort();
            await assert.rejects(() => loadTeamEntry("team1", false, "current-token", controller.signal), { name: "AbortError" });
            assert.equal(canInitializeSpaceBusiness("/auth", null), false);
            assert.equal(canInitializeSpaceBusiness("/auth/oauthCallback", null), false);
            assert.equal(canInitializeSpaceBusiness("/image", null), true);
        });
    } finally {
        globalThis.fetch = previousFetch;
        useUserStore.setState(previousUser);
        useTeamStore.setState(previousTeam);
    }
});
