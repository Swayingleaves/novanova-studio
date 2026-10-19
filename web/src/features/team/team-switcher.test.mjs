import assert from "node:assert/strict";
import { test } from "node:test";
import { useUserStore } from "../auth/stores/use-user-store.ts";
import { completeAuthentication } from "../auth/lib/complete-authentication.ts";
import { consumeOAuth2Redirect, storeOAuth2Redirect } from "../auth/lib/oauth2-login.ts";
import { listMyTeams } from "../../services/api/team.ts";
import { useTeamStore } from "./stores/use-team-store.ts";
import { finishLoginSpaceSelection, useTeamSwitcherStore } from "./stores/use-team-switcher-store.ts";
import { subscribeSessionNavigation } from "./session-navigation.ts";

const administratorTeam = { id: 101, teamSlug: "team1", name: "团队一", logoUrl: "logo.png", enabled: true, memberRole: "administrator", memberStatus: "active" };
const memberTeam = { ...administratorTeam, id: 102, teamSlug: "team2", name: "团队二", logoUrl: "", memberRole: "member" };

/** 构造普通全局角色的登录结果，团队管理员同样使用普通全局角色。 */
function createSession(role = "user") {
    return { token: "new-token", expiresAt: "2099-01-01T00:00:00.000Z", user: {
        id: 1, username: "member", nickname: "团队账号", email: null, avatar: "", role, status: 1, creditBalance: "0", welcomeRead: false,
    } };
}

test("平台登录优先选团队，团队登录直接恢复目标", async (context) => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const previousFetch = globalThis.fetch;
    const previousUser = useUserStore.getState();
    const previousTeam = useTeamStore.getState();
    const previousSwitcher = useTeamSwitcherStore.getState();
    const values = new Map();
    const destinations = [];
    const requests = [];
    const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
    const location = { pathname: "/auth", origin: "http://localhost:15555", replace: (path) => destinations.push(path), reload: () => destinations.push("刷新") };
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location, localStorage: storage, sessionStorage: storage } });
    let controller;
    let unsubscribe;
    const reset = (pathname = "/auth") => {
        unsubscribe?.();
        values.clear();
        destinations.length = 0;
        requests.length = 0;
        location.pathname = pathname;
        controller = new AbortController();
        useUserStore.setState({ ...previousUser, token: "", user: null, hydrated: true, authenticationRedirect: "" });
        useTeamStore.setState({ team: administratorTeam, ready: true, wallets: { platformBalance: "5", teamBalance: "10" } });
        useTeamSwitcherStore.setState({ open: false, loginTarget: "", switchingTo: "" });
        unsubscribe = subscribeSessionNavigation(() => controller.abort());
    };
    const respondWithTeams = (teams) => {
        globalThis.fetch = async (input, options) => {
            const headers = new Headers(options.headers);
            requests.push({ path: new URL(String(input)).pathname, token: headers.get("Authorization"), team: headers.get("X-Team-Id") });
            return new Response(JSON.stringify({ code: 0, data: teams, msg: "成功" }), { headers: { "Content-Type": "application/json" } });
        };
    };
    try {
        await context.test("团队管理员与普通成员，即使只有一个团队也先选择且不加载业务空间", async () => {
            for (const team of [administratorTeam, memberTeam]) {
                reset();
                completeAuthentication(createSession(), "/image?initialPrompt=%E4%B8%AD%E6%96%87#draft");
                assert.deepEqual(destinations, []);
                assert.equal(controller.signal.aborted, true);
                assert.equal(useTeamStore.getState().ready, false);
                assert.equal(useTeamStore.getState().team, null);
                assert.equal(useTeamStore.getState().wallets, null);
                assert.equal(useUserStore.getState().authenticationRedirect, "/image?initialPrompt=%E4%B8%AD%E6%96%87#draft");
                assert.equal(useTeamSwitcherStore.getState().open, true);
                respondWithTeams([team]);
                const teams = await listMyTeams();
                assert.deepEqual(requests, [{ path: "/api/v1/team/listMyTeams", token: "Bearer new-token", team: null }]);
                assert.deepEqual(destinations, []);
                finishLoginSpaceSelection(teams[0]);
                assert.deepEqual(destinations, [`/team/${team.teamSlug}`]);
            }
        });
        await context.test("多个团队可选，选择其他团队只进入首页，不携带原创作引用", async () => {
            reset("/");
            completeAuthentication(createSession(), "/canvas/platform-private?node=private#draft");
            respondWithTeams([administratorTeam, memberTeam]);
            const teams = await listMyTeams();
            finishLoginSpaceSelection(teams[1]);
            finishLoginSpaceSelection(teams[0]);
            assert.deepEqual(destinations, ["/team/team2"]);
        });
        await context.test("无团队或明确选择平台都保留原目标和参数，只导航一次", async () => {
            reset();
            completeAuthentication(createSession(), "/image?initialPrompt=test%26more#draft");
            respondWithTeams([]);
            assert.deepEqual(await listMyTeams(), []);
            finishLoginSpaceSelection();
            finishLoginSpaceSelection(null);
            assert.deepEqual(destinations, ["/image?initialPrompt=test%26more#draft"]);
        });
        await context.test("团队关系查询失败保持待选择状态，重试后可继续", async () => {
            reset();
            completeAuthentication(createSession());
            globalThis.fetch = async () => new Response(JSON.stringify({ code: 500, msg: "团队查询失败" }), { status: 500, headers: { "Content-Type": "application/json" } });
            await assert.rejects(() => listMyTeams(), /团队查询失败/);
            assert.deepEqual(destinations, []);
            assert.equal(useTeamSwitcherStore.getState().open, true);
            respondWithTeams([memberTeam]);
            finishLoginSpaceSelection((await listMyTeams())[0]);
            assert.deepEqual(destinations, ["/team/team2"]);
        });
        await context.test("禁用团队和禁用成员不能进入，仍可明确选择平台", () => {
            reset();
            completeAuthentication(createSession());
            assert.throws(() => finishLoginSpaceSelection({ ...memberTeam, enabled: false }), /禁用/);
            assert.throws(() => finishLoginSpaceSelection({ ...memberTeam, memberStatus: "disabled" }), /禁用/);
            assert.deepEqual(destinations, []);
            finishLoginSpaceSelection(null);
            assert.deepEqual(destinations, ["/"]);
        });
        await context.test("超级管理员不弹团队选择", () => {
            reset();
            completeAuthentication(createSession("admin"));
            assert.equal(useTeamSwitcherStore.getState().open, false);
            assert.deepEqual(destinations, ["/"]);
        });
        await context.test("平台登录附带团队目标仍先选择，选中对应团队保留明确目标", () => {
            reset();
            completeAuthentication(createSession(), "/team/team1/video?model=one#draft");
            assert.equal(useTeamSwitcherStore.getState().open, true);
            assert.deepEqual(destinations, []);
            finishLoginSpaceSelection(administratorTeam);
            assert.deepEqual(destinations, ["/team/team1/video?model=one#draft"]);
        });
        await context.test("无团队时保留明确团队目标，由对应入口校验权限，不自动回平台", () => {
            reset();
            completeAuthentication(createSession(), "/team/team1/video?model=one");
            finishLoginSpaceSelection();
            assert.deepEqual(destinations, ["/team/team1/video?model=one"]);
        });
        await context.test("团队密码入口直接恢复当前团队路径及参数", () => {
            reset("/team/team1/auth");
            completeAuthentication(createSession(), "/team/team1/video?model=one#draft");
            assert.equal(useTeamSwitcherStore.getState().open, false);
            assert.deepEqual(destinations, ["/team/team1/video?model=one#draft"]);
        });
        await context.test("平台 OAuth 先选择空间，团队 OAuth 直接回对应团队", () => {
            for (const [entry, destination] of [["/auth", "/video?model=one"], ["/team/team1/auth", "/team/team1/video?model=one"]]) {
                reset(entry);
                assert.equal(storeOAuth2Redirect(destination), true);
                location.pathname = "/auth/oauthCallback";
                completeAuthentication(createSession(), consumeOAuth2Redirect());
                assert.equal(useTeamSwitcherStore.getState().open, entry === "/auth");
                if (entry === "/auth") { assert.deepEqual(destinations, []); finishLoginSpaceSelection(null); }
                assert.deepEqual(destinations, [destination]);
            }
        });
        await context.test("退出会清除选择状态，迟到的选择不再跳转", () => {
            reset();
            completeAuthentication(createSession());
            useUserStore.getState().clearSession();
            finishLoginSpaceSelection(memberTeam);
            assert.deepEqual(destinations, ["/auth"]);
            assert.deepEqual(useTeamSwitcherStore.getState(), { open: false, loginTarget: "", switchingTo: "" });
        });
        await context.test("选择状态不随登录信息持久化，刷新恢复登录不再弹窗", () => {
            reset();
            completeAuthentication(createSession());
            finishLoginSpaceSelection(null);
            unsubscribe();
            useUserStore.setState({ token: "", user: null, hydrated: false, authenticationRedirect: "" });
            useTeamSwitcherStore.setState({ open: false, loginTarget: "", switchingTo: "" });
            destinations.length = 0;
            useUserStore.getState().hydrateSession();
            unsubscribe = subscribeSessionNavigation(() => controller.abort());
            assert.equal(useUserStore.getState().token, "new-token");
            assert.equal(useUserStore.getState().authenticationRedirect, "");
            assert.equal(useTeamSwitcherStore.getState().open, false);
            assert.deepEqual(destinations, []);
        });
    } finally {
        unsubscribe?.();
        globalThis.fetch = previousFetch;
        useUserStore.setState(previousUser);
        useTeamStore.setState(previousTeam);
        useTeamSwitcherStore.setState(previousSwitcher);
        if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
        else Reflect.deleteProperty(globalThis, "window");
    }
});
