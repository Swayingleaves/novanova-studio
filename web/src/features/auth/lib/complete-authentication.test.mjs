import assert from "node:assert/strict";
import { test } from "node:test";
import { useUserStore } from "../stores/use-user-store.ts";
import { useTeamStore } from "../../team/stores/use-team-store.ts";
import { finishLoginSpaceSelection, useTeamSwitcherStore } from "../../team/stores/use-team-switcher-store.ts";
import { subscribeSessionNavigation } from "../../team/session-navigation.ts";
import { consumeOAuth2Redirect, storeOAuth2Redirect } from "./oauth2-login.ts";
import { completeAuthentication } from "./complete-authentication.ts";
import { getCurrentUserInfo, loginByAccount } from "../../../services/api/server.ts";

/** 构造固定账号的全局认证结果，不访问真实登录服务。 */
function session(token = "new-token", userId = 1) {
    return { token, expiresAt: "2099-01-01T00:00:00.000Z", user: {
        id: userId, username: `user-${userId}`, nickname: "测试账号", email: null, avatar: "", role: "user", status: 1, creditBalance: "0", welcomeRead: true,
    } };
}

test("登录入口与完成流程只执行一次正确的空间导航", async (context) => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const previousFetch = globalThis.fetch;
    const previousUser = useUserStore.getState();
    const previousTeam = useTeamStore.getState();
    const previousSwitcher = useTeamSwitcherStore.getState();
    const localValues = new Map();
    const sessionValues = new Map();
    const destinations = [];
    const team = { id: 101, teamSlug: "team1", name: "团队一", logoUrl: "", enabled: true };
    let reloads = 0;
    let controller;
    let unsubscribe;
    const location = { pathname: "/", search: "", hash: "", origin: "http://localhost:15555",
        assign: (path) => destinations.push({ method: "assign", path }),
        replace: (path) => destinations.push({ method: "replace", path }),
        reload: () => { reloads += 1; },
    };
    const storage = (values) => ({ getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) });
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location, localStorage: storage(localValues), sessionStorage: storage(sessionValues) } });
    const reset = (path, signedIn = false) => {
        unsubscribe?.();
        localValues.clear();
        sessionValues.clear();
        destinations.length = 0;
        reloads = 0;
        controller = new AbortController();
        location.pathname = path;
        useUserStore.setState({ ...previousUser, user: null, token: "", hydrated: true, authenticationRedirect: "", pendingRedirect: "", showAuthModal: false });
        useTeamStore.setState({ ...previousTeam, team: path.startsWith("/team/") ? team : null, ready: true, wallets: null });
        useTeamSwitcherStore.setState({ open: false, loginTarget: "", switchingTo: "" });
        if (signedIn) useUserStore.getState().setSession(session("existing-token"));
        unsubscribe = subscribeSessionNavigation(() => controller.abort());
    };
    try {
        await context.test("平台登录保留弹窗，成功后先检查团队，进入平台保留原目标", () => {
            reset("/");
            useUserStore.getState().openAuthModal("/image?model=one");
            assert.equal(useUserStore.getState().showAuthModal, true);
            assert.deepEqual(destinations, []);
            completeAuthentication(session(), useUserStore.getState().pendingRedirect);
            assert.deepEqual(destinations, []);
            assert.equal(useTeamSwitcherStore.getState().open, true);
            assert.equal(useTeamSwitcherStore.getState().loginTarget, "/image?model=one");
            finishLoginSpaceSelection(null);
            assert.deepEqual(destinations, [{ method: "replace", path: "/image?model=one" }]);
            assert.equal(reloads, 0);
            assert.equal(controller.signal.aborted, true);
            assert.equal(useTeamStore.getState().ready, false);
            const stored = JSON.parse([...localValues.values()][0]);
            assert.equal(stored.token, "new-token");
            assert.equal(stored.authenticationRedirect, undefined);
        });
        await context.test("团队登录按钮进入专属 URL，不打开弹窗或复用旧账号团队", () => {
            reset("/team/team1");
            useUserStore.getState().openAuthModal();
            assert.deepEqual(destinations, [{ method: "assign", path: "/team/team1/auth" }]);
            assert.equal(useUserStore.getState().showAuthModal, false);
            reset("/auth");
            useTeamStore.setState({ team });
            completeAuthentication(session());
            assert.deepEqual(destinations, []);
            assert.equal(useTeamStore.getState().team, null);
            finishLoginSpaceSelection(null);
            assert.deepEqual(destinations, [{ method: "replace", path: "/" }]);
        });
        await context.test("团队密码登录默认返回团队首页，明确目标完整保留参数", () => {
            reset("/team/team1/auth");
            completeAuthentication(session());
            assert.deepEqual(destinations, [{ method: "replace", path: "/team/team1" }]);
            assert.equal(reloads, 0);
            reset("/team/team1/auth");
            completeAuthentication(session(), "/team/team1/image?initialPrompt=%E4%B8%AD%E6%96%87%26Test#node1");
            assert.deepEqual(destinations, [{ method: "replace", path: "/team/team1/image?initialPrompt=%E4%B8%AD%E6%96%87%26Test#node1" }]);
        });
        await context.test("认证目标无效时不写入新会话，不静默切换团队", () => {
            reset("/team/team1/auth");
            for (const path of ["https://example.com", "/team/team2", "/team/team1/auth"]) assert.throws(() => completeAuthentication(session(), path));
            assert.equal(useUserStore.getState().token, "");
            assert.deepEqual(destinations, []);
            assert.equal(localValues.size, 0);
        });
        await context.test("同账号同令牌完成认证也只执行一次目标导航", () => {
            reset("/team/team1/auth", true);
            completeAuthentication(session("existing-token"), "/team/team1/image");
            assert.deepEqual(destinations, [{ method: "replace", path: "/team/team1/image" }]);
            assert.equal(reloads, 0);
        });
        await context.test("OAuth 全局回调恢复团队目标，存储目标消费后立即清除", () => {
            reset("/team/team1/auth");
            assert.equal(storeOAuth2Redirect("/team/team1/video?model=x"), true);
            location.pathname = "/auth/oauthCallback";
            useTeamStore.getState().setTeam(null);
            const target = consumeOAuth2Redirect();
            assert.equal(target, "/team/team1/video?model=x");
            assert.equal(sessionValues.size, 0);
            completeAuthentication(session(), target);
            assert.equal(useTeamSwitcherStore.getState().open, false);
            assert.deepEqual(destinations, [{ method: "replace", path: "/team/team1/video?model=x" }]);
            assert.equal(reloads, 0);
        });
        await context.test("OAuth 未指定目标默认团队首页，跨团队目标和认证循环均拒绝", () => {
            reset("/team/team1/auth");
            assert.equal(storeOAuth2Redirect(), true);
            location.pathname = "/auth/oauthCallback";
            assert.equal(consumeOAuth2Redirect(), "/team/team1");
            location.pathname = "/team/team1/auth";
            assert.equal(storeOAuth2Redirect("/team/team2/image"), false);
            assert.equal(sessionValues.size, 0);
            sessionValues.set("novanova:oauth2:redirect:v1", "/team/team1/auth");
            assert.throws(() => consumeOAuth2Redirect(), /认证页面/);
        });
        await context.test("错误密码的 401 不清理当前会话或刷新团队登录页", async () => {
            reset("/team/team1/auth", true);
            globalThis.fetch = async () => new Response(JSON.stringify({ code: 401, data: null, msg: "密码错误" }), { status: 401, headers: { "Content-Type": "application/json" } });
            await assert.rejects(() => loginByAccount({ account: "user", password: "wrong-password" }), /密码错误/);
            assert.equal(useUserStore.getState().token, "existing-token");
            assert.deepEqual(destinations, []);
            assert.equal(reloads, 0);
        });
        await context.test("旧请求的 401 不会退出后来登录的新账号", async () => {
            reset("/auth", true);
            let respond;
            globalThis.fetch = () => new Promise((resolve) => { respond = resolve; });
            const oldRequest = getCurrentUserInfo();
            completeAuthentication(session("replacement-token"));
            respond(new Response(JSON.stringify({ code: 401, data: null, msg: "旧令牌已失效" }), { status: 401, headers: { "Content-Type": "application/json" } }));
            await assert.rejects(() => oldRequest, /旧令牌已失效/);
            assert.equal(useUserStore.getState().token, "replacement-token");
            assert.deepEqual(destinations, []);
            finishLoginSpaceSelection(null);
            assert.deepEqual(destinations, [{ method: "replace", path: "/" }]);
        });
        await context.test("当前会话失效仅返回当前团队登录页一次", async () => {
            reset("/team/team1/image", true);
            globalThis.fetch = async () => new Response(JSON.stringify({ code: 401, data: null, msg: "令牌已失效" }), { status: 401, headers: { "Content-Type": "application/json" } });
            await assert.rejects(() => getCurrentUserInfo(), /令牌已失效/);
            assert.deepEqual(destinations, [{ method: "replace", path: "/team/team1/auth" }]);
            assert.equal(useUserStore.getState().token, "");
            assert.equal(useTeamStore.getState().team, null);
        });
        await context.test("多个旧请求同时失效时不会重复发起团队退出跳转", async () => {
            reset("/team/team1/image", true);
            const responses = [];
            globalThis.fetch = () => new Promise((resolve) => responses.push(resolve));
            const requests = [getCurrentUserInfo(), getCurrentUserInfo()];
            for (let index = 0; index < responses.length; index += 1) {
                responses[index](new Response(JSON.stringify({ code: 401, data: null, msg: "令牌已失效" }), { status: 401, headers: { "Content-Type": "application/json" } }));
                await assert.rejects(() => requests[index], /令牌已失效/);
            }
            assert.deepEqual(destinations, [{ method: "replace", path: "/team/team1/auth" }]);
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
