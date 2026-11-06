import assert from "node:assert/strict";
import { test } from "node:test";
import { useUserStore } from "../../auth/stores/use-user-store.ts";
import { useTeamStore } from "../../team/stores/use-team-store.ts";
import { openHomepageCanvas, openHomepageCanvasStarter, openHomepageGeneration, readHomepageCanvasStarter, startHomepageCreation } from "./homepage-navigation.ts";

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
        await context.test("视频与画布创作进入对应页面", () => {
            location.pathname = "/";
            useTeamStore.getState().setTeam(null);
            useUserStore.setState({ user: { id: "1" }, showAuthModal: false, pendingRedirect: "" });
            startHomepageCreation(prompt, "video");
            const video = new URL(destinations.at(-1), "http://localhost:15555");
            assert.equal(video.pathname, "/video");
            assert.equal(video.searchParams.get("initialPrompt"), prompt);
            startHomepageCreation(prompt, "canvas");
            const canvas = new URL(destinations.at(-1), "http://localhost:15555");
            assert.equal(canvas.pathname, "/canvas");
            assert.equal(canvas.searchParams.get("initialPrompt"), prompt);
        });
        await context.test("未填写提示词时仍可打开画布列表", () => {
            const previousDestinations = destinations.length;
            openHomepageCanvas(" \n ");
            assert.equal(destinations.length, previousDestinations + 1);
            const canvas = new URL(destinations.at(-1), "http://localhost:15555");
            assert.equal(canvas.pathname, "/canvas");
            assert.equal(canvas.search, "");
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
        await context.test("已保存草稿的生成只进入目标页面，不带初始提示词", () => {
            location.pathname = "/";
            useTeamStore.getState().setTeam(null);
            useUserStore.setState({ user: { id: "1" }, showAuthModal: false, pendingRedirect: "" });
            openHomepageGeneration("video");
            const video = new URL(destinations.at(-1), "http://localhost:15555");
            assert.equal(video.pathname, "/video");
            assert.equal(video.search, "");
            useUserStore.setState({ user: null, showAuthModal: false, pendingRedirect: "" });
            openHomepageGeneration("image");
            assert.equal(useUserStore.getState().showAuthModal, true);
            assert.equal(useUserStore.getState().pendingRedirect, "/image");
        });
        await context.test("画布模板分别进入空白画布、图片节点和视频节点", () => {
            location.pathname = "/";
            useTeamStore.getState().setTeam(null);
            useUserStore.setState({ user: { id: "1" }, showAuthModal: false, pendingRedirect: "" });
            openHomepageCanvasStarter("blank");
            assert.equal(destinations.at(-1), "/canvas?newCanvas=1");
            openHomepageCanvasStarter("image");
            assert.equal(destinations.at(-1), "/canvas?initialNode=image");
            openHomepageCanvasStarter("video");
            assert.equal(destinations.at(-1), "/canvas?initialNode=video");
            assert.equal(readHomepageCanvasStarter("?newCanvas=1"), "blank");
            assert.equal(readHomepageCanvasStarter("?initialNode=image"), "image");
            assert.equal(readHomepageCanvasStarter("?initialNode=video"), "video");
            assert.equal(readHomepageCanvasStarter("?initialNode=audio"), null);
            useUserStore.setState({ user: null, showAuthModal: false, pendingRedirect: "" });
            openHomepageCanvasStarter("video");
            assert.equal(useUserStore.getState().pendingRedirect, "/canvas?initialNode=video");
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
