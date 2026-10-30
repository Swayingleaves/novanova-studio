import assert from "node:assert/strict";
import test from "node:test";

import { consumePwaLaunchParam, isBaseRootPath, stripLaunchParam } from "./pwa-launch.ts";

test("isBaseRootPath：识别 base 根路径，深层链接不算", () => {
    assert.equal(isBaseRootPath(new URL("https://app.example.com/"), "/"), true);
    assert.equal(isBaseRootPath(new URL("https://app.example.com/?pwa-launch=1"), "/"), true);
    assert.equal(isBaseRootPath(new URL("https://app.example.com/canvas"), "/"), false);
    assert.equal(isBaseRootPath(new URL("https://app.example.com/canvas?id=1"), "/"), false);

    assert.equal(isBaseRootPath(new URL("https://app.example.com/app"), "/app/"), true);
    assert.equal(isBaseRootPath(new URL("https://app.example.com/app/"), "/app/"), true);
    assert.equal(isBaseRootPath(new URL("https://app.example.com/app/canvas"), "/app/"), false);
});

test("stripLaunchParam：剥离 pwa-launch 并保留其余参数与 hash", () => {
    assert.equal(stripLaunchParam("https://app.example.com/?pwa-launch=1"), "/");
    assert.equal(stripLaunchParam("https://app.example.com/?pwa-launch=1&foo=1"), "/?foo=1");
    assert.equal(stripLaunchParam("https://app.example.com/?foo=1&pwa-launch=1"), "/?foo=1");
    assert.equal(stripLaunchParam("https://app.example.com/?foo=1&pwa-launch=1&bar=2"), "/?foo=1&bar=2");
    assert.equal(stripLaunchParam("https://app.example.com/?pwa-launch=1#section"), "/#section");
    assert.equal(stripLaunchParam("https://app.example.com/"), "/");
    assert.equal(stripLaunchParam("https://app.example.com/?foo=1"), "/?foo=1");
});

interface FakeWindow {
    location: { href: string };
    history: {
        replaceStateCalls: Array<unknown[]>;
        replaceState(...args: unknown[]): void;
    };
}

function installFakeWindow(href: string): FakeWindow {
    const fake: FakeWindow = {
        location: { href },
        history: {
            replaceStateCalls: [],
            replaceState(...args: unknown[]) {
                this.replaceStateCalls.push(args);
            },
        },
    };
    (globalThis as unknown as { window: unknown }).window = fake;
    return fake;
}

test("consumePwaLaunchParam：根路径消费并清除启动参数", () => {
    const fake = installFakeWindow("https://app.example.com/?pwa-launch=1&foo=2");

    consumePwaLaunchParam("/");

    assert.equal(fake.history.replaceStateCalls.length, 1);
    const [, , url] = fake.history.replaceStateCalls[0] as [unknown, unknown, string];
    assert.equal(url, "/?foo=2");

    (globalThis as unknown as { window: unknown }).window = undefined;
});

test("consumePwaLaunchParam：深层链接原样保留参数", () => {
    const fake = installFakeWindow("https://app.example.com/canvas?pwa-launch=1");

    consumePwaLaunchParam("/");

    assert.equal(fake.history.replaceStateCalls.length, 0);
    assert.equal(fake.location.href, "https://app.example.com/canvas?pwa-launch=1");

    (globalThis as unknown as { window: unknown }).window = undefined;
});

test("consumePwaLaunchParam：无参数时不做任何操作", () => {
    const fake = installFakeWindow("https://app.example.com/");

    consumePwaLaunchParam("/");

    assert.equal(fake.history.replaceStateCalls.length, 0);

    (globalThis as unknown as { window: unknown }).window = undefined;
});
