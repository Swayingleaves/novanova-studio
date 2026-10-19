import assert from "node:assert/strict";
import { test } from "node:test";
import { useUserStore } from "../../auth/stores/use-user-store.ts";
import { useTeamStore } from "../../team/stores/use-team-store.ts";
import { startHomepageCreation } from "./homepage-navigation.ts";

test("首页创作与访客登录目标保留团队上下文及完整提示词", async (context) => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const previousUser = useUserStore.getState();
    const previousTeam = useTeamStore.getState();
    const destinations = [];
    const prompt = "中文 & Mixed Case / ? # 换行\n继续创作";
    const location = { pathname: "/", assign: (path) => destinations.push(path) };
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location } });
    try {
        await context.test("团队甲与团队乙分别进入自身的创作页面", () => {
            useUserStore.setState({ user: { id: "1" }, showAuthModal: false, pendingRedirect: "" });
            for (const teamSlug of ["team1", "team2"]) {
                location.pathname = `/team/${teamSlug}`;
                useTeamStore.getState().setTeam({ id: teamSlug === "team1" ? 101 : 102, teamSlug, name: "团队", logoUrl: "", enabled: true });
                startHomepageCreation(`  ${prompt}  `);
                const destination = new URL(destinations.at(-1), "http://localhost:15555");
                assert.equal(destination.pathname, `/team/${teamSlug}/image`);
                assert.equal(destination.searchParams.get("initialPrompt"), prompt);
            }
            assert.equal(useUserStore.getState().showAuthModal, false);
        });
        await context.test("平台创作保持平台路径", () => {
            location.pathname = "/";
            useTeamStore.getState().setTeam(null);
            startHomepageCreation(prompt);
            assert.equal(new URL(destinations.at(-1), "http://localhost:15555").pathname, "/image");
        });
        await context.test("团队访客进入专属登录页，目标保留当前团队和提示词", () => {
            const previousDestinations = destinations.length;
            location.pathname = "/team/team1";
            useUserStore.setState({ user: null, showAuthModal: false, pendingRedirect: "" });
            useTeamStore.getState().setTeam({ id: 101, teamSlug: "team1", name: "团队", logoUrl: "", enabled: true });
            startHomepageCreation(prompt);
            assert.equal(destinations.length, previousDestinations + 1);
            assert.equal(useUserStore.getState().showAuthModal, false);
            const login = new URL(destinations.at(-1), "http://localhost:15555");
            assert.equal(login.pathname, "/team/team1/auth");
            const target = new URL(login.searchParams.get("redirect"), "http://localhost:15555");
            assert.equal(target.pathname, "/team/team1/image");
            assert.equal(target.searchParams.get("initialPrompt"), prompt);
        });
        await context.test("空白提示词不导航也不打开登录窗口", () => {
            const previousDestinations = destinations.length;
            useUserStore.getState().closeAuthModal();
            startHomepageCreation(" \n ");
            assert.equal(destinations.length, previousDestinations);
            assert.equal(useUserStore.getState().showAuthModal, false);
        });
    } finally {
        useUserStore.setState(previousUser);
        useTeamStore.setState(previousTeam);
        if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
        else Reflect.deleteProperty(globalThis, "window");
    }
});
