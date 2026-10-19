import assert from "node:assert/strict";
import { test } from "node:test";
import { useUserStore } from "../auth/stores/use-user-store.ts";
import { getCurrentUserInfo, loginByAccount } from "../../services/api/server.ts";
import { teamPath, useTeamStore } from "./stores/use-team-store.ts";
import { subscribeSessionNavigation } from "./session-navigation.ts";

const team = { id: 101, teamSlug: "team1", name: "测试团队", enabled: true, logoUrl: "", memberRole: "administrator" };

/** 构造两个独立账号的登录结果，复用真实会话写入与清除流程。 */
function createSession(userId, token = `token-${userId}`) {
    return { token, expiresAt: "2099-01-01T00:00:00.000Z", user: {
        id: userId, username: `user-${userId}`, nickname: "测试账号", avatar: "", email: null,
        role: "user", status: 1, creditBalance: "0", welcomeRead: true,
    } };
}

test("登录会话变化隔离团队地址和钱包", async (context) => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const previousFetch = globalThis.fetch;
    const previousUser = useUserStore.getState();
    const previousTeam = useTeamStore.getState();
    const storedValues = new Map();
    const destinations = [];
    let reloads = 0;
    let controller;
    const browserLocation = {
        origin: "http://localhost:15555", pathname: "/team/team1",
        replace: (path) => { destinations.push(path); browserLocation.pathname = path; },
        reload: () => { reloads += 1; },
    };
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
        location: browserLocation,
        localStorage: {
            getItem: (key) => storedValues.get(key) ?? null,
            setItem: (key, value) => storedValues.set(key, value),
            removeItem: (key) => storedValues.delete(key),
        },
    } });
    const reset = (signedIn = true, ready = true) => {
        controller = new AbortController();
        storedValues.clear();
        destinations.length = 0;
        reloads = 0;
        browserLocation.pathname = "/team/team1";
        useUserStore.setState({ ...previousUser, token: "", user: null, hydrated: true, pendingRedirect: "", showAuthModal: false });
        useTeamStore.setState({ ...previousTeam, team, ready, wallets: { platformBalance: "10", teamBalance: "20" } });
        if (signedIn) useUserStore.getState().setSession(createSession(1));
        return subscribeSessionNavigation(() => controller.abort());
    };
    try {
        await context.test("退出回当前团队登录页，新账号登录请求不复用旧团队状态", async () => {
            const unsubscribe = reset();
            const requests = [];
            globalThis.fetch = async (input, options) => {
                const headers = new Headers(options?.headers);
                const path = new URL(String(input)).pathname;
                requests.push({ path, teamId: headers.get("X-Team-Id"), authorization: headers.get("Authorization") });
                return new Response(JSON.stringify({ code: 0, data: path.endsWith("/login") ? createSession(2) : createSession(2).user, msg: "成功" }), { headers: { "Content-Type": "application/json" } });
            };
            try {
                useUserStore.setState({ showAuthModal: true, pendingRedirect: "/team/team1/admin/system" });
                useUserStore.getState().clearSession();
                assert.deepEqual(destinations, ["/team/team1/auth"]);
                assert.equal(reloads, 0);
                assert.equal(controller.signal.aborted, true);
                assert.equal(useTeamStore.getState().team, null);
                assert.equal(useTeamStore.getState().wallets, null);
                assert.equal(useTeamStore.getState().ready, false);
                assert.equal(useUserStore.getState().pendingRedirect, "");
                assert.equal(useUserStore.getState().showAuthModal, false);
                assert.equal(storedValues.size, 0);
                useTeamStore.getState().setTeam(null);
                useUserStore.getState().setSession(await loginByAccount({ account: "user-2", password: "password123" }));
                await getCurrentUserInfo();
                assert.equal(browserLocation.pathname, "/team/team1/auth");
                assert.equal(teamPath("/"), "/");
                assert.equal(useUserStore.getState().user.id, "2");
                assert.deepEqual(requests.map(({ teamId }) => teamId), [null, null]);
                assert.equal(requests[1].authorization, "Bearer token-2");
                assert.deepEqual(destinations, ["/team/team1/auth"]);
                assert.equal(reloads, 1);
            } finally { unsubscribe(); }
        });
        await context.test("直接更换已登录账号返回平台，不复用团队身份和余额", () => {
            const unsubscribe = reset();
            try {
                useUserStore.getState().setSession(createSession(2));
                assert.deepEqual(destinations, ["/"]);
                assert.equal(useTeamStore.getState().team, null);
                assert.equal(useTeamStore.getState().wallets, null);
                assert.equal(controller.signal.aborted, true);
                assert.equal(reloads, 0);
            } finally { unsubscribe(); }
        });
        await context.test("团队身份校验未结束时退出也会中止请求并返回对应团队登录页", () => {
            const unsubscribe = reset(true, false);
            try {
                useUserStore.getState().clearSession();
                assert.deepEqual(destinations, ["/team/team1/auth"]);
                assert.equal(controller.signal.aborted, true);
                assert.equal(useTeamStore.getState().team, null);
                useUserStore.getState().clearSession();
                assert.deepEqual(destinations, ["/team/team1/auth"]);
            } finally { unsubscribe(); }
        });
        await context.test("退出目标只依据当前 URL，不受缓存团队状态或业务页面影响", () => {
            for (const [pathname, destination] of [["/team/team1", "/team/team1/auth"], ["/team/team2/canvas/project1", "/team/team2/auth"], ["/team/team2/admin/system", "/team/team2/auth"], ["/", "/auth"], ["/profile", "/auth"]]) {
                const unsubscribe = reset();
                try {
                    browserLocation.pathname = pathname;
                    useUserStore.getState().clearSession();
                    assert.deepEqual(destinations, [destination]);
                    assert.equal(useTeamStore.getState().team, null);
                    assert.equal(useTeamStore.getState().wallets, null);
                    assert.equal(reloads, 0);
                } finally { unsubscribe(); }
            }
        });
        await context.test("主动打开团队入口登录仍保留目标地址以重新校验成员身份", () => {
            const unsubscribe = reset(false);
            try {
                useUserStore.getState().setSession(createSession(2));
                assert.deepEqual(destinations, []);
                assert.equal(browserLocation.pathname, "/team/team1");
                assert.equal(reloads, 1);
                assert.equal(controller.signal.aborted, true);
            } finally { unsubscribe(); }
        });
        await context.test("余额及资料变化不触发导航，同账号换令牌重新验证当前空间", () => {
            const unsubscribe = reset();
            try {
                useUserStore.getState().setCreditBalance("3.123456");
                useUserStore.getState().setUser({ ...createSession(1).user, nickname: "新昵称" });
                assert.equal(reloads, 0);
                assert.deepEqual(destinations, []);
                useUserStore.getState().setSession(createSession(1, "renewed-token"));
                assert.equal(reloads, 1);
                assert.deepEqual(destinations, []);
                assert.equal(browserLocation.pathname, "/team/team1");
            } finally { unsubscribe(); }
        });
    } finally {
        globalThis.fetch = previousFetch;
        useUserStore.setState(previousUser);
        useTeamStore.setState(previousTeam);
        if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
        else Reflect.deleteProperty(globalThis, "window");
    }
});
