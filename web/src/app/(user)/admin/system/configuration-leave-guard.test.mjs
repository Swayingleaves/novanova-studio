import assert from "node:assert/strict";
import { test } from "node:test";
import { leavesConfigurationPage, registerConfigurationLeaveGuard } from "./configuration-leave-guard.ts";
import { confirmPageNavigation } from "@/shared/lib/navigation-history-guard";

test("同一后台页签保留配置，跨团队、业务页面和外部链接属于离开", () => {
    const current = "http://localhost:15555/team/team1/admin/system";
    for (const target of ["#models", "?tab=configuration", current]) assert.equal(leavesConfigurationPage(target, current), false);
    for (const target of ["/team/team1", "/team/team2/admin/system", "/admin/system", "https://example.com"]) assert.equal(leavesConfigurationPage(target, current), true);
});

test("未保存配置在确认前拦截导航，取消、忽略和卸载后的结果均不丢弃草稿", async (context) => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    const browser = new EventTarget();
    const document = new EventTarget();
    browser.location = { href: "http://localhost:15555/team/team1/admin/system", origin: "http://localhost:15555", pathname: "/team/team1/admin/system" };
    Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
    Object.defineProperty(globalThis, "document", { configurable: true, value: document });
    const destinations = [];
    let confirmation;
    let confirmations;
    let dispose;
    const reset = () => {
        dispose?.();
        destinations.length = 0;
        confirmations = 0;
        dispose = registerConfigurationLeaveGuard(() => { confirmations += 1; return new Promise((resolve) => { confirmation = resolve; }); }, (destination) => destinations.push(destination));
    };
    const click = (href = "/team/team1/image", patch = {}, attributes = {}) => {
        const event = new Event("click", { cancelable: true });
        const link = { href: new URL(href, browser.location.href).href, target: "", hasAttribute: (name) => Boolean(attributes[name]), ...attributes };
        Object.defineProperties(event, {
            target: { value: { closest: () => link } },
            button: { value: 0 },
            ...Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, { value }])),
        });
        document.dispatchEvent(event);
        return event;
    };
    try {
        await context.test("取消离开保留原页面，之后仍可重新确认", async () => {
            reset();
            assert.equal(click().defaultPrevented, true);
            confirmation(false);
            await new Promise((resolve) => setImmediate(resolve));
            assert.deepEqual(destinations, []);
            assert.equal(click().defaultPrevented, true);
            confirmation(true);
            await new Promise((resolve) => setImmediate(resolve));
            assert.deepEqual(destinations, ["http://localhost:15555/team/team1/image"]);
        });
        await context.test("重复点击只产生一次确认和导航", async () => {
            reset();
            click(); click();
            assert.equal(confirmations, 1);
            assert.deepEqual(destinations, []);
            confirmation(true);
            await new Promise((resolve) => setImmediate(resolve));
            assert.equal(destinations.length, 1);
        });
        await context.test("退出登录与程序化跳转在改变会话前确认，同后台参数调整不提示", async () => {
            reset();
            assert.equal(await confirmPageNavigation("/team/team1/admin/system?tab=team"), true);
            assert.equal(confirmations, 0);
            const logout = confirmPageNavigation();
            assert.equal(await confirmPageNavigation("/team/team2"), false);
            confirmation(false);
            assert.equal(await logout, false);
            const leave = confirmPageNavigation("/team/team2");
            confirmation(true);
            assert.equal(await leave, true);
        });
        await context.test("页内链接、新标签页、修饰键和下载均不拦截", () => {
            reset();
            assert.equal(click("#models").defaultPrevented, false);
            assert.equal(click("?tab=configuration").defaultPrevented, false);
            assert.equal(click(undefined, { ctrlKey: true }).defaultPrevented, false);
            assert.equal(click(undefined, {}, { target: "_blank" }).defaultPrevented, false);
            assert.equal(click(undefined, {}, { download: true }).defaultPrevented, false);
            assert.equal(click("mailto:help@example.com").defaultPrevented, false);
            assert.equal(confirmations, 0);
        });
        await context.test("刷新及关闭请求浏览器确认，明确放弃后不重复提示", async () => {
            reset();
            const unload = new Event("beforeunload", { cancelable: true });
            browser.dispatchEvent(unload);
            assert.equal(unload.defaultPrevented, true);
            click(); confirmation(true);
            await new Promise((resolve) => setImmediate(resolve));
            const acceptedUnload = new Event("beforeunload", { cancelable: true });
            browser.dispatchEvent(acceptedUnload);
            assert.equal(acceptedUnload.defaultPrevented, false);
        });
        await context.test("退出配置组件后解除拦截，迟到确认不导航到旧空间", async () => {
            reset();
            click(); dispose(); confirmation(true);
            await new Promise((resolve) => setImmediate(resolve));
            assert.deepEqual(destinations, []);
            assert.equal(click().defaultPrevented, false);
            const unload = new Event("beforeunload", { cancelable: true });
            browser.dispatchEvent(unload);
            assert.equal(unload.defaultPrevented, false);
        });
    } finally {
        dispose?.();
        for (const [name, descriptor] of [["window", previousWindow], ["document", previousDocument]]) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else Reflect.deleteProperty(globalThis, name);
        }
    }
});
