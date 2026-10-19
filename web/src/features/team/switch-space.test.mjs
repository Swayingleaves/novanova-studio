import assert from "node:assert/strict";
import { test } from "node:test";
import { useScriptStore } from "../script/stores/use-script-store.ts";
import { useCanvasStore } from "../canvas/stores/use-canvas-store.ts";
import { useTeamStore } from "./stores/use-team-store.ts";
import { switchSpace } from "./switch-space.ts";

/** 验证选择目标之后的保存顺序和失败保护，不访问浏览器或持久化真实创作数据。 */
test("团队切换保存成功才导航，失败保留当前空间", async (context) => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const previousSaveAll = useScriptStore.getState().saveAll;
    const previousCanvas = useCanvasStore.getState();
    const previousTeam = useTeamStore.getState();
    const team = { id: 101, teamSlug: "team1", name: "当前团队", enabled: true, logoUrl: "" };
    const destinations = [];
    const errors = [];
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
        location: { assign: (path) => destinations.push(path) },
        dispatchEvent: (event) => { errors.push(event.detail); return true; },
    } });
    useTeamStore.setState({ team, ready: true });
    useCanvasStore.setState({ hydrated: false, documents: [], saveErrors: {} });
    try {
        await context.test("等待保存完成后直接进入选定团队，不经平台中转", async () => {
            let completeSave;
            let reportSaveStarted;
            const savingStarted = new Promise((resolve) => { reportSaveStarted = resolve; });
            useScriptStore.setState({ saveAll: () => {
                reportSaveStarted();
                return new Promise((resolve) => { completeSave = resolve; });
            } });
            const switching = switchSpace("/team/team2");
            await savingStarted;
            assert.deepEqual(destinations, []);
            assert.equal(useTeamStore.getState().team, team);
            completeSave(true);
            assert.equal(await switching, true);
            assert.deepEqual(destinations, ["/team/team2"]);
            assert.deepEqual(errors, []);
        });
        await context.test("剧本保存失败不离开当前团队", async () => {
            destinations.length = 0;
            useScriptStore.setState({ saveAll: async () => false });
            assert.equal(await switchSpace("/team/team2"), false);
            assert.deepEqual(destinations, []);
            assert.equal(useTeamStore.getState().team, team);
            assert.match(errors.pop(), /剧本保存失败/);
        });
        await context.test("画布有保存错误时保留团队并提示错误", async () => {
            useScriptStore.setState({ saveAll: async () => true });
            useCanvasStore.setState({ hydrated: true, documents: [], saveErrors: { document1: "保存失败" } });
            assert.equal(await switchSpace("/team/team2"), false);
            assert.deepEqual(destinations, []);
            assert.equal(useTeamStore.getState().team, team);
            assert.match(errors.pop(), /画布存在保存错误/);
        });
        await context.test("明确选择平台空间后才导航到平台入口", async () => {
            useCanvasStore.setState({ hydrated: false, saveErrors: {} });
            assert.equal(await switchSpace("/"), true);
            assert.deepEqual(destinations, ["/"]);
            assert.equal(useTeamStore.getState().team, team);
        });
    } finally {
        useScriptStore.setState({ saveAll: previousSaveAll });
        useCanvasStore.setState(previousCanvas);
        useTeamStore.setState(previousTeam);
        if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
        else Reflect.deleteProperty(globalThis, "window");
    }
});
